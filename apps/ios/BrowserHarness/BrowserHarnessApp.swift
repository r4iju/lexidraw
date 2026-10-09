import Foundation
import HTTPTypes
import LexidrawKit
import OpenAPIRuntime
import SwiftUI
import Synchronization

/// Environment for XCTest, native launch arguments for hands-on fixture review.
private enum BrowserScenario {
  static var name: String? {
    ProcessInfo.processInfo.environment["BROWSER_SCENARIO"]
      ?? UserDefaults.standard.string(forKey: "BROWSER_SCENARIO")
  }
}

/// The production browser against external service fixtures for complete journeys.
@main
struct BrowserHarnessApp: App {
  private let signInBrowser = SignInBrowserFixture()
  @State private var model = AppModel(
    account: Account(
      origin: BrowserScenario.name == "sign-in" ? SignInBrowserFixture.origin : URL(string: "https://harness.invalid")!, store: AccountHarnessToken(), transport: HarnessServer()))

  var body: some Scene {
    WindowGroup {
      Group {
        switch model.state {
        case .signedIn(let session): BrowserView(session: session)
        case .signedOut: NavigationStack { SignInView() }
        }
      }
      .environment(model)
    }
  }
}

/// Stateful service fixture at the external HTTP transport boundary. Every
/// relaunch starts a fresh account; mutations return through real service APIs.
actor HarnessServer: ClientTransport {
  private struct Item {
    let id: String
    var title: String
    let type: String
    var parent: String?
    var access = "owner"
    var tags: [String] = []
    var deleted = false
    var shared = false
    var preview = ""
  }

  private var items: [Item]
  private let scenario: String
  private var failures: Set<String> = []
  private var documents: [String: String] = [:]
  private var revisions: [String: String] = [:]
  private var saves = 0
  private var searched = false

  init() {
    scenario = BrowserScenario.name ?? "basic"
    items = [
      Item(id: "projects", title: "Projects", type: "directory", parent: nil),
      Item(id: "recipes", title: "Recipes", type: "directory", parent: nil),
      Item(id: "readme", title: "Readme", type: "document", parent: nil),
      Item(id: "q3", title: "Q3", type: "directory", parent: "projects"),
      Item(id: "plan", title: "Projects plan", type: "document", parent: "projects", tags: ["Work"]),
      Item(id: "notes", title: "Q3 notes", type: "document", parent: "q3"),
      Item(id: "pasta", title: "Pasta", type: "document", parent: "recipes"),
    ]
    if scenario != "basic" {
      items += [
        Item(id: "drawing", title: "A drawing with a wonderfully long title for our next adventure together", type: "drawing", parent: "projects", preview: "https://harness.invalid/missing-preview.png"),
        Item(id: "link", title: "Design reference", type: "url", parent: "projects"),
        Item(id: "shared-read", title: "Private team brief", type: "document", parent: "inaccessible", access: "read", shared: true),
        Item(id: "shared-edit", title: "Collaborative sketch", type: "drawing", parent: "inaccessible", access: "edit", shared: true),
        Item(id: "shared-folder", title: "Reference only", type: "directory", parent: "inaccessible", access: "read", shared: true),
      ]
    }
    if scenario == "empty" { items = [] }
    if ["restore-failure", "restore-delayed"].contains(scenario) {
      items.append(Item(id: "deleted", title: "Recovered notes", type: "document", parent: "missing-folder", deleted: true))
    }
  }

  private static func silentAudio() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appending(path: "273-read-aloud.wav")
    guard !FileManager.default.fileExists(atPath: url.path) else { return url }
    let byteCount: UInt32 = 8_000 * 120 * 2
    var data = Data()
    func append(_ value: UInt32) {
      var little = value.littleEndian
      withUnsafeBytes(of: &little) { data.append(contentsOf: $0) }
    }
    data.append(Data("RIFF".utf8)); append(36 + byteCount)
    data.append(Data("WAVEfmt ".utf8)); append(16)
    data.append(contentsOf: [1, 0, 1, 0])
    append(8_000); append(16_000)
    data.append(contentsOf: [2, 0, 16, 0])
    data.append(Data("data".utf8)); append(byteCount)
    data.append(Data(repeating: 0, count: Int(byteCount)))
    try data.write(to: url)
    return url
  }

  func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws
    -> (HTTPResponse, HTTPBody?)
  {
    let components = URLComponents(string: request.path ?? "")
    let query = components?.queryItems ?? []
    let segments = (components?.path ?? "").split(separator: "/").map(String.init)
    let entityIndex = segments.firstIndex(of: "entities")
    let id = entityIndex.flatMap { segments.indices.contains($0 + 1) ? segments[$0 + 1] : nil }
    let json: [String: Any]
    if let body {
      let data = try await Data(collecting: body, upTo: 1_000_000)
      json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
    } else { json = [:] }
    if scenario == "retry" && ["entities-list", "entities-sharedWithMe", "entities-trash"].contains(operationID),
       !failures.contains(operationID) {
      failures.insert(operationID)
      return try response(["message": "Connection interrupted. Please try again.", "code": "INTERNAL_SERVER_ERROR"], status: .internalServerError)
    }
    if scenario == "delayed", operationID == "entities-list" {
      try await Task.sleep(for: .seconds(10))
    }
    let answer: Any
    switch operationID {
    case "nativeSignIn-exchange":
      guard json["code"] as? String == "fixture-code", json["redirectUri"] as? String == Account.callback.absoluteString,
            let verifier = json["codeVerifier"] as? String, !verifier.isEmpty else {
        return try response(["message": "Invalid sign-in exchange.", "code": "BAD_REQUEST"], status: .badRequest)
      }
      try await Task.sleep(for: .seconds(4))
      if failures.insert(operationID).inserted {
        return try response(["message": "The sign-in code expired.", "code": "BAD_REQUEST"], status: .badRequest)
      }
      answer = ["token": "fixture-token", "name": "iPhone", "scope": "write"]
    case "auth-deletionConfirmation":
      if scenario == "deletion-confirmation-failure", failures.insert(operationID).inserted {
        try await Task.sleep(for: .seconds(3))
        return try response(["message": "Connection interrupted.", "code": "INTERNAL_SERVER_ERROR"], status: .internalServerError)
      }
      answer = ["confirmation": "reader@example.test"]
    case "auth-deleteAccount":
      guard (json["confirmation"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "reader@example.test" else {
        return try response(["message": "The confirmation does not match this account.", "code": "BAD_REQUEST"], status: .badRequest)
      }
      try await Task.sleep(for: .seconds(4))
      if scenario == "deletion-failure", failures.insert(operationID).inserted {
        return try response(["message": "Deletion is temporarily unavailable. Please try again.", "code": "INTERNAL_SERVER_ERROR"], status: .internalServerError)
      }
      answer = ["id": "reader"]
    case "tokens-revokeCurrent":
      if scenario == "signout-local-failure" { try await Task.sleep(for: .seconds(4)) }
      if scenario == "signout-server-failure" { throw URLError(.notConnectedToInternet) }
      answer = ["id": "fixture-token"]
    case "auth-me":
      if scenario == "identity-failure", failures.insert(operationID).inserted {
        return try response(["message": "Connection interrupted.", "code": "INTERNAL_SERVER_ERROR"], status: .internalServerError)
      }
      answer = ["userId": "reader", "name": "Native Reader", "email": "reader@example.test", "authKind": "token", "scope": "write"]
    case "entities-list":
      let parent = query.first { $0.name == "parentId" }?.value
      if scenario == "reveal-delayed", searched, parent == nil,
        failures.insert("delayed-reveal").inserted {
        // The obsolete reveal transport deliberately ignores cancellation.
        await Task.detached { try? await Task.sleep(for: .seconds(10)) }.value
      }
      let types = query.filter { $0.name == "entityTypes" }.compactMap(\.value)
      let tags = query.filter { $0.name == "tagNames" }.compactMap(\.value)
      answer = items.filter { !$0.deleted && $0.parent == parent && (types.isEmpty || types.contains($0.type)) && tags.allSatisfy($0.tags.contains) }.map(listed)
    case "entities-search":
      searched = true
      let text = query.first { $0.name == "query" }?.value ?? ""
      if scenario == "search-retry" {
        try await Task.sleep(for: .seconds(4))
        if !failures.contains(operationID) {
          failures.insert(operationID)
          return try response(["message": "Connection interrupted. Please try again.", "code": "INTERNAL_SERVER_ERROR"], status: .internalServerError)
        }
      }
      if scenario == "search-obsolete", text == "Projects" {
        // This external transport deliberately finishes despite cancellation.
        await Task.detached { try? await Task.sleep(for: .seconds(10)) }.value
      }
      answer = items.filter { !$0.deleted && $0.title.localizedCaseInsensitiveContains(text) }.map { item in
        let parent = items.first { $0.id == item.parent && !$0.deleted }
        return ["id": item.id, "title": item.title, "entityType": item.type,
          "updatedAt": Self.date, "screenShotLight": item.preview, "screenShotDark": item.preview,
          "snippet": NSNull(), "parentId": parent?.id as Any? ?? NSNull(), "folderTitle": parent?.title as Any? ?? NSNull()]
      }
    case "entities-getMetadata":
      guard let item = items.first(where: { $0.id == id && !$0.deleted }) else { return try missing() }
      answer = ["id": item.id, "title": item.title, "entityType": item.type, "publicAccess": "PRIVATE",
        "parentId": item.parent as Any? ?? NSNull(), "access": item.access,
        "ancestors": ancestors(of: item).map { ["id": $0.id, "title": $0.title, "access": $0.access] }]
    case "entities-getUserTags": answer = scenario == "basic" ? [] : ["Work", "Unassigned"]
    case "entities-sharedWithMe": answer = items.filter { $0.shared && !$0.deleted }.map(listed)
    case "entities-trash":
      answer = items.filter(\.deleted).map { item in
        ["id": item.id, "title": item.title, "entityType": item.type, "screenShotLight": item.preview,
         "screenShotDark": item.preview, "createdAt": Self.date, "updatedAt": Self.date, "deletedAt": Self.date]
      }
    case "entities-create":
      let parent = json["parentId"] as? String
      if let parent {
        guard let destination = items.first(where: { $0.id == parent && !$0.deleted }),
          destination.type == "directory", destination.access != "read"
        else { return try forbidden() }
      }
      let type = json["entityType"] as? String ?? "document"
      let title = type == "directory" ? "New folder" : "New \(type)"
      let item = Item(id: json["id"] as? String ?? UUID().uuidString, title: json["title"] as? String ?? title, type: type, parent: parent)
      items.append(item)
      answer = summary(item)
    case "entities-update", "entities-delete", "entities-restore":
      guard let index = items.firstIndex(where: { $0.id == id }) else { return try missing() }
      if items[index].access == "read" || (operationID != "entities-update" && items[index].access != "owner") { return try forbidden() }
      if operationID == "entities-update" {
        if let title = json["title"] as? String { items[index].title = title }
        if json.keys.contains("parentId") {
          let parent = json["parentId"] as? String
          if let parent {
            guard items[index].access == "owner",
              let destination = items.first(where: { $0.id == parent && !$0.deleted }),
              destination.type == "directory", destination.access != "read"
            else { return try forbidden() }
            if destination.id == items[index].id || ancestors(of: destination).contains(where: { $0.id == items[index].id }) {
              return try response(["message": "A folder cannot move into itself or its descendants.", "code": "BAD_REQUEST"], status: .badRequest)
            }
          }
          items[index].parent = parent
        }
      } else if operationID == "entities-delete" { items[index].deleted = true }
      else {
        if scenario == "restore-failure", !failures.contains(operationID) {
          failures.insert(operationID)
          return try response(["message": "Connection interrupted. Please try again.", "code": "INTERNAL_SERVER_ERROR"], status: .internalServerError)
        }
        if scenario == "restore-delayed" { try await Task.sleep(for: .seconds(6)) }
        items[index].deleted = false
        if !items.contains(where: { $0.id == items[index].parent && !$0.deleted && $0.access != "read" }) { items[index].parent = nil }
      }
      if operationID == "entities-restore" { answer = summary(items[index]) }
      else { answer = ["id": items[index].id] }
    case "entities-save":
      guard let id, let item = items.first(where: { $0.id == id && !$0.deleted }), ["document", "drawing"].contains(item.type) else { return try missing() }
      guard item.access != "read" else { return try forbidden() }
      if scenario == "drawing-save-failure" {
        return try response(["message": "Connection interrupted. Please try again.", "code": "INTERNAL_SERVER_ERROR"], status: .internalServerError)
      }
      if scenario == "reveal-save-delayed" {
        await Task.detached { try? await Task.sleep(for: .seconds(20)) }.value
      }
      guard json["ifUnmodifiedSince"] as? String == (revisions[id] ?? Self.date) else {
        return try response(["message": "Newer edits", "code": "CONFLICT"], status: .conflict)
      }
      guard let elements = json["elements"] as? String else { return try missing() }
      documents[id] = elements
      saves += 1
      let revision = "2026-09-25T09:31:\(String(format: "%02d", saves)).000Z"
      revisions[id] = revision
      answer = ["id": id, "updatedAt": revision]
    case "entities-load":
      guard let item = items.first(where: { $0.id == id && !$0.deleted }) else { return try missing() }
      var elements: String
      switch item.type {
      case "document":
        elements = #"{"root":{"type":"root","version":1,"format":"","indent":0,"direction":null,"children":[{"type":"paragraph","version":1,"format":"","indent":0,"direction":null,"children":[{"type":"text","version":1,"text":"A thoughtful plan starts here.","format":0,"style":"","mode":"normal","detail":0}]}]}}"#
      case "url": elements = #"{"url":"https://example.com/design"}"#
      default: elements = "[]"
      }
      if scenario == "wide-table", item.type == "document" {
        func node(_ type: String, _ children: [[String: Any]]) -> [String: Any] {
          ["type": type, "version": 1, "format": "", "indent": 0,
            "direction": NSNull(), "children": children]
        }
        let rows = (0..<3).map { row in
          node("tablerow", (0..<4).map { column in
            var cell = node("tablecell", [node("paragraph", [["type": "text", "version": 1,
              "text": "Row \(row) column \(column)", "format": 0, "style": "", "mode": "normal", "detail": 0]])])
            cell.merge(["colSpan": 1, "rowSpan": 1, "headerState": 0, "width": 240]) { _, new in new }
            return cell
          })
        }
        var table = node("table", rows)
        table["colWidths"] = [240, 240, 240, 240]
        elements = String(decoding: try JSONSerialization.data(withJSONObject: ["root": node("root", [table])]), as: UTF8.self)
      }
      answer = ["id": item.id, "title": item.title, "entityType": item.type, "appState": NSNull(),
        "elements": documents[item.id] ?? elements, "publicAccess": "PRIVATE", "shared": item.shared,
        "accessLevel": item.access == "read" ? "READ" : "EDIT", "updatedAt": revisions[item.id] ?? Self.date]
    case "tts-listening":
      if scenario == "listening" {
        answer = ["status": "ready", "segmentCount": 1, "plannedCount": 1,
          "segments": [["index": 0, "text": "A thoughtful plan starts here. This is a native read-aloud fixture.",
            "audioUrl": try Self.silentAudio().absoluteString, "sectionTitle": "A thoughtful plan"]]]
      } else { answer = ["status": "none", "segments": [Any]()] }
    case "drawings-files": answer = ["files": [Any]()]
    default: return try missing()
    }
    return try response(answer)
  }

  private static let date = "2026-09-25T09:30:00.000Z"

  private func ancestors(of item: Item) -> [Item] {
    guard let parent = items.first(where: { $0.id == item.parent }) else { return [] }
    return ancestors(of: parent) + [parent]
  }

  private func summary(_ item: Item) -> [String: Any] {
    ["id": item.id, "title": item.title, "entityType": item.type, "parentId": item.parent as Any? ?? NSNull(),
      "createdAt": Self.date, "updatedAt": Self.date]
  }

  private func listed(_ item: Item) -> [String: Any] {
    ["id": item.id, "title": item.title, "entityType": item.type, "createdAt": Self.date,
      "updatedAt": Self.date, "screenShotLight": item.preview, "screenShotDark": item.preview,
      "thumbnailStatus": NSNull(), "thumbnailVersion": NSNull(), "thumbnailUpdatedAt": NSNull(), "access": item.access,
      "publicAccess": "PRIVATE", "parentId": item.shared ? NSNull() : item.parent as Any? ?? NSNull(), "favoritedAt": NSNull(),
      "archivedAt": NSNull(), "sharedWithCount": item.shared ? 1 : 0, "tags": item.tags,
      "childCount": items.count { $0.parent == item.id && !$0.deleted },
      "folderCount": items.count { $0.parent == item.id && !$0.deleted && $0.type == "directory" }]
  }

  private func response(_ object: Any, status: HTTPResponse.Status = .ok) throws -> (HTTPResponse, HTTPBody?) {
    var response = HTTPResponse(status: status)
    response.headerFields[.contentType] = "application/json"
    return (response, HTTPBody(try JSONSerialization.data(withJSONObject: object)))
  }

  private func missing() throws -> (HTTPResponse, HTTPBody?) {
    try response(["message": "Not found", "code": "NOT_FOUND"], status: .notFound)
  }

  private func forbidden() throws -> (HTTPResponse, HTTPBody?) {
    try response(["message": "You don’t have permission to change this file.", "code": "FORBIDDEN"], status: .forbidden)
  }
}

/// The external secure-storage boundary, reset for each fixture launch.
final class AccountHarnessToken: TokenStore {
  private struct Stored {
    var token: String? = ["signed-out", "sign-in"].contains(BrowserScenario.name ?? "") ? nil : "harness"
    var removals = 0
  }
  private let stored = Mutex(Stored())

  func load() throws -> String? { stored.withLock { $0.token } }
  func save(_ token: String) throws { stored.withLock { $0.token = token } }
  func delete() throws {
    try stored.withLock {
      $0.removals += 1
      if BrowserScenario.name == "signout-local-failure", $0.removals == 1 {
        throw NSError(domain: "FixtureSecureStorage", code: 1, userInfo: [NSLocalizedDescriptionKey: "Secure storage is temporarily unavailable."])
      }
      $0.token = nil
    }
  }
}
