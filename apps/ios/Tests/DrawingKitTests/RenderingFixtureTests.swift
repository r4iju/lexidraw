import CoreGraphics
import Foundation
import Testing

@testable import DrawingKit

/// The renderer against what web Excalidraw drew for the same scenes, both
/// call by call and as pixels.
@Suite struct RenderingFixtureTests {
  static let cases = fixtureScenes.flatMap { scene in
    [(scene, "light"), (scene, "dark")]
  }

  @Test(arguments: cases)
  func drawsWhatTheWebDraws(scene: String, theme: String) throws {
    let expected = try JSONDecoder().decode(
      [JSONValue].self,
      from: Data(contentsOf: drawingFixtures.appending(path: "\(scene)/\(theme).events.json")))
    let canvas = RecordingCanvas()
    prepared(try sceneElements(scene), theme == "dark" ? .dark : .light, images: try sceneImages(scene))
      .export(on: canvas, padding: exportPadding, scale: exportScale, background: "#ffffff")
    let difference = firstDifference(expected, canvas.events)
    #expect(difference == nil, "\(difference ?? "")")
  }

  @Test(arguments: cases)
  func looksLikeTheWebExport(scene: String, theme: String) throws {
    let expected = try Pixels(png: drawingFixtures.appending(path: "\(scene)/\(theme).png"))
    let actual = Pixels(
      renderImage(
        try sceneElements(scene), theme == "dark" ? .dark : .light, images: try sceneImages(scene)))
    #expect((actual.width, actual.height) == (expected.width, expected.height))
    let share = mismatchShare(expected, actual)
    #expect(share < 0.002, "\(share * 100)% of pixels differ")
  }

  /// A vector image is drawn under the dark theme's filter, as the web
  /// draws it, where a raster one keeps its colours.
  @Test func aVectorImageIsThemedInTheDark() throws {
    let vector = try sceneImages("images").mapValues {
      DrawingImage(bitmap: $0.bitmap, mimeType: .svg)
    }
    let pixels = Pixels(renderImage(try sceneElements("images"), .dark, images: vector))
    let red = ColorFilter(themeFilter).apply(try #require(CSSColor("#e03131")))
    let (r, g, b, _) = pixels.pixel(100, 90)
    #expect(abs(Double(r) - red.red * 255) <= 2)
    #expect(abs(Double(g) - red.green * 255) <= 2)
    #expect(abs(Double(b) - red.blue * 255) <= 2)
  }

  /// A vector image is drawn sharper than its own size; it still shows
  /// the same part of itself in the same place.
  @Test func aSharperBitmapShowsTheSameImage() throws {
    let doubled = try sceneImages("images").mapValues { image in
      let bitmap = try #require(image.bitmap)
      let context = try #require(
        CGContext(
          data: nil, width: bitmap.width * 2, height: bitmap.height * 2, bitsPerComponent: 8,
          bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
      context.interpolationQuality = .none
      context.draw(bitmap, in: CGRect(x: 0, y: 0, width: bitmap.width * 2, height: bitmap.height * 2))
      return DrawingImage(bitmap: context.makeImage(), mimeType: .png, scale: 2)
    }
    let expected = try Pixels(png: drawingFixtures.appending(path: "images/light.png"))
    let actual = Pixels(renderImage(try sceneElements("images"), .light, images: doubled))
    #expect(mismatchShare(expected, actual) < 0.002)
  }

  /// The image comparison is loose enough to forgive anti-aliasing; this
  /// shows it still sees a stroke drawn with other random numbers.
  @Test func seesADifferentlySeededStroke() throws {
    let elements = try sceneElements("rectangles").map { element -> JSONValue in
      guard var object = element.objectValue, let seed = object["seed"]?.numberValue else {
        return element
      }
      object["seed"] = .number(seed + 1)
      return .object(object)
    }
    let expected = try Pixels(png: drawingFixtures.appending(path: "rectangles/light.png"))
    #expect(mismatchShare(expected, Pixels(renderImage(elements, .light))) >= 0.002)
  }
}
