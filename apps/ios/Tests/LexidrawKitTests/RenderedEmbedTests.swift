import Foundation
import Testing
@testable import LexidrawKit

private actor RenderCounter {
  var active = 0
  var peak = 0
  func enter() { active += 1; peak = max(peak, active) }
  func leave() { active -= 1 }
}

@Suite struct RenderedEmbedAPITests {
  @Test func articleBodyKeepsBrowserLinkGeometryAndAccessibleText() async throws {
    let server = FakeServer { _ in (200, #"{"hash":"article","svg":"<svg/>","png":"AQ==","width":390,"height":200,"accessibleText":"Readable article text","links":[{"url":"https://example.com","x":10,"y":20,"width":80,"height":17}]}"#) }
    let render = try await TestServer.session(server).renderEmbed(node: ["type": "article"], dark: false, width: 390, fontFamily: "sans", fontSize: 17)
    #expect(render.accessibleText == "Readable article text")
    #expect(render.links.first?.url == URL(string: "https://example.com"))
    #expect(render.links.first?.x == 10)
  }
  @Test func boundsNativeNetworkRenders() async throws {
    let queue = RenderedEmbedQueue()
    let counter = RenderCounter()
    try await withThrowingTaskGroup(of: Void.self) { group in
      for _ in 0..<12 {
        group.addTask {
          try await queue.perform {
            await counter.enter()
            try await Task.sleep(for: .milliseconds(20))
            await counter.leave()
          }
        }
      }
      try await group.waitForAll()
    }
    #expect(await counter.peak == 2)
    #expect(await counter.active == 0)
  }
}
