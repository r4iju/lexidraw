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
      .alert("Couldn't sign out", message: $signOutFailure)
    }
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

/// What deleting the account removes, as Settings on the web says it, and a
/// typed confirmation the server checks again.
private struct DeleteAccountView: View {
  @Environment(AppModel.self) private var model
  @State private var confirmation: DeletionConfirmation?
  @State private var typed = ""
  @State private var confirming = false
  @State private var deleting = false
  @State private var failure: String?
  @State private var loadFailure: String?

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
      if let confirmation {
        Section {
          TextField("Confirmation", text: $typed)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .textContentType(.none)
            .accessibilityLabel("Type \(confirmation.expected) to confirm")
        } header: {
          Text("Type **\(confirmation.expected)** to confirm")
            .textCase(nil)
        }
        Section {
          Button("Delete Account", role: .destructive) { confirming = true }
            .disabled(!confirmation.isConfirmed(by: typed) || deleting)
        }
      } else if let loadFailure {
        Section {
          Button("Try Again") { Task { await load() } }
        } footer: {
          Text("Couldn’t ask the server what confirms it: \(loadFailure)")
        }
      } else {
        ProgressView().frame(maxWidth: .infinity)
      }
    }
    .navigationTitle("Delete Account")
    .navigationBarTitleDisplayMode(.inline)
    .confirmationDialog("Delete your account?", isPresented: $confirming, titleVisibility: .visible) {
      Button("Delete Account", role: .destructive) { Task { await delete() } }
    } message: {
      Text(
        "Your files, tokens and sign-ins are removed for good, for you and for everyone you shared with. You can’t undo this."
      )
    }
    .alert("Couldn’t delete your account. Try again.", message: $failure)
    .task { await load() }
  }

  private func load() async {
    guard case .signedIn(let session) = model.state else { return }
    do {
      confirmation = try await session.deletionConfirmation()
      loadFailure = nil
    } catch is CancellationError {
      return
    } catch {
      loadFailure = error.localizedDescription
    }
  }

  private func delete() async {
    guard case .signedIn(let session) = model.state else { return }
    deleting = true
    defer { deleting = false }
    do {
      try await session.deleteAccount(confirmation: typed)
      model.notice = "Your account and everything that was yours are deleted."
      model.state = .signedOut
    } catch {
      failure = error.localizedDescription
    }
  }
}
