import Foundation
import Testing
@testable import LexidrawKit

struct DeviceNarrationPresentationTests {
  @Test func oldPausedCheckpointDisclosesEachContinuationBeforeResume() throws {
    let checkpoint = DeviceNarrationCheckpoint(
      version: 1, account: "alice", document: "doc", id: "retained-continuation",
      created: Date().addingTimeInterval(-3 * 24 * 60 * 60),
      status: "paused",
      parts: [
        .init(kind: .completed, text: "Retained chapter",
          output: DeviceAudio(audio: "data:audio/wav;base64,UklGRg==", seconds: 1)),
        .init(kind: .pending, text: "Pending chapter", output: nil),
      ], fingerprints: Data())

    let presentation = DeviceNarrationPresentation(checkpoint: checkpoint)

    #expect(presentation.retainedSummary == "1 of 2 parts retained locally.")
    guard case .resume(let disclosure) = presentation.activity else {
      Issue.record("An old paused checkpoint must still offer Resume generation.")
      return
    }
    let copy = try #require(disclosure)
    #expect(copy == "Paused on this device. Choose Resume generation to continue with the current key. Each Resume starts a new 20-minute continuation for pending parts only; completed audio is kept. Unfinished or unsynced work is local only.")
  }
}
