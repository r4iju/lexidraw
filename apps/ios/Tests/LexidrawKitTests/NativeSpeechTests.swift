import AVFoundation
import Foundation
import LexidrawKit
import Testing

@Suite @MainActor struct NativeSpeechTests {
  @Test func appleSpeechProducesSeekableDeviceAudioWithoutASyncedRecording() async throws {
    let speech = NativeSpeech()
    defer { speech.stop() }
    let narration = try LocalNarration(
      text: String(
        repeating:
          "A thoughtful plan starts here. Built-in speech reads this document on this device. ",
        count: 12), language: "en")
    let recording = try await speech.recording(narration)
    let part = try #require(recording.parts.first)
    #expect(part.audio.isFileURL)
    let file = try AVAudioFile(forReading: part.audio)
    #expect(Double(file.length) / file.processingFormat.sampleRate > 30)
    let buffer = try #require(
      AVAudioPCMBuffer(
        pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)))
    try file.read(into: buffer)
    let samples = try #require(buffer.floatChannelData?[0])
    #expect((0..<Int(buffer.frameLength)).contains { abs(samples[$0]) > 0.001 })
    speech.stop()
    #expect(!FileManager.default.fileExists(atPath: part.audio.path))
  }
}
