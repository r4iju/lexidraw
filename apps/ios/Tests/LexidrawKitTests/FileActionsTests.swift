import Foundation
import Testing

@testable import LexidrawKit

@Suite struct FileActionsTests {
  /// Left for the server to title and start empty, as it does the web's.
  @Test func makesANewFileInTheFolderItWasAskedFrom() async throws {
    let server = FakeServer { request in (200, Summary.json(id: request.json["id"] ?? "", type: "drawing", title: "New drawing", parentId: "dir-1")) }
    let session = try TestServer.session(server)

    let made = try await session.create(.drawing, in: "dir-1")

    let request = try #require(server.requests.only)
    #expect(request.method == .post)
    #expect(request.url.path == "/api/v1/entities")
    #expect(request.keys == ["id", "entityType", "parentId"])
    #expect(request.json["entityType"] == "drawing")
    #expect(request.json["parentId"] == "dir-1")
    #expect(UUID(uuidString: request.json["id"] ?? "") != nil)
    #expect(made.id == request.json["id"])
    #expect(made.title == "New drawing")
    #expect(made.kind == .drawing)
    #expect(made.access == .owner)
  }

  @Test func makesANewFolderAtTheTopOfHome() async throws {
    let server = FakeServer { request in (200, Summary.json(id: request.json["id"] ?? "", type: "directory", title: "New folder")) }
    let session = try TestServer.session(server)

    let made = try await session.create(.folder, in: nil)

    let request = try #require(server.requests.only)
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

  /// As the web moves one: a null folder is Home, where a missing one would
  /// leave it where it is.
  @Test func movesIntoAFolderOrHome() async throws {
    let server = FakeServer { _ in (200, #"{"id":"doc"}"#) }
    let session = try TestServer.session(server)

    try await session.move("doc", to: "dir-team")
    try await session.move("doc", to: nil)

    let (into, home) = (server.requests[0], server.requests[1])
    #expect(into.method == .patch)
    #expect(into.url.path == "/api/v1/entities/doc")
    #expect(into.authorization == "Bearer lxd_kept")
    #expect(into.json == ["parentId": "dir-team"])
    #expect(String(decoding: home.body ?? Data(), as: UTF8.self) == #"{"parentId":null}"#)
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

  @Test(arguments: [
    { (session: Session) in try await session.move("dir", to: "dir-inside") },
    { (session: Session) in try await session.rename("dir", to: "Inside") },
    { (session: Session) in _ = try await session.listing(of: "dir") },
  ] as [@Sendable (Session) async throws -> Void])
  func aRefusalCarriesWhatTheServerSaid(ask: @Sendable (Session) async throws -> Void) async throws {
    let server = FakeServer { _ in
      (400, #"{"message":"A directory cannot move into itself or a directory inside it","code":"BAD_REQUEST"}"#)
    }
    let session = try TestServer.session(server)

    let refusal = await #expect(throws: Refusal.self) { try await ask(session) }
    #expect(refusal?.status == 400)
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

  /// As a drop on the web.
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

/// What `POST /entities` and a restore answer.
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
      id: id, title: id, kind: kind, updatedAt: .now, access: access, parentId: nil, tags: [], folderCount: 0,
      pictures: Pictures(light: "", dark: ""))
  }
}
