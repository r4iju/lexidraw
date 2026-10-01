import Foundation
import HTTPTypes
import LexidrawKit
import OpenAPIRuntime
import SwiftUI

/// The app's browser over a small folder tree, with no server, for the UI
/// tests of moving between folders.
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

/// Home holds Projects, which holds Q3, and Recipes; each folder holds one
/// document named for it.
struct HarnessServer: ClientTransport {
  private struct Item {
    let id: String
    let title: String
    let type: String
    let parent: String?
  }

  private static let items = [
    Item(id: "projects", title: "Projects", type: "directory", parent: nil),
    Item(id: "recipes", title: "Recipes", type: "directory", parent: nil),
    Item(id: "readme", title: "Readme", type: "document", parent: nil),
    Item(id: "q3", title: "Q3", type: "directory", parent: "projects"),
    Item(id: "plan", title: "Projects plan", type: "document", parent: "projects"),
    Item(id: "notes", title: "Q3 notes", type: "document", parent: "q3"),
    Item(id: "pasta", title: "Pasta", type: "document", parent: "recipes"),
  ]

  func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws
    -> (HTTPResponse, HTTPBody?)
  {
    let query = URLComponents(string: request.path ?? "")?.queryItems ?? []
    let answer: Any
    switch operationID {
    case "entities-list":
      let parent = query.first { $0.name == "parentId" }?.value
      let types = query.filter { $0.name == "entityTypes" }.compactMap(\.value)
      answer = Self.items
        .filter { $0.parent == parent && (types.isEmpty || types.contains($0.type)) }
        .map(Self.listed)
    case "entities-getMetadata":
      let id = request.path?.split(separator: "/").dropLast().last.map(String.init)
      guard let folder = Self.items.first(where: { $0.id == id }) else {
        return (HTTPResponse(status: .notFound), nil)
      }
      answer = [
        "id": folder.id, "title": folder.title, "entityType": folder.type, "publicAccess": "PRIVATE",
        "parentId": folder.parent ?? NSNull(), "access": "edit",
        "ancestors": Self.ancestors(of: folder).map { ["id": $0.id, "title": $0.title, "access": "edit"] },
      ]
    case "entities-getUserTags", "entities-sharedWithMe", "entities-trash":
      answer = [Any]()
    default:
      return (HTTPResponse(status: .notFound), nil)
    }
    var response = HTTPResponse(status: .ok)
    response.headerFields[.contentType] = "application/json"
    return (response, HTTPBody(try JSONSerialization.data(withJSONObject: answer)))
  }

  private static func ancestors(of item: Item) -> [Item] {
    guard let parent = items.first(where: { $0.id == item.parent }) else { return [] }
    return ancestors(of: parent) + [parent]
  }

  private static func listed(_ item: Item) -> [String: Any] {
    [
      "id": item.id, "title": item.title, "entityType": item.type, "createdAt": "2026-09-01T08:00:00.000Z",
      "updatedAt": "2026-09-25T09:30:00.000Z", "screenShotLight": "", "screenShotDark": "",
      "thumbnailStatus": NSNull(), "thumbnailVersion": NSNull(), "thumbnailUpdatedAt": NSNull(), "access": "edit",
      "publicAccess": "PRIVATE", "parentId": item.parent ?? NSNull(), "favoritedAt": NSNull(),
      "archivedAt": NSNull(), "sharedWithCount": 0, "tags": [String](),
      "childCount": items.count { $0.parent == item.id },
      "folderCount": items.count { $0.parent == item.id && $0.type == "directory" },
    ]
  }
}
