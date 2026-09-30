import LexicalSwift

/// The spec's benchmark documents (#108): the same words and node counts as
/// the documents the earlier headless JS Lexical benchmark measured, built
/// the same way every time, so a measurement is repeatable without keeping a
/// real document. Sections of a heading and paragraphs, with lists, quotes,
/// tables and an embedded video among them, as a long Lexidraw document has.
public struct SyntheticDocument: Sendable, CustomStringConvertible {
  public let words: Int
  public let nodes: Int

  public static let small = SyntheticDocument(words: 11_500, nodes: 1_082)
  public static let large = SyntheticDocument(words: 115_000, nodes: 9_002)

  public var description: String { "\(words) words, \(nodes) nodes" }

  public var state: JSONValue { makeState(checkpointInput: false) }

  /// Media editing belongs to #131; input measurements use empty paragraphs
  /// in its place, preserving the original word and node counts.
  public var checkpointInputState: JSONValue { makeState(checkpointInput: true) }

  private func makeState(checkpointInput: Bool) -> JSONValue {
    var plan = Self.plan(nodes: nodes - 1)
    if checkpointInput {
      plan = plan.map { if case .video = $0 { .paragraph([]) } else { $0 } }
    }
    let fixed = plan.reduce(0) { $0 + $1.fixedWords }
    let flexible = plan.reduce(0) { $0 + $1.flexibleTexts }
    precondition(words - fixed >= flexible, "\(self) has too few words for its nodes")
    var share = Share(total: words - fixed, parts: flexible)
    var text = Words()
    for index in plan.indices { plan[index].shareWords(&share) }
    return LexicalJSON.document(plan.map { $0.json(&text) })
  }

  /// Blocks whose nodes add up to `nodes`: whole sections while one fits,
  /// then paragraphs of one text, then an embedded video for an odd one out.
  private static func plan(nodes: Int) -> [Block] {
    var blocks: [Block] = []
    var used = 0
    var section = 0
    while true {
      let next = Self.section(section)
      let cost = next.reduce(0) { $0 + $1.nodes }
      guard used + cost <= nodes else { break }
      blocks += next
      used += cost
      section += 1
    }
    while nodes - used >= 2 {
      blocks.append(.paragraph([.plain(0)]))
      used += 2
    }
    if used < nodes { blocks.append(.video) }
    return blocks
  }

  private static func section(_ index: Int) -> [Block] {
    var blocks: [Block] = [.heading(index % 2 == 0 ? "h2" : "h3")]
    for paragraph in 0..<5 {
      blocks.append(
        paragraph % 3 == 1
          ? .paragraph([.plain(0), .link, .plain(0)])
          : .paragraph([.plain(0), .bold, .plain(0)]))
      if paragraph == 2, index % 3 == 1 { blocks.append(.list(items: 3)) }
    }
    if index % 4 == 2 { blocks.append(.quote) }
    if index % 5 == 3 { blocks.append(.table(rows: 4, columns: 3)) }
    if index % 6 == 5 { blocks.append(.video) }
    return blocks
  }

  private enum Inline {
    /// Plain text with however many words the document has left to share.
    case plain(Int)
    case bold
    case link

    var nodes: Int { if case .link = self { 2 } else { 1 } }
    var fixedWords: Int {
      switch self {
      case .plain: 0
      case .bold: 3
      case .link: 2
      }
    }
  }

  private enum Block {
    case heading(String)
    case paragraph([Inline])
    case quote
    case list(items: Int)
    case table(rows: Int, columns: Int)
    case video

    static let headingWords = 5
    static let quoteWords = 16
    static let itemWords = 8
    static let cellWords = 2

    var nodes: Int {
      switch self {
      case .heading, .quote: 2
      case .paragraph(let inlines): 1 + inlines.reduce(0) { $0 + $1.nodes }
      case .list(let items): 1 + 2 * items
      case .table(let rows, let columns): 1 + rows + 3 * rows * columns
      case .video: 1
      }
    }

    var fixedWords: Int {
      switch self {
      case .heading: Self.headingWords
      case .paragraph(let inlines): inlines.reduce(0) { $0 + $1.fixedWords }
      case .quote: Self.quoteWords
      case .list(let items): items * Self.itemWords
      case .table(let rows, let columns): rows * columns * Self.cellWords
      case .video: 0
      }
    }

    var flexibleTexts: Int {
      guard case .paragraph(let inlines) = self else { return 0 }
      return inlines.filter { if case .plain = $0 { true } else { false } }.count
    }

    mutating func shareWords(_ share: inout Share) {
      guard case .paragraph(let inlines) = self else { return }
      self = .paragraph(inlines.map { if case .plain = $0 { .plain(share.next()) } else { $0 } })
    }

    func json(_ text: inout Words) -> JSONValue {
      switch self {
      case .heading(let tag):
        return LexicalJSON.element("heading", [LexicalJSON.text(text.sentence(Self.headingWords, period: false))], ["tag": .string(tag)])
      case .paragraph(let inlines):
        var children: [JSONValue] = []
        for (index, inline) in inlines.enumerated() {
          // A space between texts, so no word runs from one into the next.
          let before = index > 0 ? " " : ""
          let after = index < inlines.count - 1 ? " " : ""
          switch inline {
          case .plain(let count): children.append(LexicalJSON.text(before + text.sentence(count) + after))
          case .bold: children.append(LexicalJSON.text(text.sentence(3, period: false), format: .bold))
          case .link:
            children.append(
              LexicalJSON.element(
                "link", [LexicalJSON.text(text.sentence(2, period: false))],
                ["rel": nil, "target": nil, "title": nil, "url": "https://example.com/"]))
          }
        }
        return LexicalJSON.paragraph(children)
      case .quote:
        return LexicalJSON.element("quote", [LexicalJSON.text(text.sentence(Self.quoteWords))])
      case .list(let items):
        return LexicalJSON.element(
          "list",
          (1...items).map {
            LexicalJSON.element("listitem", [LexicalJSON.text(text.sentence(Self.itemWords))], ["value": .number(Double($0))])
          },
          ["listType": "bullet", "start": 1, "tag": "ul"])
      case .table(let rows, let columns):
        return LexicalJSON.table(
          (0..<rows).map { _ in (0..<columns).map { _ in text.sentence(Self.cellWords, period: false) } }, headerRow: true)
      case .video:
        return LexicalJSON.youtube("dQw4w9WgXcQ")
      }
    }
  }

  /// `total` split into `parts` as evenly as whole numbers allow.
  private struct Share {
    let total: Int
    let parts: Int
    var given = 0

    mutating func next() -> Int {
      defer { given += 1 }
      return total / parts + (given < total % parts ? 1 : 0)
    }
  }

  /// Words of varied length from a fixed seed, in sentences.
  private struct Words {
    private static let vocabulary = """
      the a of and to in is it that was for on are with as be at by this had not but from or have an they which \
      one you were all her she there would their we him been has when who will more no if out so said what up its \
      about into than them can only other new some could time these two may then do first any my now such like our \
      over man me even most made after also did many before must through back years where much your way well down \
      should because each just those people how too little state good very make world still own see men work long \
      get here between both life being under never day same another know while last might us great old year off \
      come since against go came right used take three document drawing paragraph heading selection keyboard \
      composition measurement viewport attachment reconciler transformation serialization
      """.split(separator: " ").map(String.init)

    private var state: UInt64 = 0x9E37_79B9_7F4A_7C15

    mutating func sentence(_ count: Int, period: Bool = true) -> String {
      guard count > 0 else { return "" }
      var words: [String] = []
      words.reserveCapacity(count)
      for index in 0..<count {
        var word = Self.vocabulary[Int(next() % UInt64(Self.vocabulary.count))]
        if index == 0 || words.last?.hasSuffix(".") == true { word = word.prefix(1).uppercased() + word.dropFirst() }
        if period, index == count - 1 || next() % 14 == 0 { word += "." }
        words.append(word)
      }
      return words.joined(separator: " ")
    }

    /// SplitMix64.
    private mutating func next() -> UInt64 {
      state &+= 0x9E37_79B9_7F4A_7C15
      var z = state
      z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
      z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
      return z ^ (z >> 31)
    }
  }
}
