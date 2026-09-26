import LexidrawKit
import SwiftUI

@main
struct LexidrawApp: App {
  @State private var model = AppModel()

  var body: some Scene {
    WindowGroup {
      NavigationStack {
        switch model.state {
        case .signedOut:
          SignInView()
        case .signedIn(let session):
          HomeView(session: session)
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
    let server = Bundle.main.object(forInfoDictionaryKey: "LexidrawServerURL") as? String
    account = Account(
      origin: URL(string: server ?? "")!,
      store: KeychainTokenStore(service: Bundle.main.bundleIdentifier!)
    )
    state = (try? account.restore()).flatMap { $0 }.map(State.signedIn) ?? .signedOut
  }
}
