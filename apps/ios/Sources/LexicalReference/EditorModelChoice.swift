import Foundation
import LexicalSwift

extension EditorModelChoice {
  /// `referenceScript` is the bundle `bun run build:reference` writes, which
  /// only the reference reads.
  public func make(referenceScript: URL) throws -> any EditorModel {
    switch self {
    case .lexicalSwift: Editor()
    case .reference: try ReferenceEditor(scriptURL: referenceScript)
    }
  }
}
