import AVFoundation
import Foundation
import Testing

/// Listen plays the reader's chosen format, which may be Ogg.
@Suite struct OggPlaybackTests {
  private let sample = Bundle.module.url(forResource: "Fixtures/spoken.ogg", withExtension: nil)!

  @Test func oggOpusIsDecoded() throws {
    let file = try AVAudioFile(forReading: sample)
    #expect(file.length > 40_000)
  }

  @Test func oggOpusIsPlayable() async throws {
    let asset = AVURLAsset(url: sample)
    #expect(try await asset.load(.isPlayable))
    #expect(try await asset.load(.duration).seconds > 0.9)
  }
}
