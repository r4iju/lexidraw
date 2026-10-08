import LexidrawKit
import SwiftUI

extension View {
  /// Each pushed screen owns its toolbar items; a stack-level item is not
  /// inherited by its destinations.
  func phoneAccountControl() -> some View {
    toolbar {
      if UIDevice.current.userInterfaceIdiom == .phone {
        ToolbarItem(placement: .topBarTrailing) { SettingsButton() }
      }
    }
  }
}

struct SettingsButton: View {
  @State private var shown = false

  var body: some View {
    Button("Settings", systemImage: "person.crop.circle") { shown = true }
      .sheet(isPresented: $shown) { SettingsView() }
  }
}

private struct SettingsView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @State private var signOutFailure: String?
  @State private var signingOut = false
  @State private var deletingAccount = false
  private enum Identity {
    case loading
    case loaded(AccountIdentity)
    case failed
  }
  @State private var identity = Identity.loading

  var body: some View {
    NavigationStack {
      Form {
        Section {
          HStack(alignment: .top, spacing: 16) {
            if !dynamicTypeSize.isAccessibilitySize {
              Image(systemName: "person.crop.circle.fill")
                .font(.largeTitle)
                .foregroundStyle(.tint)
                .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 4) {
              Text(accountName)
                .font(.title3.weight(.semibold))
              if case .loaded(let details) = identity, let email = details.email, !email.isEmpty {
                Text(email)
                  .font(.subheadline)
                  .foregroundStyle(.secondary)
                  .textSelection(.enabled)
              }
              Text("Signed in on this \(UIDevice.current.model)")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            }
          }
          .padding(.vertical, 8)
          switch identity {
          case .loading:
            ProgressView("Loading account details…")
          case .failed:
            VStack(alignment: .leading, spacing: 8) {
              Text("Couldn’t load account details")
                .foregroundStyle(.secondary)
              Button("Try Again") { Task { await loadIdentity() } }
            }
          case .loaded: EmptyView()
          }
          Button {
            Task { await signOut() }
          } label: {
            if signingOut {
              ProgressView("Signing out…")
            } else {
              Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
            }
          }
        } header: {
          Text("Account")
        } footer: {
          Text("Sign out of this device. Your files and your sign-ins on other devices stay in your account.")
        }
        Section("Listening") {
          NavigationLink {
            ReadAloudInformationView()
          } label: {
            Label("Read Aloud", systemImage: "headphones")
          }
        }
        Section {
          NavigationLink {
            DeleteAccountView(deletingAccount: $deletingAccount)
          } label: {
            Label("Delete Account", systemImage: "person.crop.circle.badge.minus")
              .foregroundStyle(.red)
          }
        } header: {
          Text("Delete account permanently")
        } footer: {
          Text("Remove your account and all the files you own. This cannot be undone.")
        }
      }
      .disabled(signingOut || deletingAccount)
      .navigationTitle("Settings")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") { dismiss() }
            .disabled(signingOut || deletingAccount)
        }
      }
      .alert("Couldn’t sign out", message: $signOutFailure)
      .task { await loadIdentity() }
    }
    .interactiveDismissDisabled(signingOut || deletingAccount)
  }

  private var accountName: String {
    if case .loaded(let details) = identity, let name = details.name, !name.isEmpty { name }
    else { "Your account" }
  }

  private func loadIdentity() async {
    guard case .signedIn(let session) = model.state else { return }
    identity = .loading
    do {
      let details = try await session.accountIdentity()
      try Task.checkCancellation()
      identity = .loaded(details)
    } catch is CancellationError {
    } catch {
      identity = .failed
    }
  }

  private func signOut() async {
    guard !signingOut, case .signedIn(let session) = model.state else { return }
    signingOut = true
    defer { signingOut = false }
    do {
      if try await session.signOut() == .stillValidOnServer {
        model.notice =
          "Lexidraw couldn’t confirm with the server that this \(UIDevice.current.model)’s token was revoked. Revoke it under API tokens in Settings on the web."
      }
      model.state = .signedOut
    } catch {
      signOutFailure = "Your sign-in couldn’t be removed from this \(UIDevice.current.model). You’re still signed in here. Please try again.\n\n\(error.localizedDescription)"
    }
  }
}

/// What deleting the account removes, as Settings on the web says it, and a
/// typed confirmation the server checks again.
private struct DeleteAccountView: View {
  /// Asking the server what confirms it, then waiting for it to be typed.
  private enum Phase {
    case asking
    case unanswered(String)
    case confirming(DeletionConfirmation)
    case deleting(DeletionConfirmation)
    case refused(DeletionConfirmation, String)
  }

  @Environment(AppModel.self) private var model
  @State private var phase = Phase.asking
  @State private var typed = ""
  @FocusState private var confirmationFocused: Bool
  @Binding var deletingAccount: Bool

  var body: some View {
    Form {
      Section {
        Label(
          "Every file and folder you own, with the pictures, videos and audio in them. The people you shared them with can no longer open them.",
          systemImage: "doc.on.doc")
        Label("Your API tokens, and your sign-ins on every device.", systemImage: "key")
        Label(
          "Any linked sign-in, such as GitHub, your password and your settings.",
          systemImage: "person.badge.key")
      } header: {
        Text("What’s removed")
      } footer: {
        Text(
          "Files other people keep in your folders move to the top level of their own. Signing in again afterwards starts a new, empty account."
        )
      }
      switch phase {
      case .asking:
        Section {
          ProgressView("Checking confirmation…")
        }
      case .unanswered(let reason):
        Section {
          Label("Couldn’t load confirmation", systemImage: "exclamationmark.circle")
            .font(.headline)
          Text(reason).foregroundStyle(.secondary)
          Button("Try Again") { Task { await load() } }
        } footer: {
          Text("Your account has not been deleted. Connect and try again to continue.")
        }
      case .confirming(let confirmation), .deleting(let confirmation), .refused(let confirmation, _):
        Section {
          TextField("Confirmation", text: $typed, axis: .vertical)
            .focused($confirmationFocused)
            .submitLabel(.done)
            .onSubmit { confirmationFocused = false }
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .textContentType(.none)
            .accessibilityLabel("Type \(confirmation.expected) to confirm")
        } header: {
          Text("Type **\(confirmation.expected)** to confirm")
            .textCase(nil)
        } footer: {
          Text(
            "Your files, tokens and sign-ins are removed for good, for you and for everyone you shared with. You can’t undo this."
          )
        }
        Section {
          Button(role: .destructive) {
            Task { await delete(confirmation) }
          } label: {
            if isDeleting {
              ProgressView("Deleting account…")
            } else {
              Label("Delete Account", systemImage: "person.crop.circle.badge.minus")
            }
          }
          .disabled(!confirmation.isConfirmed(by: typed) || isDeleting)
        }
      }
    }
    .disabled(isDeleting)
    .navigationTitle("Delete Account")
    .navigationBarTitleDisplayMode(.inline)
    .navigationBarBackButtonHidden(isDeleting)
    .toolbar {
      ToolbarItemGroup(placement: .keyboard) {
        Spacer()
        Button("Hide keyboard", systemImage: "keyboard.chevron.compact.down") {
          confirmationFocused = false
        }
      }
    }
    .alert("Couldn’t delete your account", message: refusal)
    .task { await load() }
  }

  private var isDeleting: Bool {
    if case .deleting = phase { true } else { false }
  }

  private var refusal: Binding<String?> {
    Binding {
      if case .refused(_, let reason) = phase { reason } else { nil }
    } set: { reason in
      if reason == nil, case .refused(let confirmation, _) = phase { phase = .confirming(confirmation) }
    }
  }

  private func load() async {
    guard case .signedIn(let session) = model.state else { return }
    phase = .asking
    do {
      let confirmation = try await session.deletionConfirmation()
      try Task.checkCancellation()
      phase = .confirming(confirmation)
    } catch is CancellationError {
      return
    } catch {
      phase = .unanswered(error.localizedDescription)
    }
  }

  private func delete(_ confirmation: DeletionConfirmation) async {
    guard !isDeleting, confirmation.isConfirmed(by: typed), case .signedIn(let session) = model.state else { return }
    confirmationFocused = false
    deletingAccount = true
    defer { deletingAccount = false }
    phase = .deleting(confirmation)
    do {
      try await session.deleteAccount(confirmation: typed)
      model.notice = "Your account and everything that was yours are deleted."
      model.state = .signedOut
    } catch {
      phase = .refused(confirmation, error.localizedDescription)
    }
  }
}

private struct ReadAloudInformationView: View {
  var body: some View {
    Form {
      Section {
        Label("Read aloud with AI", systemImage: "waveform")
          .font(.headline)
        Text(ReadAloudDisclosure.explanation)
      } footer: {
        Text("Before generating audio, Lexidraw asks for your permission. Allowing it applies to the current browsing session. Opening this page does not grant permission.")
      }
      Section {
        Text("Choose Listen from a document or link’s actions menu. Existing audio can play without generating a new recording.")
      }
    }
    .navigationTitle("Read Aloud")
    .navigationBarTitleDisplayMode(.inline)
  }
}
