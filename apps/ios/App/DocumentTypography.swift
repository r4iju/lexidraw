import Foundation
import LexidrawKit
import TextKitEditor

/// Resolves the actual family selected by the web's generated reading stack.
/// Downloaded families must identify themselves as that family in CoreText.
@MainActor func loadDocumentFont(_ settings: DocumentSettings, session: Session) async throws
  -> DocumentFont
{
  let families = try fontFamilies(settings.fontFamily)
  guard let family = families.first else { throw DocumentSettingsUnsupported("Empty font stack") }
  if let font = try? DocumentFont(family: family, cascade: Array(families.dropFirst())) {
    return font
  }
  // The web bundles Fredoka/Ubuntu Mono and names other saved CSS variables;
  // those families use the same public font provider when not installed here.
  var components = URLComponents()
  components.path = "/api/fonts"
  components.queryItems = [URLQueryItem(name: "family", value: family)]
  guard let resource = settings.fontResource ?? components.string else {
    throw DocumentSettingsUnsupported("Invalid font family")
  }
  let bytes = try await session.documentFontData(resource: resource)
  return try DocumentFont(family: family, data: bytes, cascade: Array(families.dropFirst()))
}

private func fontFamilies(_ stack: String) throws -> [String] {
  var result: [String] = []
  var name = ""
  var quote: Character?
  var escaped = false
  for character in stack {
    if escaped {
      name.append(character)
      escaped = false
      continue
    }
    if character == "\\" {
      escaped = true
      continue
    }
    if let current = quote {
      if character == current { quote = nil } else { name.append(character) }
    } else if character == "\"" || character == "'" {
      quote = character
    } else if character == "," {
      result.append(name.trimmingCharacters(in: .whitespacesAndNewlines))
      name = ""
    } else {
      name.append(character)
    }
  }
  guard quote == nil, !escaped else { throw DocumentSettingsUnsupported("Invalid font stack") }
  result.append(name.trimmingCharacters(in: .whitespacesAndNewlines))
  guard result.allSatisfy({ !$0.isEmpty && !$0.contains("(") && !$0.contains(")") }) else {
    throw DocumentSettingsUnsupported("Unported font stack")
  }
  return result
}
