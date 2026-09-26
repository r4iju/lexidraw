import AVFoundation
import LexidrawKit
import MediaPlayer

/// Listen: one file read aloud at a time, playing on with the screen locked
/// and controlled from the Lock Screen and Control Centre like a podcast.
@MainActor @Observable
final class Listener {
  struct File: Equatable {
    let id: String
    let title: String
  }

  enum State {
    case idle
    case preparing(File, Recording.Progress)
    case failed(File, String)
    case loaded(File, Recording)
  }

  /// How far the controls skip, as Podcasts does for spoken audio.
  static let skip = 15.0

  private(set) var state = State.idle
  private(set) var position = Recording.Position.start
  private(set) var isPlaying = false
  /// Of the part playing, once it is known.
  private(set) var duration: Double?

  private let session: Session
  private let resumePoints = ResumePoints()
  private let player = AVQueuePlayer()
  /// The parts queued in the player, from `firstQueued` on.
  private var queued: [AVPlayerItem] = []
  private var firstQueued = 0
  private var preparing: Task<Void, Never>?
  private var observations: [NSKeyValueObservation] = []
  private var ticks: Any?
  private var interruptions: Task<Void, Never>?
  private var endings: Task<Void, Never>?

  init(session: Session) {
    self.session = session
    observations = [
      player.observe(\.currentItem) { [weak self] _, _ in
        Task { @MainActor in self?.partChanged() }
      },
      player.observe(\.timeControlStatus) { [weak self] player, _ in
        let playing = player.timeControlStatus != .paused
        Task { @MainActor in self?.playingChanged(playing) }
      },
    ]
    ticks = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 1, preferredTimescale: 600), queue: .main) {
      [weak self] time in
      MainActor.assumeIsolated { self?.ticked(time.seconds) }
    }
    endings = Task { [weak self] in
      for await note in NotificationCenter.default.notifications(named: AVPlayerItem.didPlayToEndTimeNotification) {
        guard let self, let item = note.object as? AVPlayerItem, item === queued.last else { continue }
        finished()
      }
    }
  }

  var file: File? {
    switch state {
    case .idle: nil
    case .preparing(let file, _), .failed(let file, _), .loaded(let file, _): file
    }
  }

  var recording: Recording? {
    if case .loaded(_, let recording) = state { recording } else { nil }
  }

  var part: Recording.Part? {
    recording?.part(at: position)
  }

  /// Plays `file` from where its last listen stopped, making its audio first
  /// when there is none yet.
  func listen(to file: File) {
    if self.file == file, recording != nil {
      play()
      return
    }
    stop()
    state = .preparing(file, .started)
    preparing = Task {
      do {
        let recording = try await session.recording(of: file.id) { progress in
          Task { @MainActor in
            if case .preparing(file, _) = self.state { self.state = .preparing(file, progress) }
          }
        }
        try Task.checkCancellation()
        state = .loaded(file, recording)
        queue(from: recording.resuming(resumePoints.position(of: file.id)), playing: true)
      } catch is CancellationError {
      } catch {
        state = .failed(file, error.localizedDescription)
      }
    }
  }

  func play() {
    guard recording != nil else { return }
    activateAudio()
    player.play()
  }

  func pause() {
    player.pause()
    keepPosition()
  }

  func togglePlaying() {
    isPlaying ? pause() : play()
  }

  func skip(by seconds: Double) {
    let target = max(0, min(position.seconds + seconds, (duration ?? .infinity) - 0.5))
    player.seek(to: CMTime(seconds: target, preferredTimescale: 600))
    position.seconds = target
    updateNowPlaying()
  }

  func nextPart() {
    guard let next = recording?.next(from: position) else { return }
    queue(from: next, playing: isPlaying)
  }

  func previousPart() {
    guard let previous = recording?.previous(from: position) else { return }
    queue(from: previous, playing: isPlaying)
  }

  /// Ends the listen, keeping where it stopped for next time.
  func stop() {
    preparing?.cancel()
    preparing = nil
    if recording != nil { keepPosition() }
    player.pause()
    player.removeAllItems()
    queued = []
    state = .idle
    position = .start
    duration = nil
    MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    releaseRemoteCommands()
    interruptions?.cancel()
    interruptions = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  // MARK: Playing

  /// Queues the parts from `position` on, so the next part plays on without
  /// a gap.
  private func queue(from position: Recording.Position, playing: Bool) {
    guard let recording else { return }
    player.removeAllItems()
    firstQueued = position.part
    queued = recording.parts[position.part...].map { AVPlayerItem(url: $0.audio) }
    for item in queued { player.insert(item, after: nil) }
    self.position = position
    duration = nil
    if position.seconds > 0 {
      player.seek(to: CMTime(seconds: position.seconds, preferredTimescale: 600))
    }
    claimRemoteCommands()
    if playing { play() }
    updateNowPlaying()
  }

  /// Past the last part: the next listen starts from the top.
  private func finished() {
    guard let file else { return }
    resumePoints.finished(file.id)
    queue(from: .start, playing: false)
  }

  private func partChanged() {
    guard let item = player.currentItem, let index = queued.firstIndex(of: item) else { return }
    if firstQueued + index != position.part {
      position = Recording.Position(part: firstQueued + index, seconds: 0)
    }
    duration = nil
    keepPosition()
    updateNowPlaying()
  }

  private func playingChanged(_ playing: Bool) {
    isPlaying = playing
    updateNowPlaying()
  }

  private func ticked(_ seconds: Double) {
    guard recording != nil, seconds.isFinite else { return }
    position.seconds = seconds
    if duration == nil, let known = player.currentItem?.duration.seconds, known.isFinite {
      duration = known
      updateNowPlaying()
    }
    keepPosition()
  }

  private func keepPosition() {
    guard let file, recording != nil else { return }
    resumePoints.keep(position, of: file.id)
  }

  // MARK: The system's controls

  private func activateAudio() {
    let audio = AVAudioSession.sharedInstance()
    // Long-form spoken audio: routed as Podcasts is, and paused rather than
    // ducked when something else speaks.
    try? audio.setCategory(.playback, mode: .spokenAudio, policy: .longFormAudio)
    try? audio.setActive(true)
    guard interruptions == nil else { return }
    interruptions = Task { [weak self] in
      for await note in NotificationCenter.default.notifications(named: AVAudioSession.interruptionNotification) {
        let info = note.userInfo ?? [:]
        guard (info[AVAudioSessionInterruptionTypeKey] as? UInt).flatMap(AVAudioSession.InterruptionType.init) == .ended
        else { continue }
        let options = AVAudioSession.InterruptionOptions(rawValue: info[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0)
        if options.contains(.shouldResume) { self?.play() }
      }
    }
  }

  private func updateNowPlaying() {
    guard let file, let recording else { return }
    var info: [String: Any] = [
      MPMediaItemPropertyTitle: file.title,
      MPMediaItemPropertyArtist: part?.section ?? "Lexidraw",
      MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
      MPNowPlayingInfoPropertyChapterNumber: position.part,
      MPNowPlayingInfoPropertyChapterCount: recording.parts.count,
      MPNowPlayingInfoPropertyElapsedPlaybackTime: position.seconds,
      MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0,
    ]
    if let duration { info[MPMediaItemPropertyPlaybackDuration] = duration }
    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
  }

  private func claimRemoteCommands() {
    let center = MPRemoteCommandCenter.shared()
    releaseRemoteCommands()
    center.skipForwardCommand.preferredIntervals = [NSNumber(value: Self.skip)]
    center.skipBackwardCommand.preferredIntervals = [NSNumber(value: Self.skip)]
    let actions: [(MPRemoteCommand, @MainActor (Listener) -> Void)] = [
      (center.playCommand, { $0.play() }),
      (center.pauseCommand, { $0.pause() }),
      (center.togglePlayPauseCommand, { $0.togglePlaying() }),
      (center.skipForwardCommand, { $0.skip(by: Self.skip) }),
      (center.skipBackwardCommand, { $0.skip(by: -Self.skip) }),
      (center.nextTrackCommand, { $0.nextPart() }),
      (center.previousTrackCommand, { $0.previousPart() }),
    ]
    for (command, action) in actions {
      command.isEnabled = true
      // The system calls these on the main thread.
      command.addTarget { [weak self] _ in
        MainActor.assumeIsolated {
          guard let self else { return .noActionableNowPlayingItem }
          action(self)
          return .success
        }
      }
    }
    center.changePlaybackPositionCommand.isEnabled = true
    center.changePlaybackPositionCommand.addTarget { [weak self] event in
      MainActor.assumeIsolated {
        guard let self, let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
        self.skip(by: event.positionTime - self.position.seconds)
        return .success
      }
    }
  }

  private func releaseRemoteCommands() {
    let center = MPRemoteCommandCenter.shared()
    for command in [
      center.playCommand, center.pauseCommand, center.togglePlayPauseCommand, center.skipForwardCommand,
      center.skipBackwardCommand, center.nextTrackCommand, center.previousTrackCommand,
      center.changePlaybackPositionCommand,
    ] {
      command.removeTarget(nil)
      command.isEnabled = false
    }
  }
}
