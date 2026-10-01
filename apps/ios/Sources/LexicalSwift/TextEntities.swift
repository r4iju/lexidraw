import EditorModelInterface

extension Update {
  private mutating func createTextEntity(_ type: String) throws -> NodeKey {
    guard let json = WebTextEntities.defaults[type] else { throw EditorError.invalidState("Unknown text entity constructor") }
    return create(SerializedNode(json: try JSONValue(parsing: json)).asLoaded(), type: type, children: nil)
  }
  mutating func transformNestedTextEntities(_ key: NodeKey) throws {
    for plugin in editorContext.mountedPlugins where state.isAttached(key) {
      switch plugin {
      case "EmojisPlugin": try transformEmoticon(key)
      case "HashtagPlugin": try transformTextEntity(key, type: "hashtag", pattern: WebTextEntities.hashtag, group: 3, prefixLength: 1)
      case "KeywordsPlugin": try transformTextEntity(key, type: "keyword", pattern: WebTextEntities.keyword, group: 2, prefixLength: 0)
      default: break
      }
    }
  }

  private func entityMatch(_ text: String, _ pattern: JSRegExp, _ group: Int, _ prefixLength: Int) -> (start: Int, end: Int)? {
    guard let result = pattern.firstMatch(in: text), result.groups.count > group,
      let boundary = result.groups[1], let body = result.groups[group] else { return nil }
    let start = result.index + boundary.utf16.count
    return (start, start + body.utf16.count + prefixLength)
  }

  private mutating func replaceEntityWithText(_ key: NodeKey) throws {
    let text = createText(state[key].text, format: format(of: key), style: style(of: key))
    copyTextFields(from: key, to: text)
    try replace(key, with: text)
  }

  private mutating func copyTextFields(from source: NodeKey, to target: NodeKey) {
    guard let sourceFields = state[source].payload.textFields, var targetFields = state[target].payload.textFields else { return }
    targetFields.text = sourceFields.text
    targetFields.format = sourceFields.format
    targetFields.style = sourceFields.style
    targetFields.detail = sourceFields.detail
    modify(target) { $0.payload.textFields = targetFields }
  }

  /// `registerLexicalTextEntity`: sibling boundaries, repeated matches and
  /// reverse transforms follow the upstream registration, including selection.
  private mutating func transformTextEntity(_ key: NodeKey, type: String, pattern: JSRegExp, group: Int, prefixLength: Int) throws {
    if state[key].type == type {
      let text = state[key].text
      guard let match = entityMatch(text, pattern, group, prefixLength), match.start == 0 else {
        try replaceEntityWithText(key); return
      }
      if text.utf16.count > match.end { try splitText(key, at: [match.end]); return }
      if let previous = state.previousSibling(of: key), state[previous].isText, state[previous].isTextEntity {
        try replaceEntityWithText(previous)
        try replaceEntityWithText(key)
      }
      if let next = state.nextSibling(of: key), state[next].isText, state[next].isTextEntity {
        try replaceEntityWithText(next)
        if state.isAttached(key), state[key].type == type { try replaceEntityWithText(key) }
      }
      return
    }
    guard state[key].isSimpleText else { return }
    var previous = state.previousSibling(of: key)
    var text = state[key].text
    var current = key
    if let previousKey = previous, state[previousKey].isText {
      let previousText = state[previousKey].text
      let previousMatch = entityMatch(previousText + text, pattern, group, prefixLength)
      if state[previousKey].type == type {
        guard let previousMatch, state[previousKey].textMode == .normal else {
          try replaceEntityWithText(previousKey); return
        }
        let diff = previousMatch.end - previousText.utf16.count
        if diff > 0 {
          select(previousKey)
          try setText(previousKey, previousText + text.sliceUTF16(0, diff))
          if diff == text.utf16.count { try remove(key) }
          else { try setText(key, text.sliceUTF16(diff, text.utf16.count)) }
          return
        }
      } else if previousMatch == nil || previousMatch!.start < previousText.utf16.count { return }
    }
    var skipped = 0
    while true {
      let remaining = text
      let match = entityMatch(remaining, pattern, group, prefixLength)
      let nextText = match.map { remaining.sliceUTF16($0.end, remaining.utf16.count) } ?? ""
      text = nextText
      if nextText.isEmpty, let next = state.nextSibling(of: current), state[next].isText {
        let nextMatch = entityMatch(remaining + state[next].text, pattern, group, prefixLength)
        if nextMatch == nil {
          if state[next].type == type { try replaceEntityWithText(next) } else { markDirty(next) }
          return
        } else if match == nil || nextMatch!.start != match!.start { return }
      }
      guard let match else { return }
      if match.start == 0, let previous, state[previous].isText, state[previous].isTextEntity {
        skipped += match.end; continue
      }
      let parts = try splitText(current, at: match.start == 0 ? [match.end] : [match.start + skipped, match.end + skipped])
      let targetIndex = match.start == 0 ? 0 : 1
      guard parts.indices.contains(targetIndex) else { throw EditorError.invalidState("Text entity split omitted its match") }
      let target = parts[targetIndex]
      let replacement = try createTextEntity(type)
      copyTextFields(from: target, to: replacement)
      try replace(target, with: replacement)
      guard parts.indices.contains(targetIndex + 1) else { return }
      current = parts[targetIndex + 1]
      skipped = 0
      previous = replacement
    }
  }

  private mutating func transformEmoticon(_ key: NodeKey) throws {
    guard state[key].isSimpleText else { return }
    let text = state[key].text
    let units = Array(text.utf16)
    for offset in units.indices {
      let single = String(decoding: units[offset..<min(offset + 1, units.count)], as: UTF16.self)
      let pair = String(decoding: units[offset..<min(offset + 2, units.count)], as: UTF16.self)
      guard let emoji = WebTextEntities.emojis.first(where: {
        $0.0 == single || $0.0 == pair
      }) else { continue }
      let parts = try splitText(key, at: offset == 0 ? [offset + 2] : [offset, offset + 2])
      let target = parts[offset == 0 ? 0 : 1]
      let replacement = try createTextEntity("emoji")
      guard case .emoji(var payload) = state[replacement].payload else { return }
      payload.text = .string(emoji.2); payload.className = .string(emoji.1); payload.mode = .token
      modify(replacement) { $0.payload = .emoji(payload) }
      try replace(target, with: replacement)
      return
    }
  }
}

private extension String {
  func sliceUTF16(_ start: Int, _ end: Int) -> String {
    let units = Array(utf16)
    return String(decoding: units[min(start, units.count)..<min(end, units.count)], as: UTF16.self)
  }
}

private extension Node {
  var isTextEntity: Bool { ["hashtag", "keyword", "mention"].contains(type) }
}
