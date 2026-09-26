import Foundation
import Testing

@testable import DrawingKit

/// What the app asks of the editor beyond what the web editor does.
@Suite struct EditingTests {
  static let box: JSONValue = [
    "id": "box", "type": "rectangle", "x": 0, "y": 0, "width": 100, "height": 80, "version": 3,
    "versionNonce": 7, "index": "a0",
  ]

  /// A second finger turns what the first began into a pinch: the edit is
  /// taken back, and there is nothing to undo.
  @Test func aCancelledGestureLeavesNothingBehind() {
    let editor = DrawingEditor(elements: [Self.box], measurer: FontLibrary.shared, environment: .counting)
    let before = editor.elements

    editor.pointerDown(Point2D(50, 40), pointer: .touch, pressure: 0.5)
    editor.pointerMove(Point2D(90, 70), pressure: 0.5)
    editor.cancelGesture()
    editor.tool = .ellipse
    editor.pointerDown(Point2D(200, 200), pointer: .touch, pressure: 0.5)
    editor.pointerMove(Point2D(260, 240), pressure: 0.5)
    editor.cancelGesture()

    #expect(editor.elements == before)
    #expect(editor.selectedIds.isEmpty)
    #expect(!editor.canUndo)
  }

  /// While a shape is dragged, the frame it would join if let go is
  /// outlined, as the web outlines it; a dragged frame joins none.
  @Test func aDraggedShapeShowsTheFrameItWouldJoin() throws {
    let frame: JSONValue = [
      "id": "frame", "type": "frame", "x": 200, "y": 0, "width": 300, "height": 200, "index": "a1",
    ]
    let editor = DrawingEditor(elements: [Self.box, frame], measurer: FontLibrary.shared, environment: .counting)
    editor.pointerDown(Point2D(0, 40), pointer: .touch, pressure: 0.5)
    editor.pointerMove(Point2D(100, 40), pressure: 0.5)
    #expect(editor.overlay(pointer: .touch).frame == nil)

    editor.pointerMove(Point2D(250, 40), pressure: 0.5)
    #expect(editor.overlay(pointer: .touch).frame == Bounds(minX: 200, minY: 0, maxX: 500, maxY: 200))

    editor.pointerUp(Point2D(250, 40), pressure: 0)
    #expect(editor.overlay(pointer: .touch).frame == nil)
    editor.pointerDown(Point2D(200, 100), pointer: .touch, pressure: 0.5)
    editor.pointerMove(Point2D(220, 100), pressure: 0.5)
    #expect(editor.overlay(pointer: .touch).frame == nil)
  }

  /// A selected group is outlined once round all of it, as the web outlines
  /// it, not round each of its elements; while it is edited, the element
  /// picked in it is outlined too.
  @Test func aSelectedGroupIsOutlinedAsAWhole() {
    let first: JSONValue = [
      "id": "first", "type": "rectangle", "x": 0, "y": 0, "width": 100, "height": 80, "groupIds": ["g"],
      "index": "a0",
    ]
    let second: JSONValue = [
      "id": "second", "type": "rectangle", "x": 200, "y": 0, "width": 100, "height": 80, "groupIds": ["g"],
      "index": "a1",
    ]
    let editor = DrawingEditor(elements: [first, second], measurer: FontLibrary.shared, environment: .counting)
    let group = Bounds(minX: -4, minY: -4, maxX: 304, maxY: 84)

    editor.pointerDown(Point2D(0, 40), pointer: .touch, pressure: 0.5)
    editor.pointerUp(Point2D(0, 40), pressure: 0)
    var overlay = editor.overlay(pointer: .touch)
    #expect(editor.selectedIds == ["first", "second"])
    #expect(overlay.outlines.isEmpty)
    #expect(overlay.groupBoxes == [group])

    editor.doubleTap(Point2D(0, 40))
    overlay = editor.overlay(pointer: .touch)
    #expect(editor.selectedIds == ["first"])
    #expect(overlay.outlines.count == 1)
    #expect(overlay.groupBoxes == [group])
  }

  /// Predicted touches draw the stroke on ahead of the pencil, but only
  /// until the real ones arrive.
  @Test func aPredictionExtendsTheStrokeOnlyOnScreen() throws {
    let editor = DrawingEditor(elements: [], measurer: FontLibrary.shared, environment: .counting)
    editor.tool = .freedraw
    editor.pointerDown(Point2D(10, 10), pointer: .pen, pressure: 0.3)
    editor.pointerMove(Point2D(20, 10), pressure: 0.4)
    let before = editor.elements

    let shown = editor.elements(predicting: [(Point2D(30, 12), 0.45)])

    #expect(editor.elements == before)
    let stroke = try #require(shown.first)
    #expect(stroke["points"] == [[0, 0], [10, 0], [20, 2]])
    #expect(stroke["pressures"] == [0.3, 0.4, 0.45])
  }

  /// Shapes kept from one frame to the next are drawn again only for
  /// elements that haven't changed since.
  @Test func keptShapesFollowTheElements() throws {
    let cache = ShapeCache()
    var elements = try sceneElements("fills")
    _ = events(elements, cache)
    var first = try #require(elements[0].objectValue)
    first["width"] = .number(first.number("width") + 40)
    elements[0] = .object(first)

    #expect(events(elements, cache) == events(elements, nil))
  }

  /// A placed image is marked stored once its upload ends, which, as on
  /// the web, is not a step to undo.
  @Test func storingAnImageIsNotAStepToUndo() throws {
    let editor = DrawingEditor(elements: [], measurer: FontLibrary.shared, environment: .counting)
    let photo = try #require(
      try fixtureFiles(interactionFixtures.appending(path: "place-an-image"), as: ImageFile.init(data:))["photo"])
    let id = editor.placeImage(photo, at: Point2D(400, 300), viewportHeight: 800)
    editor.setStatus("saved", ofImagesShowing: photo.id)
    editor.pointerDown(Point2D(400, 300), pointer: .touch, pressure: 0.5)
    editor.pointerMove(Point2D(450, 300), pressure: 0.5)
    editor.pointerUp(Point2D(450, 300), pressure: 0)

    editor.undo()

    let image = try #require(editor.elements.first { $0["id"]?.stringValue == id })
    #expect(image["x"] == 100)
    #expect(image["status"] == "saved")
  }

  /// The style panel offers what the selection can take, or else what the
  /// tool draws with.
  @Test func stylesOfferedFollowTheSelection() {
    let image: JSONValue = [
      "id": "image", "type": "image", "x": 0, "y": 0, "width": 100, "height": 80, "fileId": "f",
    ]
    let editor = DrawingEditor(
      elements: [Self.box, image], measurer: FontLibrary.shared, environment: .counting)
    editor.tool = .rectangle
    var controls = editor.styleControls
    #expect(controls.showsStrokeColor && controls.showsBackgroundColor && !controls.showsFillStyle)
    #expect(controls.strokeWidth == 2)

    editor.tool = .selection
    editor.pointerDown(Point2D(50, 40), pointer: .touch, pressure: 0.5)
    editor.pointerUp(Point2D(50, 40), pressure: 0)
    controls = editor.styleControls
    #expect(editor.selectedIds == ["image"])
    #expect(!controls.showsStrokeColor && !controls.showsBackgroundColor && !controls.showsStrokeWidth)
  }

  private func events(_ elements: [JSONValue], _ cache: ShapeCache?) -> [JSONValue] {
    let scene = PreparedScene(
      restoreElements(elements), theme: .light, measurer: FontLibrary.shared, shapes: cache)
    let canvas = RecordingCanvas()
    scene.export(on: canvas, padding: exportPadding, scale: exportScale, background: "#ffffff")
    return canvas.events
  }
}
