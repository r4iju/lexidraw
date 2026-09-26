import Foundation
import LexidrawKit
import Synchronization
import Testing

/// The server's answers about a file's audio, as it words them.
private enum Audio {
  static let ready = """
    {"status":"ready","segmentCount":2,"segments":[\
    {"index":0,"text":"Quarterly numbers.","audioUrl":"https://blob.test/a.mp3","sectionTitle":"Summary"},\
    {"index":1,"text":"They went up.","audioUrl":"https://blob.test/b.mp3"}]}
    """
  static let none = #"{"status":"none","segments":[]}"#
  static let queued = #"{"status":"queued","segments":[]}"#
  static let cancelled = #"{"status":"cancelled","segments":[]}"#

  static func processing(made: Int, of planned: Int) -> String {
    #"{"status":"processing","segmentCount":\#(made),"plannedCount":\#(planned),"segments":[]}"#
  }
}

/// Answers each request with the next of `answers`, the last one again once
/// they run out.
private func serverAnswering(_ answers: [(Int, String)]) -> FakeServer {
  let next = Mutex(0)
  return FakeServer { _ in
    let index = next.withLock { index in
      defer { index += 1 }
      return min(index, answers.count - 1)
    }
    return answers[index]
  }
}

private final class Reports: Sendable {
  private let seen = Mutex<[Recording.Progress]>([])
  var all: [Recording.Progress] { seen.withLock { $0 } }
  func add(_ progress: Recording.Progress) { seen.withLock { $0.append(progress) } }
}

@Suite struct RecordingTests {
  @Test func audioAlreadyMadeIsPlayedWithoutMakingItAgain() async throws {
    let server = serverAnswering([(200, Audio.ready)])
    let session = try TestServer.session(server)

    let recording = try await session.recording(of: "doc-1", pause: {})

    let request = try #require(server.requests.only)
    #expect(request.method == .get)
    #expect(request.url.path == "/api/v1/entities/doc-1/listen")
    #expect(
      recording.parts == [
        .init(text: "Quarterly numbers.", audio: URL(string: "https://blob.test/a.mp3")!, section: "Summary"),
        .init(text: "They went up.", audio: URL(string: "https://blob.test/b.mp3")!, section: nil),
      ])
  }

  /// As the web's Listen does: made on first listen, and waited for.
  @Test func audioNotMadeYetIsMadeAndWaitedFor() async throws {
    let server = serverAnswering([
      (200, Audio.none), (200, Audio.queued), (200, Audio.processing(made: 1, of: 3)), (200, Audio.ready),
    ])
    let session = try TestServer.session(server)
    let reports = Reports()
    let pauses = Mutex(0)

    let recording = try await session.recording(
      of: "doc-1", progress: reports.add, pause: { pauses.withLock { $0 += 1 } })

    #expect(server.requests.map(\.method) == [.get, .post, .get, .get])
    #expect(server.requests[1].url.path == "/api/v1/entities/doc-1/listen")
    #expect(reports.all == [.started, .made(1, of: 3)])
    #expect(pauses.withLock { $0 } == 2)
    #expect(recording.parts.count == 2)
  }

  /// Started on the web or another device a moment ago: starting it again
  /// would throw away what is made.
  @Test func audioBeingMadeIsWaitedForNotStartedAgain() async throws {
    let server = serverAnswering([(200, Audio.processing(made: 2, of: 3)), (200, Audio.ready)])
    let session = try TestServer.session(server)

    _ = try await session.recording(of: "doc-1", pause: {})

    #expect(server.requests.map(\.method) == [.get, .get])
  }

  @Test func audioThatFailedSaysWhy() async throws {
    let server = serverAnswering([(200, #"{"status":"error","error":"The voice service refused","segments":[]}"#)])
    let session = try TestServer.session(server)

    await #expect(throws: ListenFailed(message: "The voice service refused")) {
      try await session.recording(of: "doc-1", pause: {})
    }
  }

  @Test func aFileWithNothingToReadIsRefusedSayingSo() async throws {
    let server = serverAnswering([
      (200, Audio.none),
      (400, #"{"message":"There is nothing in this document to read aloud","code":"BAD_REQUEST"}"#),
    ])
    let session = try TestServer.session(server)

    let refusal = await #expect(throws: Refusal.self) {
      try await session.recording(of: "doc-1", pause: {})
    }
    #expect(refusal?.message == "There is nothing in this document to read aloud")
  }

  /// Starting it again would stop the other listen in turn, so neither
  /// would ever finish.
  @Test func audioStoppedByAListenElsewhereIsNotStartedAgain() async throws {
    let server = serverAnswering([(200, Audio.none), (200, Audio.queued), (200, Audio.cancelled)])
    let session = try TestServer.session(server)

    await #expect(throws: ListenFailed.self) {
      try await session.recording(of: "doc-1", pause: {})
    }
    #expect(server.requests.map(\.method) == [.get, .post, .get])
  }
}

@Suite struct RecordingPositionTests {
  private let recording = Recording(
    parts: (0..<3).map { .init(text: "Part \($0)", audio: URL(string: "https://blob.test/\($0).mp3")!, section: nil) })

  @Test func previousGoesBackToTheStartOfAPartWellUnderway() {
    #expect(recording.previous(from: .init(part: 1, seconds: 12)) == .init(part: 1, seconds: 0))
  }

  @Test func previousGoesToThePartBeforeFromNearTheStart() {
    #expect(recording.previous(from: .init(part: 1, seconds: 1)) == .init(part: 0, seconds: 0))
    #expect(recording.previous(from: .init(part: 0, seconds: 1)) == .init(part: 0, seconds: 0))
  }

  @Test func nextGoesToTheStartOfThePartAfterUntilTheLast() {
    #expect(recording.next(from: .init(part: 1, seconds: 5)) == .init(part: 2, seconds: 0))
    #expect(recording.next(from: .init(part: 2, seconds: 5)) == nil)
  }

  /// The audio may have been made again since, with fewer parts.
  @Test func aKeptPositionPastTheEndStartsOver() {
    #expect(recording.resuming(.init(part: 1, seconds: 7)) == .init(part: 1, seconds: 7))
    #expect(recording.resuming(.init(part: 3, seconds: 7)) == .init(part: 0, seconds: 0))
    #expect(recording.resuming(nil) == .init(part: 0, seconds: 0))
  }

  @Test func aPartIsNamedByItsPlaceAmongThemAll() {
    #expect(recording.partNumber(at: .init(part: 1, seconds: 7)) == "Part 2 of 3")
  }

  /// A part read under a heading is known by it.
  @Test func aPartIsTitledByItsSectionWhenItHasOne() {
    let sectioned = Recording(parts: [
      .init(text: "Up.", audio: URL(string: "https://blob.test/0.mp3")!, section: "Summary"),
      .init(text: "Down.", audio: URL(string: "https://blob.test/1.mp3")!, section: nil),
    ])

    #expect(sectioned.partTitle(at: .start) == "Summary")
    #expect(sectioned.partTitle(at: .init(part: 1, seconds: 0)) == "Part 2 of 2")
  }
}

@Suite struct ListenableTests {
  /// As the server reads them aloud.
  @Test func onlyDocumentsAndLinksAreReadAloud() {
    #expect([Entry.Kind.folder, .document, .drawing, .url].filter(\.isListenable) == [.document, .url])
  }
}

@Suite struct ResumePointsTests {
  private let points = ResumePoints(defaults: UserDefaults(suiteName: "resume-\(UUID())")!)

  @Test func eachFileResumesWhereItsListenStopped() {
    points.keep(.init(part: 2, seconds: 31.5), of: "doc-1")
    points.keep(.init(part: 0, seconds: 4), of: "doc-2")

    #expect(points.position(of: "doc-1") == .init(part: 2, seconds: 31.5))
    #expect(points.position(of: "doc-2") == .init(part: 0, seconds: 4))
    #expect(points.position(of: "doc-3") == nil)
  }

  @Test func aFileListenedToTheEndStartsOver() {
    points.keep(.init(part: 2, seconds: 31.5), of: "doc-1")

    points.finished("doc-1")

    #expect(points.position(of: "doc-1") == nil)
  }
}
