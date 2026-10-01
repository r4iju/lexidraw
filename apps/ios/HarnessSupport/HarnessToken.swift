import LexidrawKit

/// Signed in, as far as a harness's screens can tell.
struct HarnessToken: TokenStore {
  func load() throws -> String? { "harness" }
  func save(_ token: String) throws {}
  func delete() throws {}
}
