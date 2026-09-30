import Foundation

extension Update {
  mutating func clearFormatting(_ selection: RangeSelection) throws {
    let nodes = try nodes(in: selection)
    let extracted = try extract(selection)
    guard !selection.isCollapsed else { return }
    try clearFormatting(nodes, extracted: extracted, anchor: selection.anchor, focus: selection.focus)
  }

  mutating func clearFormatting(_ selection: TableSelection) throws {
    let nodes = try nodes(in: selection)
    guard selection.anchor != selection.focus else { return }
    try clearFormatting(nodes, extracted: nodes, anchor: nil, focus: nil)
  }

  private mutating func clearFormatting(_ nodes: [NodeKey], extracted: [NodeKey], anchor: SelectionPoint?, focus: SelectionPoint?) throws {
    for (index, original) in nodes.enumerated() {
      var node = original
      if state[node].isText {
        // The toolbar retains Point objects, not copied offsets. Replacing
        // a quote can mutate those points before restoring a cloned selection.
        let anchorOffset = anchor?.offset ?? 0
        if index == 0 && anchorOffset != 0 {
          let split = try splitText(node, at: [anchorOffset])
          node = split.count > 1 ? split[1] : node
        }
        if index == nodes.count - 1 {
          node = try splitText(node, at: [focus?.offset ?? 0]).first ?? node
        }
        if nodes.count == 1, let first = extracted.first, state[first].isText { node = first }
        if !style(of: node).isEmpty { setStyle(node, "") }
        if !format(of: node).isEmpty {
          setFormat(node, [])
          guard let block = findParent(from: node, where: isBlock), state[block].isElement else {
            throw EditorError.invalidState("Formatting has no enclosing block")
          }
          modifyElement(block) { $0.format = .empty }
        }
      } else if state[node].type == SerializedHeadingNode.type || state[node].type == SerializedQuoteNode.type {
        try replace(node, with: create(SerializedParagraphNode.type), includingChildren: true)
      } else if state[node].isDecorator, !state[node].isInline, state[node].payload.json["format"] != nil {
        var fields = state[node].payload.json.objectValue!
        fields["format"] = ""
        let payload = try SerializedNode(json: .object(fields))
        modify(node) { $0.payload = payload }
      }
    }
  }

  mutating func changeFontSize(_ selection: RangeSelection, increase: Bool) throws {
    let nodes = try nodes(in: selection)
    var patched: Set<NodeKey> = []
    if selection.isCollapsed {
      selection.style = resizedStyle(selection.style, increase: increase)
      selection.dirty = true
      let anchor = selection.anchor.key
      if state[anchor].isElement, isEmpty(anchor) {
        try setTextStyle(anchor, resizedStyle(textStyle(of: anchor), increase: increase))
        patched.insert(anchor)
      }
    }
    let range = try state.caretRange(from: selection)
    let slices = state.textSlices(range)
    let partial = [slices.0, slices.1].compactMap { $0 }
    for node in nodes where state[node].isText {
      let indices = partial.first { $0.origin == node }?.indices ?? 0..<state.textSize(of: node)
      guard !indices.isEmpty else { continue }
      let target: NodeKey
      if indices.lowerBound == 0 && indices.upperBound == state.textSize(of: node) { target = node }
      else {
        let split = try splitText(node, at: [indices.lowerBound, indices.upperBound])
        target = split[indices.lowerBound == 0 ? 0 : 1]
      }
      setStyle(target, resizedStyle(style(of: target), increase: increase))
    }
    for node in nodes where state[node].isElement && state[node].canBeEmpty && isEmpty(node) && !patched.contains(node) {
      try setTextStyle(node, resizedStyle(textStyle(of: node), increase: increase))
    }
    if selection.anchor.type == .text && selection.focus.type == .text && selection.anchor.key == selection.focus.key,
      try state.isBackward(selection) {
      let anchor = selection.anchor.value
      selection.anchor.set(selection.focus.value)
      selection.focus.set(anchor)
    }
  }

  mutating func changeFontSize(_ selection: TableSelection, increase: Bool) throws {
    try changeFontSizeOfNodes(nodes(in: selection), increase: increase)
  }

  mutating func changeFontSizeOfNodes(_ nodes: [NodeKey], increase: Bool) throws {
    for node in nodes {
      if state[node].isText {
        setStyle(node, resizedStyle(style(of: node), increase: increase))
      } else if state[node].isElement && state[node].canBeEmpty && isEmpty(node) {
        try setTextStyle(node, resizedStyle(textStyle(of: node), increase: increase))
      }
    }
  }

  private func resizedStyle(_ style: String, increase: Bool) -> String {
    var css = InlineCSS(style)
    let value = css["font-size"].map { String($0.dropLast(2)) }
    let current: Double
    if let value {
      let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
      if trimmed.isEmpty { current = 0 }
      else if trimmed.hasPrefix("0x") || trimmed.hasPrefix("0X"), let hex = UInt64(trimmed.dropFirst(2), radix: 16) { current = Double(hex) }
      else if trimmed.hasPrefix("0b") || trimmed.hasPrefix("0B"), let binary = UInt64(trimmed.dropFirst(2), radix: 2) { current = Double(binary) }
      else if trimmed.hasPrefix("0o") || trimmed.hasPrefix("0O"), let octal = UInt64(trimmed.dropFirst(2), radix: 8) { current = Double(octal) }
      else if trimmed == "Infinity" || trimmed == "+Infinity" { current = .infinity }
      else if trimmed == "-Infinity" { current = -.infinity }
      else if let number = Double(trimmed), number.isFinite || trimmed.contains("e") || trimmed.contains("E") {
        current = number
      } else { current = .nan }
    } else { current = WebFontSizing.defaultSize }
    let next = increase ? WebFontSizing.increment(current) : WebFontSizing.decrement(current)
    css["font-size"] = JSONValue.number(next).stringified + "px"
    return css.serialized
  }
}
