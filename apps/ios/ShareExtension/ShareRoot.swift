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
    case loaded(Saving)
  }

  var body: some View {
    NavigationStack {
      Group {
        if let session {
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
        if session == nil || shared.isNothing {
          ToolbarItem(placement: .confirmationAction) {
            Button("Done", action: close)
          }
        }
      }
    }
    .task {
      guard let session else { return }
      shared = await load().map { .loaded(Saving(session: session, shared: $0, close: close)) } ?? .nothing
    }
  }
}

extension ShareRoot.Loaded {
  fileprivate var isNothing: Bool {
    if case .nothing = self { true } else { false }
  }
}

/// Saving what was shared, and what came of it.
@MainActor @Observable
final class Saving {
  enum Step {
    case choosing
    case saving(String)
    /// Nothing was saved, so it can be tried again.
    case refused(String)
    /// The link was saved, but its page wasn't read.
    case partly(title: String, message: String)
  }

  let session: Session
  let shared: Shared
  let close: @MainActor () -> Void
  /// Nil for Home.
  var folder: Place.Folder?
  var step = Step.choosing

  init(session: Session, shared: Shared, close: @escaping @MainActor () -> Void) {
    self.session = session
    self.shared = shared
    self.close = close
  }

  func save() async {
    step = .saving("Saving…")
    switch shared {
    case .link(let url):
      let link: Entry
      do {
        link = try await session.saveLink(url, in: folder?.id)
      } catch {
        step = .refused("Couldn’t save the link. \(error.localizedDescription)")
        return
      }
      step = .saving("Reading the page…")
      do {
        _ = try await session.distill(link.id)
        close()
      } catch {
        step = .partly(title: "Saved the link, but couldn’t read the page.", message: error.localizedDescription)
      }
    case .document(let document):
      do {
        _ = try await session.saveDocument(document, in: folder?.id)
        close()
      } catch {
        step = .refused("Couldn’t save it. \(error.localizedDescription)")
      }
    }
  }
}

private struct SaveForm: View {
  @Bindable var saving: Saving
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

extension Saving {
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
  /// Nil for Home.
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
