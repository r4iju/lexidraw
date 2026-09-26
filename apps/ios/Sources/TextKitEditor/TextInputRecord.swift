import Foundation

/// One call a keyboard's input method made on the editor, and the text it
/// left the view showing. The editor reports these as they happen, so a
/// harness can record what a keyboard sends and what the view did with it.
public struct TextInputRecord: Codable, Equatable, Sendable {
  public var call: Call
  /// The view's whole text after the call, the newline ending the last
  /// block included.
  public var text: String
  /// The text being composed, in UTF-16 offsets into `text`.
  public var marked: NSRange?

  public init(call: Call, text: String, marked: NSRange?) {
    self.call = call
    self.text = text
    self.marked = marked
  }

  public enum Call: Equatable, Sendable {
    /// Text being composed, with the selection inside it.
    case setMarkedText(String, selectedRange: NSRange)
    /// The composed text, committed as it stands.
    case unmarkText
    case insertText(String)
    case deleteBackward
  }
}

extension TextInputRecord.Call: Codable {
  private enum CodingKeys: String, CodingKey {
    case name, text, selectedRange
  }

  private enum Name: String, Codable {
    case setMarkedText, unmarkText, insertText, deleteBackward
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(Name.self, forKey: .name) {
    case .setMarkedText:
      self = .setMarkedText(
        try container.decode(String.self, forKey: .text),
        selectedRange: try container.decode(NSRange.self, forKey: .selectedRange))
    case .unmarkText: self = .unmarkText
    case .insertText: self = .insertText(try container.decode(String.self, forKey: .text))
    case .deleteBackward: self = .deleteBackward
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .setMarkedText(let text, let selectedRange):
      try container.encode(Name.setMarkedText, forKey: .name)
      try container.encode(text, forKey: .text)
      try container.encode(selectedRange, forKey: .selectedRange)
    case .unmarkText:
      try container.encode(Name.unmarkText, forKey: .name)
    case .insertText(let text):
      try container.encode(Name.insertText, forKey: .name)
      try container.encode(text, forKey: .text)
    case .deleteBackward:
      try container.encode(Name.deleteBackward, forKey: .name)
    }
  }
}
