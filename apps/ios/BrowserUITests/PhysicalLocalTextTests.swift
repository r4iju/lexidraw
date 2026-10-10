import Foundation
import LexidrawKit
import XCTest

@MainActor final class PhysicalLocalTextTests: XCTestCase {
  func testActualLocalModelAvailabilityLanguagesAndContinuation() async throws {
    guard ProcessInfo.processInfo.environment["LEXIDRAW_PHYSICAL_LOCAL_CHECK"] == "1" else {
      throw XCTSkip("Explicit physical local-compute check only")
    }
    let runtime = NativeLocalText()
    print(
      "PHYSICAL_LOCAL en_US=\(runtime.availability(locale: Locale(identifier: "en_US"))) ja_JP=\(runtime.availability(locale: Locale(identifier: "ja_JP"))) eo=\(runtime.availability(locale: Locale(identifier: "eo")))"
    )
    XCTAssertEqual(runtime.availability(locale: Locale(identifier: "eo")), .unsupportedLanguage)
    XCTAssertEqual(runtime.availability(action: "image"), .unsupportedAction)
    guard runtime.availability(locale: Locale(identifier: "en_US")) == .available else {
      throw XCTSkip(runtime.availability(locale: Locale(identifier: "en_US")).message)
    }
    let output = try await runtime.suggest(
      title: "", before: "The capital of France is ", after: "", locale: Locale(identifier: "en_US")
    )
    print("PHYSICAL_LOCAL output=\(output)")
    XCTAssertTrue(output.localizedCaseInsensitiveContains("Paris"))
    runtime.cancel()
  }
  func testActualJapaneseLocalContinuation() async throws {
    guard ProcessInfo.processInfo.environment["LEXIDRAW_PHYSICAL_LOCAL_CHECK"] == "1" else {
      throw XCTSkip("Explicit physical local compute only")
    }
    let runtime = NativeLocalText()
    let locale = Locale(identifier: "ja_JP")
    guard runtime.availability(locale: locale) == .available else {
      throw XCTSkip(runtime.availability(locale: locale).message)
    }
    let output = try await runtime.suggest(title: "", before: "日本の首都は", after: "", locale: locale)
    print("PHYSICAL_LOCAL_JAPANESE output=\(output)")
    XCTAssertFalse(output.isEmpty)
    XCTAssertTrue(
      output.contains("東京"),
      "The real Japanese continuation should answer this bounded factual prompt")
    runtime.cancel()
  }

}
