import Foundation
import Testing

@testable import LexidrawKit

@Suite struct BrowsingTests {
  @Test func opensAFolderWithItsFoldersAboveItsFiles() async throws {
    let server = FakeServer { _ in
      (200, "[\(ListItem.json(id: "doc", type: "document", access: "edit")),\(ListItem.json(id: "sub", type: "directory", access: "read"))]")
    }
    let session = try TestServer.session(server)

    let listing = try await session.listing(of: "dir-projects")

    #expect(listing.folders.map(\.id) == ["sub"])
    #expect(listing.files.map(\.id) == ["doc"])
    #expect(listing.folders.map(\.access) == [.read])
    #expect(listing.files.map(\.access) == [.edit])
    let request = try #require(server.requests.only)
    #expect(request.url.path == "/api/v1/entities")
    #expect(request.url[query: "parentId"] == "dir-projects")
  }

  /// The server leaves out every folder above that the caller can't open, so
  /// the breadcrumbs are what it sent, from the top down.
  @Test func breadcrumbsAreTheFoldersAboveThatTheServerSaysTheCallerMayOpen() async throws {
    let server = FakeServer { _ in
      (
        200,
        """
        {"id":"dir-q3","title":"Q3","entityType":"directory","publicAccess":"PRIVATE",
         "parentId":"dir-work","access":"edit",
         "ancestors":[{"id":"dir-top","title":"Top","access":"read"},{"id":"dir-work","title":"Work","access":"edit"}]}
        """
      )
    }
    let session = try TestServer.session(server)

    let place = try await session.place(of: "dir-q3")

    #expect(place.title == "Q3")
    #expect(place.access == .edit)
    #expect(place.ancestors.map(\.title) == ["Top", "Work"])
    #expect(try #require(server.requests.only).url.path == "/api/v1/entities/dir-q3/metadata")
  }

  @Test func searchSaysWhichFolderEachResultIsInWhenTheCallerMayOpenIt() async throws {
    let server = FakeServer { _ in
      (
        200,
        """
        [{"id":"a","title":"Plan","entityType":"document","screenShotLight":"","screenShotDark":"",
          "updatedAt":"2026-09-25T09:30:00.000Z","parentId":"dir-work","folderTitle":"Work","snippet":null},
         {"id":"b","title":"Plan B","entityType":"drawing","screenShotLight":"","screenShotDark":"",
          "updatedAt":"2026-09-24T09:30:00.000Z","parentId":null,"folderTitle":null,"snippet":null}]
        """
      )
    }
    let session = try TestServer.session(server)

    let results = try await session.search("plan")

    #expect(results.map(\.location) == ["Document in Work", "Drawing in Home"])
    let request = try #require(server.requests.only)
    #expect(request.url.path == "/api/v1/entities/search")
    #expect(request.url[query: "query"] == "plan")
  }

  @Test func filtersByTheTagsTheCallerChoseFromTheirOwn() async throws {
    let server = FakeServer { request in
      request.url.path.hasSuffix("/tags") ? (200, #"["reading","work"]"#) : (200, "[]")
    }
    let session = try TestServer.session(server)

    #expect(try await session.tags() == ["reading", "work"])
    _ = try await session.listing(of: nil, taggedWith: ["reading", "work"])

    let listing = try #require(server.requests.last)
    #expect(listing.url.queryItems?.filter { $0.name == "tagNames" }.map(\.value) == ["reading", "work"])
    #expect(listing.url[query: "parentId"] == nil)
  }

  @Test func theSidebarAsksForAFoldersFoldersAlone() async throws {
    let server = FakeServer { _ in (200, "[\(ListItem.json(id: "sub", type: "directory", access: "owner"))]") }
    let session = try TestServer.session(server)

    #expect(try await session.folders(in: "dir-projects").map(\.id) == ["sub"])

    let request = try #require(server.requests.only)
    #expect(request.url[query: "parentId"] == "dir-projects")
    #expect(request.url[query: "entityTypes"] == "directory")
  }

  /// So the tree opens only onto folders, not onto a folder's files.
  @Test func aFolderSaysHowManyFoldersAreInIt() async throws {
    let server = FakeServer { _ in
      (200, "[\(ListItem.json(id: "files", type: "directory", access: "owner", childCount: 3, folderCount: 0)),\(ListItem.json(id: "tree", type: "directory", access: "owner", childCount: 2, folderCount: 1))]")
    }
    let session = try TestServer.session(server)

    #expect(try await session.folders(in: nil).map(\.folderCount) == [0, 1])
  }

  @Test func listsWhatOthersSharedWithTheCaller() async throws {
    let server = FakeServer { _ in (200, "[\(ListItem.json(id: "given", type: "document", access: "read"))]") }
    let session = try TestServer.session(server)

    let shared = try await session.sharedWithMe()

    #expect(shared.map(\.id) == ["given"])
    #expect(try #require(server.requests.only).url.path == "/api/v1/entities/shared")
  }

  @Test func listsTheTrashLastInFirst() async throws {
    let server = FakeServer { _ in
      (
        200,
        """
        [{"id":"gone","title":"Old plan","entityType":"drawing","screenShotLight":"","screenShotDark":"",
          "createdAt":"2026-09-01T08:00:00.000Z","updatedAt":"2026-09-02T08:00:00.000Z",
          "deletedAt":"2026-09-20T08:00:00.000Z"}]
        """
      )
    }
    let session = try TestServer.session(server)

    let trash = try await session.trash()

    #expect(trash.map(\.title) == ["Old plan"])
    #expect(trash.map(\.kind) == [.drawing])
    #expect(try #require(server.requests.only).url.path == "/api/v1/entities/trash")
  }

  /// As on the web, a theme without its own picture shows the file's icon
  /// rather than the other theme's.
  @Test func aThumbnailIsTheOneForTheScreensAppearance() async throws {
    let server = FakeServer { _ in
      (
        200,
        "[\(ListItem.json(id: "both", type: "drawing", access: "owner", light: "https://blob.test/l.webp", dark: "https://blob.test/d.webp")),\(ListItem.json(id: "light", type: "drawing", access: "owner", light: "https://blob.test/only.webp"))]"
      )
    }
    let session = try TestServer.session(server)

    let files = try await session.listing(of: nil).files

    #expect(files[0].thumbnail(dark: false) == URL(string: "https://blob.test/l.webp"))
    #expect(files[0].thumbnail(dark: true) == URL(string: "https://blob.test/d.webp"))
    #expect(files[1].thumbnail(dark: false) == URL(string: "https://blob.test/only.webp"))
    #expect(files[1].thumbnail(dark: true) == nil)
  }
}

/// One row of `GET /entities`, with only what a test cares about set.
enum ListItem {
  static func json(
    id: String, type: String, access: String, light: String = "", dark: String = "", tags: [String] = [],
    childCount: Int = 0, folderCount: Int = 0
  ) -> String {
    let tagList = tags.map { "\"\($0)\"" }.joined(separator: ",")
    return """
      {"id":"\(id)","title":"\(id)","entityType":"\(type)","createdAt":"2026-09-01T08:00:00.000Z",
       "updatedAt":"2026-09-25T09:30:00.000Z","screenShotLight":"\(light)","screenShotDark":"\(dark)",
       "thumbnailStatus":null,"thumbnailVersion":null,"thumbnailUpdatedAt":null,"access":"\(access)",
       "publicAccess":"PRIVATE","parentId":null,"favoritedAt":null,"archivedAt":null,"sharedWithCount":0,
       "tags":[\(tagList)],"childCount":\(childCount),"folderCount":\(folderCount)}
      """
  }
}
