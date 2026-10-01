import LexidrawKit
import SwiftUI

@MainActor @Observable
final class AppModel {
  enum State {
    case signedOut
    case signedIn(Session)
  }

  let account: Account
  var state: State
  /// Said once on the sign-in screen, after a sign-out that needs a word.
  var notice: String?

  init(account: Account = .configured()) {
    self.account = account
    state = (try? account.restore()).flatMap { $0 }.map(State.signedIn) ?? .signedOut
  }
}
