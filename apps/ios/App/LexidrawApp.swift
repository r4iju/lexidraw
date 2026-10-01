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
