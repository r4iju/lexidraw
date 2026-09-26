import LexidrawKit
import SwiftUI

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
  @State private var signOutFailure: String?

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Button("Sign Out") { Task { await signOut() } }
        }
        Section {
          NavigationLink("Delete Account") { DeleteAccountView() }
            .foregroundStyle(.red)
        } footer: {
          Text("Remove your account and everything that is yours, for good.")
        }
      }
      .navigationTitle("Settings")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") { dismiss() }
        }
      }
      .alert("Couldn’t sign out", message: $signOutFailure)
    }
  }

  private func signOut() async {
    guard case .signedIn(let session) = model.state else { return }
    do {
      if try await session.signOut() == .stillValidOnServer {
        model.notice =
          "Lexidraw couldn’t confirm with the server that this \(UIDevice.current.model)’s token was revoked. Revoke it under API tokens in Settings on the web."
      }
      model.state = .signedOut
    } catch {
      signOutFailure = "The token couldn’t be removed from this \(UIDevice.current.model): \(error.localizedDescription)"
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
        ProgressView().frame(maxWidth: .infinity)
      case .unanswered(let reason):
        Section {
          Button("Try Again") { Task { await load() } }
        } footer: {
          Text("Couldn’t ask the server what confirms it: \(reason)")
        }
      case .confirming(let confirmation), .deleting(let confirmation), .refused(let confirmation, _):
        Section {
          TextField("Confirmation", text: $typed)
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
          Button("Delete Account", role: .destructive) { Task { await delete(confirmation) } }
            .disabled(!confirmation.isConfirmed(by: typed) || isDeleting)
        }
      }
    }
    .navigationTitle("Delete Account")
    .navigationBarTitleDisplayMode(.inline)
    .alert("Couldn’t delete your account. Try again.", message: refusal)
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
      phase = .confirming(try await session.deletionConfirmation())
    } catch is CancellationError {
      return
    } catch {
      phase = .unanswered(error.localizedDescription)
    }
  }

  private func delete(_ confirmation: DeletionConfirmation) async {
    guard case .signedIn(let session) = model.state else { return }
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
