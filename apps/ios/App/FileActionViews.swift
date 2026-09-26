import LexidrawKit
import SwiftUI

/// The file actions asked for from any listing and what came of them, one for
/// the whole browser, so a row only says which file.
@MainActor @Observable
final class FileActions {
  struct Failure {
    let title: String
    let message: String
  }

  /// What is being asked of someone, or why an action failed; one at a time.
  enum Step {
    case renaming(Entry)
    case moving(Entry)
    case deleting(Entry)
    case failed(Failure)
  }

  let session: Session
  private let browser: Browser
  var step: Step?
  /// The title being typed while renaming.
  var title = ""
  /// Said at the foot of the screen for a moment once an action is done.
  var done: String?

  init(session: Session, browser: Browser) {
    self.session = session
    self.browser = browser
  }

  var renaming: Entry? { if case .renaming(let entry) = step { entry } else { nil } }
  var moving: Entry? { if case .moving(let entry) = step { entry } else { nil } }
  var deleting: Entry? { if case .deleting(let entry) = step { entry } else { nil } }
  var failure: Failure? { if case .failed(let failure) = step { failure } else { nil } }

  /// What `shown` presents, for a presenter; dismissing it ends the step.
  func item<T>(_ shown: KeyPath<FileActions, T?>) -> Binding<T?> {
    Binding { self[keyPath: shown] } set: { value in
      if value == nil, self[keyPath: shown] != nil { self.step = nil }
    }
  }

  func presenting<T>(_ shown: KeyPath<FileActions, T?>) -> Binding<Bool> {
    Binding { self[keyPath: shown] != nil } set: { up in
      if !up { self.item(shown).wrappedValue = nil }
    }
  }

  /// Makes the file, then asks for its name straight away, as the Files app
  /// does with a new folder.
  func create(_ kind: Entry.Kind, in folder: Place.Folder?) async {
    do {
      let made = try await session.create(kind, in: folder?.id)
      browser.reload()
      startRenaming(made)
    } catch {
      fail("Couldn’t create it. Try again.", error)
    }
  }

  func startRenaming(_ entry: Entry) {
    title = entry.title
    step = .renaming(entry)
  }

  func rename(_ entry: Entry, to title: String) async {
    let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !title.isEmpty, title != entry.title else { return }
    do {
      try await session.rename(entry.id, to: title)
      finish("Renamed to “\(title)”.")
    } catch {
      fail("Couldn’t rename “\(entry.title)”. Try again.", error)
    }
  }

  /// The folders a file could move into, in `folder` or at the top of Home.
  func folders(in folder: Entry?) async throws -> [Entry] {
    try await session.folders(in: folder?.id)
  }

  /// Into `folder`, or to the top of Home when it is nil.
  func move(_ entry: Entry, to folder: Entry?) async {
    step = nil
    do {
      try await session.move(entry.id, to: folder?.id)
      finish("Moved “\(entry.title)” to \(folder.map { "“\($0.title)”" } ?? "Home").")
    } catch {
      fail("Couldn’t move “\(entry.title)”. Try again.", error)
    }
  }

  func delete(_ entry: Entry) async {
    do {
      try await session.moveToTrash(entry.id)
      finish("Deleted “\(entry.title)”.")
    } catch {
      fail("Couldn’t delete “\(entry.title)”. Try again.", error)
    }
  }

  func restore(_ entry: TrashedEntry) async {
    do {
      switch try await session.restore(entry.id) {
      case .itsFolder: finish("Restored “\(entry.title)” to its folder.")
      case .home: finish("Restored “\(entry.title)” to Home.")
      }
    } catch {
      fail("Couldn’t restore “\(entry.title)”. Try again.", error)
    }
  }

  private func finish(_ message: String) {
    done = message
    browser.reload()
  }

  private func fail(_ title: String, _ error: any Error) {
    step = .failed(Failure(title: title, message: error.localizedDescription))
  }
}

extension View {
  /// What may be done to `entry`, by the caller's access to it, from a swipe
  /// or a long press.
  func fileActions(for entry: Entry) -> some View {
    modifier(FileActionMenu(entry: entry))
  }

  /// The rename prompt, the move sheet, failures and the note that an action
  /// is done, for every listing below.
  func fileActionPresenters(_ actions: FileActions) -> some View {
    modifier(FileActionPresenters(actions: actions))
  }
}

private struct FileActionMenu: ViewModifier {
  let entry: Entry
  @Environment(FileActions.self) private var actions

  func body(content: Content) -> some View {
    content
      .contextMenu {
        ListenButton(file: entry)
        // Anyone who can see a file may send its address; the web decides
        // who it opens for.
        ShareLink(item: actions.session.link(to: entry), subject: Text(entry.title)) {
          Label("Share Link…", systemImage: "square.and.arrow.up")
        }
        Divider()
        if entry.access.may(.rename) {
          Button("Rename…", systemImage: "pencil") { actions.startRenaming(entry) }
        }
        if entry.access.may(.move) {
          Button("Move…", systemImage: "folder") { actions.step = .moving(entry) }
        }
        if entry.access.may(.delete) {
          Divider()
          Button("Delete…", systemImage: "trash", role: .destructive) { actions.step = .deleting(entry) }
        }
      }
      .swipeActions(edge: .leading) {
        if entry.access.may(.rename) {
          Button("Rename", systemImage: "pencil") { actions.startRenaming(entry) }
            .tint(.blue)
        }
      }
      .swipeActions(edge: .trailing) {
        // Not a destructive role: the row stays until the deletion is confirmed.
        if entry.access.may(.delete) {
          Button("Delete", systemImage: "trash") { actions.step = .deleting(entry) }
            .tint(.red)
        }
        if entry.access.may(.move) {
          Button("Move", systemImage: "folder") { actions.step = .moving(entry) }
            .tint(.indigo)
        }
      }
      .confirmationDialog(
        "Delete “\(entry.title)”?", isPresented: deleting, titleVisibility: .visible
      ) {
        Button("Delete", role: .destructive) { Task { await actions.delete(entry) } }
      } message: {
        Text("It’s removed for everyone it’s shared with. You can restore it from the Trash.")
      }
  }

  /// Only this row's dialog, of all the rows that have one.
  private var deleting: Binding<Bool> {
    Binding { actions.deleting?.id == entry.id } set: { up in
      if !up, actions.deleting?.id == entry.id { actions.step = nil }
    }
  }
}

private struct FileActionPresenters: ViewModifier {
  @Bindable var actions: FileActions

  func body(content: Content) -> some View {
    content
      .alert("Rename", isPresented: actions.presenting(\.renaming), presenting: actions.renaming) { entry in
        TextField("Title", text: $actions.title)
        Button("Cancel", role: .cancel) {}
        Button("Rename") {
          let title = actions.title
          Task { await actions.rename(entry, to: title) }
        }
      }
      .sheet(item: actions.item(\.moving)) { entry in
        MoveSheet(entry: entry)
      }
      .alert(
        actions.failure?.title ?? "", isPresented: actions.presenting(\.failure), presenting: actions.failure
      ) { _ in
        Button("OK") {}
      } message: { failure in
        Text(failure.message)
      }
      .overlay(alignment: .bottom) {
        if let done = actions.done {
          Text(done)
            .font(.subheadline)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(.regularMaterial, in: .capsule)
            .padding(.bottom, 24)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .task(id: done) {
              AccessibilityNotification.Announcement(done).post()
              try? await Task.sleep(for: .seconds(3))
              if actions.done == done { actions.done = nil }
            }
        }
      }
      .animation(.default, value: actions.done)
  }
}

/// Picks where a file goes by browsing the folders from Home, offering only
/// the places the server may take it.
private struct MoveSheet: View {
  let entry: Entry

  var body: some View {
    NavigationStack {
      Destinations(entry: entry, folder: nil)
        .navigationDestination(for: Entry.self) { folder in
          Destinations(entry: entry, folder: folder)
        }
    }
  }
}

private struct Destinations: View {
  let entry: Entry
  /// Nil for Home.
  let folder: Entry?
  @Environment(FileActions.self) private var actions
  @State private var folders: Loaded<[Entry]> = .loading

  var body: some View {
    List {
      Section {
        ForEach(folders.value ?? []) { candidate in
          // A folder cannot go inside itself, so its own contents are no destination.
          if candidate.id == entry.id {
            Label(candidate.title, systemImage: "folder")
              .foregroundStyle(.secondary)
          } else {
            NavigationLink(value: candidate) {
              Label(candidate.title, systemImage: "folder")
            }
          }
        }
      } footer: {
        if let note {
          Text(note)
        }
      }
    }
    .overlay(for: folders, what: "the folders", retry: load)
    .navigationTitle(folder?.title ?? "Home")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .principal) {
        VStack {
          Text(folder?.title ?? "Home").font(.headline)
          Text("Move “\(entry.title)”").font(.caption).foregroundStyle(.secondary)
        }
      }
      ToolbarItem(placement: .cancellationAction) {
        Button("Cancel") { actions.step = nil }
      }
      ToolbarItem(placement: .confirmationAction) {
        Button("Move Here") { Task { await actions.move(entry, to: folder) } }
          .disabled(!entry.mayMove(into: folder) || entry.parentId == folder?.id)
      }
    }
    .task { await load() }
  }

  /// Why this folder can't take the file, and what to do instead.
  private var note: String? {
    guard let folder, !entry.mayMove(into: folder) else { return nil }
    return entry.access == .owner
      ? "You can only view “\(folder.title)”, so nothing can move into it."
      : "Someone else owns “\(entry.title)”, so it can go into a folder only where they can edit too. Move it to Home, or ask them to move it."
  }

  private func load() async {
    if let loaded = await Loaded.from({ try await actions.folders(in: folder) }) { folders = loaded }
  }
}
