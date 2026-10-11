import Foundation
import LexidrawJSON
import Testing
@testable import LexidrawKit

@Test @MainActor func nativeImageQuoteDeclineAndUploadRetryDoNotRegenerate() async throws {
  let bytes = try Data(contentsOf: Bundle.module.url(forResource: "generated-image", withExtension: "png", subdirectory: "Fixtures")!)
  let artifact = try NativeImageArtifact(base64: bytes.base64EncodedString())
  var generations = 0, uploads = 0, fail = true
  let flow = NativeImageFlow(source: { .pro }, capability: { .init(available: true, maximum: 60_000_000, fixture: true, reason: "fixture") }, generatePro: { _, _, maximum in
    #expect(maximum == 60_000_000); generations += 1; return try .completed(artifact)
  }, generateBYOK: { _ in throw NativeImageError.unavailable }, save: { _, _ in
    uploads += 1; if fail { throw NativeImageError.syncFailed }; return URL(string: "https://storage.test/image.png")!
  })
  await flow.generate("tree")
  #expect(generations == 0)
  flow.decline()
  #expect(generations == 0)
  await flow.generate("tree"); await flow.accept()
  #expect(generations == 1)
  #expect(await flow.upload() == nil)
  fail = false
  #expect(await flow.upload()?.absoluteString == "https://storage.test/image.png")
  #expect(generations == 1); #expect(uploads == 2)
}

@Test @MainActor func encodedEnvelopeIsRejectedBeforeNativeImageRetention() throws {
  let file = try #require(Bundle.module.url(forResource: "invalid-envelope-image", withExtension: "bin", subdirectory: "Fixtures"))
  let bytes = try Data(contentsOf: file)
  #expect(throws: Error.self) { try NativeImageArtifact(base64: bytes.base64EncodedString()) }
}

@Test @MainActor func imageAdmissionClaimsIntentBeforeAsynchronousSourceRead() async throws {
  let bytes = try Data(contentsOf: #require(Bundle.module.url(forResource: "generated-image", withExtension: "png", subdirectory: "Fixtures")))
  let image = try NativeImageArtifact(base64: bytes.base64EncodedString())
  var waits: [CheckedContinuation<AIPowerPreference, Never>] = []
  var dispatches = 0
  let flow = NativeImageFlow(source: { await withCheckedContinuation { waits.append($0) } }, capability: { .init(available: true, maximum: 1, fixture: true, reason: "Fixture") }, generatePro: { _, _, _ in try .completed(image) }, generateBYOK: { _ in dispatches += 1; return image }, save: { _, _ in URL(string: "https://app.test/image")! })
  let first = Task { await flow.generate("First image") }
  while waits.isEmpty { await Task.yield() }
  let second = Task { await flow.generate("Second image") }
  await Task.yield()
  for wait in waits { wait.resume(returning: .byok) }
  await first.value; await second.value
  #expect(dispatches == 1)
}

@Test @MainActor func reopeningNativeImageAfterLostUploadResponseKeepsUploadIdentity() async throws {
  let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  let artifact = try NativeImageArtifact(base64: Data(contentsOf: #require(Bundle.module.url(forResource: "generated-image", withExtension: "png", subdirectory: "Fixtures"))).base64EncodedString())
  let files = NativeImageFileStore(directory: directory)
  var identities: [String] = []
  var generations = 0
  func reopen() -> NativeImageFlow {
    NativeImageFlow(source: { .byok }, capability: { .init(available: true, maximum: 1, fixture: true, reason: "Fixture") }, generatePro: { _, _, _ in throw NativeImageError.unavailable }, generateBYOK: { _ in generations += 1; return artifact }, save: { id, _ in identities.append(id); throw URLError(.networkConnectionLost) }, files: files)
  }
  var flow: NativeImageFlow? = reopen()
  await flow?.generate("Saved image")
  _ = await flow?.upload()
  flow = nil
  flow = reopen()
  _ = await flow?.upload()
  #expect(identities.count == 2)
  #expect(identities.first == identities.last)
  #expect(generations == 1)
}

@Test @MainActor func endedImageLifetimeCannotPublishALateUploadReceipt() async throws {
  let artifact = try NativeImageArtifact(base64: Data(contentsOf: #require(Bundle.module.url(forResource: "generated-image", withExtension: "png", subdirectory: "Fixtures"))).base64EncodedString())
  var reply: CheckedContinuation<URL, Never>?
  let flow = NativeImageFlow(source: { .byok }, capability: { .init(available: true, maximum: 1, fixture: true, reason: "Fixture") }, generatePro: { _, _, _ in try .completed(artifact) }, generateBYOK: { _ in artifact }, save: { _, _ in await withCheckedContinuation { reply = $0 } })
  await flow.generate("Synthetic image")
  let upload = Task { await flow.upload() }
  while reply == nil { await Task.yield() }
  flow.end()
  reply?.resume(returning: URL(string: "https://app.test/api/generated-images/synthetic")!)
  let result = await upload.value
  #expect(result == nil)
  #expect(flow.checkpoint?.receipt == nil)
}

@Test @MainActor func imageClearsOnlyAfterActualDocumentSaveContainsItsReceipt() async throws {
  let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  let files = NativeImageFileStore(directory: directory)
  let image = try NativeImageArtifact(base64: Data(contentsOf: #require(Bundle.module.url(forResource: "generated-image", withExtension: "png", subdirectory: "Fixtures"))).base64EncodedString())
  let url = URL(string: "https://app.test/api/generated-images/00000000-0000-4000-8000-000000000001")!
  let stored = try JSONValue(parsing: "{\"root\":{\"children\":[{\"type\":\"image\",\"src\":\"" + url.absoluteString + "\"}]}}")
  let server = FakeServer { _ in (200, #"{"id":"n1","updatedAt":"2026-09-25T09:31:00.456Z"}"#) }
  let saver = DocumentSaver(session: try TestServer.session(server), document: "n1", readAt: .now, pause: { try await Task.sleep(for: .seconds(60)) })
  var uploads = 0
  let flow = NativeImageFlow(source: { .byok }, capability: { .init(available: true, maximum: 1, fixture: true, reason: "Fixture") }, generatePro: { _, _, _ in try .completed(image) }, generateBYOK: { _ in image }, save: { _, _ in uploads += 1; return url }, files: files)
  await flow.generate("Synthetic image")
  _ = await flow.upload(confirm: { _, _ in
    await saver.changed { .object(["root": .object(["children": .array([])])]) }
    return await saver.saveNow()
  })
  #expect(try files.loadCheckpoint() != nil)
  _ = await flow.upload(confirm: { _, _ in
    await saver.changed { stored }
    return await saver.saveNow()
  })
  #expect(try files.loadCheckpoint() == nil)
  #expect(uploads == 1)
  #expect(server.requests.last?.json["elements"] == stored.stringified)
}

@Test @MainActor func lostNativeGenerationResponseSurvivesReopeningWithoutNewPaidWork() async throws {
  let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  let files = NativeImageFileStore(directory: directory)
  var keys: [String] = []
  func reopen() -> NativeImageFlow {
    NativeImageFlow(source: { .pro }, capability: { .init(available: true, maximum: 1, fixture: true, reason: "Fixture") }, generatePro: { _, key, _ in keys.append(key); throw URLError(.networkConnectionLost) }, generateBYOK: { _ in throw NativeImageError.unavailable }, save: { _, _ in throw NativeImageError.unavailable }, files: files)
  }
  var flow: NativeImageFlow? = reopen()
  await flow?.generate("First paid image")
  await flow?.accept()
  flow = nil
  flow = reopen()
  await flow?.generate("Second paid image")
  await flow?.accept()
  #expect(keys.count == 1)
}

@Test @MainActor func staleDocumentAcknowledgmentCannotClearANewerRetainedImage() async throws {
  let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  let files = NativeImageFileStore(directory: directory)
  let image = try NativeImageArtifact(base64: Data(contentsOf: #require(Bundle.module.url(forResource: "generated-image", withExtension: "png", subdirectory: "Fixtures"))).base64EncodedString())
  let url = URL(string: "https://app.test/api/generated-images/00000000-0000-4000-8000-000000000001")!
  let snapshot = try JSONValue(parsing: "{\"root\":{\"children\":[{\"type\":\"image\",\"src\":\"" + url.absoluteString + "\"}]}}")
  let server = FakeServer { _ in (200, #"{"id":"n1","updatedAt":"2026-09-25T09:31:00.456Z"}"#) }
  let saver = DocumentSaver(session: try TestServer.session(server), document: "n1", readAt: .now, pause: { try await Task.sleep(for: .seconds(60)) })
  func reopen() -> NativeImageFlow {
    NativeImageFlow(source: { .byok }, capability: { .init(available: true, maximum: 1, fixture: true, reason: "Fixture") }, generatePro: { _, _, _ in try .completed(image) }, generateBYOK: { _ in image }, save: { _, _ in url }, files: files, document: "n1")
  }
  let old = reopen()
  await old.generate("Image A"); _ = await old.upload()
  var release: CheckedContinuation<Void, Never>?
  let delayed = Task { await old.upload(confirm: { _, _ in
    await saver.changed { snapshot }
    let receipt = await saver.saveNow()
    await withCheckedContinuation { release = $0 }
    return receipt
  }) }
  while release == nil { await Task.yield() }
  let newer = reopen()
  _ = await newer.upload(confirm: { _, _ in await saver.saveNow() })
  await newer.generate("Image B")
  release?.resume()
  _ = await delayed.value
  #expect(try files.loadCheckpoint()?.prompt == "Image B")
}

@Test @MainActor func nativeImageAdmissionRetainsRunningOperationInsteadOfAnonymousFailure() async throws {
  let server = FakeServer { _ in (200, #"{"result":{"data":{"json":{"id":"operation-a","state":"running","result":null}}}}"#) }
  let session = try TestServer.session(server)
  let outcome = try await session.generateProImage(prompt: "Synthetic image", id: UUID().uuidString, acceptedMaximum: 1)
  let data = try JSONEncoder().encode(outcome)
  let encoded = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
  #expect(encoded["id"] as? String == "operation-a")
  #expect(encoded["state"] as? String == "running")
}
