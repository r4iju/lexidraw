@preconcurrency import CLibxml2
import Foundation

/// libxml2 owns recovery, character references and encodings. No source HTML
/// reaches JavaScriptCore; only this inert tree of text and attributes does.
enum HTMLDOM {
  static func parse(_ html: String) throws -> JSONValue {
    let bytes = Array(html.utf8)
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
      return ["name": .string(string(raw.name)), "attributes": .object(attributes), "children": .array(children)]
    }
    guard let root = xmlDocGetRootElement(document), let tree = node(root) else {
      return ["name": "body", "children": []]
    }
    return ["name": "#document", "children": .array(recoverHeadings(tree))]
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
