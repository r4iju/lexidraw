import Foundation

/// What a control in the app does to the drawing.
public enum EditorAction {
  case undo, redo, delete, group, ungroup
  case style(StyleChange)
  case placeImage(ImageFile, at: Point2D, viewportHeight: Double)
}

/// A button the app shows, and the action tapping it performs.
public struct EditorButton: Identifiable {
  public let title: String
  public let systemImage: String
  public let isDestructive: Bool
  public let isEnabled: Bool
  public let action: EditorAction
  public var id: String { title }
}

extension DrawingEditor {
  public func perform(_ action: EditorAction) {
    switch action {
    case .undo: undo()
    case .redo: redo()
    case .delete: deleteSelection()
    case .group: group()
    case .ungroup: ungroup()
    case .style(let change): changeStyle(change)
    case .placeImage(let file, let point, let viewportHeight):
      placeImage(file, at: point, viewportHeight: viewportHeight)
    }
  }

  public var historyButtons: [EditorButton] {
    [
      EditorButton(
        title: "Undo", systemImage: "arrow.uturn.backward", isDestructive: false, isEnabled: canUndo, action: .undo),
      EditorButton(
        title: "Redo", systemImage: "arrow.uturn.forward", isDestructive: false, isEnabled: canRedo, action: .redo),
    ]
  }

  /// The buttons for what is selected: none while nothing is.
  public var selectionButtons: [EditorButton] {
    var buttons: [EditorButton] = []
    if canGroup {
      buttons.append(
        EditorButton(
          title: "Group", systemImage: "rectangle.3.group", isDestructive: false, isEnabled: true, action: .group))
    }
    if canUngroup {
      buttons.append(
        EditorButton(
          title: "Ungroup", systemImage: "square.on.square.dashed", isDestructive: false, isEnabled: true,
          action: .ungroup))
    }
    if editing == nil, !selectedIds.isEmpty {
      buttons.append(
        EditorButton(title: "Delete", systemImage: "trash", isDestructive: true, isEnabled: true, action: .delete))
    }
    return buttons
  }
}
