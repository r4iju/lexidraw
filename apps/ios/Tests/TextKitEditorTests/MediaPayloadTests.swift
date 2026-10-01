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
    let node: JSONValue = ["type": "video", "src": "https://example.com/a.mp4", "showCaption": true, "captionsEnabled": true, "caption": ["root": ["type": "root", "children": [["type": "paragraph", "children": [["type": "text", "text": "Caption"], ["type": "linebreak"], ["type": "text", "text": "next"]]]]]]]
    #expect(MediaPayload(node)?.caption == "Caption\nnext")
  }
  @Test func embeddedRasterDataIsRenderable() {
    #expect(MediaPayload(["type": "image", "src": "data:image/png;base64,aGVsbG8="])?.source != nil)
    #expect(MediaPayload(["type": "image", "src": "data:text/html;base64,aGVsbG8="])?.source == nil)
  }
  // Stored as in "Shopping - Clothing"; the browser's URL parser strips the
  // space, and the blob store answers the percent-encoded one with a 404.
  @Test func sourcesAreParsedAsTheBrowserParsesAnImgSrc() {
    let stored = "https://wzjiyy9aqsfxib5p.public.blob.vercel-storage.com/75d8b37e-4971-44d6-ad21-07897d58f38a-8cb30c35-eb98-46a5-9f63-19afe39eedbf.jpeg "
    #expect(MediaPayload(["type": "image", "src": .string(stored)])?.source?.absoluteString == String(stored.dropLast()))
    #expect(MediaPayload(["type": "image", "src": "\n\t https://example.com/a\tb\n.png \u{0}"])?.source?.absoluteString == "https://example.com/ab.png")
  }
  @Test func unsafeSourcesAreNotLoaded() {
    #expect(MediaPayload(["type": "image", "src": "javascript:alert(1)"])?.source == nil)
    #expect(MediaPayload(["type": "image", "src": "file:///private/token"])?.source == nil)
  }
}
