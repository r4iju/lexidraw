import AVFoundation
import LexidrawKit
import MediaPlayer

/// Listen: one file read aloud at a time, playing on with the screen locked
/// and controlled from the Lock Screen and Control Centre like a podcast.
@MainActor @Observable
final class Listener {
  struct File: Equatable, Identifiable {
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
  private(set) var voiceDescription: String?
  private var positionKey: String?
  private let speech = NativeSpeech()
  private var proFiles: ProNarrationFiles?
  private var seekID: UUID?
  private var recovery = ListeningRecovery()
  private var savedOnly = false
  private var routes: Task<Void, Never>?
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
        Task { @MainActor in self?.playingChanged() }
      },
    ]
    ticks = player.addPeriodicTimeObserver(
      forInterval: CMTime(seconds: 1, preferredTimescale: 600), queue: .main
    ) {
      [weak self] time in
      MainActor.assumeIsolated { self?.ticked(time.seconds) }
    }
    endings = Task { [weak self] in
      for await note in NotificationCenter.default.notifications(
        named: AVPlayerItem.didPlayToEndTimeNotification)
      {
        guard let self, let item = note.object as? AVPlayerItem, item === queued.last else {
          continue
        }
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

  /// Reads with the account power choice, or explicitly replays saved audio.
  func listen(to file: File, savedOnly: Bool = false) {
    stop()
    self.savedOnly = savedOnly
    state = .preparing(file, .started)
    preparing = Task {
      do {
        let source = try await session.narration(of: file.id, savedOnly: savedOnly)
        try Task.checkCancellation()
        let recording: Recording
        switch source {
        case .local(let narration):
          positionKey = narration.resumeID(file: file.id)
          recording = try await speech.recording(narration)
          voiceDescription = speech.voiceDescription
        case .device(let job):
          let files = ProNarrationFiles()
          recording = try files.recording(job)
          proFiles = files
          positionKey = NarrationPlayback(job: job, source: .device).resumeID(file: file.id)
          voiceDescription = "Saved device recording. Replay is free without a key."
        case .saved(let saved):
          recording = saved
          positionKey = file.id
        }
        try Task.checkCancellation()
        guard !recording.parts.isEmpty else {
          throw ListenFailed(message: "There is no audio in this recording.")
        }
        state = .loaded(file, recording)
        queue(
          from: recording.resuming(resumePoints.position(of: positionKey ?? file.id)), playing: true
        )
      } catch is CancellationError {
      } catch {
        guard !Task.isCancelled else { return }
        state = .failed(file, error.localizedDescription)
      }
    }
  }

  var narrationSession: Session { session }

  func proNarrationFlow(for document: String) -> NativeNarrationFlow {
    NativeNarrationFlow(session: session, document: document)
  }

  func playNarration(_ playback: NarrationPlayback, to file: File) {
    let job = playback.job
    stop()
    let files = ProNarrationFiles()
    do {
      let recording = try files.recording(job)
      proFiles = files
      positionKey = playback.resumeID(file: file.id)
      voiceDescription = job.policy
      state = .loaded(file, recording)
      queue(
        from: recording.resuming(resumePoints.position(of: positionKey ?? file.id)), playing: true)
    } catch {
      files.clear()
      state = .failed(file, "Saved narration could not be opened. Reload it without regenerating.")
    }
  }

  func retry() {
    guard let file else { return }
    listen(to: file, savedOnly: savedOnly)
  }

  func play() {
    guard recording != nil else { return }
    recovery.play()
    if seekID != nil { return }
    guard activateAudio() else {
      recovery.pause()
      return
    }
    player.play()
  }

  func pause() {
    recovery.pause()
    player.pause()
    isPlaying = false
    updateNowPlaying()
    keepPosition()
  }

  func togglePlaying() {
    isPlaying ? pause() : play()
  }

  func skip(by seconds: Double) {
    let target = max(0, min(position.seconds + seconds, (duration ?? .infinity) - 0.5))
    position.seconds = target
    seek(to: position, playing: isPlaying)
    keepPosition()
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
    seekID = nil
    recovery.pause()
    player.pause()
    player.removeAllItems()
    queued = []
    proFiles?.clear()
    proFiles = nil
    speech.stop()
    voiceDescription = nil
    positionKey = nil
    isPlaying = false
    state = .idle
    position = .start
    duration = nil
    MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    releaseRemoteCommands()
    interruptions?.cancel()
    interruptions = nil
    routes?.cancel()
    routes = nil
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
    claimRemoteCommands()
    seek(to: position, playing: playing)
    updateNowPlaying()
  }

  private func seek(to position: Recording.Position, playing: Bool) {
    let id = UUID()
    seekID = id
    if playing { recovery.play() } else { recovery.pause() }
    player.seek(
      to: CMTime(seconds: position.seconds, preferredTimescale: 600), toleranceBefore: .zero,
      toleranceAfter: .zero
    ) { [weak self] completed in
      Task { @MainActor in
        guard let self, self.seekID == id else { return }
        self.seekID = nil
        if completed {
          self.position = position
          self.keepPosition()
          if self.recovery.wantsPlayback { self.play() }
          self.updateNowPlaying()
        }
      }
    }
  }

  /// Past the last part: the next listen starts from the top.
  private func finished() {
    guard let positionKey else { return }
    resumePoints.finished(positionKey)
    queue(from: .start, playing: false)
  }

  private func partChanged() {
    guard let item = player.currentItem, let index = queued.firstIndex(of: item) else { return }
    if firstQueued + index != position.part {
      position = Recording.Position(part: firstQueued + index, seconds: 0)
    }
    duration = nil
    if seekID == nil { keepPosition() }
    updateNowPlaying()
  }

  private func playingChanged() {
    isPlaying = recording != nil && recovery.wantsPlayback && player.timeControlStatus != .paused
    updateNowPlaying()
  }

  private func ticked(_ observedSeconds: Double) {
    let seconds = player.currentTime().seconds
    guard recording != nil, seekID == nil, seconds.isFinite else { return }
    position.seconds = seconds
    if duration == nil, let known = player.currentItem?.duration.seconds, known.isFinite {
      duration = known
      updateNowPlaying()
    }
    keepPosition()
  }

  private func keepPosition() {
    guard let positionKey, recording != nil else { return }
    resumePoints.keep(position, of: positionKey)
  }

  // MARK: The system's controls

  private func activateAudio() -> Bool {
    let audio = AVAudioSession.sharedInstance()
    do {
      try audio.setCategory(.playback, mode: .spokenAudio, policy: .longFormAudio)
      try audio.setActive(true)
    } catch {
      if let file {
        state = .failed(
          file, "Audio playback is unavailable. Try again after the interruption ends.")
      }
      return false
    }
    if interruptions == nil {
      interruptions = Task { [weak self] in
        for await note in NotificationCenter.default.notifications(
          named: AVAudioSession.interruptionNotification)
        {
          guard let self else { return }
          let info = note.userInfo ?? [:]
          let type = (info[AVAudioSessionInterruptionTypeKey] as? UInt).flatMap(
            AVAudioSession.InterruptionType.init)
          if type == .began {
            recovery.interrupted()
            player.pause()
            isPlaying = false
            keepPosition()
            updateNowPlaying()
          } else if type == .ended {
            let options = AVAudioSession.InterruptionOptions(
              rawValue: info[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0)
            if recovery.ended(shouldResume: options.contains(.shouldResume)) { play() }
          }
        }
      }
    }
    if routes == nil {
      routes = Task { [weak self] in
        for await note in NotificationCenter.default.notifications(
          named: AVAudioSession.routeChangeNotification)
        {
          let reason = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
          if reason == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue {
            self?.pause()
          }
        }
      }
    }
    return true
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
        guard let self, let event = event as? MPChangePlaybackPositionCommandEvent else {
          return .commandFailed
        }
        self.skip(by: event.positionTime - self.position.seconds)
        return .success
      }
    }
  }

  private func releaseRemoteCommands() {
    let center = MPRemoteCommandCenter.shared()
    for command in [
      center.playCommand, center.pauseCommand, center.togglePlayPauseCommand,
      center.skipForwardCommand,
      center.skipBackwardCommand, center.nextTrackCommand, center.previousTrackCommand,
      center.changePlaybackPositionCommand,
    ] {
      command.removeTarget(nil)
      command.isEnabled = false
    }
  }
}
