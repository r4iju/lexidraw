import LexidrawKit
import SwiftUI

@main
struct LexidrawApp: App {
  @State private var model = AppModel()

  var body: some Scene {
    WindowGroup {
      Group {
        switch model.state {
        case .signedOut:
          NavigationStack { SignInView() }
        case .signedIn(let session):
          BrowserView(session: session)
        }
      }
      .environment(model)
    }
  }
}

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

  init() {
    account = Account.configured()
    state = (try? account.restore()).flatMap { $0 }.map(State.signedIn) ?? .signedOut
  }
}
