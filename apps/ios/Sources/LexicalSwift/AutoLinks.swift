import JavaScriptCore
import Synchronization

/// `registerAutoLink`'s `TextNode` transform, ported from lexical@0.51.0 with
/// the web editor's matchers, and the default separators.
extension Update {
  mutating func transformAutoLinkText(_ key: NodeKey) throws {
    guard let parent = state.parent(of: key) else { throw EditorError.invalidState("Expected node to have a parent") }
    let previous = state.previousSibling(of: key)
    if state[parent].isAutoLink {
      try handleLinkEdit(parent)
    } else if !state[parent].isLink {
      if state[key].isSimpleText,
        state[key].text.startsWithSeparator || !(previous.map { state[$0].isAutoLink } ?? false)
      {
        try handleLinkCreation(textNodesToMatch(key))
      }
      try handleBadNeighbors(key)
    }
  }

  /// `getTextNodesToMatch`: the text and the simple text after it, up to
  /// the first with whitespace.
  private func textNodesToMatch(_ key: NodeKey) -> [NodeKey] {
    var nodes = [key]
    var next = state.nextSibling(of: key)
    while let sibling = next, state[sibling].isText, state[sibling].isSimpleText {
      nodes.append(sibling)
      if state[sibling].text.utf16.contains(where: \.isJavaScriptWhitespace) { break }
      next = state.nextSibling(of: sibling)
    }
    return nodes
  }

  /// `$handleLinkCreation`.
  private mutating func handleLinkCreation(_ nodes: [NodeKey]) throws {
    for node in nodes {
      if let parent = state.parent(of: node), isLinkedAutoLink(parent) { return }
    }
    var currentNodes = nodes
    let initialText = Array(nodes.map { state[$0].text }.joined().utf16)
    var text = initialText[...]
    var invalidMatchEnd = 0
    while let match = WebLinks.firstMatch(in: String(decoding: text, as: UTF16.self)) {
      let matchStart = match.index
      let matchEnd = matchStart + match.length
      let isValid = isContentAroundValid(
        invalidMatchEnd + matchStart, invalidMatchEnd + matchEnd, initialText, currentNodes)
      if isValid {
        let (matchingOffset, matchingNodes, afterNodes) = extractMatchingNodes(
          currentNodes, invalidMatchEnd + matchStart, invalidMatchEnd + matchEnd)
        if matchingNodes.contains(where: { state.parent(of: $0).map(isLinkedAutoLink) ?? false }) {
          invalidMatchEnd += matchEnd
          text = text.dropFirst(matchEnd)
          continue
        }
        let remaining = try createAutoLink(
          matchingNodes, invalidMatchEnd + matchStart - matchingOffset, invalidMatchEnd + matchEnd - matchingOffset,
          match)
        currentNodes = remaining.map { [$0] + afterNodes } ?? afterNodes
        invalidMatchEnd = 0
      } else {
        invalidMatchEnd += matchEnd
      }
      text = text.dropFirst(matchEnd)
    }
  }

  private func isLinkedAutoLink(_ key: NodeKey) -> Bool {
    guard case .autoLink(let link) = state[key].payload else { return false }
    return !(link.isUnlinked ?? false)
  }

  /// `isContentAroundIsValid`, which reads `text` at offsets that can be past
  /// its end once a link is made, as JavaScript reads `undefined` there.
  private func isContentAroundValid(_ matchStart: Int, _ matchEnd: Int, _ text: [UTF16.CodeUnit], _ nodes: [NodeKey])
    -> Bool
  {
    let unit = { (index: Int) in text.indices.contains(index) && text[index].isSeparator }
    let isBeforeValid = matchStart > 0 ? unit(matchStart - 1) : isPreviousNodeValid(nodes[0])
    guard isBeforeValid else { return false }
    return matchEnd < text.count ? unit(matchEnd) : isNextNodeValid(nodes[nodes.count - 1])
  }

  /// `extractMatchingNodes`, without the nodes before the match, which no
  /// caller reads.
  private func extractMatchingNodes(_ nodes: [NodeKey], _ startIndex: Int, _ endIndex: Int)
    -> (offset: Int, matching: [NodeKey], after: [NodeKey])
  {
    var matching: [NodeKey] = []
    var after: [NodeKey] = []
    var matchingOffset = 0
    var offset = 0
    for node in nodes {
      let length = state.textSize(of: node)
      if offset + length <= startIndex {
        matchingOffset += length
      } else if offset >= endIndex {
        after.append(node)
      } else {
        matching.append(node)
      }
      offset += length
    }
    return (matchingOffset, matching, after)
  }

  /// `$createAutoLinkNode_`: the match's text goes into a new autolink, and
  /// the text after it, if any, is what's left to match.
  private mutating func createAutoLink(_ nodes: [NodeKey], _ startIndex: Int, _ endIndex: Int, _ match: WebLinks.Match)
    throws -> NodeKey?
  {
    let link = create(SerializedAutoLinkNode.type)
    modifyLink(link) { $0.url = match.url }
    if nodes.count == 1 {
      let split = try splitText(nodes[0], at: startIndex == 0 ? [endIndex] : [startIndex, endIndex])
      let (linkText, remaining) = startIndex == 0 ? (split[0], split.dropFirst().first) : (split[1], split.dropFirst(2).first)
      try append(link, [copyText(match.text, like: linkText)])
      try replace(linkText, with: link)
      return remaining
    }
    guard let firstText = nodes.first else {
      throw EditorError.invalidState("No text matched, so Lexical has none to link")
    }
    var offset = state.textSize(of: firstText)
    let firstLinkText = startIndex == 0 ? firstText : try splitText(firstText, at: [startIndex])[1]
    var linkNodes: [NodeKey] = []
    var remaining: NodeKey?
    for node in nodes.dropFirst() {
      let length = state.textSize(of: node)
      if offset < endIndex {
        if offset + length <= endIndex {
          linkNodes.append(node)
        } else {
          let split = try splitText(node, at: [endIndex - offset])
          linkNodes.append(split[0])
          remaining = split[1]
        }
      }
      offset += length
    }
    let selection = self.selection
    let selectedText = try selection.flatMap { try self.nodes(in: $0).first { state[$0].isText } }
    let text = copyText(state[firstLinkText].text, like: firstLinkText)
    try append(link, [text] + linkNodes)
    if let selection, selectedText == firstLinkText {
      selectText(text, selection.anchor.offset, selection.focus.offset)
    }
    try replace(firstLinkText, with: link)
    return remaining
  }

  /// New text with `text`, and the format, detail and style of `like`.
  private mutating func copyText(_ text: String, like: NodeKey) -> NodeKey {
    let key = createText(text, format: format(of: like), style: style(of: like))
    if case .text(var node) = state[key].payload, let detail = state[like].textNode?.detail, detail != 0 {
      node.detail = detail
      state.nodes[key]!.payload = .text(node)
    }
    return key
  }

  /// `handleLinkEdit`: an autolink whose text is no longer a whole match,
  /// or whose neighbours now run into it, goes.
  private mutating func handleLinkEdit(_ link: NodeKey) throws {
    let children = state.children(of: link)
    guard children.allSatisfy({ state[$0].isText && state[$0].isSimpleText }) else {
      return try replaceWithChildren(link)
    }
    let text = state.textContent(of: link)
    guard let match = WebLinks.firstMatch(in: text), match.text == text else { return try replaceWithChildren(link) }
    guard isPreviousNodeValid(link), isNextNodeValid(link) else { return try replaceWithChildren(link) }
    if url(of: link) != match.url {
      modifyLink(link) { $0.url = match.url }
    }
  }

  /// `handleBadNeighbors`: text typed against an autolink either extends
  /// its domain or ends it.
  private mutating func handleBadNeighbors(_ key: NodeKey) throws {
    let parent = state.parent(of: key)
    let previous = state.previousSibling(of: key)
    let next = state.nextSibling(of: key)
    let text = state[key].text
    if let parent, isLinkedAutoLink(parent) { return }
    if let previous, isLinkedAutoLink(previous), previous == state.previousSibling(of: key),
      state.parent(of: key) == state.parent(of: previous)
    {
      if !text.startsWithSeparator {
        return try replaceWithChildren(previous)
      }
      if text.startsWithTopLevelDomain(isEmail: url(of: previous).hasPrefix("mailto:")) {
        let combined = state.textContent(of: previous) + text
        if let match = WebLinks.firstMatch(in: combined), match.text == combined {
          try append(previous, [key])
          try handleLinkEdit(previous)
        }
      }
    }
    if let next, isLinkedAutoLink(next), !text.endsWithSeparator, next == state.nextSibling(of: key),
      state.parent(of: key) == state.parent(of: next)
    {
      try replaceWithChildren(next)
    }
  }

  /// `replaceWithChildren` in the autolink extension.
  private mutating func replaceWithChildren(_ key: NodeKey) throws {
    for child in state.children(of: key).reversed() {
      try insert(child, after: key)
    }
    try remove(key)
  }

  /// `isPreviousNodeValid`: nothing, a line break, or text ending in a
  /// separator comes before.
  private func isPreviousNodeValid(_ key: NodeKey) -> Bool {
    var previous = state.previousSibling(of: key)
    if let element = previous, state[element].isElement { previous = lastDescendant(of: element) }
    guard let previous else { return true }
    return state[previous].isLineBreak || (state[previous].isText && state.textContent(of: previous).endsWithSeparator)
  }

  private func isNextNodeValid(_ key: NodeKey) -> Bool {
    var next = state.nextSibling(of: key)
    if let element = next, state[element].isElement { next = firstDescendant(of: element) }
    guard let next else { return true }
    return state[next].isLineBreak || (state[next].isText && state.textContent(of: next).startsWithSeparator)
  }

  func url(of link: NodeKey) -> String { linkFields(of: link).url ?? "" }
}

extension String {
  /// Whether the text starts with what the autolink extension's
  /// `PUNCTUATION_OR_SPACE` matches.
  fileprivate var startsWithSeparator: Bool { utf16.first?.isSeparator ?? false }

  fileprivate var endsWithSeparator: Bool { utf16.last?.isSeparator ?? false }

  /// `startsWithTLD`.
  fileprivate func startsWithTopLevelDomain(isEmail: Bool) -> Bool {
    guard utf16.first == 0x2E else { return false }
    let run = utf16.dropFirst().prefix { unit in
      (0x41...0x5A).contains(unit) || (0x61...0x7A).contains(unit) || (!isEmail && (0x30...0x39).contains(unit))
    }
    return run.count >= (isEmail ? 2 : 1)
  }
}

extension UTF16.CodeUnit {
  /// `/[.,;\s]/`.
  fileprivate var isSeparator: Bool {
    self == 0x2E || self == 0x2C || self == 0x3B || isJavaScriptWhitespace
  }

  /// JavaScript's `\s`.
  fileprivate var isJavaScriptWhitespace: Bool {
    switch self {
    case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: true
    default: false
    }
  }
}

/// The web editor's autolink matchers and `validateUrl`, run as the web runs
/// them: `linkConfigurationScript` is their code, bundled.
enum WebLinks {
  /// `LinkMatcherResult`, less the attributes none of the web's matchers
  /// give.
  struct Match {
    /// In UTF-16 code units.
    var index: Int
    var length: Int
    var text: String
    var url: String
  }

  /// `findFirstMatch` over the web's matchers.
  static func firstMatch(in text: String) -> Match? {
    configuration.withLock { configuration in
      let matchers = configuration.forProperty("matchers")!
      for index in 0..<Int(matchers.forProperty("length").toInt32()) {
        guard let result = matchers.atIndex(index).call(withArguments: [text]), result.isObject else { continue }
        return Match(
          index: Int(result.forProperty("index").toInt32()), length: Int(result.forProperty("length").toInt32()),
          text: result.forProperty("text").toString(), url: result.forProperty("url").toString())
      }
      return nil
    }
  }

  static func validateUrl(_ url: String) -> Bool {
    configuration.withLock { $0.forProperty("validateUrl").call(withArguments: [url]).toBool() }
  }

  private static let configuration = Mutex(
    {
      let context = JSContext()!
      context.evaluateScript(linkConfigurationScript)
      return context.objectForKeyedSubscript("linkConfiguration")!
    }()
  )
}
