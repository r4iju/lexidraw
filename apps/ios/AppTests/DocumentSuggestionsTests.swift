import Foundation
import HTTPTypes
import LexidrawKit
import OpenAPIRuntime
import XCTest
import LexicalSwift
import TextKitEditor
import UIKit
import Synchronization

@testable import EditorHarness

private struct SuggestionTestToken: TokenStore {
  func load() throws -> String? { "lxd_fixture" }
  func save(_ token: String) throws {}
  func delete() throws {}
}
private struct DelayedSuggestionPreferences: ClientTransport {
  func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws
    -> (HTTPResponse, HTTPBody?)
  {
    try await Task.sleep(for: .milliseconds(100))
    let value: String
    switch operationID {
    case "config.getAutocompleteConfig": value = #"{"enabled":true}"#
    case "auth.getPowerPreference": value = #"{"mode":"local"}"#
    default: throw NSError(domain: "Unexpected network", code: 1)
    }
    return (HTTPResponse(status: .ok), HTTPBody("{\"result\":{\"data\":{\"json\":\(value)}}}"))
  }
}
@MainActor final class DocumentSuggestionsTests: XCTestCase {
  func testLeavingEditorDuringPreferenceLoadDoesNotReactivateSuggestions() async throws {
    let session = try XCTUnwrap(
      Account(
        origin: URL(string: "https://local-fixture.invalid")!, store: SuggestionTestToken(),
        transport: DelayedSuggestionPreferences()
      ).restore())
    let suggestions = DocumentSuggestions()
    let load = Task {
      await suggestions.load(session: session, editor: nil, title: "", language: "en_US")
    }
    try await Task.sleep(for: .milliseconds(20))
    suggestions.stop()
    await load.value
    XCTAssertFalse(
      suggestions.enabled, "An old preference response must not reactivate the departed editor")
  }
}

private struct ProSuggestionFixture: ClientTransport {
  let maximum: Int64?
  let balance: Int64
  func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (HTTPResponse, HTTPBody?) {
    let value: String
    switch operationID {
    case "config.getAutocompleteConfig": value = #"{"enabled":true}"#
    case "auth.getPowerPreference": value = #"{"mode":"pro"}"#
    case "pro.status":
      value = "{\"eligible\":true,\"entitled\":true,\"entitlementPeriodId\":\"period\",\"autocompleteMaximumSubcredits\":\(maximum.map(String.init) ?? "null"),\"availableSubcredits\":\(balance),\"reservedSubcredits\":0,\"history\":[],\"policy\":{\"version\":\"fixture\",\"disclosure\":\"Fixture rates\"}}"
    default: throw URLError(.unsupportedURL)
    }
    return (HTTPResponse(status: .ok), HTTPBody("{\"result\":{\"data\":{\"json\":\(value)}}}"))
  }
}
extension DocumentSuggestionsTests {
  func testConfigureUsesActivePeriodMaximumInsteadOfCompiledRate() async throws {
    for (maximum, balance, expected) in [(Int64(560_000), Int64(600_000), "On · Pro suggestions metered in aggregate"), (Int64(2_240_000), Int64(1_500_000), "Not enough allowance for another suggestion.")] {
      let session = try XCTUnwrap(Account(origin: URL(string: "https://local-fixture.invalid")!, store: SuggestionTestToken(), transport: ProSuggestionFixture(maximum: maximum, balance: balance)).restore())
      let suggestions = DocumentSuggestions()
      await suggestions.load(session: session, editor: nil, title: "", language: "en_US")
      XCTAssertEqual(suggestions.message, expected)
    }
  }
  func testMissingOrInvalidPeriodMaximumVisiblyBlocksSuggestions() async throws {
    for maximum: Int64? in [nil, 0, -1, 9_007_199_254_740_992] {
      let session = try XCTUnwrap(Account(origin: URL(string: "https://local-fixture.invalid")!, store: SuggestionTestToken(), transport: ProSuggestionFixture(maximum: maximum, balance: 3_000_000)).restore())
      let suggestions = DocumentSuggestions()
      await suggestions.load(session: session, editor: nil, title: "", language: "en_US")
      XCTAssertEqual(suggestions.message, "Pro suggestion rates could not be verified for the active period. Reload AI Power.")
    }
  }
}

private final class CompletingSuggestionFixture: ClientTransport, Sendable {
  let failRefresh: Bool
  private let reads = Mutex(0)
  private let paid = Mutex(0)
  var paidCalls: Int { paid.withLock { $0 } }
  var statusReads: Int { reads.withLock { $0 } }
  init(failRefresh: Bool) { self.failRefresh = failRefresh }
  func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (HTTPResponse, HTTPBody?) {
    let value: String
    switch operationID {
    case "config.getAutocompleteConfig": value = #"{"enabled":true}"#
    case "auth.getPowerPreference": value = #"{"mode":"pro"}"#
    case "pro.autocomplete": paid.withLock { $0 += 1 }; value = #"{"id":"paid","state":"settled","result":" paid output"}"#
    case "pro.status":
      let count = reads.withLock { $0 += 1; return $0 }
      if count > 1 && failRefresh { throw URLError(.notConnectedToInternet) }
      value = "{\"eligible\":true,\"entitled\":true,\"entitlementPeriodId\":\"period\",\"autocompleteMaximumSubcredits\":1120000,\"availableSubcredits\":\(count == 1 ? 1120000 : 0),\"reservedSubcredits\":0,\"history\":[],\"policy\":{\"version\":\"fixture\",\"disclosure\":\"Fixture\"}}"
    default: throw URLError(.unsupportedURL)
    }
    return (HTTPResponse(status: .ok), HTTPBody("{\"result\":{\"data\":{\"json\":\(value)}}}"))
  }
}
extension DocumentSuggestionsTests {
  func testFinalAffordableSuggestionPublishesSettledTextDespiteZeroBalanceOrFailedStatus() async throws {
    for failedRead in [false, true] {
      let transport = CompletingSuggestionFixture(failRefresh: failedRead)
      let session = try XCTUnwrap(Account(origin: URL(string: "https://local-fixture.invalid")!, store: SuggestionTestToken(), transport: transport).restore())
      let model = Editor()
      try model.load(["root": ["type": "root", "version": 1, "children": [["type": "paragraph", "version": 1, "children": [["type": "text", "version": 1, "text": "Hello", "mode": "normal", "format": 0, "style": "", "detail": 0]]]]]])
      try model.apply(.caret(Point(path: [0, 0], offset: 5, type: .text)))
      let editor = EditorView(model: model)
      let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 400, height: 800))
      editor.frame = window.bounds
      window.addSubview(editor)
      window.makeKeyAndVisible()
      editor.becomeFirstResponder()
      editor.selectedTextRange = editor.textRange(from: editor.endOfDocument, to: editor.endOfDocument)
      let suggestions = DocumentSuggestions()
      await suggestions.load(session: session, editor: editor, title: "", language: "en_US")
      for _ in 0..<160 {
        // The transport read finishes before TextKit publishes the async result.
        if transport.statusReads == 2 && editor.writingSuggestion != nil { break }
        try await Task.sleep(for: .milliseconds(50))
      }
      XCTAssertEqual(transport.paidCalls, 1)
      XCTAssertEqual(transport.statusReads, 2)
      XCTAssertEqual(editor.writingSuggestion, " paid output", "A charged result belongs to the user even when the next request is blocked")
      XCTAssertTrue(editor.acceptWritingSuggestion())
      XCTAssertEqual(try model.node(at: [0, 0])["text"], "Hello paid output")
      suggestions.stop()
      window.isHidden = true
    }
  }
  func testDeviceComposerAndGenericListenResumeTheSameSavedRecording() async throws {
    let audio = try DeviceAudio.pcm(Data(repeating: 0, count: 480_000))
    let saved: [String: Any] = ["id": "resume-fixture", "recording": ["mimeType": "audio/wav", "parts": [["text": "Saved audio", "audio": audio.audio, "seconds": audio.seconds]]]]
    let bytes = try JSONSerialization.data(withJSONObject: ["result": ["data": ["json": saved]]])
    let transport = SavedPlaybackFixture(response: String(decoding: bytes, as: UTF8.self))
    let session = try XCTUnwrap(Account(origin: URL(string: "https://local-fixture.invalid")!, store: SuggestionTestToken(), transport: transport).restore())
    let retained = try await session.savedDeviceNarration(document: "doc")
    let job = try XCTUnwrap(retained).recording.job(id: "resume-fixture")
    let points = ResumePoints()
    points.keep(.init(part: 0, seconds: 3), of: "device.resume-fixture")
    defer { points.finished("device.resume-fixture"); points.finished("pro.resume-fixture") }
    let listener = Listener(session: session)
    listener.playNarration(.init(job: job, source: .device), to: .init(id: "doc", title: "Document"))
    XCTAssertEqual(listener.position.seconds, 3, accuracy: 0.1)
    listener.pause()
    listener.stop()
    points.keep(.init(part: 0, seconds: 3), of: "device.resume-fixture")
    listener.listen(to: .init(id: "doc", title: "Document"), savedOnly: true)
    for _ in 0..<80 {
      if case .loaded = listener.state { break }
      try await Task.sleep(for: .milliseconds(50))
    }
    XCTAssertEqual(listener.position.seconds, 3, accuracy: 0.5)
    listener.stop()
  }
}
private struct SavedPlaybackFixture: ClientTransport {
  let response: String
  func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (HTTPResponse, HTTPBody?) {
    guard operationID == "deviceNarration.saved" else { throw URLError(.unsupportedURL) }
    return (HTTPResponse(status: .ok), HTTPBody(response))
  }
}

extension DocumentSuggestionsTests {
  func testChangingAccountOrDocumentClearsPreviousAllowanceBeforeFailedLoad() async throws {
    let oldSession = try XCTUnwrap(Account(origin: URL(string: "https://local-fixture.invalid")!, store: SuggestionTestToken(), transport: ProSuggestionFixture(maximum: 560_000, balance: 600_000)).restore())
    let newSession = try XCTUnwrap(Account(origin: URL(string: "https://local-fixture.invalid")!, store: SuggestionTestToken(), transport: FailingSuggestionFixture()).restore())
    let suggestions = DocumentSuggestions()
    await suggestions.load(session: oldSession, editor: nil, title: "Old document", language: "en_US")
    XCTAssertNotNil(suggestions.allowance)
    await suggestions.load(session: newSession, editor: nil, title: "New document", language: "en_US")
    XCTAssertNil(suggestions.allowance, "Another account/document must never display the prior allowance")
    XCTAssertFalse(suggestions.enabled)
  }
}
private struct FailingSuggestionFixture: ClientTransport {
  func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (HTTPResponse, HTTPBody?) { throw URLError(.notConnectedToInternet) }
}
