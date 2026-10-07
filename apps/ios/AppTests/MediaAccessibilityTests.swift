import XCTest
import UIKit
import LexicalSwift
import LexidrawJSON
import TextKitEditor
@testable import EditorHarness

@MainActor final class MediaAccessibilityTests: XCTestCase {
  func testVideoBodyIsExposedAndActivatesOwnerOnce() throws {
    let model = Editor()
    try model.load(["root": ["type": "root", "version": 1, "children": [["type": "paragraph", "version": 1, "children": [["type": "video", "version": 1, "src": "http://127.0.0.1:1/disposable.mp4", "width": 320, "height": 180, "showCaption": false, "captionsEnabled": false, "caption": ["root": ["type": "root", "version": 1, "children": []]]]]]]]])
    let view = EditorView(model: model, isEditable: true)
    view.frame = CGRect(x: 0, y: 0, width: 390, height: 600)
    view.layoutIfNeeded()
    _ = view.caretRect(for: view.beginningOfDocument)
    var calls = 0
    view.onEmbeddedTap = { _, node in
      XCTAssertEqual(node["type"], "video")
      calls += 1
      return true
    }
    let media = try XCTUnwrap(view.visibleEmbeddedAccessibilityViews.first)
    let elements = try XCTUnwrap(media.accessibilityElements as? [UIAccessibilityElement])
    let button = try XCTUnwrap(elements.first { $0.accessibilityTraits.contains(.button) })
    XCTAssertTrue(button.accessibilityActivate())
    XCTAssertEqual(calls, 1)
    XCTAssertFalse(media.isAccessibilityElement)
  }
}
