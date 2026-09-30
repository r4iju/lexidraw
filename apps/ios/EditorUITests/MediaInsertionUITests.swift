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
    let photos = app.buttons["Choose from Photos…"]
    XCTAssertTrue(photos.waitForExistence(timeout: 3))
    photos.tap()
    let firstPhoto = app.images.matching(identifier: "PXGGridLayout-Info").firstMatch
    XCTAssertTrue(firstPhoto.waitForExistence(timeout: 10), "Seed a disposable picture in this simulator before running the photo-selection gate")
    firstPhoto.tap()
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
}
