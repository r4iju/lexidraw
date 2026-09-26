import Foundation

/// A style picked in the style controls.
public enum StyleChange: Equatable, Sendable {
  case strokeColor(String)
  case backgroundColor(String)
  case fillStyle(FillStyle)
  case strokeWidth(Double)
  case strokeStyle(StrokeStyle)
  case roughness(Double)
}

/// The style controls that apply to what is selected, or else to what the
/// tool draws, as the web's shape actions panel shows them, each with the
/// value to show as picked: nil where the elements differ.
public struct StyleControls: Equatable, Sendable {
  public var showsStrokeColor = false
  public var showsBackgroundColor = false
  public var showsFillStyle = false
  public var showsStrokeWidth = false
  /// Stroke style and sloppiness, which the web offers together.
  public var showsStrokeStyle = false
  public var strokeColor: String?
  public var backgroundColor: String?
  public var fillStyle: FillStyle?
  public var strokeWidth: Double?
  public var strokeStyle: StrokeStyle?
  public var roughness: Double?

  public init() {}

  /// The web's top picks, which the popover offers before any other colour.
  static let strokeColors = ["#1e1e1e", "#e03131", "#2f9e44", "#1971c2", "#f08c00"]
  static let backgroundColors = ["transparent", "#ffc9c9", "#b2f2bb", "#a5d8ff", "#ffec99"]

  /// The style popover's sections, in the web's order, each with the
  /// change its controls make.
  public var sections: [StyleSection] {
    func choices<Value: Equatable>(
      _ title: String, _ options: [(String, Value)], picked: Value?, _ change: (Value) -> StyleChange
    ) -> StyleSection {
      StyleSection(
        title: title,
        options: .choices(options.map { StyleChoice(label: $0.0, change: change($0.1), isPicked: $0.1 == picked) }))
    }
    var sections: [StyleSection] = []
    if showsStrokeColor {
      sections.append(
        StyleSection(title: "Stroke", options: .colors(Self.strokeColors, picked: strokeColor, property: .stroke)))
    }
    if showsBackgroundColor {
      sections.append(
        StyleSection(
          title: "Background", options: .colors(Self.backgroundColors, picked: backgroundColor, property: .background))
      )
    }
    if showsFillStyle {
      sections.append(
        choices(
          "Fill", [("Hachure", FillStyle.hachure), ("Cross-Hatch", .crossHatch), ("Solid", .solid)],
          picked: fillStyle, StyleChange.fillStyle))
    }
    if showsStrokeWidth {
      sections.append(
        choices(
          "Stroke Width", [("Thin", 1.0), ("Bold", 2.0), ("Extra Bold", 4.0)], picked: strokeWidth,
          StyleChange.strokeWidth))
    }
    if showsStrokeStyle {
      sections.append(
        choices(
          "Stroke Style", [("Solid", StrokeStyle.solid), ("Dashed", .dashed), ("Dotted", .dotted)],
          picked: strokeStyle, StyleChange.strokeStyle))
      sections.append(
        choices(
          "Sloppiness", [("Architect", 0.0), ("Artist", 1.0), ("Cartoonist", 2.0)], picked: roughness,
          StyleChange.roughness))
    }
    return sections
  }
}

/// One part of the style popover.
public struct StyleSection: Identifiable, Sendable {
  public enum Options: Sendable {
    /// Swatches of `colors`, and a picker for any other colour.
    case colors([String], picked: String?, property: ColorProperty)
    case choices([StyleChoice])
  }

  public let title: String
  public let options: Options
  public var id: String { title }
}

/// One of a section's choices, and the change picking it makes.
public struct StyleChoice: Identifiable, Sendable {
  public let label: String
  public let change: StyleChange
  public let isPicked: Bool
  public var id: String { label }
}

/// The colour a colour section sets.
public enum ColorProperty: Sendable {
  case stroke, background

  public func change(_ color: String) -> StyleChange {
    switch self {
    case .stroke: .strokeColor(color)
    case .background: .backgroundColor(color)
    }
  }
}

private func hasStrokeColor(_ type: ElementType?) -> Bool {
  switch type {
  case .image, .frame, .magicframe: false
  case .rectangle, .diamond, .ellipse, .line, .arrow, .freedraw, .text, .iframe, .embeddable, nil: true
  }
}

private func hasBackground(_ type: ElementType?) -> Bool {
  switch type {
  case .rectangle, .iframe, .embeddable, .ellipse, .diamond, .line, .freedraw: true
  case .arrow, .text, .image, .frame, .magicframe, nil: false
  }
}

private func hasStrokeWidth(_ type: ElementType?) -> Bool {
  switch type {
  case .rectangle, .iframe, .embeddable, .ellipse, .diamond, .freedraw, .arrow, .line: true
  case .text, .image, .frame, .magicframe, nil: false
  }
}

private func hasStrokeStyle(_ type: ElementType?) -> Bool {
  switch type {
  case .rectangle, .iframe, .embeddable, .ellipse, .diamond, .arrow, .line: true
  case .freedraw, .text, .image, .frame, .magicframe, nil: false
  }
}

extension DrawingEditor {
  /// `getTargetElements`: the text being written, or what is selected with
  /// the labels its shapes hold.
  private func styleTargets(includingLabels: Bool) -> [RawElement] {
    if let editing, let text = element(editing.id) { return [text] }
    return store.filter { element in
      !element.isDeleted
        && (selectedIds.contains(element.id)
          || (includingLabels && element.type == .text
            && element["containerId"]?.stringValue.map(selectedIds.contains) == true))
    }
  }

  public var styleControls: StyleControls {
    let targets = styleTargets(includingLabels: true)
    let types = Set(targets.map(\.type))
    let tool = self.tool.elementType
    var controls = StyleControls()
    let commonType = types.count == 1 ? types.first : nil
    controls.showsStrokeColor =
      (hasStrokeColor(tool) && commonType.map { hasStrokeColor($0) } != false)
      || types.contains(where: hasStrokeColor)
    controls.showsBackgroundColor = hasBackground(tool) || types.contains(where: hasBackground)
    controls.showsFillStyle =
      (hasBackground(tool) && !isTransparentColor(style.backgroundColor))
      || targets.contains {
        hasBackground($0.type) && !isTransparentColor($0["backgroundColor"]?.stringValue ?? "transparent")
      }
    controls.showsStrokeWidth = hasStrokeWidth(tool) || types.contains(where: hasStrokeWidth)
    controls.showsStrokeStyle = hasStrokeStyle(tool) || types.contains(where: hasStrokeStyle)

    // `getFormValue`: the value the selection shares, or what the tool draws with.
    let shown = editing == nil ? styleTargets(includingLabels: false) : targets
    func common(_ key: String, _ relevant: (ElementType?) -> Bool = { _ in true }) -> JSONValue?? {
      let values = Set(shown.filter { relevant($0.type) }.compactMap { $0[key] })
      guard !shown.isEmpty else { return .some(nil) }
      return values.count == 1 ? .some(values.first) : nil
    }
    controls.strokeColor = common("strokeColor").map { $0?.stringValue ?? style.strokeColor } ?? nil
    controls.backgroundColor = common("backgroundColor").map { $0?.stringValue ?? style.backgroundColor } ?? nil
    controls.fillStyle =
      common("fillStyle", hasBackground).map { $0?.stringValue.map(FillStyle.init) ?? style.fillStyle } ?? nil
    controls.strokeWidth = common("strokeWidth", hasStrokeWidth).map { $0?.numberValue ?? style.strokeWidth } ?? nil
    controls.strokeStyle =
      common("strokeStyle").map { $0?.stringValue.map(StrokeStyle.init) ?? style.strokeStyle } ?? nil
    controls.roughness = common("roughness", hasStrokeStyle).map { $0?.numberValue ?? style.roughness } ?? nil
    return controls
  }

  /// `changeProperty` with each style action: the selection, or the text
  /// being written, takes the style, and so does what is drawn next. A
  /// stroke colour colours the labels in shapes too, and new sloppiness
  /// comes with a new seed.
  public func changeStyle(_ change: StyleChange) {
    guard gesture == nil else { return }
    var includingLabels = false
    switch change {
    case .strokeColor(let color):
      style.strokeColor = color
      includingLabels = true
    case .backgroundColor(let color): style.backgroundColor = color
    case .fillStyle(let fill): style.fillStyle = fill
    case .strokeWidth(let width): style.strokeWidth = width
    case .strokeStyle(let stroke): style.strokeStyle = stroke
    case .roughness(let roughness): style.roughness = roughness
    }
    let targets = Set(styleTargets(includingLabels: includingLabels).map(\.id))
    for position in store.indices where targets.contains(store[position].id) {
      let updates: RawElement
      switch change {
      case .strokeColor(let color):
        guard hasStrokeColor(store[position].type) else { continue }
        updates = ["strokeColor": .string(color)]
      case .backgroundColor(let color): updates = ["backgroundColor": .string(color)]
      case .fillStyle(let fill): updates = ["fillStyle": .string(fill.rawValue)]
      case .strokeWidth(let width): updates = ["strokeWidth": .number(width)]
      case .strokeStyle(let stroke): updates = ["strokeStyle": .string(stroke.rawValue)]
      case .roughness(let roughness):
        updates = ["seed": .number(Double(environment.randomInteger())), "roughness": .number(roughness)]
      }
      environment.update(&store[position], updates)
    }
    capture()
  }
}
