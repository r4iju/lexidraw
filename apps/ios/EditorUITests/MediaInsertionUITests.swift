import EditorModelInterface
import Foundation
import XCTest

@MainActor final class MediaInsertionUITests: XCTestCase {
  func testPhotosSelectionInsertsOnlyUploadedImage() throws {
    continueAfterFailure = false
    let app = XCUIApplication()
    let saved = FileManager.default.temporaryDirectory.appending(path: "media-picked-\(UUID()).json")
    app.launchEnvironment["EDITOR_DOCUMENT"] = "{\"root\":{\"type\":\"root\",\"version\":1,\"children\":[{\"type\":\"paragraph\",\"version\":1,\"children\":[],\"format\":\"\",\"indent\":0,\"direction\":null,\"textFormat\":0,\"textStyle\":\"\"}],\"format\":\"\",\"indent\":0,\"direction\":null}}"
    app.launchEnvironment["EDITOR_IMAGE_UPLOAD_RETURN"] = "https://example.com/disposable-picked.jpg"
    app.launchEnvironment["EDITOR_SAVE_PATH"] = saved.path
    app.launch()
    let editor = app.textViews["editor"]
    XCTAssertTrue(editor.waitForExistence(timeout: 10))
    editor.tap()
    app.buttons["Insert"].tap()
    app.buttons["Image"].tap()
    let photos = app.buttons["Choose from Photos…"]
    XCTAssertTrue(photos.waitForExistence(timeout: 3))
    photos.tap()
    selectFirstAsset(in: app, kind: "Photo")
    let add = app.buttons["Add"]
    if add.waitForExistence(timeout: 2) { add.tap() }
    XCTAssertTrue(editor.waitForExistence(timeout: 10))
    app.buttons["Save"].tap()
    let deadline = Date().addingTimeInterval(5)
    while !FileManager.default.fileExists(atPath: saved.path), Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.1)) }
    let state = try JSONValue(parsing: String(contentsOf: saved, encoding: .utf8))
    var pending = [state["root"]!]
    var image: JSONValue?
    while let node = pending.popLast() {
      if node["type"] == "image" { image = node; break }
      pending += node["children"]?.arrayValue ?? []
    }
    XCTAssertEqual(image?["src"], "https://example.com/disposable-picked.jpg")
    XCTAssertNotNil(image?["caption"]?["editorState"]?["root"])
  }
  func testInlineImageSelectionPreservesOptions() throws {
    continueAfterFailure = false
    let app = XCUIApplication()
    let saved = FileManager.default.temporaryDirectory.appending(path: "media-picked-\(UUID()).json")
    app.launchEnvironment["EDITOR_DOCUMENT"] = "{\"root\":{\"type\":\"root\",\"version\":1,\"children\":[{\"type\":\"paragraph\",\"version\":1,\"children\":[],\"format\":\"\",\"indent\":0,\"direction\":null,\"textFormat\":0,\"textStyle\":\"\"}],\"format\":\"\",\"indent\":0,\"direction\":null}}"
    app.launchEnvironment["EDITOR_IMAGE_UPLOAD_RETURN"] = "https://example.com/disposable-picked.jpg"
    app.launchEnvironment["EDITOR_SAVE_PATH"] = saved.path
    app.launch()
    let editor = app.textViews["editor"]
    XCTAssertTrue(editor.waitForExistence(timeout: 10))
    editor.tap()
    app.buttons["Insert"].tap()
    let photos = app.buttons["Inline image from Photos…"]
    XCTAssertTrue(photos.waitForExistence(timeout: 3))
    photos.tap()
    selectFirstAsset(in: app, kind: "Photo")
    let add = app.buttons["Add"]
    if add.waitForExistence(timeout: 2) { add.tap() }
    XCTAssertTrue(editor.waitForExistence(timeout: 10))
    let alternative = app.textFields["Alternative text"]
    XCTAssertTrue(alternative.waitForExistence(timeout: 10))
    alternative.tap()
    alternative.typeText("Blue square")
    app.buttons["Right"].tap()
    app.switches["Show caption"].tap()
    app.buttons["Insert image"].tap()
    app.buttons["Save"].tap()
    let deadline = Date().addingTimeInterval(5)
    while !FileManager.default.fileExists(atPath: saved.path), Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.1)) }
    let state = try JSONValue(parsing: String(contentsOf: saved, encoding: .utf8))
    var pending = [state["root"]!]
    var image: JSONValue?
    while let node = pending.popLast() {
      if node["type"] == "inline-image" { image = node; break }
      pending += node["children"]?.arrayValue ?? []
    }
    XCTAssertEqual(image?["src"], "https://example.com/disposable-picked.jpg")
    XCTAssertEqual(image?["altText"], "Blue square")
    XCTAssertEqual(image?["position"], "right")
    XCTAssertEqual(image?["showCaption"], true)
    XCTAssertNotNil(image?["caption"]?["editorState"]?["root"])
  }
  func testVideoSelectionInsertsOnlyUploadedVideo() throws {
    continueAfterFailure = false
    let app = XCUIApplication()
    let saved = FileManager.default.temporaryDirectory.appending(path: "video-picked-\(UUID()).json")
    app.launchEnvironment["EDITOR_DOCUMENT"] = "{\"root\":{\"type\":\"root\",\"version\":1,\"children\":[{\"type\":\"paragraph\",\"version\":1,\"children\":[],\"format\":\"\",\"indent\":0,\"direction\":null}],\"format\":\"\",\"indent\":0,\"direction\":null}}"
    app.launchEnvironment["EDITOR_IMAGE_UPLOAD_RETURN"] = "https://example.com/disposable-picked.mp4"
    app.launchEnvironment["EDITOR_SAVE_PATH"] = saved.path
    app.launch()
    let editor = app.textViews["editor"]
    XCTAssertTrue(editor.waitForExistence(timeout: 10))
    editor.tap()
    app.buttons["Insert"].tap()
    let video = app.buttons["Video from Photos…"]
    XCTAssertTrue(video.waitForExistence(timeout: 3))
    video.tap()
    selectFirstAsset(in: app, kind: "Video")
    let add = app.buttons["Add"]
    if add.waitForExistence(timeout: 2) { add.tap() }
    XCTAssertTrue(editor.waitForExistence(timeout: 20))
    let uploading = app.alerts["Uploading video"]
    let deadline = Date().addingTimeInterval(20)
    while uploading.exists, Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.1)) }
    app.buttons["Save"].tap()
    let saveDeadline = Date().addingTimeInterval(5)
    while !FileManager.default.fileExists(atPath: saved.path), Date() < saveDeadline { RunLoop.current.run(until: Date().addingTimeInterval(0.1)) }
    let state = try JSONValue(parsing: String(contentsOf: saved, encoding: .utf8))
    var pending = [state["root"]!]
    var inserted: JSONValue?
    while let node = pending.popLast() {
      if node["type"] == "video" { inserted = node; break }
      pending += node["children"]?.arrayValue ?? []
    }
    XCTAssertEqual(inserted?["src"], "https://example.com/disposable-picked.mp4")
  }

  private func selectFirstAsset(in app: XCUIApplication, kind: String) {
    let photos = app.scrollViews["photosView_content_scroll_view"]
    XCTAssertTrue(photos.waitForExistence(timeout: 10), "The system Photos picker must be presented")
    let asset = photos.images.matching(NSPredicate(
      format: "identifier == %@ AND label BEGINSWITH %@", "PXGGridLayout-Info", "\(kind),"
    )).firstMatch
    XCTAssertTrue(asset.waitForExistence(timeout: 10), "Import the disposable \(kind) fixture before running this gate")
    if asset.isHittable {
      asset.tap()
    } else {
      // The iOS 26 picker can expose thumbnail information as noninteractive image nodes.
      // Tap its measured center through the actual, hittable Photos scroll view.
      XCTAssertTrue(photos.isHittable)
      let frame = asset.frame
      XCTAssertGreaterThan(frame.width, 0)
      XCTAssertGreaterThan(frame.height, 0)
      XCTAssertTrue(photos.frame.contains(frame))
      photos.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(
        dx: frame.midX - photos.frame.minX, dy: frame.midY - photos.frame.minY
      )).tap()
    }
  }

}
