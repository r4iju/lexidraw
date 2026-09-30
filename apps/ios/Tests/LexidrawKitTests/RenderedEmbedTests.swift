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
