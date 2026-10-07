extension Update {
  mutating func convertArticle(path: [Int], html: String) throws {
    let article = try pointNode(Point(path: path, offset: 0, type: .element))
    guard state[article].type == "article" else { throw EditorError.invalidState("The article changed") }
    var nodes: [NodeKey] = []
    for json in try HTMLImport.nodes(html) {
      let node = try parse(json)
      if ["collapsible-container", "collapsible-title", "collapsible-content"].contains(state[node].type) {
        nodes.append(contentsOf: state.children(of: node))
      } else { nodes.append(node) }
    }
    if nodes.isEmpty {
      let paragraph = try parse(["type": "paragraph", "version": 1, "children": []])
      try append(paragraph, [createText(WebArticlePlainText.convert(html))])
      nodes = [paragraph]
    }
    var pending = nodes
    while let node = pending.popLast() {
      guard state[node].isEditable else { throw EditorError.unsupported("Article HTML contains unsupported \(state[node].type) (#\(state[node].portingIssue ?? 134))") }
      pending.append(contentsOf: state.children(of: node))
    }
    let container = parents(of: article).first { state[$0].type == "collapsible-container" }
    let selection = selectNext(container ?? article)
    try insertNodes(selection, nodes)
    if let last = nodes.last, state[last].isElement { selectEnd(last) }
    try remove(article)
  }
}
