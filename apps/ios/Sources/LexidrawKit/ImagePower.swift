import Foundation
import HTTPTypes
import OpenAPIRuntime
private struct ImageEnvelope<Value: Decodable>: Decodable {
  struct Result: Decodable { struct Body: Decodable { let json: Value }; let data: Body }; let result: Result
}
private struct ImagePayload<Value: Encodable>: Encodable { let json: Value }
public struct NativeImageOperation: Codable, Sendable {
  public let id: String
  public let state: String
  public let result: String?
  @MainActor public static func completed(_ image: NativeImageArtifact) throws -> Self {
    Self(id: UUID().uuidString, state: "settled", result: String(decoding: try JSONEncoder().encode(image), as: UTF8.self))
  }
  @MainActor public func artifact() throws -> NativeImageArtifact? {
    guard ["reserved", "running", "unknown", "settled", "refunded", "cancelled"].contains(state), !id.isEmpty, id.utf8.count <= 100 else { throw NativeImageError.invalid }
    guard state == "settled" else { return nil }
    guard let result else { throw NativeImageError.invalid }
    return try JSONDecoder().decode(NativeImageArtifact.self, from: Data(result.utf8)).validated()
  }
}
extension Session {
  public func imageCapability() async throws -> ImageCapability {
    try await imageRPC("imagePower.capability", input: Optional<String>.none, as: ImageCapability.self)
  }
  @MainActor public func generateProImage(prompt: String, id: String, acceptedMaximum: Int64) async throws -> NativeImageOperation {
    struct Input: Encodable { let idempotencyKey: String; let prompt: String; let acceptedMaximum: Int64 }
    let result = try await imageRPC("imagePower.generate", input: Input(idempotencyKey: id, prompt: prompt, acceptedMaximum: acceptedMaximum), as: NativeImageOperation.self)
    _ = try result.artifact()
    return result
  }
  @MainActor public func readProImage(key: String) async throws -> NativeImageOperation? {
    struct Input: Encodable { let idempotencyKey: String }
    let operation = try await imageRPC("imagePower.current", input: Input(idempotencyKey: key), as: Optional<NativeImageOperation>.self)
    _ = try operation?.artifact()
    return operation
  }
  @MainActor public func cancelProImage(_ id: String) async throws -> NativeImageOperation {
    struct Input: Encodable { let id: String }
    return try await imageRPC("imagePower.cancel", input: Input(id: id), as: NativeImageOperation.self)
  }
  @MainActor public func saveGeneratedImage(_ image: NativeImageArtifact, id: String, document: String) async throws -> URL {
    struct Input: Encodable { let idempotencyKey: String; let entityId: String; let image: NativeImageArtifact }
    struct Saved: Decodable { let id: String; let url: String }
    let result = try await imageRPC("imagePower.save", input: Input(idempotencyKey: id, entityId: document, image: image.validated()), as: Saved.self)
    guard let source = URL(string: result.url) else { throw NativeImageError.invalid }
    let url = try generatedImageURL(source)
    guard result.id == url.lastPathComponent else { throw NativeImageError.invalid }
    return url
  }
  private func generatedImageURL(_ source: URL) throws -> URL {
    guard let base = URLComponents(url: origin, resolvingAgainstBaseURL: false),
      base.scheme == "https", base.host != nil, base.user == nil, base.password == nil,
      base.query == nil, base.fragment == nil, ["", "/"].contains(base.path),
      let parts = URLComponents(url: source, resolvingAgainstBaseURL: false),
      parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
      parts.percentEncodedPath.range(of: #"^/api/generated-images/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"#, options: .regularExpression) != nil,
      (parts.scheme == nil && parts.host == nil) || (parts.scheme == base.scheme && parts.host == base.host && parts.port == base.port),
      let url = URL(string: source.absoluteString, relativeTo: origin)?.absoluteURL
    else { throw NativeImageError.invalid }
    return url
  }
  @MainActor public func savedGeneratedImage(_ source: URL) async throws -> Data {
    let url = try generatedImageURL(source)
    guard let token = try store.load() else { throw NativeImageError.invalid }
    var request = HTTPRequest(method: .get, scheme: nil, authority: nil, path: url.path)
    request.headerFields[.authorization] = "Bearer " + token
    request.headerFields[.cacheControl] = "no-store"
    let (response, body) = try await savedImageTransport.send(request, body: nil, baseURL: origin, operationID: "generatedImage.read")
    guard response.status.code == 200, response.headerFields[.contentType] == "image/png",
      let length = response.headerFields[.contentLength].flatMap(Int.init), length > 0, length <= 2 << 20,
      let body else { throw NativeImageError.invalid }
    let bytes = try await Data(collecting: body, upTo: 2 << 20)
    guard bytes.count == length else { throw NativeImageError.invalid }
    return try NativeImageArtifact(base64: bytes.base64EncodedString()).bytes
  }
  @MainActor public func imageFlow(document: String) async throws -> NativeImageFlow {
    _ = try await self.document(document)
    let byok = try await nativeAI()
    let identity = try await self.accountIdentity()
    let owner = try NativeArtifactOwner(origin: origin, account: identity.id, document: document, namespace: "images-v2")
    guard let root = aiHandle.narrationDirectory else { throw NativeAIError.unavailable }
    let directory = root.appending(path: owner.storageKey)
    let files = NativeImageFileStore(directory: directory, owner: owner)
    let flow = NativeImageFlow(source: { try await self.powerPreference() }, capability: { try await self.imageCapability() },
      generatePro: { prompt, id, maximum in try await self.generateProImage(prompt: prompt, id: id, acceptedMaximum: maximum) },
      generateBYOK: { prompt in try await byok.generateImage(prompt: prompt) },
      save: { id, image in try await self.saveGeneratedImage(image, id: id, document: document) }, files: files, readPro: { key in try await self.readProImage(key: key) }, cancelPro: { id in try await self.cancelProImage(id) }, document: document, ownerCurrent: { (try? self.aiHandle.existing()) != nil })
    byok.onSessionEnd { flow.end(); try files.clear(); try files.clearPending() }
    return flow
  }
  private func imageRPC<Input: Encodable, Value: Decodable>(_ procedure: String, input: Input?, as: Value.Type) async throws -> Value {
    let data = try input.map { try JSONEncoder().encode(ImagePayload(json: $0)) }
    if let data { try NativeCredentialGuard.shared.check(data) }
    let ownedRead = procedure == "imagePower.current"
    var components = URLComponents(); components.path = "/" + procedure
    if ownedRead, let data { components.queryItems = [URLQueryItem(name: "input", value: String(decoding: data, as: UTF8.self))] }
    let request = HTTPRequest(method: input == nil || ownedRead ? .get : .post, scheme: nil, authority: nil, path: components.string)
    let (response, body) = try await connection.exchange(request, json: ownedRead ? nil : data, operationID: procedure, baseURL: origin.appending(path: "api/trpc"))
    guard let body else { throw NativeImageError.unavailable }
    let result = try await Data(collecting: body, upTo: 3 << 20)
    if !(200..<300).contains(response.status.code) {
      if let text = String(data: result, encoding: .utf8), text.contains("Upload expired. Retry the retained image.") { throw NativeImageError.uploadExpired }
      throw NativeImageError.unavailable
    }
    try NativeCredentialGuard.shared.check(result)
    return try JSONDecoder().decode(ImageEnvelope<Value>.self, from: result).result.data.json
  }
}
