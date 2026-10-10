import Foundation
import Testing
@testable import LexidrawKit

@Test @MainActor func nativeImageQuoteDeclineAndUploadRetryDoNotRegenerate() async throws {
  let bytes = try Data(contentsOf: Bundle.module.url(forResource: "generated-image", withExtension: "png", subdirectory: "Fixtures")!)
  let artifact = try NativeImageArtifact(base64: bytes.base64EncodedString())
  var generations = 0, uploads = 0, fail = true
  let flow = NativeImageFlow(source: { .pro }, capability: { .init(available: true, maximum: 60_000_000, fixture: true, reason: "fixture") }, generatePro: { _, _, maximum in
    #expect(maximum == 60_000_000); generations += 1; return artifact
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
