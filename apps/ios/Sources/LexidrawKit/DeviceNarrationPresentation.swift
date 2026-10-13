public struct DeviceNarrationPresentation: Sendable {
  public enum Activity: Sendable {
    case unknown(String)
    case running(String)
    case resume(disclosure: String?)
    case none
  }

  public let retainedSummary: String
  public let activity: Activity

  public init(checkpoint: DeviceNarrationCheckpoint) {
    retainedSummary = "\(checkpoint.parts.filter { $0.kind == .completed }.count) of \(checkpoint.parts.count) parts retained locally."
    if checkpoint.status == "unknown" {
      activity = .unknown(
        "Provider outcome uncertain. No automatic repeat will occur. Check the original provider result before recovering this part."
      )
    } else if checkpoint.status == "running" {
      activity = .running("Generating in the foreground…")
    } else if checkpoint.recording == nil {
      let pausedPending = checkpoint.status == "paused"
        && checkpoint.parts.contains { $0.kind == .pending }
        && !checkpoint.parts.contains { $0.kind == .started || $0.kind == .unknown }
      activity = .resume(disclosure: pausedPending
        ? "Paused on this device. Choose Resume generation to continue with the current key. Each Resume starts a new 20-minute continuation for pending parts only; completed audio is kept. Unfinished or unsynced work is local only."
        : nil)
    } else {
      activity = .none
    }
  }
}
