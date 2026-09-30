import Foundation
import LexidrawJSON
import Synchronization
import Testing

@testable import LexidrawKit

@Suite struct DocumentTests {
  static func loaded(elements: String, access: String = "EDIT") -> String {
    """
    {"id":"n1","title":"Notes","entityType":"document","appState":null,
     "elements":\(elements),"publicAccess":"PRIVATE","shared":false,"accessLevel":"\(access)",
     "updatedAt":"2026-09-25T09:30:00.123Z"}
    """
  }

  /// The editor state comes as the JSON it was stored as, nodes this app
  /// doesn't know included, so the editor can keep them.
  @Test func opensADocumentWithItsEditorStateAsStored() async throws {
    let state =
      #"{"root":{"children":[{"type":"poll","question":"Lunch?","version":1}],"direction":null,"format":"","#
      + #""indent":0,"type":"root","version":1}}"#
    let server = FakeServer { _ in
      (200, Self.loaded(elements: try String(data: JSONEncoder().encode(state), encoding: .utf8)!))
    }
    let session = try TestServer.session(server)

    let document = try await session.document("n1")

    #expect(document.title == "Notes")
    #expect(document.access == .edit)
    #expect(document.state.stringified == state)
    #expect(try #require(server.requests.only).url.path == "/api/v1/entities/n1")
  }

  @Test func savesADocumentAgainstTheRevisionReadWithoutChangingSettings() async throws {
    let server = FakeServer { _ in (200, #"{"id":"n1","updatedAt":"2026-09-25T09:31:00.456Z"}"#) }
    let session = try TestServer.session(server)
    let state = try JSONValue(
      parsing: #"{"root":{"type":"root","children":[{"type":"future","custom":{"kept":true}}]}}"#)
    let read = Date(timeIntervalSince1970: 1_790_328_600.123)

    let saved = try await session.save(document: "n1", state: state, ifUnmodifiedSince: read)

    let request = try #require(server.requests.only)
    #expect(request.method == .put)
    #expect(request.url.path == "/api/v1/entities/n1")
    #expect(request.json["ifUnmodifiedSince"] == "2026-09-25T09:30:00.123Z")
    #expect(request.json["elements"] == state.stringified)
    #expect(!request.keys.contains("appState"))
    #expect(saved == Date(timeIntervalSince1970: 1_790_328_660.456))
  }

  @Test func loadsTheRevisionAndDocumentSettingsWithoutDiscardingUnknownSettings() async throws {
    let response = Self.loaded(elements: #""{\"root\":{}}""#).replacingOccurrences(
      of: "\"appState\":null",
      with:
        #""appState":"{\"lang\":\"ja\",\"defaultFontFamily\":\"Source Serif 4\",\"future\":true}""#)
    let session = try TestServer.session(FakeServer { _ in (200, response) })

    let document = try await session.document("n1")

    #expect(document.id == "n1")
    #expect(document.updatedAt == Date(timeIntervalSince1970: 1_790_328_600.123))
    #expect(document.appState?["lang"]?.stringValue == "ja")
    #expect(document.appState?["defaultFontFamily"]?.stringValue == "Source Serif 4")
    #expect(document.appState?["future"] == .bool(true))
  }

  @Test func aNewerRevisionIsAnExplicitDocumentConflict() async throws {
    let session = try TestServer.session(FakeServer { _ in (409, #"{"message":"Newer edits"}"#) })
    do {
      _ = try await session.save(
        document: "n1", state: .object(["root": .object([:])]), ifUnmodifiedSince: Date())
      Issue.record("A stale revision must not save")
    } catch is DocumentConflict {
    }
  }

  @Test func documentTypographyUsesTheWebsLanguageInferenceAndSavedFont() throws {
    let state = try JSONValue(parsing: #"{"root":{"children":[{"text":"日本語を読む"}]}}"#)
    let inferred = try DocumentSettings(state: state, appState: nil)
    #expect(inferred.language == "ja")
    #expect(inferred.fontFamily.contains("-apple-system"))
    let selected = try DocumentSettings(
      state: state,
      appState: .object(["lang": "ko", "defaultFontFamily": "Source Serif 4", "future": true]))
    #expect(selected.language == "ko")
    #expect(selected.fontFamily.hasPrefix("\"Source Serif 4\""))
    #expect(selected.fontResource == "/api/fonts?family=Source%20Serif%204")
  }

  @Test func downloadsFontFacesFromThePublicCSSWithoutSendingTheAPIToken() async throws {
    let server = FakeServer { request in
      request.url.path == "/api/fonts"
        ? (
          200,
          "@font-face { font-family: 'Source Serif 4'; src: url(https://fonts.gstatic.com/s/face.woff2) format('woff2'); }"
        )
        : (200, "font bytes")
    }
    let session = try TestServer.session(server)

    let data = try await session.documentFontData(resource: "/api/fonts?family=Source%20Serif%204")

    #expect(data == [Data("font bytes".utf8)])
    #expect(server.requests.map(\.authorization) == [nil, nil])
    #expect(
      server.requests[0].url.string == "https://lexidraw.test/api/fonts?family=Source%20Serif%204")
    #expect(server.requests[1].url.string == "https://fonts.gstatic.com/s/face.woff2")
  }

  /// Shared with the caller to read, it opens read-only.
  @Test func aDocumentSharedToReadIsReadOnly() async throws {
    let server = FakeServer { _ in (200, Self.loaded(elements: #""{\"root\":{}}""#, access: "READ"))
    }
    let session = try TestServer.session(server)

    #expect(try await session.document("n1").access == .read)
  }
}

@Suite struct DocumentSaverTests {
  @Test func retryingAnAmbiguousCopyCreationReusesItsID() async throws {
    let attempts = Mutex(0)
    let server = FakeServer { request in
      if request.method == .post {
        let count = attempts.withLock { $0 += 1; return $0 }
        if count == 1 { return (503, #"{"message":"Response lost"}"#) }
        return (200, Summary.json(id: request.json["id"] ?? "", type: "document", title: "Notes (copy)"))
      }
      return request.url.path == "/api/v1/entities/n1" ? (409, #"{"message":"Newer edits"}"#)
        : (200, #"{"id":"copy","updatedAt":"2026-09-25T09:31:00.456Z"}"#)
    }
    let saver = DocumentSaver(session: try TestServer.session(server), document: "n1", readAt: .now,
      pause: { try await Task.sleep(for: .seconds(60)) })
    await saver.changed { .object(["root": .object([:])]) }
    await saver.saveNow()
    await #expect(throws: Refusal.self) { try await saver.keepMineAsCopy(title: "Notes", appState: nil) }

    _ = try await saver.keepMineAsCopy(title: "Notes", appState: nil)

    let creates = server.requests.filter { $0.method == .post }
    #expect(creates.count == 2)
    #expect(creates[0].json["id"] == creates[1].json["id"])
  }

  @Test func coalescesEditsAndSerializesOnlyTheLatestStateWhenSaving() async throws {
    let server = FakeServer { _ in (200, #"{"id":"n1","updatedAt":"2026-09-25T09:31:00.456Z"}"#) }
    let saver = DocumentSaver(
      session: try TestServer.session(server), document: "n1",
      readAt: Date(timeIntervalSince1970: 1_790_328_600.123),
      pause: { try await Task.sleep(for: .seconds(60)) })
    await saver.changed {
      Issue.record("The superseded state must not be serialized")
      return .null
    }
    let latest = try JSONValue(parsing: #"{"root":{"children":[{"type":"future","kept":true}]}}"#)
    await saver.changed { latest }
    #expect(server.requests.isEmpty)

    await saver.saveNow()

    #expect(await saver.status == .saved)
    #expect(try #require(server.requests.only).json["elements"] == latest.stringified)
  }

  @Test func aConflictStopsSavesAndKeepingMineCreatesACopyWithItsSettings() async throws {
    let server = FakeServer { request in
      if request.method == .post {
        return (
          200, Summary.json(id: request.json["id"] ?? "", type: "document", title: "Notes (copy)")
        )
      }
      return request.url.path == "/api/v1/entities/n1"
        ? (409, #"{"message":"Newer edits"}"#)
        : (200, #"{"id":"copy","updatedAt":"2026-09-25T09:31:00.456Z"}"#)
    }
    let saver = DocumentSaver(
      session: try TestServer.session(server), document: "n1",
      readAt: Date(timeIntervalSince1970: 1_790_328_600.123),
      pause: { try await Task.sleep(for: .seconds(60)) })
    await saver.changed { .object(["root": .object([:])]) }
    await saver.saveNow()
    #expect(await saver.status == .conflict)
    let latest = try JSONValue(parsing: #"{"root":{"children":[{"type":"future","kept":true}]}}"#)
    await saver.changed { latest }
    await saver.saveNow()
    #expect(server.requests.count == 1)
    let settings = try JSONValue(
      parsing: #"{"lang":"ja","defaultFontFamily":"Source Serif 4","future":true}"#)

    let copy = try await saver.keepMineAsCopy(title: "Notes", appState: settings)

    #expect(await saver.status == .saved)
    #expect(copy.id != "n1")
    #expect(copy.state == latest)
    #expect(copy.appState == settings)
    #expect(server.requests.count == 3)
    #expect(server.requests[1].json["elements"] == latest.stringified)
    #expect(server.requests[2].url.path == "/api/v1/entities/\(copy.id)")
    #expect(server.requests[2].json["appState"] == settings.stringified)
  }
}
