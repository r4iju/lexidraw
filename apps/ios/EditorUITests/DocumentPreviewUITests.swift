import EditorModelInterface
import LexicalFuzz
import XCTest

/// The app's document screen in the harness, on a document its server
/// serves with the access each test gives.
@MainActor
final class DocumentPreviewUITests: XCTestCase {
  func testStandalonePortraitInlineImageFitsTheReadingColumn() throws {
    XCUIDevice.shared.orientation = .portrait
    let source = UIGraphicsImageRenderer(size: CGSize(width: 1055, height: 1491)).image { context in
      UIColor.blue.setFill()
      context.fill(CGRect(x: 0, y: 0, width: 1055, height: 1491))
    }
    let image: JSONValue = ["type": "inline-image", "version": 1,
      "src": .string("data:image/png;base64," + source.pngData()!.base64EncodedString()),
      "width": 0, "height": 0, "altText": "Portrait image", "showCaption": false]
    let app = XCUIApplication()
    app.launchEnvironment["EDITOR_PREVIEW_ACCESS"] = "READ"
    app.launchEnvironment["EDITOR_DOCUMENT"] = LexicalJSON.document([LexicalJSON.paragraph([image])]).stringified
    app.launch()
    let picture = app.buttons["Portrait image"]
    XCTAssertTrue(picture.waitForExistence(timeout: 10))
    XCTAssertGreaterThan(picture.frame.height, 100)
    XCTAssertLessThanOrEqual(picture.frame.width, app.textViews.firstMatch.frame.width)
    XCTAssertLessThanOrEqual(picture.frame.height, app.windows.firstMatch.frame.height * 0.7)
  }

  override func setUp() {
    continueAfterFailure = false
  }

  func testSmallSavedImageCaptionRemainsReadableAtLargestText() throws {
    XCUIDevice.shared.orientation = .portrait
    let photo = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
      .appending(path: "../Tests/DrawingKitTests/Fixtures/Drawings/images/files/photo.png")
    let image: JSONValue = ["type": "image", "version": 1,
      "src": .string("data:image/png;base64," + (try Data(contentsOf: photo)).base64EncodedString()),
      "width": 240, "height": 180, "altText": "Disposable media fixture photograph",
      "$": ["figure": ["caption": "Saved image caption"]]]
    let app = XCUIApplication()
    app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
    app.launchEnvironment["EDITOR_PREVIEW_ACCESS"] = "READ"
    app.launchEnvironment["EDITOR_DOCUMENT"] = LexicalJSON.document([
      LexicalJSON.paragraph([image]), LexicalJSON.paragraph([LexicalJSON.text("After the media")]),
    ]).stringified
    app.launch()
    let caption = app.staticTexts["Saved image caption"]
    XCTAssertTrue(caption.waitForExistence(timeout: 10))
    XCTAssertGreaterThanOrEqual(caption.frame.width, min(200, app.textViews.firstMatch.frame.width / 2),
      "A small image must not squeeze enlarged caption words into individual letters")
    XCTAssertLessThan(caption.frame.height, 180, "The short caption must leave the following document reachable")
    XCTAssertFalse(app.buttons["Edit"].exists)
    XCTAssertFalse(app.keyboards.firstMatch.exists)
  }

  func testLongReadingIdentityLeavesContentReachableAtLargestTextInLandscape() {
    XCUIDevice.shared.orientation = .landscapeLeft
    defer { XCUIDevice.shared.orientation = .portrait }
    let app = XCUIApplication()
    app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
    app.launchEnvironment["EDITOR_PREVIEW_ACCESS"] = "EDIT"
    app.launchEnvironment["EDITOR_PREVIEW_TITLE"] = "A thoughtful document with a wonderfully long title for our next adventure together, preserving everything that matters"
    app.launch()
    let editor = app.textViews.firstMatch
    XCTAssertTrue(app.buttons["Edit"].waitForExistence(timeout: 10))
    XCTAssertTrue(editor.isHittable)
    XCTAssertGreaterThan(editor.frame.height, 80, "The reading identity must leave room to read and select document content")
    app.buttons["Edit"].tap()
    XCTAssertTrue(app.buttons["Done"].exists)
    app.buttons["editor hide keyboard"].tap()
    XCTAssertTrue(editor.isHittable)
  }

  func testOpeningAnEditableDocumentIsReadingUntilExplicitEdit() {
    let app = open(access: "EDIT")
    XCTAssertTrue(app.staticTexts["Saved"].waitForExistence(timeout: 10))
    let editor = app.textViews.firstMatch
    let original = editor.value as? String
    XCTAssertFalse(offersKeyboard(app), "Reading taps must not begin writing")
    editor.press(forDuration: 1)
    XCTAssertTrue(app.menuItems["Copy"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.menuItems["Cut"].exists)
    app.buttons["Edit"].tap()
    XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 5))
    XCTAssertEqual(editor.value as? String, original)
    XCTAssertEqual(requests(in: app), "entities-load")
    editor.tap()
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
    app.buttons["Done"].tap()
    expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.keyboards.firstMatch)
    waitForExpectations(timeout: 5)
    XCTAssertTrue(app.buttons["Edit"].exists)
    XCTAssertFalse(offersKeyboard(app))
    XCTAssertEqual(editor.value as? String, original)
    XCTAssertEqual(requests(in: app), "entities-load")
  }

  func testDocumentIdentityAndModeStayClearWhileEditsRetainUndoAcrossDone() {
    let original = LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("Original text")])])
    let app = open(access: "EDIT", document: original)
    XCTAssertTrue(app.staticTexts["Reading"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.staticTexts["Tracer"].exists)
    app.buttons["Edit"].tap()
    XCTAssertTrue(app.staticTexts["Editing"].exists)
    let editor = app.textViews.firstMatch
    editor.typeKey(XCUIKeyboardKey.shift.rawValue, modifierFlags: [])
    editor.typeKey(XCUIKeyboardKey.F13.rawValue, modifierFlags: .shift)
    editor.typeKey("a", modifierFlags: .command)
    editor.typeText("R")
    app.buttons["Done"].tap()
    XCTAssertTrue(app.staticTexts["Reading"].exists)
    XCTAssertEqual(editor.value as? String, "R\n")
    XCTAssertTrue(app.staticTexts["Saved"].waitForExistence(timeout: 10))
    app.buttons["Edit"].tap()
    editor.typeKey(XCUIKeyboardKey.shift.rawValue, modifierFlags: [])
    editor.typeKey(XCUIKeyboardKey.F13.rawValue, modifierFlags: .shift)
    editor.typeKey("z", modifierFlags: .command)
    XCTAssertEqual(editor.value as? String, "Original text\n")
    editor.typeKey("z", modifierFlags: [.command, .shift])
    XCTAssertEqual(editor.value as? String, "R\n")
    app.buttons["editor hide keyboard"].tap()
    XCTAssertTrue(app.staticTexts["Editing"].exists)
    XCTAssertTrue(app.buttons["Done"].exists)
    editor.tap()
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
  }

  func testSaveFailureRetainsWorkAndPreventsLeavingUntilRetrySucceeds() {
    let app = open(access: "EDIT", environment: ["EDITOR_SAVE_FAILURES": "2"])
    XCTAssertTrue(app.buttons["Edit"].waitForExistence(timeout: 10))
    app.buttons["Edit"].tap()
    let editor = app.textViews.firstMatch
    editor.typeText("Recover my work")
    app.buttons["Done"].tap()
    XCTAssertTrue(app.buttons["Try Again"].waitForExistence(timeout: 10))
    let revised = editor.value as? String
    app.buttons["document back"].tap()
    XCTAssertTrue(app.buttons["Try Again"].waitForExistence(timeout: 10))
    XCTAssertEqual(editor.value as? String, revised)
    app.buttons["Try Again"].tap()
    XCTAssertTrue(app.staticTexts["Saved"].waitForExistence(timeout: 10))
    app.buttons["Away"].tap()
    app.navigationBars.buttons.element(boundBy: 0).tap()
    XCTAssertTrue(app.staticTexts["Saved"].waitForExistence(timeout: 10))
    XCTAssertEqual(app.textViews.firstMatch.value as? String, revised)
  }

  func testConflictKeepsEditsAsACopyWithoutReplacingTheOriginal() {
    let app = open(access: "EDIT", environment: ["EDITOR_SAVE_CONFLICT": "1"])
    XCTAssertTrue(app.buttons["Edit"].waitForExistence(timeout: 10))
    app.buttons["Edit"].tap()
    app.textViews.firstMatch.typeText("My conflicting work")
    app.buttons["Done"].tap()
    XCTAssertTrue(app.staticTexts["Newer edits available"].waitForExistence(timeout: 10))
    let mine = app.textViews.firstMatch.value as? String
    XCTAssertTrue(app.buttons["Reload Theirs"].exists)
    app.buttons["Keep Mine as a Copy"].tap()
    XCTAssertTrue(app.staticTexts["Tracer (copy)"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.staticTexts["Saved"].waitForExistence(timeout: 10))
    XCTAssertEqual(app.textViews.firstMatch.value as? String, mine)
    XCTAssertFalse(app.buttons["Reload Theirs"].exists)
    app.buttons["Away"].tap()
    app.navigationBars.buttons.element(boundBy: 0).tap()
    XCTAssertTrue(app.staticTexts["Saved"].waitForExistence(timeout: 10))
    XCTAssertFalse((app.textViews.firstMatch.value as? String)?.contains("My conflicting work") == true)
  }

  func testConflictReloadReturnsToReadingAndUsesTheServerVersion() {
    let app = open(access: "EDIT", environment: ["EDITOR_SAVE_CONFLICT": "1"])
    XCTAssertTrue(app.buttons["Edit"].waitForExistence(timeout: 10))
    let original = app.textViews.firstMatch.value as? String
    app.buttons["Edit"].tap()
    app.textViews.firstMatch.typeText("Unsaved conflict")
    app.buttons["Done"].tap()
    XCTAssertTrue(app.staticTexts["Newer edits available"].waitForExistence(timeout: 10))
    app.buttons["Reload Theirs"].tap()
    XCTAssertTrue(app.staticTexts["Saved"].waitForExistence(timeout: 10))
    XCTAssertEqual(app.textViews.firstMatch.value as? String, original)
    XCTAssertTrue(app.staticTexts["Reading"].exists)
    XCTAssertFalse(offersKeyboard(app))
  }

  func testCopyRecoveryShowsProgressAndRejectsRepeatedSubmission() {
    let app = open(access: "EDIT", environment: ["EDITOR_SAVE_CONFLICT": "1", "EDITOR_COPY_DELAY": "4"])
    XCTAssertTrue(app.buttons["Edit"].waitForExistence(timeout: 10))
    app.buttons["Edit"].tap()
    app.textViews.firstMatch.typeText("Retain this copy")
    app.buttons["Done"].tap()
    let copy = app.buttons["Keep Mine as a Copy"]
    XCTAssertTrue(copy.waitForExistence(timeout: 10))
    copy.tap()
    XCTAssertTrue(app.descendants(matching: .any)["Saving a copy…"].firstMatch.waitForExistence(timeout: 2))
    XCTAssertFalse(copy.isEnabled)
    XCTAssertFalse(app.buttons["Reload Theirs"].isEnabled)
    XCTAssertTrue(app.staticTexts["Tracer (copy)"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.staticTexts["Saved"].waitForExistence(timeout: 10))
    XCTAssertTrue((app.textViews.firstMatch.value as? String)?.contains("Retain this copy") == true)
  }

  func testFocusedFormattingAndInsertionStayVisibleAndSaveAuthoredText() throws {
    let original = LexicalJSON.document([LexicalJSON.paragraph([])])
    let app = open(access: "EDIT", document: original)
    XCTAssertTrue(app.buttons["Edit"].waitForExistence(timeout: 10))
    app.buttons["Edit"].tap()
    XCTAssertTrue(app.buttons["Format"].waitForExistence(timeout: 3))
    XCTAssertTrue(app.buttons["Format"].isHittable)
    XCTAssertTrue(app.buttons["Insert"].isHittable)
    XCTAssertTrue(app.buttons["Block type"].isHittable)
    app.buttons["Format"].tap()
    app.buttons["Bold"].tap()
    app.textViews.firstMatch.typeText("A deliberate paragraph")
    app.buttons["Done"].tap()
    XCTAssertTrue(app.staticTexts["Saved"].waitForExistence(timeout: 10))
    app.buttons["Away"].tap()
    app.navigationBars.buttons.element(boundBy: 0).tap()
    XCTAssertTrue(app.buttons["Edit"].waitForExistence(timeout: 10))
    XCTAssertEqual(app.textViews.firstMatch.value as? String, "A deliberate paragraph\n")
    app.buttons["Edit"].tap()
    let editor = app.textViews.firstMatch
    editor.typeKey(XCUIKeyboardKey.shift.rawValue, modifierFlags: [])
    editor.typeKey(XCUIKeyboardKey.F13.rawValue, modifierFlags: .shift)
    editor.typeKey("a", modifierFlags: .command)
    app.buttons["Format"].tap()
    XCTAssertTrue(app.buttons["Bold"].isSelected)
  }


  func testHideKeyboardKeepsTheDocumentOpenAndCanResumeEditing() {
    let app = open(access: "EDIT")
    XCTAssertTrue(app.staticTexts["Saved"].waitForExistence(timeout: 10))
    app.buttons["Edit"].tap()
    let editor = app.textViews.firstMatch
    editor.tap()
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
    let before = editor.value as? String
    let hide = app.buttons["editor hide keyboard"]
    XCTAssertTrue(hide.waitForExistence(timeout: 3))
    XCTAssertTrue(hide.isHittable)
    hide.tap()
    expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.keyboards.firstMatch)
    waitForExpectations(timeout: 5)
    XCTAssertTrue(editor.exists)
    XCTAssertEqual(editor.value as? String, before)
    editor.tap()
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
  }

  func testRealDocumentPredictionAcceptanceUndoesOneReplacement() throws {
    let original = LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("prefix ")])])
    let app = open(access: "EDIT", document: original)
    XCTAssertTrue(app.staticTexts["Saved"].waitForExistence(timeout: 10))
    app.buttons["Edit"].tap()
    let editor = app.textViews.firstMatch
    editor.tap()
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
    if app.buttons["Continue"].exists { app.buttons["Continue"].tap() }
    for character in "hel" {
      let lower = app.keyboards.keys[String(character)]
      let key = lower.exists ? lower : app.keyboards.keys[String(character).uppercased()]
      XCTAssertTrue(key.isHittable)
      key.tap()
    }
    XCTAssertTrue((editor.value as? String)?.lowercased().contains("hel") == true)
    let beforeAcceptance = try XCTUnwrap(editor.value as? String)
    let prediction = app.descendants(matching: .any).matching(NSPredicate(format: "label ==[c] %@", "Hello")).firstMatch
    XCTAssertTrue(prediction.waitForExistence(timeout: 3), "\(app.keyboards.debugDescription)")
    XCTAssertTrue(prediction.isHittable)
    prediction.tap()
    XCTAssertTrue((editor.value as? String)?.lowercased().contains("hello") == true)
    editor.typeKey(XCUIKeyboardKey.shift.rawValue, modifierFlags: [])
    editor.typeKey(XCUIKeyboardKey.F13.rawValue, modifierFlags: .shift)
    editor.typeKey("z", modifierFlags: .command)
    XCTAssertEqual(editor.value as? String, beforeAcceptance)
  }


  /// Real QuickPath drags. The simulator delivers the first word and its
  /// space as separate calls, then each later word as one `insertText` (#236).
  func testRealDocumentSwipedWordsUndoAndRedoTogether() throws {
    let original = LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("Say ")])])
    let app = open(access: "EDIT", document: original)
    XCTAssertTrue(app.staticTexts["Saved"].waitForExistence(timeout: 10))
    app.buttons["Edit"].tap()
    let editor = app.textViews.firstMatch
    editor.tap()
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
    if app.buttons["Continue"].waitForExistence(timeout: 2) { app.buttons["Continue"].tap() }
    func keyCenter(_ name: String) -> CGPoint {
      let lower = app.keyboards.keys[name]
      let key = lower.exists ? lower : app.keyboards.keys[name.uppercased()]
      XCTAssertTrue(key.isHittable)
      return CGPoint(x: key.frame.midX, y: key.frame.midY)
    }
    func swipe(_ from: CGPoint, _ to: CGPoint) {
      let origin = app.coordinate(withNormalizedOffset: .zero)
      origin.withOffset(CGVector(dx: from.x, dy: from.y)).press(
        forDuration: 0.05, thenDragTo: origin.withOffset(CGVector(dx: to.x, dy: to.y)),
        withVelocity: 300, thenHoldForDuration: 0.05)
    }
    swipe(keyCenter("t"), keyCenter("o"))
    // Accept the keyboard's real correction before capturing the first-word
    // boundary. Otherwise QuickPath can revise "To" to "Too" on the next swipe.
    let correction = app.descendants(matching: .any).matching(
      NSPredicate(format: "label ==[c] %@", "Too")).firstMatch
    XCTAssertTrue(correction.waitForExistence(timeout: 3), "\(app.debugDescription)")
    XCTAssertTrue(correction.isHittable)
    correction.tap()
    let afterFirstWord = try XCTUnwrap(editor.value as? String)
    XCTAssertEqual(afterFirstWord.split(whereSeparator: \.isWhitespace).map(String.init), ["Say", "Too"])
    // Resolve the real keyboard geometry before the run. Repeated accessibility
    // lookups between gestures can exceed the editor's two-second swipe window
    // on CI, turning the intended burst into separate user input turns.
    let w = keyCenter("w"), e = keyCenter("e"), t = keyCenter("t"), o = keyCenter("o")
    swipe(w, e)
    swipe(t, o)
    let swiped = try XCTUnwrap(editor.value as? String)
    XCTAssertEqual(swiped.split(whereSeparator: \.isWhitespace).count, afterFirstWord.split(whereSeparator: \.isWhitespace).count + 2)
    XCTAssertTrue(swiped.hasPrefix(afterFirstWord.trimmingCharacters(in: .newlines)))
    editor.typeKey(XCUIKeyboardKey.shift.rawValue, modifierFlags: [])
    editor.typeKey(XCUIKeyboardKey.F13.rawValue, modifierFlags: .shift)
    editor.typeKey("z", modifierFlags: .command)
    XCTAssertEqual(editor.value as? String, afterFirstWord)
    editor.typeKey("z", modifierFlags: [.command, .shift])
    XCTAssertEqual(editor.value as? String, swiped)
  }

  func testAnEditableDocumentAutosavesItsChanges() {
    let app = open(access: "EDIT")
    let notice = app.staticTexts["Saved"]
    XCTAssertTrue(notice.waitForExistence(timeout: 10))

    app.buttons["Edit"].tap()

    XCTAssertTrue(offersKeyboard(app))
    app.textViews.firstMatch.typeText("Typed in the document")

    let saved = NSPredicate(format: "label CONTAINS %@", "entities-save")
    expectation(for: saved, evaluatedWith: app.staticTexts["server requests"])
    waitForExpectations(timeout: 10)
    XCTAssertTrue(notice.waitForExistence(timeout: 10))
    XCTAssertEqual(requests(in: app), "entities-load entities-save")
  }

  func testAReadOnlyDocumentSaysItIsReadOnly() {
    let app = open(access: "READ")

    XCTAssertTrue(app.staticTexts["Read only"].waitForExistence(timeout: 10))
    XCTAssertFalse(app.staticTexts["Preview: changes aren’t saved"].exists)
    XCTAssertFalse(offersKeyboard(app))
  }

  /// Reading is what a read-only document is for, so a word pressed on is
  /// selected and offered to copy, and nothing that would edit is offered.
  func testAReadOnlyDocumentOffersToCopyWhatIsSelected() {
    let app = open(access: "READ")
    XCTAssertTrue(app.staticTexts["Read only"].waitForExistence(timeout: 10))

    app.textViews.firstMatch.press(forDuration: 1)

    XCTAssertTrue(app.menuItems["Copy"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.menuItems["Cut"].exists)
    XCTAssertFalse(app.menuItems["Paste"].exists)
    XCTAssertEqual(app.keyboards.count, 0)
  }

  func testADocumentTheAppCantEditYetOpensReadOnlyAndShowsWhatItCantShowYet() {
    let document = LexicalJSON.document([
      LexicalJSON.paragraph([LexicalJSON.text("Watch this")]), ["type": "unported-widget", "version": 1],
    ])
    let app = open(access: "EDIT", document: document)

    XCTAssertTrue(
      app.staticTexts["Read only: this document has parts the app can’t edit yet"].waitForExistence(
        timeout: 10))
    XCTAssertFalse(app.staticTexts["Preview: changes aren’t saved"].exists)
    XCTAssertTrue((app.textViews.firstMatch.value as? String)?.contains("unported-widget") == true)
    XCTAssertFalse(offersKeyboard(app))
  }

  /// Loaded again, here once shared to read only, the screen shows the
  /// second load, not the editor the first one made.
  func testASecondLoadReplacesWhatIsShown() {
    let app = open(access: "EDIT,READ")
    XCTAssertTrue(app.staticTexts["Saved"].waitForExistence(timeout: 10))

    app.buttons["Away"].tap()
    app.navigationBars.buttons.element(boundBy: 0).tap()

    XCTAssertTrue(app.staticTexts["Read only"].waitForExistence(timeout: 10))
    XCTAssertEqual(requests(in: app), "entities-load entities-load")
    XCTAssertFalse(offersKeyboard(app))
  }

  func testADocumentTheAppCantReadSaysSoWithoutARetry() {
    let app = open(
      access: "EDIT", document: ["root": ["type": "paragraph", "version": 1, "children": []]])

    XCTAssertTrue(app.staticTexts["Can’t open the document"].waitForExistence(timeout: 10))
    XCTAssertFalse(app.buttons["Try Again"].exists)
  }

  func testFractionalColumnsBelowOneLeaveTheRemainingSpaceEmpty() {
    XCUIDevice.shared.orientation = .landscapeLeft
    defer { XCUIDevice.shared.orientation = .portrait }
    let paragraph: JSONValue = ["type": "paragraph", "version": 1, "children": []]
    let item: JSONValue = ["type": "layout-item", "version": 1, "children": [paragraph]]
    let document = LexicalJSON.document([["type": "layout-container", "version": 1,
      "templateColumns": "0.25fr 0.25fr", "children": [item, item]]])
    let app = open(access: "EDIT", document: document)
    XCTAssertTrue(app.buttons["Edit"].waitForExistence(timeout: 10))
    app.buttons["Edit"].tap()
    let column = app.buttons["Edit column 1"]
    XCTAssertTrue(column.waitForExistence(timeout: 10))
    XCTAssertGreaterThan(app.frame.width, 600)
    XCTAssertGreaterThan(column.frame.width, app.frame.width * 0.15)
    XCTAssertLessThan(column.frame.width, app.frame.width * 0.35)
  }

  func testRepeatedMinmaxColumnsKeepTheirImplicitRows() {
    XCUIDevice.shared.orientation = .landscapeLeft
    defer { XCUIDevice.shared.orientation = .portrait }
    let paragraph: JSONValue = ["type": "paragraph", "version": 1, "children": []]
    let item: JSONValue = ["type": "layout-item", "version": 1, "children": [paragraph]]
    let document = LexicalJSON.document([["type": "layout-container", "version": 1,
      "templateColumns": "repeat(2, minmax(100px, 1fr))", "children": [item, item, item, item]]])
    let app = open(access: "EDIT", document: document)
    XCTAssertTrue(app.buttons["Edit"].waitForExistence(timeout: 10))
    app.buttons["Edit"].tap()
    let first = app.buttons["Edit column 1"]
    XCTAssertTrue(first.waitForExistence(timeout: 10))
    let second = app.buttons["Edit column 2"]
    let third = app.buttons["Edit column 3"]
    XCTAssertTrue(third.exists)
    XCTAssertEqual(first.frame.width, second.frame.width, accuracy: 1)
    XCTAssertGreaterThan(first.frame.width, 100)
    XCTAssertEqual(third.frame.minX, first.frame.minX, accuracy: 1)
    XCTAssertGreaterThan(third.frame.minY, first.frame.maxY)
  }

  func testImportedColumnsRetainFixedPercentageAndFractionalTracks() {
    XCUIDevice.shared.orientation = .landscapeLeft
    defer { XCUIDevice.shared.orientation = .portrait }
    let paragraph: JSONValue = ["type": "paragraph", "version": 1, "children": []]
    let item: JSONValue = ["type": "layout-item", "version": 1, "children": [paragraph]]
    let document = LexicalJSON.document([["type": "layout-container", "version": 1,
      "templateColumns": "100px 25% 0.5fr", "children": [item, item, item]]])
    let app = open(access: "EDIT", document: document)
    XCTAssertTrue(app.buttons["Edit"].waitForExistence(timeout: 10))
    app.buttons["Edit"].tap()
    let first = app.buttons["Edit column 1"]
    XCTAssertTrue(first.waitForExistence(timeout: 10))
    XCTAssertGreaterThan(app.frame.width, 600)
    XCTAssertEqual(first.frame.width, 82, accuracy: 1) // 100px track minus the source border and padding.
    let percentage = app.buttons["Edit column 2"].frame.width
    XCTAssertGreaterThan(percentage, app.frame.width * 0.15)
    XCTAssertLessThan(percentage, app.frame.width * 0.3)
    XCTAssertTrue(app.buttons["Edit column 3"].exists)
  }

  private func open(access: String, document: JSONValue? = nil, environment: [String: String] = [:]) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchEnvironment["EDITOR_PREVIEW_ACCESS"] = access
    for (key, value) in environment { app.launchEnvironment[key] = value }
    if let document {
      app.launchEnvironment["EDITOR_DOCUMENT"] = String(
        decoding: try! JSONEncoder().encode(document), as: UTF8.self)
    }
    app.launch()
    return app
  }

  /// Whether a tap on the editor brings up the keyboard. A read-only editor
  /// still takes focus, for its text to be selected and copied.
  private func offersKeyboard(_ app: XCUIApplication) -> Bool {
    app.textViews.firstMatch.tap()
    return app.keyboards.firstMatch.waitForExistence(timeout: 3)
  }

  /// Document operations, excluding the independent account identity read.
  private func requests(in app: XCUIApplication) -> String {
    app.staticTexts["server requests"].label.split(separator: " ").filter { $0 != "auth-me" }.joined(separator: " ")
  }
}
