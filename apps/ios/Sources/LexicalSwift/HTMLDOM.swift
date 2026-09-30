@preconcurrency import CLibxml2
import Foundation

/// libxml2 owns recovery, character references and encodings. No source HTML
/// reaches JavaScriptCore; only this inert tree of text and attributes does.
enum HTMLDOM {
  static func parse(_ html: String) throws -> JSONValue {
    let (protected, qualifiedNames) = protectQualifiedNames(html)
    let bytes = Array(protected.utf8)
    guard bytes.count <= Int(Int32.max) else { throw EditorError.invalidState("HTML clipboard too large") }
    let document = bytes.withUnsafeBytes { buffer in
      htmlReadMemory(buffer.baseAddress?.assumingMemoryBound(to: CChar.self), Int32(bytes.count), nil, "UTF-8",
        Int32(HTML_PARSE_RECOVER.rawValue | HTML_PARSE_NOERROR.rawValue | HTML_PARSE_NOWARNING.rawValue | HTML_PARSE_NONET.rawValue))
    }
    guard let document else { return ["name": "body", "children": []] }
    defer { xmlFreeDoc(document) }
    func string(_ pointer: UnsafePointer<xmlChar>?) -> String {
      guard let pointer else { return "" }
      return String(cString: pointer)
    }
    func node(_ pointer: xmlNodePtr) -> JSONValue? {
      let raw = pointer.pointee
      if raw.type == XML_TEXT_NODE || raw.type == XML_CDATA_SECTION_NODE {
        return ["name": "#text", "text": .string(string(raw.content))]
      }
      guard raw.type == XML_ELEMENT_NODE else { return nil }
      var attributes: JSONObject = [:]
      var attribute = raw.properties
      while let current = attribute {
        let value = xmlNodeListGetString(document, current.pointee.children, 1)
        attributes[string(current.pointee.name)] = .string(string(value))
        if let value { xmlFree(value) }
        attribute = current.pointee.next
      }
      var children: [JSONValue] = []
      var child = raw.children
      while let current = child {
        if let value = node(current) { children.append(value) }
        child = current.pointee.next
      }
      let name = string(raw.name)
      return ["name": .string(qualifiedNames[name] ?? name), "attributes": .object(attributes), "children": .array(children)]
    }
    guard let root = xmlDocGetRootElement(document), let tree = node(root) else {
      return ["name": "body", "children": []]
    }
    return ["name": "#document", "children": .array(recoverHeadings(tree))]
  }
  /// libxml2 drops HTML tag prefixes (`o:p` becomes `p`). Browsers keep these
  /// as unknown elements, so protect their names without changing their contents.
  private static func protectQualifiedNames(_ html: String) -> (String, [String: String]) {
    let bytes = Array(html.utf8)
    let marker = "lexidraw-" + UUID().uuidString.lowercased() + "-"
    var names: [String: String] = [:]
    var protectedNames: [String: String] = [:]
    var replacements: [(Range<Int>, [UInt8])] = []
    var rawText: String?
    var foreign: [(name: String, namespace: String, htmlChildren: Bool)] = []
    var index = 0
    func letter(_ byte: UInt8) -> Bool { (65...90).contains(byte) || (97...122).contains(byte) }
    func nameByte(_ byte: UInt8) -> Bool {
      ![9, 10, 12, 13, 32, 47, 62].contains(byte)
    }
    while index < bytes.count {
      guard bytes[index] == 60 else { index += 1; continue }
      if let rawText, ["textarea", "title"].contains(rawText) {
        let closing = Array("</\(rawText)".utf8)
        let after = index + closing.count
        let matches = after < bytes.count && zip(bytes[index..<after], closing).allSatisfy { source, target in
          (65...90).contains(source) ? source + 32 == target : source == target
        } && !nameByte(bytes[after])
        if !matches {
          replacements.append((index..<(index + 1), Array("&lt;".utf8)))
          index += 1
          continue
        }
      }
      if rawText == nil, bytes[index...].starts(with: Array("<!--".utf8)) {
        index += 4
        while index < bytes.count, !bytes[index...].starts(with: Array("-->".utf8)) { index += 1 }
        index = min(index + 3, bytes.count)
        continue
      }
      var start = index + 1
      let closing = start < bytes.count && bytes[start] == 47
      if closing { start += 1 }
      guard start < bytes.count, letter(bytes[start]) else { index += 1; continue }
      var end = start + 1
      while end < bytes.count, nameByte(bytes[end]) { end += 1 }
      let name = String(decoding: bytes[start..<end], as: UTF8.self).lowercased()
      let completeName = end < bytes.count
      if let rawText, !(closing && name == rawText && completeName) {
        index += 1
        continue
      }
      var tagEnd = end
      // Quotes start quoted values only after an equals sign; quotes within
      // unquoted values remain literal HTML parse errors.
      enum AttributeState { case before, name, afterName, beforeValue, unquoted, quoted(UInt8), afterValue }
      var attributeState = AttributeState.before
      while tagEnd < bytes.count {
        let byte = bytes[tagEnd]
        let space = [9, 10, 12, 13, 32].contains(byte)
        if case .quoted(let quote) = attributeState {
          if byte == quote { attributeState = .afterValue }
        } else {
          if byte == 62 { break }
          switch attributeState {
          case .beforeValue:
            if byte == 34 || byte == 39 { attributeState = .quoted(byte) }
            else if !space { attributeState = .unquoted }
          case .unquoted:
            if space { attributeState = .before }
          case .name, .afterName:
            if byte == 61 { attributeState = .beforeValue }
            else if space { attributeState = .afterName }
            else if byte == 47 { attributeState = .before }
            else { attributeState = .name }
          case .before, .afterValue:
            if !space && byte != 47 { attributeState = .name }
          case .quoted: break
          }
        }
        tagEnd += 1
      }
      let selfClosing = tagEnd > end && tagEnd < bytes.count && bytes[tagEnd - 1] == 47
      let foreignBreakout: Set<String> = ["b", "big", "blockquote", "body", "br", "center", "code", "dd", "div", "dl", "dt", "em", "embed", "h1", "h2", "h3", "h4", "h5", "h6", "head", "hr", "i", "img", "li", "listing", "menu", "meta", "nobr", "ol", "p", "pre", "ruby", "s", "small", "span", "strong", "strike", "sub", "sup", "table", "tt", "u", "ul", "var"]
      if !closing, foreign.last?.htmlChildren == false, foreignBreakout.contains(name) {
        while foreign.last?.htmlChildren == false { foreign.removeLast() }
      }
      let inForeign = !foreign.isEmpty && foreign.last?.htmlChildren == false
      let startsForeign = name == "svg" || name == "math"
      if !closing, startsForeign || inForeign || !foreign.isEmpty {
        let namespace = startsForeign ? name : (inForeign ? foreign.last!.namespace : "html")
        let integration = namespace == "svg" && ["title", "desc", "foreignobject"].contains(name)
          || namespace == "math" && ["mi", "mo", "mn", "ms", "mtext"].contains(name)
        let void = namespace == "html" && ["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"].contains(name)
        if !void && !(selfClosing && namespace != "html") {
          // Foreign integration points admit HTML children without making the
          // SVG title itself an HTML RCDATA element. Track HTML descendants too
          // so a nested HTML title's end tag cannot close the outer SVG title.
          foreign.append((name, namespace, namespace == "html" || integration))
        }
      } else if closing, let matched = foreign.lastIndex(where: { $0.name == name }) {
        foreign.removeSubrange(matched...)
      }
      if name.contains(":") {
        let protectedName = protectedNames[name] ?? marker + String(names.count)
        protectedNames[name] = protectedName
        names[protectedName] = name
        replacements.append((start..<end, Array(protectedName.utf8)))
      }
      if closing { rawText = nil }
      else if !inForeign, !startsForeign, completeName, ["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "plaintext"].contains(name) {
        rawText = name
        if ["textarea", "title"].contains(name), tagEnd > end, tagEnd < bytes.count, bytes[tagEnd - 1] == 47 {
          // HTML ignores a self-closing flag on an RCDATA start tag.
          replacements.append(((tagEnd - 1)..<tagEnd, []))
        }
        if name == "plaintext" { break }
      }
      index = min(tagEnd + 1, bytes.count)
    }
    var output: [UInt8] = []
    var copied = 0
    for (range, replacement) in replacements {
      output.append(contentsOf: bytes[copied..<range.lowerBound])
      output.append(contentsOf: replacement)
      copied = range.upperBound
    }
    output.append(contentsOf: bytes[copied...])
    return (String(decoding: output, as: UTF8.self), names)
  }
  /// HTML5 closes an open heading on the next heading start; libxml2's
  /// HTML4 recovery nests it when the preceding end tag names another level.
  private static func recoverHeadings(_ tree: JSONValue) -> [JSONValue] {
    guard case .object(var node) = tree, let rawChildren = node["children"]?.arrayValue else { return [tree] }
    let children = rawChildren.flatMap(recoverHeadings)
    func isHeading(_ node: JSONValue) -> Bool {
      guard let name = node["name"]?.stringValue, name.count == 2, name.first == "h",
        let level = Int(name.dropFirst()) else { return false }
      return (1...6).contains(level)
    }
    guard isHeading(tree), let firstNested = children.firstIndex(where: isHeading) else {
      node["children"] = .array(children)
      return [.object(node)]
    }
    node["children"] = .array(Array(children[..<firstNested]))
    return [.object(node)] + children[firstNested...]
  }

}
