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
    prepared(try sceneElements(scene), theme == "dark" ? .dark : .light)
      .export(on: canvas, padding: exportPadding, scale: exportScale, background: "#ffffff")
    let difference = firstDifference(expected, canvas.events)
    #expect(difference == nil, "\(difference ?? "")")
  }

  @Test(arguments: cases)
  func looksLikeTheWebExport(scene: String, theme: String) throws {
    let expected = try Pixels(png: drawingFixtures.appending(path: "\(scene)/\(theme).png"))
    let actual = Pixels(renderImage(try sceneElements(scene), theme == "dark" ? .dark : .light))
    #expect((actual.width, actual.height) == (expected.width, expected.height))
    let share = mismatchShare(expected, actual)
    #expect(share < 0.002, "\(share * 100)% of pixels differ")
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
