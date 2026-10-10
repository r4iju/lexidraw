import Foundation
import HTTPTypes
import LexidrawKit
import OpenAPIRuntime
import XCTest

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
