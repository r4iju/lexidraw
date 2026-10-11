import Foundation
import HTTPTypes
import LexidrawKit
import OpenAPIRuntime
import SwiftUI
import XCTest
@testable import EditorHarness
private struct OuterAgentToken: TokenStore {
  func load() throws -> String? { "lxd_outer_fixture" }
  func save(_ token: String) throws {}
  func delete() throws {}
}
private actor OuterAgentTransport: ClientTransport {
  let selected: String
  private(set) var procedures: [String] = []
  init(_ selected: String) { self.selected = selected }
  func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (HTTPResponse, HTTPBody?) {
    procedures.append(operationID)
    let json: String
    switch operationID {
    case "auth.getPowerPreference":
      if selected == "failed" { throw URLError(.notConnectedToInternet) }
      json = "{\"mode\":\"\(selected)\"}"
    case "agentPower.capability": json = #"{"available":false,"reason":"New generation closed"}"#
    case "agentPower.current": json = #"{"operation":{"id":"owned","state":"unknown","charged":0,"quote":10},"report":{"status":"reconciling","completed":[{"revision":2,"description":"Saved paragraph"}],"incomplete":["Next edit"]}}"#
    default: throw URLError(.unsupportedURL)
    }
    return (HTTPResponse(status: .ok), HTTPBody("{\"result\":{\"data\":{\"json\":\(json)}}}"))
  }
}
@MainActor final class DocumentAgentRecoveryTests: XCTestCase {
  func testPublicOuterComposerReadsOwnedActionWhenPreferenceFailsOrSelectsLocal() async throws {
    for selection in ["failed", "local"] {
      let transport = OuterAgentTransport(selection)
      let session = try XCTUnwrap(Account(origin: URL(string: "https://outer-agent.invalid")!, store: OuterAgentToken(), transport: transport).restore())
      let controller = UIHostingController(rootView: DocumentAgentComposer(session: session, document: "doc"))
      let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 800, height: 1000))
      window.rootViewController = controller
      window.makeKeyAndVisible()
      try await Task.sleep(for: .milliseconds(500))
      let calls = await transport.procedures
      XCTAssertTrue(calls.contains("agentPower.current"), "Owned read must run independently of \(selection) preference")
      XCTAssertFalse(calls.contains("agentPower.start"))
      window.isHidden = true
      window.rootViewController = nil
    }
  }
}
