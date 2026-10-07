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
  // The web's `mediaLink` rules, generated into MediaLinks: an id the
  // provider cannot have anything under links nowhere, rather than to the
  // provider's home page.
  @Test func embedsLinkOnlyIdsTheirProviderCanName() {
    #expect(MediaPayload(["type": "youtube", "videoID": "dQw4w9WgXcQ"])?.source?.absoluteString == "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    #expect(MediaPayload(["type": "tweet", "id": "20"])?.source?.absoluteString == "https://x.com/i/web/status/20")
    #expect(MediaPayload(["type": "figma", "documentID": "LKQ4FJ4bTnCSjedbRpk931"])?.source?.absoluteString == "https://www.figma.com/file/LKQ4FJ4bTnCSjedbRpk931")
    for node: JSONValue in [
      ["type": "youtube", "videoID": ""], ["type": "youtube", "videoID": "fixture-unavailable"],
      ["type": "tweet", "id": ""], ["type": "tweet", "id": "abc"],
      ["type": "figma", "documentID": "fixture-unavailable"],
    ] {
      #expect(MediaPayload(node)?.source == nil)
    }
    #expect(MediaPayload(["type": "youtube", "videoID": ""])?.unlinkedMessage == "No video linked")
    #expect(MediaPayload(["type": "tweet", "id": "abc"])?.unlinkedMessage == "No post linked")
    #expect(MediaPayload(["type": "figma", "documentID": ""])?.unlinkedMessage == "No Figma file linked")
  }
  @Test func unsafeSourcesAreNotLoaded() {
    #expect(MediaPayload(["type": "image", "src": "javascript:alert(1)"])?.source == nil)
    #expect(MediaPayload(["type": "image", "src": "file:///private/token"])?.source == nil)
  }
}
