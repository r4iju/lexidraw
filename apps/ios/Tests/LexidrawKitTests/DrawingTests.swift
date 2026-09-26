import Foundation
import Testing

@testable import LexidrawKit

@Suite struct DrawingTests {
  static func loaded(elements: String, appState: String = "null", access: String = "EDIT") -> String {
    """
    {"id":"d1","title":"Floor plan","entityType":"drawing","appState":\(appState),
     "elements":\(elements),"publicAccess":"PRIVATE","shared":false,"accessLevel":"\(access)",
     "updatedAt":"2026-09-25T09:30:00.123Z"}
    """
  }

  /// A later save must send these elements back as they came, fields this app
  /// doesn't know included, so they are kept as JSON and not as a model.
  @Test func opensADrawingWithItsElementsAsStored() async throws {
    let elements = #"[{"id":"r","type":"rectangle","x":1,"customData":{"kept":true}},{"id":"w","type":"widget"}]"#
    let server = FakeServer { _ in
      (200, Self.loaded(elements: try String(data: JSONEncoder().encode(elements), encoding: .utf8)!))
    }
    let session = try TestServer.session(server)

    let drawing = try await session.drawing("d1")

    #expect(drawing.title == "Floor plan")
    #expect(drawing.access == .edit)
    #expect(drawing.elements.map { $0["id"] } == ["r", "w"])
    #expect(drawing.elements.first?["customData"] == ["kept": true])
    #expect(drawing.updatedAt == Date(timeIntervalSince1970: 1_790_328_600.123))
    #expect(try #require(server.requests.only).url.path == "/api/v1/entities/d1")
  }

  /// The web draws on the saved background colour, and on white when the
  /// drawing has no app state.
  @Test func drawsOnTheSavedBackground() async throws {
    let server = FakeServer { request in
      request.url.path.hasSuffix("d1")
        ? (200, Self.loaded(elements: #""[]""#, appState: ##""{\"viewBackgroundColor\":\"#fdf6e3\"}""##))
        : (200, Self.loaded(elements: #""[]""#))
    }
    let session = try TestServer.session(server)

    #expect(try await session.drawing("d1").background == "#fdf6e3")
    #expect(try await session.drawing("d2").background == "#ffffff")
  }
}
