import LexicalFuzz
import LexicalSwift
import Testing

@Suite struct EditorStateTests {
  @Test func unknownNodesAndUnknownFieldsSurviveLoadThenSave() throws {
    // Lexical would drop the empty text, but a node nobody knows keeps what it holds.
    let future: JSONValue = [
      "type": "future-block", "version": 3, "shape": ["sides": [1, 2.5], "open": nil],
      "children": [text(""), ["type": "future-inline", "version": 1]],
    ]
    var withAddedField = paragraph(text("known"), ["type": "future-inline", "version": 1], text("node"))
    if case .object(var fields) = withAddedField {
      fields["addedLater"] = ["nested": [true, nil]]
      withAddedField = .object(fields)
    }
    var textWithAddedField = text("more")
    if case .object(var fields) = textWithAddedField {
      fields["reactions"] = ["👍🏽", 2]
      textWithAddedField = .object(fields)
    }
    let state = document(future, withAddedField, paragraph(textWithAddedField))
    let editor = Editor()

    try editor.load(state)

    #expect(try editor.snapshot().state == state)
  }

  @Test func saysWhetherItCanEditTheDocumentLoaded() throws {
    let model: any EditorModel = Editor()

    try model.load(
      LexicalJSON.document([
        LexicalJSON.paragraph([LexicalJSON.text("plain"), LexicalJSON.lineBreak, LexicalJSON.text("bold", format: .bold)])
      ]))
    #expect(model.isEditable)

    try model.load(
      LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("plain")]), LexicalJSON.youtube("dQw4w9WgXcQ")]))
    #expect(!model.isEditable)
  }

  /// The web's empty document, keyed on every node, and what the API and CLI
  /// write, keyed on the root.
  @Test(arguments: [
    #"{"root":{"children":[{"key":"1","type":"paragraph","version":1,"direction":"ltr","format":"","indent":0,"textFormat":0,"textStyle":"","children":[{"detail":0,"format":0,"mode":"normal","style":"","text":"","type":"text","version":1,"key":"initial-text-content-node"}]}],"direction":"ltr","format":"","indent":0,"type":"root","version":1,"key":"root"}}"#,
    #"{"root":{"children":[{"children":[{"detail":0,"format":0,"mode":"normal","style":"","text":"one","type":"text","version":1},{"type":"linebreak","version":1},{"detail":0,"format":1,"mode":"normal","style":"","text":"two","type":"text","version":1}],"direction":null,"format":"","indent":0,"type":"paragraph","version":1,"textFormat":0,"textStyle":""}],"direction":null,"format":"","indent":0,"type":"root","version":1,"key":"root"}}"#,
  ])
  func aStoredNodesKeyIsDroppedAsLexicalDropsIt(_ stored: String) throws {
    let state = try JSONValue(parsing: stored)
    let typing: [EditorCommand] = [.caret(Point(path: [0], offset: 0, type: .element)), .insertText("typed")]
    let fixture = try Fixture.record(start: state, commands: typing, on: try Support.referenceEditor())
    let editor = Editor()

    #expect(try fixture.replay(on: editor) == fixture.recorded)
    try editor.load(state)
    #expect(editor.isEditable)
  }

  /// Every node the web stores, and every one in the editors nested in them,
  /// with the key an editor gave it.
  @Test func aKeyIsDroppedWhereverLexicalDropsIt() throws {
    func keyed(_ json: JSONValue) -> JSONValue {
      switch json {
      case .object(var fields):
        fields = fields.mapValues(keyed)
        if fields["type"]?.stringValue != nil { fields["key"] = "7" }
        return .object(fields)
      case .array(let items): return .array(items.map(keyed))
      default: return json
      }
    }
    let state = keyed(SerializedNodeTests.everyNode)
    let reference = try Support.referenceEditor()
    try reference.load(state)
    let editor = Editor()
    try editor.load(state)

    #expect(try editor.snapshot().state == reference.snapshot().state)
  }

  /// A node nobody knows keeps what it holds but the keys of it and its
  /// children, which no editor saves.
  @Test func anUnknownNodeLosesItsKeyAndItsChildrensKeys() throws {
    let data: JSONValue = ["key": "data, not a node's"]
    func future(key: Bool) -> JSONValue {
      var child = paragraph(text("inside"))
      var node: JSONObject = ["type": "future-block", "version": 1, "data": data]
      if key, case .object(var fields) = child {
        fields["key"] = "2"
        child = .object(fields)
        node["key"] = "1"
      }
      node["children"] = [child]
      return .object(node)
    }
    let editor = Editor()

    try editor.load(document(future(key: true)))

    #expect(try editor.snapshot().state == document(future(key: false)))
  }

  /// Typing keeps every earlier state, as undo does, so a copy of the whole
  /// document per update would show here as time growing with its size.
  @Test func anUpdateCostsTheSameInABigDocumentAsInASmallOne() throws {
    func typingInto(nodes: Int) throws -> () throws -> Duration {
      let paragraphs = nodes / 5
      let editor = Editor()
      try editor.load(
        LexicalJSON.document(
          (0..<paragraphs).map { _ in
            LexicalJSON.paragraph([
              LexicalJSON.text("plain "), LexicalJSON.text("bold", format: .bold), LexicalJSON.text(" and "),
              LexicalJSON.text("italic", format: .italic),
            ])
          }))
      try editor.apply(.caret(.text([paragraphs / 2, 2], 3)))
      var kept: [EditorState] = []
      return {
        try ContinuousClock().measure {
          for _ in 0..<100 {
            try editor.apply(.insertText("a"))
            kept.append(editor.state)
          }
        }
      }
    }

    let typeSmall = try typingInto(nodes: 1_000)
    let typeBig = try typingInto(nodes: 9_000)
    // Alternating the two puts a busy machine's slowdowns on both sides.
    var small = try typeSmall()
    var big = try typeBig()
    for _ in 1..<5 {
      small = min(small, try typeSmall())
      big = min(big, try typeBig())
    }

    #expect(big < small * 2, "1k nodes: \(small), 9k nodes: \(big)")
  }
}
