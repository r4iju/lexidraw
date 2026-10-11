import Foundation
import Observation

public struct DeviceRecording: Codable, Sendable {
  public struct Part: Codable, Sendable {
    public let text: String
    public let audio: String
    public let seconds: Double
  }
  public let mimeType: String
  public let parts: [Part]
  @MainActor public func validated() throws -> Self {
    guard mimeType == "audio/wav", (1...8).contains(parts.count),
      parts.reduce(0, { $0 + $1.text.utf8.count }) <= 6000
    else { throw NativeAIError.rejected }
    for part in parts {
      guard !part.text.isEmpty, part.text.utf8.count <= 2000 else { throw NativeAIError.rejected }
      try NativeCredentialGuard.shared.check(Data(part.text.utf8))
      _ = try DeviceAudio(audio: part.audio, seconds: part.seconds).validated()
    }
    return self
  }
  public func job(id: String?) -> ProNarrationJob {
    ProNarrationJob(
      id: id, state: "saved", charged: 0, quote: 0, made: parts.count, planned: parts.count,
      parts: parts.map { .init(text: $0.text, audio: $0.audio, seconds: $0.seconds) },
      policy: "Saved device recording. Replay is free without a provider key or Pro credits.")
  }
}
public struct DeviceNarrationCheckpoint: Codable, Sendable {
  public struct Part: Codable, Sendable {
    public enum Kind: String, Codable, Sendable { case pending, started, unknown, completed }
    public var kind: Kind
    public let text: String
    public var output: DeviceAudio?
  }
  public var revision: String = UUID().uuidString
  public let version: Int
  public let account: String
  public let document: String
  public var id: String
  public var uploadKey: String? = nil
  public var recordingId: String? = nil
  public let created: Date
  public var status: String
  public var parts: [Part]
  public var owner: NativeArtifactOwner? = nil
  public var fingerprints: Data
  @MainActor public func validated() throws -> Self {
    guard version == 1, parts.reduce(0, { $0 + $1.text.utf8.count }) <= 6000, !account.isEmpty,
      !document.isEmpty, !id.isEmpty, (1...8).contains(parts.count),
      ["paused", "running", "unknown", "completed", "syncing", "sync_failed", "saved"].contains(
        status)
    else { throw NativeAIError.rejected }
    if ["saved", "completed", "syncing", "sync_failed"].contains(status) {
      guard parts.allSatisfy({ $0.kind == .completed && $0.output != nil }) else { throw NativeAIError.rejected }
    }
    if status == "saved" { guard let recordingId, !recordingId.isEmpty, recordingId.utf8.count <= 100 else { throw NativeAIError.rejected } }
    for part in parts {
      guard !part.text.isEmpty, part.text.count <= 500 else { throw NativeAIError.rejected }
      guard (part.kind == .completed) == (part.output != nil) else { throw NativeAIError.rejected }
      if let output = part.output { _ = try output.validated() }
    }
    return self
  }
  public var playbackID: String { recordingId ?? id }
  private var readyParts: [DeviceRecording.Part] {
    return parts.compactMap { part -> DeviceRecording.Part? in
      guard part.kind == .completed, let output = part.output else { return nil }
      return .init(text: part.text, audio: output.audio, seconds: output.seconds)
    }
  }
  public var usefulRecording: DeviceRecording? {
    let ready = readyParts
    return ready.isEmpty ? nil : DeviceRecording(mimeType: "audio/wav", parts: ready)
  }
  public var retainedJob: ProNarrationJob? {
    guard let recording = usefulRecording else { return nil }
    return ProNarrationJob(id: playbackID, state: status == "saved" ? "saved" : "retained", charged: 0, quote: 0,
      made: recording.parts.count, planned: parts.count,
      parts: recording.parts.map { .init(text: $0.text, audio: $0.audio, seconds: $0.seconds) },
      policy: status == "saved" ? "Saved device recording. Replay is free." : "Retained completed parts. Unfinished or unsynced work remains on this device.")
  }
  public var recording: DeviceRecording? {
    let ready = readyParts
    return ready.count == parts.count ? DeviceRecording(mimeType: "audio/wav", parts: ready) : nil
  }
}
@MainActor public struct NativeDeviceNarrationStore {
  private let directory: URL
  private let credentialGuard: NativeCredentialGuard
  public let owner: NativeArtifactOwner?
  private let legacyDirectory: URL?
  private var file: URL { directory.appending(path: "checkpoint.json") }
  public init(directory: URL, owner: NativeArtifactOwner? = nil, legacyDirectory: URL? = nil, credentialGuard: NativeCredentialGuard = .shared) {
    self.directory = directory
    self.owner = owner
    self.legacyDirectory = legacyDirectory
    self.credentialGuard = credentialGuard
  }
  public func save(_ value: DeviceNarrationCheckpoint, expected: String? = nil) throws {
    if !FileManager.default.fileExists(atPath: file.path), let legacyDirectory, FileManager.default.fileExists(atPath: legacyDirectory.appending(path: "checkpoint.json").path) { throw NativeAIError.rejected }
    if FileManager.default.fileExists(atPath: file.path) {
      let size = try FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber
      guard let size, size.intValue <= 63_000_000 else { throw NativeAIError.rejected }
      let existing = try JSONDecoder().decode(
        DeviceNarrationCheckpoint.self, from: Data(contentsOf: file))
      guard owner == nil || existing.owner == owner else { throw NativeAIError.rejected }
      guard existing.revision == expected else { throw NativeAIError.expired }
      try credentialGuard.restore(existing.fingerprints)
    } else if expected != nil {
      throw NativeAIError.expired
    }
    if !value.fingerprints.isEmpty { try credentialGuard.restore(value.fingerprints) }
    var checkpoint = try value.validated()
    if let owner {
      guard checkpoint.owner == nil || checkpoint.owner == owner, checkpoint.account == owner.account, checkpoint.document == owner.document else { throw NativeAIError.rejected }
      checkpoint.owner = owner
    }
    checkpoint.fingerprints = try credentialGuard.snapshot()
    let data = try JSONEncoder().encode(checkpoint)
    guard data.count <= 63_000_000 else { throw NativeAIError.rejected }
    try credentialGuard.check(data)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    var folder = directory
    var attributes = URLResourceValues()
    attributes.isExcludedFromBackup = true
    try folder.setResourceValues(attributes)
    #if os(iOS)
      try data.write(to: file, options: [.atomic, .completeFileProtection])
    #else
      try data.write(to: file, options: .atomic)
    #endif
  }
  public func load() throws -> DeviceNarrationCheckpoint? {
    // Only Session supplies a legacy directory under its authenticated origin/token root.
    // Account/document-only files in an arbitrary old cache are never adopted.
    if !FileManager.default.fileExists(atPath: file.path), let legacyDirectory,
      FileManager.default.fileExists(atPath: legacyDirectory.appending(path: "checkpoint.json").path) {
      guard let owner, var legacy = try NativeDeviceNarrationStore(directory: legacyDirectory, credentialGuard: credentialGuard).load(),
        legacy.owner == nil || legacy.owner == owner, legacy.account == owner.account, legacy.document == owner.document else { throw NativeAIError.rejected }
      legacy.owner = owner
      let replacement = NativeDeviceNarrationStore(directory: directory, owner: owner, credentialGuard: credentialGuard)
      try replacement.save(legacy)
      return try replacement.load()
    }
    guard FileManager.default.fileExists(atPath: file.path) else { return nil }
    let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
    guard let size = attributes[.size] as? NSNumber, size.intValue <= 63_000_000 else {
      throw NativeAIError.rejected
    }
    let data = try Data(contentsOf: file)
    var value = try JSONDecoder().decode(DeviceNarrationCheckpoint.self, from: data)
    guard owner == nil || value.owner == owner else { throw NativeAIError.rejected }
    try credentialGuard.restore(value.fingerprints)
    try credentialGuard.check(data)
    if ["saved", "completed", "syncing", "sync_failed"].contains(value.status),
      !value.parts.allSatisfy({ $0.kind == .completed && $0.output != nil }) || (value.status == "saved" && value.recordingId == nil) {
      value.parts = value.parts.map { part in var part = part; if part.kind == .started { part.kind = .unknown }; return part }
      value.status = value.parts.contains(where: { $0.kind == .unknown }) ? "unknown" : value.parts.allSatisfy({ $0.kind == .completed }) ? "sync_failed" : "paused"
    }
    return try value.validated()
  }
  public func clear() throws {
    if FileManager.default.fileExists(atPath: directory.path) {
      try FileManager.default.removeItem(at: directory)
    }
  }
}
@MainActor @Observable public final class NativeDeviceNarrationFlow {
  public private(set) var checkpoint: DeviceNarrationCheckpoint?
  public private(set) var notice: String?
  public private(set) var memoryOnly = false
  private let account: String, document: String
  private let runtime: NativeBYOK
  private let files: NativeDeviceNarrationStore
  public let available: Bool
  private let resumePoints: ResumePoints
  private let save: (String, DeviceRecording) async throws -> String
  private var quarantined = false
  private var busy = false
  public var keyAvailable: Bool { runtime.hasKey }
  public init(
    account: String, document: String, runtime: NativeBYOK, files: NativeDeviceNarrationStore,
    available: Bool = false, resumePoints: ResumePoints = ResumePoints(), save: @escaping (String, DeviceRecording) async throws -> String
  ) {
    self.account = account
    self.document = document
    self.runtime = runtime
    self.files = files
    self.available = available
    self.resumePoints = resumePoints
    self.save = save
    runtime.onSessionEnd { try files.clear() }
  }
  private func active() throws { guard runtime.sessionActive else { throw NativeAIError.expired } }
  private func persist(_ value: DeviceNarrationCheckpoint) throws {
    try active()
    guard value.account == account, value.document == document else { throw NativeAIError.rejected }
    var updated = value
    updated.owner = files.owner
    updated.revision = UUID().uuidString
    try files.save(updated, expected: checkpoint?.revision)
    checkpoint = updated
    memoryOnly = false
  }
  public func restore() throws {
    quarantined = true
    try active()
    guard var value = try files.load() else { quarantined = false; return }
    guard value.account == account, value.document == document else { throw NativeAIError.rejected }
    checkpoint = value
    value.parts = value.parts.map { part in
      var part = part
      if part.kind == .started { part.kind = .unknown }
      return part
    }
    if value.parts.contains(where: { $0.kind == .unknown }) {
      value.status = "unknown"
    } else if value.status == "running" {
      value.status = "paused"
    } else if value.status == "syncing" {
      value.status = "sync_failed"
    }
    try persist(value)
    quarantined = false
  }
  public func start(text: String) async throws {
    try active()
    guard !quarantined, checkpoint == nil, !busy else { return }
    try NativeCredentialGuard.shared.check(Data(text.utf8))
    let context = try narrationContext()
    guard
      let plan = context.objectForKeyedSubscript("nativeNarrationPlan")?.call(withArguments: [text]
      )?.toString(), context.exception == nil
    else { throw NativeAIError.rejected }
    let texts = try JSONDecoder().decode([String].self, from: Data(plan.utf8))
    try persist(
      .init(
        version: 1, account: account, document: document, id: UUID().uuidString, created: Date(),
        status: "paused", parts: texts.map { .init(kind: .pending, text: $0, output: nil) },
        fingerprints: Data()))
    try await resume()
  }
  public func resume() async throws {
    try active()
    guard !busy, !memoryOnly, available, runtime.hasKey, var value = checkpoint,
      value.created.timeIntervalSinceNow >= -1200,
      !value.parts.contains(where: { $0.kind == .started || $0.kind == .unknown }),
      value.recording == nil
    else { return }
    let reference = try runtime.credentialReference()
    busy = true
    notice = nil
    defer { busy = false }
    for index in value.parts.indices where value.parts[index].kind == .pending {
      try active()
      guard runtime.isCurrent(reference) else {
        notice = "Your key changed. Completed audio is retained. Resume explicitly to use the current key."
        break
      }
      value.parts[index].kind = .started
      value.status = "running"
      try persist(value)
      guard runtime.isCurrent(reference) else {
        value.parts[index].kind = .pending
        break
      }
      do {
        let output = try await runtime.narrate(text: value.parts[index].text, reference: reference)
        try complete(index: index, audio: output)
        if memoryOnly { return }
        guard let confirmed = checkpoint else { throw NativeAIError.expired }
        value = confirmed
      } catch {
        try active()
        value.parts[index].kind = .unknown
        value.status = "unknown"
        try persist(value)
        return
      }
      await Task.yield()
    }
    value.status = value.recording == nil ? "paused" : "completed"
    try persist(value)
  }
  private func complete(index: Int, audio: DeviceAudio) throws {
    try active()
    guard let prior = checkpoint, var latest = try files.load(), latest.account == account,
      latest.document == document, latest.id == prior.id, latest.parts.indices.contains(index),
      prior.parts.indices.contains(index), latest.parts[index].text == prior.parts[index].text,
      [.started, .unknown].contains(latest.parts[index].kind)
    else { throw NativeAIError.rejected }
    let validated = try audio.validated()
    checkpoint = latest
    latest.parts[index].output = validated
    latest.parts[index].kind = .completed
    latest.status = latest.recording == nil ? "paused" : "completed"
    do { try persist(latest) }
    catch {
      checkpoint = latest
      memoryOnly = true
      notice = "Confirmed audio retained in memory only. Reopen recovery is unconfirmed. Retry checkpointing before continuing."
    }
  }
  public func retryCheckpoint() throws {
    try active()
    guard memoryOnly, let checkpoint else { return }
    try persist(checkpoint)
    notice = nil
  }
  public func confirm(index: Int, audio: DeviceAudio) throws {
    try active()
    guard !busy, let value = checkpoint, value.parts.indices.contains(index),
      value.parts[index].kind == .unknown
    else { return }
    try complete(index: index, audio: audio)
  }
  public func sync() async {
    guard !busy, !memoryOnly, var value = checkpoint, value.status != "saved", let recording = value.recording
    else { return }
    busy = true
    defer { busy = false }
    do {
      try active()
      value.status = "syncing"
      try persist(value)
      let validated = try recording.validated()
      try NativeCredentialGuard.shared.check(JSONEncoder().encode(validated))
      try active()
      let recordingId = try await save(value.uploadKey ?? value.id, validated)
      guard !recordingId.isEmpty, recordingId.utf8.count <= 100 else { throw NativeAIError.rejected }
      let prefix = value.owner.map { "device.\($0.storageKey)." } ?? "device."
      resumePoints.migrate(from: prefix + value.id, to: prefix + recordingId)
      value.recordingId = recordingId
      try active()
      value.status = "saved"
      try persist(value)
    } catch {
      guard runtime.sessionActive else {
        checkpoint = nil
        return
      }
      if case DeviceNarrationError.uploadExpired = error { value.uploadKey = UUID().uuidString }
      value.status = "sync_failed"
      try? persist(value)
      notice = "Sync failed. Retry retained audio without regenerating."
    }
  }
}
