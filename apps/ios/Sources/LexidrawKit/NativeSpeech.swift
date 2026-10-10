import AVFoundation
import Foundation
import Synchronization

/// Apple's voices rendered into disposable device files. AVPlayer supplies
/// accurate seeking and long-form background playback; nothing is uploaded.
@MainActor public final class NativeSpeech: NSObject, AVSpeechSynthesizerDelegate {
  private let synthesizer = AVSpeechSynthesizer()
  private var directory: URL?
  private var output: SpeechOutput?
  private var utteranceID: ObjectIdentifier?
  public private(set) var voiceDescription: String?

  public override init() {
    super.init()
    synthesizer.delegate = self
  }

  nonisolated public func speechSynthesizer(
    _ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance
  ) {
    let id = ObjectIdentifier(utterance)
    Task { @MainActor [weak self] in
      guard self?.utteranceID == id else { return }
      self?.output?.end()
    }
  }

  public func recording(_ narration: LocalNarration) async throws -> Recording {
    stop()
    let language = narration.language ?? Locale.current.language.languageCode?.identifier ?? "en"
    // Use the system's language default rather than an arbitrary enumerated voice.
    guard let preferred = AVSpeechSynthesisVoice(language: language),
      let voice = AVSpeechSynthesisVoice.speechVoices().first(where: {
        $0.identifier == preferred.identifier
      })
    else {
      throw ListenFailed(
        message:
          "No available Apple voice for \(language). Add a voice in iOS Accessibility settings. No cloud voice is used."
      )
    }
    voiceDescription =
      "Built-in Apple voice: \(voice.name) (\(voice.language)). Uses the voices available on this device. This audio is temporary and does not sync."
    let folder = FileManager.default.temporaryDirectory.appending(path: "local-narration-\(UUID())")
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    directory = folder
    var parts: [Recording.Part] = []
    do {
      for (index, text) in narration.parts.enumerated() {
        try Task.checkCancellation()
        guard directory == folder else { throw CancellationError() }
        let url = folder.appending(path: "\(index).caf")
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = voice
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate
        let sink = SpeechOutput(url: url)
        output = sink
        utteranceID = ObjectIdentifier(utterance)
        let timeout = Task { [weak self] in
          try? await Task.sleep(for: .seconds(60))
          guard !Task.isCancelled else { return }
          sink.finish(
            .failure(
              ListenFailed(
                message:
                  "The device voice did not finish. Try again or choose another installed voice in iOS settings."
              )))
          if self?.output === sink { self?.synthesizer.stopSpeaking(at: .immediate) }
        }
        defer { timeout.cancel() }
        try await withTaskCancellationHandler {
          try await withCheckedThrowingContinuation { continuation in
            sink.begin(continuation)
            synthesizer.write(utterance) { buffer in sink.write(buffer) }
          }
        } onCancel: {
          sink.finish(.failure(CancellationError()))
          Task { @MainActor [weak self] in
            guard self?.output === sink else { return }
            self?.synthesizer.stopSpeaking(at: .immediate)
          }
        }
        try Task.checkCancellation()
        parts.append(.init(text: text, audio: url, section: nil))
      }
      output = nil
      return Recording(parts: parts)
    } catch {
      if directory == folder { stop() } else { try? FileManager.default.removeItem(at: folder) }
      throw error
    }
  }

  public func stop() {
    output?.finish(.failure(CancellationError()))
    output = nil
    utteranceID = nil
    synthesizer.stopSpeaking(at: .immediate)
    if let directory { try? FileManager.default.removeItem(at: directory) }
    directory = nil
    voiceDescription = nil
  }
}

/// The speech callback runs outside the main actor. All file writes and
/// continuation completion are serialized, including cancellation races.
private final class SpeechOutput: Sendable {
  private struct State {
    var file: AVAudioFile?
    var continuation: CheckedContinuation<Void, any Error>?
    var result: Result<Void, any Error>?
  }
  private let state = Mutex(State())
  private let url: URL
  init(url: URL) { self.url = url }

  func begin(_ continuation: CheckedContinuation<Void, any Error>) {
    state.withLock {
      if let result = $0.result {
        continuation.resume(with: result)
      } else {
        $0.continuation = continuation
      }
    }
  }

  func write(_ buffer: AVAudioBuffer) {
    state.withLock { state in
      guard state.result == nil else { return }
      do {
        guard let pcm = buffer as? AVAudioPCMBuffer else {
          throw ListenFailed(message: "The device voice returned unsupported audio.")
        }
        // Empty buffers can separate speech chunks. The utterance delegate
        // confirms completion after all chunks have been written.
        if pcm.frameLength > 0 {
          if state.file == nil {
            state.file = try AVAudioFile(forWriting: url, settings: pcm.format.settings)
            #if os(iOS)
              try FileManager.default.setAttributes(
                [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                ofItemAtPath: url.path)
            #endif
          }
          try state.file?.write(from: pcm)
        }
      } catch { complete(.failure(error), state: &state) }
    }
  }

  func end() {
    state.withLock { state in
      if let file = state.file, file.length > 0 {
        complete(.success(()), state: &state)
      } else {
        complete(
          .failure(ListenFailed(message: "The installed device voice produced no audio.")),
          state: &state)
      }
    }
  }

  func finish(_ result: Result<Void, any Error>) {
    state.withLock { complete(result, state: &$0) }
  }

  private func complete(_ result: Result<Void, any Error>, state: inout State) {
    guard state.result == nil else { return }
    state.result = result
    state.file = nil
    state.continuation?.resume(with: result)
    state.continuation = nil
  }
}
