import Foundation
import HTTPTypes
import OpenAPIRuntime
private struct ImageEnvelope<Value: Decodable>: Decodable {
  struct Result: Decodable { struct Body: Decodable { let json: Value }; let data: Body }; let result: Result
}
private struct ImagePayload<Value: Encodable>: Encodable { let json: Value }
extension Session {
  public func imageCapability() async throws -> ImageCapability {
    try await imageRPC("imagePower.capability", input: Optional<String>.none, as: ImageCapability.self)
  }
  @MainActor public func generateProImage(prompt: String, id: String, acceptedMaximum: Int64) async throws -> NativeImageArtifact {
    struct Input: Encodable { let idempotencyKey: String; let prompt: String; let acceptedMaximum: Int64 }
    struct Operation: Decodable { let id: String; let state: String; let result: String? }
    let result = try await imageRPC("imagePower.generate", input: Input(idempotencyKey: id, prompt: prompt, acceptedMaximum: acceptedMaximum), as: Operation.self)
    guard result.state == "settled", let json = result.result else { throw NativeImageError.reconciling }
    return try JSONDecoder().decode(NativeImageArtifact.self, from: Data(json.utf8)).validated()
  }
  @MainActor public func saveGeneratedImage(_ image: NativeImageArtifact, id: String, document: String) async throws -> URL {
    struct Input: Encodable { let idempotencyKey: String; let entityId: String; let image: NativeImageArtifact }
    struct Saved: Decodable { let id: String; let url: String }
    let result = try await imageRPC("imagePower.save", input: Input(idempotencyKey: id, entityId: document, image: image.validated()), as: Saved.self)
    guard let url = URL(string: result.url), url.scheme == "https" else { throw NativeImageError.invalid }
    return url
  }
  @MainActor public func imageFlow(document: String) async throws -> NativeImageFlow {
    let byok = try await nativeAI()
    let identity = try await self.identity()
    let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appending(path: "completed-images").appending(path: identity.id).appending(path: document)
    return NativeImageFlow(source: { try await self.powerPreference() }, capability: { try await self.imageCapability() },
      generatePro: { prompt, id, maximum in try await self.generateProImage(prompt: prompt, id: id, acceptedMaximum: maximum) },
      generateBYOK: { prompt in try await byok.generateImage(prompt: prompt) },
      save: { id, image in try await self.saveGeneratedImage(image, id: id, document: document) }, files: NativeImageFileStore(directory: directory))
  }
  private func imageRPC<Input: Encodable, Value: Decodable>(_ procedure: String, input: Input?, as: Value.Type) async throws -> Value {
    let data = try input.map { try JSONEncoder().encode(ImagePayload(json: $0)) }
    if let data { try NativeCredentialGuard.shared.check(data) }
    let request = HTTPRequest(method: input == nil ? .get : .post, scheme: nil, authority: nil, path: "/" + procedure)
    let (response, body) = try await connection.exchange(request, json: data, operationID: procedure, baseURL: origin.appending(path: "api/trpc"))
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
