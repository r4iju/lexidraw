import LexidrawKit
import SwiftUI

/// Save to Lexidraw: what was shared, the folder it goes into, and saving it.
struct ShareRoot: View {
  /// Nil when the app isn't signed in.
  let session: Session?
  let load: @MainActor () async -> Shared?
  let close: @MainActor () -> Void
  @State private var shared: Loaded = .loading

  enum Loaded {
    case loading, nothing
    case loaded(ShareSaving)
  }

  var body: some View {
    NavigationStack {
      Group {
        if session != nil, !shared.isSignedOut {
          switch shared {
          case .loading:
            ProgressView()
          case .nothing:
            ContentUnavailableView(
              "Nothing to Save", systemImage: "square.and.arrow.down",
              description: Text("Lexidraw saves web addresses, text and pictures."))
          case .loaded(let saving):
            SaveForm(saving: saving)
          }
        } else {
          ContentUnavailableView(
            "Not Signed In", systemImage: "person.crop.circle.badge.exclamationmark",
            description: Text("Open Lexidraw and sign in, then share again."))
        }
      }
      .navigationTitle("Save to Lexidraw")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        if session == nil || shared.isNothing || shared.isSignedOut {
          ToolbarItem(placement: .confirmationAction) {
            Button("Done", action: close)
          }
        }
      }
    }
    .task {
      guard let session else { return }
      shared = await load().map { .loaded(ShareSaving(session: session, shared: $0, close: close)) } ?? .nothing
    }
  }
}

extension ShareRoot.Loaded {
  fileprivate var isNothing: Bool {
    if case .nothing = self { true } else { false }
  }

  @MainActor fileprivate var isSignedOut: Bool {
    if case .loaded(let saving) = self { saving.step == .signedOut } else { false }
  }
}

private struct SaveForm: View {
  @Bindable var saving: ShareSaving
  @State private var choosingFolder = false

  var body: some View {
    Form {
      Section {
        SharedSummary(shared: saving.shared)
      }
      Section {
        Button {
          choosingFolder = true
        } label: {
          LabeledContent("Folder") {
            Label(saving.folder?.title ?? "Home", systemImage: saving.folder == nil ? "house" : "folder")
          }
        }
        .tint(.primary)
      }
      switch saving.step {
      case .choosing:
        EmptyView()
      case .saving(let what):
        Section {
          LabeledContent(what) { ProgressView() }
        }
      case .refused(let message):
        Section {
          Text(message).foregroundStyle(.secondary)
        }
      case .partly(let title, let message):
        Section {
          VStack(alignment: .leading, spacing: 4) {
            Text(title)
            Text(message).font(.footnote).foregroundStyle(.secondary)
          }
        }
      case .signedOut:
        EmptyView()
      }
    }
    .disabled(saving.isBusy)
    .sheet(isPresented: $choosingFolder) {
      FolderPicker(session: saving.session, chosen: $saving.folder)
    }
    .toolbar {
      if case .partly = saving.step {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done", action: saving.close)
        }
      } else {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel", action: saving.close)
        }
        ToolbarItem(placement: .confirmationAction) {
          Button(saving.isRefused ? "Try Again" : "Save") { Task { await saving.save() } }
            .disabled(saving.isBusy)
        }
      }
    }
  }
}

extension ShareSaving {
  fileprivate var isBusy: Bool {
    if case .saving = step { true } else { false }
  }

  fileprivate var isRefused: Bool {
    if case .refused = step { true } else { false }
  }
}

/// What will be saved, as it will show in Lexidraw.
private struct SharedSummary: View {
  let shared: Shared

  var body: some View {
    switch shared {
    case .link(let url):
      Label {
        VStack(alignment: .leading) {
          Text("Link")
          Text(url.absoluteString).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
        }
      } icon: {
        Image(systemName: "link")
      }
    case .document(let document):
      Label {
        VStack(alignment: .leading) {
          Text(document.title ?? "New document")
          if let detail = detail(body: document.body, images: document.images.count) {
            Text(detail).font(.footnote).foregroundStyle(.secondary).lineLimit(3)
          }
        }
      } icon: {
        Image(systemName: "doc.text")
      }
    }
  }

  private func detail(body: String, images: Int) -> String? {
    let pictures = images == 0 ? nil : images == 1 ? "1 picture" : "\(images) pictures"
    return [body.isEmpty ? nil : body, pictures].compactMap(\.self).joined(separator: "\n").nilIfEmpty
  }
}

extension String {
  fileprivate var nilIfEmpty: String? { isEmpty ? nil : self }
}

/// Picks a folder by browsing from Home, offering only the ones a new file
/// may go into.
private struct FolderPicker: View {
  let session: Session
  @Binding var chosen: Place.Folder?

  var body: some View {
    NavigationStack {
      FolderLevel(session: session, folder: nil, chosen: $chosen)
        .navigationDestination(for: Entry.self) { folder in
          FolderLevel(session: session, folder: folder, chosen: $chosen)
        }
    }
  }
}

private struct FolderLevel: View {
  let session: Session
  let folder: Entry?
  @Binding var chosen: Place.Folder?
  @Environment(\.dismiss) private var dismiss
  @State private var folders: [Entry]?
  @State private var failure: String?

  var body: some View {
    List {
      Section {
        ForEach(folders ?? []) { child in
          NavigationLink(value: child) {
            Label(child.title, systemImage: "folder")
          }
        }
      } footer: {
        if let folder, !mayHoldNewFiles {
          Text("You can only view “\(folder.title)”, so nothing can be saved into it.")
        }
      }
    }
    .overlay {
      if let failure {
        ContentUnavailableView(
          "Couldn’t Load the Folders", systemImage: "wifi.exclamationmark", description: Text(failure))
      } else if folders == nil {
        ProgressView()
      }
    }
    .navigationTitle(folder?.title ?? "Home")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .cancellationAction) {
        Button("Cancel") { dismiss() }
      }
      ToolbarItem(placement: .confirmationAction) {
        Button("Choose") {
          chosen = folder.map { Place.Folder(id: $0.id, title: $0.title) }
          dismiss()
        }
        .disabled(!mayHoldNewFiles)
      }
    }
    .task {
      do {
        folders = try await session.folders(in: folder?.id)
      } catch {
        failure = error.localizedDescription
      }
    }
  }

  /// As the server decides it: anyone may save at Home, and into a folder
  /// only who may edit it.
  private var mayHoldNewFiles: Bool { folder.map { $0.access >= .edit } ?? true }
}
