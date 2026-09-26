import AuthenticationServices
import LexidrawKit
import SwiftUI

struct SignInView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.webAuthenticationSession) private var webAuthenticationSession
  @State private var signingIn = false
  @State private var failure: String?

  var body: some View {
    @Bindable var model = model
    VStack(spacing: 12) {
      Spacer()
      Text("Lexidraw")
        .font(.largeTitle.bold())
      Text("Your documents and drawings.")
        .foregroundStyle(.secondary)
      Spacer()
      if let failure {
        Text(failure)
          .foregroundStyle(.red)
          .multilineTextAlignment(.center)
      }
      Button {
        Task { await signIn() }
      } label: {
        Text("Sign In")
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(.borderedProminent)
      .controlSize(.large)
      .disabled(signingIn)
    }
    .padding()
    .alert("Signed out", message: $model.notice)
  }

  private func signIn() async {
    signingIn = true
    defer { signingIn = false }
    failure = nil
    let browser = webAuthenticationSession
    do {
      model.state = .signedIn(
        try await model.account.signIn(deviceName: UIDevice.current.model) { @MainActor url in
          try await browser.authenticate(
            using: url,
            callback: .customScheme("lexidraw"),
            // Shares the browser's cookies, so someone signed in to the web
            // there only has to approve.
            preferredBrowserSession: .shared,
            additionalHeaderFields: [:]
          )
        })
    } catch ASWebAuthenticationSessionError.canceledLogin {
      return
    } catch SignInError.refused {
      failure = "The sign-in didn’t go through. Please try again."
    } catch {
      failure = "Couldn’t sign in: \(error.localizedDescription)"
    }
  }
}
