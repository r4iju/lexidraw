import EditorModelInterface
import Foundation
import Testing
#if canImport(UIKit)
import UIKit
#else
import AppKit
#endif
@testable import TextKitEditor

@Suite struct MediaCaptionTests {
  @Test func socialTextLeavesRenderInCaptions() {
    let state: JSONValue = ["root": ["type": "root", "children": [["type": "paragraph", "children": [
      ["type": "hashtag", "text": "#native", "format": 1, "style": ""],
      ["type": "keyword", "text": " congratulations", "format": 0, "style": ""],
      ["type": "emoji", "text": "😄", "className": "emoji", "mode": "token", "format": 0, "style": ""],
    ]]]]]
    #expect(MediaCaptionSupport.refusal(in: state) == nil)
    let rendered = DocumentText.caption(state, style: { _, _ in [:] })
    #expect(rendered.string == "#native congratulations😄")
  }

  @Test func captionKeepsTextFormatsLinksAndParagraphs() throws {
    let state: JSONValue = ["root": ["type": "root", "children": [
      ["type": "paragraph", "children": [["type": "text", "text": "Bold", "format": 1], ["type": "text", "text": " italic", "format": 2]]],
      ["type": "paragraph", "children": [["type": "link", "url": "https://example.com/", "children": [["type": "text", "text": "Link", "format": 8]]]]],
    ]]]
    let formatKey = NSAttributedString.Key("test.caption.format")
    let caption = DocumentText.caption(state, style: { _, format in [formatKey: format.rawValue] })
    #expect(caption.string == "Bold italic\nLink")
    #expect(caption.attribute(formatKey, at: 0, effectiveRange: nil) as? Int == 1)
    #expect(caption.attribute(formatKey, at: 5, effectiveRange: nil) as? Int == 2)
    #expect(caption.attribute(formatKey, at: 12, effectiveRange: nil) as? Int == 8)
    #expect((caption.attribute(.link, at: 12, effectiveRange: nil) as? URL)?.absoluteString == "https://example.com/")
  }
  @Test func captionAllowsTheNativeFontSizeStyle() {
    let state: JSONValue = ["root": ["type": "root", "children": [["type": "paragraph", "children": [["type": "text", "text": "Sized caption", "style": "font-size: 48px;"]]]]]]
    #expect(MediaCaptionSupport.refusal(in: state) == nil)
  }
  @Test func imageReadsTheStoredNestedEditorShape() {
    let state: JSONValue = ["root": ["type": "root", "children": [["type": "paragraph", "children": [["type": "text", "text": "Stored image caption", "format": 1]]]]]]
    let node: JSONValue = ["type": "image", "showCaption": true, "caption": ["editorState": state]]
    #expect(MediaPayload(node)?.caption == "Stored image caption")
    #expect(MediaPayload(node)?.captionState == state)
  }
  @Test func inlineCaptionsAreEnabledByDefaultLikeTheWeb() {
    let state: JSONValue = ["root": ["type": "root", "children": [["type": "paragraph", "children": [["type": "text", "text": "Default caption"]]]]]]
    let node: JSONValue = ["type": "inline-image", "showCaption": true, "caption": ["editorState": state]]
    #expect(MediaPayload(node)?.caption == "Default caption")
  }
  @Test func captionUsesStoredParagraphAlignment() {
    let state: JSONValue = ["root": ["type": "root", "children": [["type": "paragraph", "format": "right", "children": [["type": "text", "text": "Aligned", "format": 0]]]]]]
    let base = NSMutableParagraphStyle()
    base.alignment = .center
    let caption = DocumentText.caption(state, style: { _, _ in [.paragraphStyle: base] })
    #expect((caption.attribute(.paragraphStyle, at: 0, effectiveRange: nil) as? NSParagraphStyle)?.alignment == .right)
  }
  @Test(arguments: ["inline-image", "video"]) func captionRespectsCaptionsEnabled(_ type: String) {
    let node: JSONValue = ["type": .string(type), "showCaption": true, "captionsEnabled": false, "caption": ["root": ["children": [["type": "paragraph", "children": [["type": "text", "text": "Hidden caption"]]]]]]]
    #expect(MediaPayload(node)?.caption == "")
  }
}
