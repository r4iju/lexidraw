import LexidrawKit
import SwiftUI

struct AccountMenu: View {
  @Environment(AppModel.self) private var model
  @State private var signOutFailure: String?

  var body: some View {
    Menu {
      Button("Sign Out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
        Task { await signOut() }
      }
    } label: {
      Label("Account", systemImage: "person.crop.circle")
    }
    .alert("Couldn't sign out", message: $signOutFailure)
  }

  private func signOut() async {
    guard case .signedIn(let session) = model.state else { return }
    do {
      if try await session.signOut() == .stillValidOnServer {
        model.notice =
          "Lexidraw couldn't confirm with the server that this \(UIDevice.current.model)'s token was revoked. Revoke it under API tokens in Settings on the web."
      }
      model.state = .signedOut
    } catch {
      signOutFailure = "The token couldn't be removed from this \(UIDevice.current.model): \(error.localizedDescription)"
    }
  }
}
