import Foundation
import Observation
import CryptoKit
@MainActor func nativeAgentCall(_ function: String, _ arguments: [Any]) throws -> String {
 for value in arguments { if let text = value as? String { try NativeCredentialGuard.shared.check(Data(text.utf8)) } }
 let context = try narrationContext()
 guard let result = context.objectForKeyedSubscript(function)?.call(withArguments: arguments)?.toString(), context.exception == nil else { throw NativeAIError.rejected }
 try NativeCredentialGuard.shared.check(Data(result.utf8))
 return result
}
public struct NativeDeviceDocument: Codable, Sendable {
 public let revision: Int; public let text: String
 public init(revision: Int, text: String) { self.revision = revision; self.text = text }
}
public struct NativeDeviceReceipt: Codable, Sendable {
 public let revision: Int; public let description: String
 public init(revision: Int, description: String) { self.revision = revision; self.description = description }
}
public struct NativeDeviceMutation: Codable, Sendable {
 public struct Edit: Codable, Sendable { public let kind: String; public let text: String?; public let image: NativeImageArtifact? }
 public let accountId: String; public let documentId: String; public let idempotencyKey: String; public let revision: Int; public let edit: Edit
}
public struct NativeAgentCheckpoint: Decodable, Sendable {
 public let account: String, documentId: String, id: String, status: String, phase: String
 public let receipts: [NativeDeviceReceipt], plan: [String]
 public let pending: NativeDeviceMutation?
 public let imagePrompt: String?
 public let reason: String?
}
private struct AgentFile: Codable { let state: String; let fingerprints: Data; let revision: String; var owner: NativeArtifactOwner? = nil }
@MainActor @Observable public final class NativeDeviceAgentFlow {
 public private(set) var checkpoint: NativeAgentCheckpoint?
 public private(set) var notice: String?
 public let available: Bool
 private let images: Bool
 private let account: String
 private let document: String
 private let runtime: NativeBYOK
 private let directory: URL
 private let owner: NativeArtifactOwner?
 private let legacyDirectory: URL?
 private var quarantined = false
 private let read: () async throws -> NativeDeviceDocument
 private let apply: (NativeDeviceMutation) async throws -> NativeDeviceReceipt
 private var state: String?
 private var revision: String?
 private var busy = false
 private var stopped = false
 private var starting = false
 private var intent = UUID()
 public var keyAvailable: Bool { runtime.hasKey }
 public init(account: String, document: String, runtime: NativeBYOK, directory: URL, owner: NativeArtifactOwner? = nil, legacyDirectory: URL? = nil, available: Bool = false, images: Bool = false, read: @escaping () async throws -> NativeDeviceDocument, apply: @escaping (NativeDeviceMutation) async throws -> NativeDeviceReceipt) {
  self.owner = owner; self.legacyDirectory = legacyDirectory; self.account = account; self.document = document; self.runtime = runtime; self.directory = directory; self.available = available; self.images = images; self.read = read; self.apply = apply
  runtime.onSessionEnd { [weak self] in self?.checkpoint = nil; self?.state = nil; self?.stopped = true; if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) } }
 }
 private var file: URL { directory.appending(path: "agent.json") }
 private func active() throws { guard runtime.sessionActive else { throw NativeAIError.expired } }
 private func loadFile() throws -> AgentFile? {
  if !FileManager.default.fileExists(atPath: file.path), let legacyDirectory,
    FileManager.default.fileExists(atPath: legacyDirectory.appending(path: "agent.json").path) {
   guard let owner else { throw NativeAIError.rejected }
   let legacyFile = legacyDirectory.appending(path: "agent.json")
   guard let size = try FileManager.default.attributesOfItem(atPath: legacyFile.path)[.size] as? NSNumber, size.intValue <= 4_500_000 else { throw NativeAIError.rejected }
   var legacy = try JSONDecoder().decode(AgentFile.self, from: Data(contentsOf: legacyFile))
   guard legacy.owner == nil || legacy.owner == owner else { throw NativeAIError.rejected }
   try NativeCredentialGuard.shared.restore(legacy.fingerprints)
   try NativeCredentialGuard.shared.check(Data(legacy.state.utf8))
   let validated = try nativeAgentCall("nativeAgentRestore", [legacy.state])
   let cp = try JSONDecoder().decode(NativeAgentCheckpoint.self, from: Data(validated.utf8))
   guard cp.account == owner.account, cp.documentId == owner.document else { throw NativeAIError.rejected }
   legacy.owner = owner
   // The old file remains until the atomic, owner-validated replacement is readable.
   try writeFile(try JSONEncoder().encode(legacy))
  }
  guard FileManager.default.fileExists(atPath: file.path) else { return nil }
  guard let size = try FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber, size.intValue <= 4_500_000 else { throw NativeAIError.rejected }
  let value = try JSONDecoder().decode(AgentFile.self, from: Data(contentsOf: file)); guard owner == nil || value.owner == owner else { throw NativeAIError.rejected }; try NativeCredentialGuard.shared.restore(value.fingerprints); try NativeCredentialGuard.shared.check(Data(value.state.utf8)); return value
 }
 private func persist(_ value: String) throws {
  try active()
  guard try loadFile()?.revision == revision else { throw NativeAIError.expired }
  let cp = try JSONDecoder().decode(NativeAgentCheckpoint.self, from: Data(value.utf8))
  guard cp.account == account, cp.documentId == document else { throw NativeAIError.rejected }
  try NativeCredentialGuard.shared.check(Data(value.utf8))
  let nextRevision = UUID().uuidString
  let data = try JSONEncoder().encode(AgentFile(state: value, fingerprints: NativeCredentialGuard.shared.snapshot(), revision: nextRevision, owner: owner))
  guard data.count <= 4_500_000 else { throw NativeAIError.rejected }
  try NativeCredentialGuard.shared.check(data)
  try writeFile(data)
  state = value; revision = nextRevision; checkpoint = cp
 }
 private func writeFile(_ data: Data) throws {
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  var folder = directory; var attrs = URLResourceValues(); attrs.isExcludedFromBackup = true; try folder.setResourceValues(attrs)
  #if os(iOS)
  try data.write(to: file, options: [.atomic, .completeFileProtection])
  #else
  try data.write(to: file, options: .atomic)
  #endif
 }
 public func restore() throws {
  quarantined = true
  try active(); guard let value = try loadFile() else { quarantined = false; return }; revision = value.revision
  try persist(nativeAgentCall("nativeAgentRestore", [value.state]))
  quarantined = false
 }
 public func start(prompt: String) async throws {
  try active(); guard !quarantined, !busy, !starting, state == nil, available, runtime.hasKey else { return }
  try Task.checkCancellation()
  starting = true; stopped = false
  intent = UUID(); let run = intent
  defer { starting = false }
  try NativeCredentialGuard.shared.check(Data(prompt.utf8))
  let reference = try runtime.credentialReference()
  let source = try JSONEncoder().encode(await read()); try active()
  try Task.checkCancellation()
  guard intent == run, !stopped, state == nil, runtime.isCurrent(reference) else { return }
  try persist(nativeAgentCall("nativeAgentStart", [account, document, UUID().uuidString, Date().timeIntervalSince1970 * 1000, prompt, String(decoding: source, as: UTF8.self)]))
  try await resume()
 }
 private func update(_ value: String, status: String, reason: String? = nil, clearFence: Bool = false) throws -> String {
  var object = try JSONSerialization.jsonObject(with: Data(value.utf8)) as? [String: Any] ?? [:]
  object["status"] = status; if let reason { object["reason"] = reason }; if clearFence { object.removeValue(forKey: "fence") }
  return String(decoding: try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]), as: UTF8.self)
 }
 public func newAction() throws {
  try active(); guard !busy, let cp = checkpoint, ["complete", "blocked"].contains(cp.status), cp.pending == nil else { return }
  guard let state, let object = try JSONSerialization.jsonObject(with: Data(state.utf8)) as? [String: Any], object["fence"] == nil else { return }
  guard try loadFile()?.revision == revision else { throw NativeAIError.expired }
  if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
  self.state = nil; revision = nil; checkpoint = nil
 }
 public func resume() async throws {
  try active(); guard !busy, checkpoint != nil else { return }; busy = true; stopped = false; defer { busy = false }
  while let original = state, let cp = checkpoint, !stopped {
   try active(); if ["unknown", "complete", "blocked"].contains(cp.status) { return }
   if cp.phase == "mutation" {
    guard let pending = cp.pending else { throw NativeAIError.rejected }
    do {
     try NativeCredentialGuard.shared.check(JSONEncoder().encode(pending)); let receipt = try await apply(pending); try active()
     let data = try JSONEncoder().encode(receipt)
     try persist(nativeAgentCall("nativeAgentReceipt", [original, String(decoding: data, as: UTF8.self)]))
    } catch { try active(); try persist(update(original, status: "sync_failed", reason: "Edit not confirmed. Retry the retained edit for its receipt. Saved edits remain; concurrent changes stop the write.")); return }
    continue
   }
   guard available, runtime.hasKey else { try persist(update(original, status: "paused")); return }
   if cp.phase == "image", !images { try persist(update(original, status: "blocked", reason: "Images await verified provider access and a complete billable bound. No fallback was used.")); return }
   let reference = try runtime.credentialReference()
   let fenced = try nativeAgentCall("nativeAgentFence", [original, Date().timeIntervalSince1970 * 1000]); try persist(fenced)
   if checkpoint?.status == "blocked" { return }
   await Task.yield(); try active()
   guard !stopped, runtime.isCurrent(reference) else { try persist(update(original, status: "paused")); return }
   do {
    let next: String
    if cp.phase == "image" {
     let image = try await runtime.generateImage(prompt: cp.imagePrompt ?? "")
     next = try nativeAgentCall("nativeAgentImage", [fenced, String(decoding: JSONEncoder().encode(image), as: UTF8.self)])
    } else {
     let output = try await runtime.agent(state: fenced, reference: reference)
     next = try nativeAgentCall("nativeAgentOutput", [fenced, output])
    }
    try active(); try persist(next)
   } catch { try active(); try persist(nativeAgentCall("nativeAgentRestore", [fenced])); return }
  }
 }
 public func stop() { stopped = true; intent = UUID() }
}
extension Session {
 @MainActor public func deviceAgentFlow(document: String) async throws -> NativeDeviceAgentFlow {
  _ = try await deviceAgentSource(document: document)
  let runtime = try await nativeAI(), identity = try await accountIdentity()
  guard let root = aiHandle.narrationDirectory else { throw NativeAIError.unavailable }
  let scope = SHA256.hash(data: Data((identity.id + "\n" + document + "\nopenrouter-gpt41mini-agent-v1").utf8)).map { String(format: "%02x", $0) }.joined()
  let owner = try NativeArtifactOwner(origin: origin, account: identity.id, document: document, namespace: "agent-v2")
  let directory = root.appending(path: owner.storageKey)
  return NativeDeviceAgentFlow(account: identity.id, document: document, runtime: runtime, directory: directory, owner: owner, legacyDirectory: root.appending(path: scope), read: {
   try await self.deviceAgentSource(document: document)
  }, apply: { input in
   try await self.commitDeviceAgentEdit(input)
  })
 }
}
extension Session {
 @MainActor public func deviceAgentSource(document: String) async throws -> NativeDeviceDocument {
  struct Input: Encodable { let documentId: String }
  return try await narrationRPC("deviceAgent.source", method: .get, input: Input(documentId: document), as: NativeDeviceDocument.self)
 }
 @MainActor public func commitDeviceAgentEdit(_ input: NativeDeviceMutation) async throws -> NativeDeviceReceipt {
  try await narrationRPC("deviceAgent.commitEdit", method: .post, input: input, as: NativeDeviceReceipt.self)
 }
}
