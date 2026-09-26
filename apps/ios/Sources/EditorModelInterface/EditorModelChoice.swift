/// The two implementations of the editor model, for tests and harnesses that
/// run the same script on each. `LexicalReference` makes them.
public enum EditorModelChoice: String, CaseIterable, Sendable {
  case lexicalSwift
  case reference
}
