import CryptoKit
import Foundation
import HTTPTypes

public enum DeviceNarrationError: Error { case uploadExpired }
public struct SavedDeviceRecording: Decodable, Sendable {
  public let id: String
  public let recording: DeviceRecording
}
extension Session {
  @MainActor public func deviceNarrationSource(document: String) async throws -> String {
    struct Input: Encodable { let documentId: String }
    return try await narrationRPC(
      "deviceNarration.source", method: .get, input: Input(documentId: document), as: String.self)
  }
  @MainActor public func saveDeviceNarration(
    _ recording: DeviceRecording, id: String, document: String
  ) async throws -> String {
    struct Input: Encodable {
      let documentId: String
      let idempotencyKey: String
      let recording: DeviceRecording
    }
    struct Identity: Decodable { let id: String }
    return try await narrationRPC(
      "deviceNarration.save", method: .post,
      input: Input(documentId: document, idempotencyKey: id, recording: recording.validated()),
      as: Identity.self
    ).id
  }
  @MainActor public func savedDeviceNarration(document: String) async throws
    -> SavedDeviceRecording?
  {
    struct Input: Encodable { let documentId: String }
    let result = try await narrationRPC(
      "deviceNarration.saved", method: .get, input: Input(documentId: document),
      as: Optional<SavedDeviceRecording>.self)
    if let result { _ = try result.recording.validated() }
    return result
  }
  public func deviceNarrationPlaybackScope(document: String) async throws -> String {
    let identity = try await accountIdentity()
    return try NativeArtifactOwner(origin: origin, account: identity.id, document: document, namespace: "narration-v2").storageKey
  }
  @MainActor public func deviceNarrationFlow(document: String) async throws
    -> NativeDeviceNarrationFlow
  {
    _ = try await deviceNarrationSource(document: document)
    let runtime = try await nativeAI()
    let identity = try await accountIdentity()
    guard let root = aiHandle.narrationDirectory else { throw NativeAIError.unavailable }
    let scope = SHA256.hash(data: Data((identity.id + "\n" + document).utf8)).map {
      String(format: "%02x", $0)
    }.joined()
    let owner = try NativeArtifactOwner(origin: origin, account: identity.id, document: document, namespace: "narration-v2")
    let directory = root.appending(path: owner.storageKey)
    return NativeDeviceNarrationFlow(
      account: identity.id, document: document, runtime: runtime,
      files: NativeDeviceNarrationStore(directory: directory, owner: owner, legacyDirectory: root.appending(path: scope)),
      save: { id, recording in
        try await self.saveDeviceNarration(recording, id: id, document: document)
      })
  }
}
