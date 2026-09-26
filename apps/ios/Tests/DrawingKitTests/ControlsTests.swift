import Foundation
import Testing

@testable import DrawingKit

/// The app's buttons and style popover are drawn from what the editor
/// offers, and a tap performs the action the control carries: each control
/// here does what its label says.
@Suite struct ControlsTests {
  static let filled: JSONValue = [
    "id": "box", "type": "rectangle", "x": 0, "y": 0, "width": 100, "height": 80,
    "backgroundColor": "#a5d8ff", "fillStyle": "solid", "strokeStyle": "solid",
  ]
  static let other: JSONValue = [
    "id": "other", "type": "ellipse", "x": 200, "y": 0, "width": 100, "height": 80,
  ]

  private func selectingBox() -> DrawingEditor {
    let editor = DrawingEditor(
      elements: [Self.filled, Self.other], measurer: FontLibrary.shared, environment: .counting)
    editor.pointerDown(Point2D(50, 40), pointer: .touch, pressure: 0.5)
    editor.pointerUp(Point2D(50, 40), pressure: 0)
    return editor
  }

  private func box(_ editor: DrawingEditor) -> JSONValue? {
    editor.elements.first { $0["id"] == "box" }
  }

  @Test func eachStyleChoiceSetsWhatItsLabelSays() throws {
    let says: [String: (key: String, value: JSONValue)] = [
      "Fill: Hachure": ("fillStyle", "hachure"), "Fill: Cross-Hatch": ("fillStyle", "cross-hatch"),
      "Fill: Solid": ("fillStyle", "solid"), "Stroke Width: Thin": ("strokeWidth", 1),
      "Stroke Width: Bold": ("strokeWidth", 2), "Stroke Width: Extra Bold": ("strokeWidth", 4),
      "Stroke Style: Solid": ("strokeStyle", "solid"), "Stroke Style: Dashed": ("strokeStyle", "dashed"),
      "Stroke Style: Dotted": ("strokeStyle", "dotted"), "Sloppiness: Architect": ("roughness", 0),
      "Sloppiness: Artist": ("roughness", 1), "Sloppiness: Cartoonist": ("roughness", 2),
    ]
    let sections = selectingBox().styleControls.sections
    #expect(
      sections.map(\.title) == ["Stroke", "Background", "Fill", "Stroke Width", "Stroke Style", "Sloppiness"])
    let choices = sections.flatMap { section -> [(String, StyleChoice)] in
      guard case .choices(let choices) = section.options else { return [] }
      return choices.map { ("\(section.title): \($0.label)", $0) }
    }
    #expect(Set(choices.map(\.0)) == Set(says.keys))
    for (name, choice) in choices {
      let editor = selectingBox()
      editor.perform(.style(choice.change))
      let expected = try #require(says[name])
      #expect(box(editor)?[expected.key] == expected.value, "\(name)")
    }
  }

  @Test func eachSwatchColoursWhatItsSectionSays() throws {
    for section in selectingBox().styleControls.sections {
      guard case .colors(let colors, _, let property) = section.options else { continue }
      let key = ["Stroke": "strokeColor", "Background": "backgroundColor"][section.title]
      for color in colors {
        let editor = selectingBox()
        editor.perform(.style(property.change(color)))
        #expect(box(editor)?[try #require(key)] == .string(color))
      }
    }
  }

  @Test func theButtonsForASelectionDoWhatTheySay() throws {
    let editor = selectingBox()
    editor.pointerDown(Point2D(250, 40), pointer: .touch, pressure: 0.5)
    editor.pointerUp(Point2D(250, 40), pressure: 0)
    editor.pointerDown(Point2D(-20, -20), pointer: .touch, pressure: 0.5)
    editor.pointerMove(Point2D(150, 60), pressure: 0.5)
    editor.pointerMove(Point2D(320, 100), pressure: 0.5)
    editor.pointerUp(Point2D(320, 100), pressure: 0)
    #expect(editor.selectionButtons.map(\.title) == ["Group", "Delete"])

    try perform("Group", from: editor.selectionButtons, on: editor)
    #expect(box(editor)?["groupIds"]?.arrayValue?.count == 1)
    #expect(editor.selectionButtons.map(\.title) == ["Ungroup", "Delete"])

    try perform("Ungroup", from: editor.selectionButtons, on: editor)
    #expect(box(editor)?["groupIds"] == [])

    try perform("Undo", from: editor.historyButtons, on: editor)
    #expect(box(editor)?["groupIds"]?.arrayValue?.count == 1)
    try perform("Redo", from: editor.historyButtons, on: editor)
    #expect(box(editor)?["groupIds"] == [])

    try perform("Delete", from: editor.selectionButtons, on: editor)
    #expect(box(editor)?["isDeleted"] == true)
    #expect(editor.selectionButtons.isEmpty)
  }

  private func perform(_ title: String, from buttons: [EditorButton], on editor: DrawingEditor) throws {
    let button = try #require(buttons.first { $0.title == title }, "\(title) in \(buttons.map(\.title))")
    #expect(button.isEnabled)
    editor.perform(button.action)
  }
}
