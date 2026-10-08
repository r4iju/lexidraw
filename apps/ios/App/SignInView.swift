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
    ScrollViewReader { scroll in
      ScrollView {
        VStack(alignment: .leading, spacing: 28) {
          Image(systemName: "square.and.pencil")
            .font(.system(size: 48, weight: .light))
            .foregroundStyle(.tint)
            .frame(width: 104, height: 104)
            .background(.tint.opacity(0.08), in: .rect(cornerRadius: 28))
            .accessibilityHidden(true)
          VStack(alignment: .leading, spacing: 12) {
            Text("Lexidraw")
              .font(.title3.weight(.semibold))
              .foregroundStyle(.secondary)
            Text("A place for your ideas")
              .font(.largeTitle.bold())
              .accessibilityAddTraits(.isHeader)
            Text("Your documents and drawings, together. Pick up where you left off and explore what’s shared with you.")
              .font(.title3)
              .foregroundStyle(.secondary)
          }
          if let failure {
            VStack(alignment: .leading, spacing: 8) {
              Label("Couldn’t sign in", systemImage: "exclamationmark.circle")
                .font(.headline)
                .foregroundStyle(.red)
              Text(failure).foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .contain)
            .id("sign-in-failure")
          }
        }
        .frame(maxWidth: 520, alignment: .leading)
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.horizontal, 28)
        .padding(.vertical, 40)
      }
      .onChange(of: failure) { _, failure in
        if failure != nil { scroll.scrollTo("sign-in-failure", anchor: .top) }
      }
    }
    .safeAreaInset(edge: .bottom) {
      VStack(spacing: 12) {
        Button {
          Task { await signIn() }
        } label: {
          Group {
            if signingIn {
              ProgressView("Signing in…")
            } else {
              Text("Sign In")
            }
          }
          .frame(maxWidth: .infinity, minHeight: 28)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .disabled(signingIn)
        Text("You’ll continue in a secure browser window.")
          .font(.footnote)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
      }
      .frame(maxWidth: 520)
      .padding(.horizontal, 28)
      .padding(.vertical, 16)
      .frame(maxWidth: .infinity)
      .background(.background)
    }
    .alert("Signed out", message: $model.notice)
  }

  private func signIn() async {
    guard !signingIn else { return }
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
      failure = "The sign-in expired or couldn’t be approved. Please try again."
    } catch SignInError.noCode {
      failure = "The browser didn’t complete sign-in. Please try again."
    } catch {
      failure = "Sign-in couldn’t be completed on this device. Check your connection and try again."
    }
  }
}
