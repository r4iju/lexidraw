import EditorModelInterface
import Testing
@testable import TextKitEditor

@Suite struct MediaPayloadTests {
  @Test func imageUsesStoredDimensionsAltAndFigureCaption() {
    let node: JSONValue = ["type": "image", "src": "https://example.com/p.png", "width": 800, "height": 400, "altText": "Chart", "$": ["figure": ["caption": "Figure one", "width": "wide"]]]
    let media = MediaPayload(node)
    #expect(media?.source?.absoluteString == "https://example.com/p.png")
    #expect(media?.aspectRatio == 2)
    #expect(media?.caption == "Figure one")
    #expect(media?.label == "Chart")
  }
  @Test func captionEditorTextSurvives() {
    let node: JSONValue = ["type": "video", "src": "https://example.com/a.mp4", "showCaption": true, "caption": ["root": ["children": [["type": "paragraph", "children": [["type": "text", "text": "Caption"], ["type": "linebreak"], ["type": "text", "text": "next"]]]]]]]
    #expect(MediaPayload(node)?.caption == "Caption\nnext")
  }
  @Test func embeddedRasterDataIsRenderable() {
    #expect(MediaPayload(["type": "image", "src": "data:image/png;base64,aGVsbG8="])?.source != nil)
    #expect(MediaPayload(["type": "image", "src": "data:text/html;base64,aGVsbG8="])?.source == nil)
  }
  @Test func unsafeSourcesAreNotLoaded() {
    #expect(MediaPayload(["type": "image", "src": "javascript:alert(1)"])?.source == nil)
    #expect(MediaPayload(["type": "image", "src": "file:///private/token"])?.source == nil)
  }
}
