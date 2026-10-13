import LexidrawKit
import Testing

@Suite struct ListeningRecoveryTests {
  @Test func interruptionResumesOnlyTheListenTheUserWasPlaying() {
    var listening = ListeningRecovery()
    listening.play()
    listening.interrupted()
    #expect(!listening.wantsPlayback)
    let resumed = listening.ended(shouldResume: true)
    #expect(resumed)
    #expect(listening.wantsPlayback)
    listening.pause()
    listening.interrupted()
    let resumedAfterPause = listening.ended(shouldResume: true)
    #expect(!resumedAfterPause)
  }

  @Test func pausingDuringAnInterruptionPreventsUnexpectedPlayback() {
    var listening = ListeningRecovery()
    listening.play()
    listening.interrupted()
    listening.pause()
    let resumedAfterPause = listening.ended(shouldResume: true)
    #expect(!resumedAfterPause)
    #expect(!listening.wantsPlayback)
  }

  @Test func anInterruptionWithoutResumePermissionKeepsTheListenPaused() {
    var listening = ListeningRecovery()
    listening.play()
    listening.interrupted()
    let resumed = listening.ended(shouldResume: false)
    #expect(!resumed)
    #expect(!listening.wantsPlayback)
  }
}
