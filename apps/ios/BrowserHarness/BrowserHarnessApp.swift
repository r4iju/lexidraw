import Foundation
import HTTPTypes
import LexidrawKit
import OpenAPIRuntime
import SwiftUI

/// The production browser against an external service fixture for navigation,
/// organization, permissions and recovery journeys.
@main
struct BrowserHarnessApp: App {
  @State private var model = AppModel(
    account: Account(
      origin: URL(string: "https://harness.invalid")!, store: HarnessToken(), transport: HarnessServer()))

  var body: some Scene {
    WindowGroup {
      if case .signedIn(let session) = model.state {
        BrowserView(session: session)
          .environment(model)
      }
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

  init() {
    scenario = ProcessInfo.processInfo.environment["BROWSER_SCENARIO"] ?? "basic"
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
    case "entities-list":
      let parent = query.first { $0.name == "parentId" }?.value
      let types = query.filter { $0.name == "entityTypes" }.compactMap(\.value)
      let tags = query.filter { $0.name == "tagNames" }.compactMap(\.value)
      answer = items.filter { !$0.deleted && $0.parent == parent && (types.isEmpty || types.contains($0.type)) && tags.allSatisfy($0.tags.contains) }.map(listed)
    case "entities-search":
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
    case "entities-load":
      guard let item = items.first(where: { $0.id == id && !$0.deleted }) else { return try missing() }
      let elements: String
      switch item.type {
      case "document":
        elements = #"{"root":{"type":"root","version":1,"format":"","indent":0,"direction":null,"children":[{"type":"paragraph","version":1,"format":"","indent":0,"direction":null,"children":[{"type":"text","version":1,"text":"A thoughtful plan starts here.","format":0,"style":"","mode":"normal","detail":0}]}]}}"#
      case "url": elements = #"{"url":"https://example.com/design"}"#
      default: elements = "[]"
      }
      answer = ["id": item.id, "title": item.title, "entityType": item.type, "appState": NSNull(),
        "elements": elements, "publicAccess": "PRIVATE", "shared": item.shared,
        "accessLevel": item.access == "read" ? "READ" : "EDIT", "updatedAt": Self.date]
    case "tts-listening": answer = ["status": "none", "segments": [Any]()]
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
