import Foundation
import Testing

@testable import LexidrawKit

@Suite struct FileActionsTests {
  /// Titled as the web titles one, and left for the server to start empty.
  @Test func makesANewFileInTheFolderItWasAskedFrom() async throws {
    let server = FakeServer { request in (200, Summary.json(id: request.json["id"] ?? "", type: "drawing", title: "New drawing", parentId: "dir-1")) }
    let session = try TestServer.session(server)

    let made = try await session.create(.drawing, in: "dir-1")

    let request = try #require(server.requests.only)
    #expect(request.method == .post)
    #expect(request.url.path == "/api/v1/entities")
    #expect(request.json["title"] == "New drawing")
    #expect(request.json["entityType"] == "drawing")
    #expect(request.json["parentId"] == "dir-1")
    #expect(UUID(uuidString: request.json["id"] ?? "") != nil)
    #expect(!request.keys.contains("elements"))
    #expect(made.id == request.json["id"])
    #expect(made.kind == .drawing)
    #expect(made.access == .owner)
  }

  @Test func makesANewFolderAtTheTopOfHome() async throws {
    let server = FakeServer { request in (200, Summary.json(id: request.json["id"] ?? "", type: "directory", title: "New folder")) }
    let session = try TestServer.session(server)

    let made = try await session.create(.folder, in: nil)

    let request = try #require(server.requests.only)
    #expect(request.json["title"] == "New folder")
    #expect(request.json["entityType"] == "directory")
    #expect(!request.keys.contains("parentId"))
    #expect(made.kind == .folder)
  }

  @Test func renamesByTheTitleAlone() async throws {
    let server = FakeServer { _ in (200, #"{"id":"doc"}"#) }
    let session = try TestServer.session(server)

    try await session.rename("doc", to: "Plan")

    let request = try #require(server.requests.only)
    #expect(request.method == .patch)
    #expect(request.url.path == "/api/v1/entities/doc")
    #expect(request.json == ["title": "Plan"])
  }

  @Test func movesIntoAFolderOrHome() async throws {
    let server = FakeServer { _ in (200, Summary.json(id: "doc", type: "document", title: "Plan")) }
    let session = try TestServer.session(server)

    try await session.move("doc", to: "dir-team")
    try await session.move("doc", to: nil)

    let (into, home) = (server.requests[0], server.requests[1])
    #expect(into.method == .post)
    #expect(into.url.path == "/api/v1/entities/doc/move")
    #expect(into.json == ["parentId": "dir-team"])
    #expect(home.keys.isEmpty)
  }

  @Test func deletingPutsItInTheTrash() async throws {
    let server = FakeServer { _ in (200, #"{"id":"doc"}"#) }
    let session = try TestServer.session(server)

    try await session.moveToTrash("doc")

    let request = try #require(server.requests.only)
    #expect(request.method == .delete)
    #expect(request.url.path == "/api/v1/entities/doc")
  }

  /// Into the folder it left, or Home when its owner may no longer write there.
  @Test func restoringSaysWhetherItWentBackToHome() async throws {
    let server = FakeServer { request in
      request.url.path.contains("gone-home")
        ? (200, Summary.json(id: "gone-home", type: "document", title: "A"))
        : (200, Summary.json(id: "gone-back", type: "document", title: "B", parentId: "dir-1"))
    }
    let session = try TestServer.session(server)

    #expect(try await session.restore("gone-back") == .itsFolder)
    #expect(try await session.restore("gone-home") == .home)

    #expect(server.requests.map(\.method) == [.post, .post])
    #expect(server.requests[0].url.path == "/api/v1/entities/gone-back/restore")
  }

  @Test func aRefusalCarriesWhatTheServerSaid() async throws {
    let server = FakeServer { _ in
      (400, #"{"message":"A directory cannot move into itself or a directory inside it","code":"BAD_REQUEST"}"#)
    }
    let session = try TestServer.session(server)

    let refusal = await #expect(throws: Refusal.self) { try await session.move("dir", to: "dir-inside") }
    #expect(refusal?.message == "A directory cannot move into itself or a directory inside it")
  }
}

@Suite struct FileAccessTests {
  @Test func aFileOffersWhatItsAccessAllows() {
    #expect(Access.read.may(.rename) == false)
    #expect(Access.edit.may(.rename) && Access.edit.may(.move))
    #expect(Access.edit.may(.delete) == false)
    #expect(Access.owner.may(.delete))
  }

  /// As a drop on the web: anyone who may move a file may take it to Home, and
  /// only its owner into a folder, one they may edit in, since whether the
  /// owner may write there is not the caller's to see.
  @Test func aFileGoesOnlyWhereTheServerWouldTakeIt() {
    let owned = Entry.stub(id: "doc", access: .owner)
    let edited = Entry.stub(id: "doc", access: .edit)
    let read = Entry.stub(id: "doc", access: .read)
    let team = Entry.stub(id: "dir-team", kind: .folder, access: .edit)
    let theirs = Entry.stub(id: "dir-theirs", kind: .folder, access: .read)

    #expect(owned.mayMove(into: team))
    #expect(owned.mayMove(into: nil))
    #expect(!owned.mayMove(into: theirs))
    #expect(edited.mayMove(into: nil))
    #expect(!edited.mayMove(into: team))
    #expect(!read.mayMove(into: nil))
    let folder = Entry.stub(id: "dir-team", kind: .folder, access: .owner)
    #expect(!folder.mayMove(into: team))
  }
}

/// What `POST /entities`, a move and a restore answer.
enum Summary {
  static func json(id: String, type: String, title: String, parentId: String? = nil) -> String {
    let parent = parentId.map { "\"\($0)\"" } ?? "null"
    return """
      {"id":"\(id)","title":"\(title)","entityType":"\(type)","parentId":\(parent),
       "createdAt":"2026-09-26T08:00:00.000Z","updatedAt":"2026-09-26T08:00:00.000Z"}
      """
  }
}

extension Entry {
  static func stub(id: String, kind: Kind = .document, access: Access) -> Entry {
    Entry(
      id: id, title: id, kind: kind, updatedAt: .now, access: access, parentId: nil, tags: [], itemCount: 0,
      pictures: Pictures(light: "", dark: ""))
  }
}
