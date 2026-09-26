import Foundation

/// A style picked in the style controls.
public enum StyleChange: Equatable, Sendable {
  case strokeColor(String)
  case backgroundColor(String)
  case fillStyle(FillStyle)
  case strokeWidth(Double)
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
  public var showsRoughness = false
  public var strokeColor: String?
  public var backgroundColor: String?
  public var fillStyle: FillStyle?
  public var strokeWidth: Double?
  public var roughness: Double?

  public init() {}
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
    controls.showsRoughness = hasStrokeStyle(tool) || types.contains(where: hasStrokeStyle)

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
      case .roughness(let roughness):
        updates = ["seed": .number(Double(environment.randomInteger())), "roughness": .number(roughness)]
      }
      environment.update(&store[position], updates)
    }
    capture()
  }
}
