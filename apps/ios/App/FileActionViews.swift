import LexidrawKit
import SwiftUI

/// The file actions asked for from any listing and what came of them, one for
/// the whole browser, so a row only says which file.
@MainActor @Observable
final class FileActions {
  struct Failure: Identifiable {
    let id = UUID()
    let title: String
    let message: String
  }

  let session: Session
  let browser: Browser
  var renaming: Entry?
  var title = ""
  var moving: Entry?
  var deleting: Entry?
  var failure: Failure?
  /// Said at the foot of the screen for a moment once an action is done.
  var done: String?

  init(session: Session, browser: Browser) {
    self.session = session
    self.browser = browser
  }

  /// Makes the file, then asks for its name straight away, as the Files app
  /// does with a new folder.
  func create(_ file: NewFile, in folder: Place.Folder?) async {
    do {
      let made = try await session.create(file, in: folder?.id)
      browser.reload()
      startRenaming(made)
    } catch {
      fail("Couldn’t create it. Try again.", error)
    }
  }

  func startRenaming(_ entry: Entry) {
    title = entry.title
    renaming = entry
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

  /// Into `folder`, or to the top of Home when it is nil.
  func move(_ entry: Entry, to folder: Entry?) async {
    moving = nil
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
    failure = Failure(title: title, message: error.localizedDescription)
  }
}

extension View {
  /// What may be done to `entry`, by the caller's access to it, from a swipe
  /// or a long press.
  func fileActions(for entry: Entry, movable: Bool = true) -> some View {
    modifier(FileActionMenu(entry: entry, movable: movable))
  }

  /// The rename prompt, the move sheet, failures and the note that an action
  /// is done, for every listing below.
  func fileActionPresenters(_ actions: FileActions) -> some View {
    modifier(FileActionPresenters(actions: actions))
  }
}

private struct FileActionMenu: ViewModifier {
  let entry: Entry
  let movable: Bool
  @Environment(FileActions.self) private var actions

  func body(content: Content) -> some View {
    content
      .contextMenu {
        if entry.access.may(.rename) {
          Button("Rename…", systemImage: "pencil") { actions.startRenaming(entry) }
        }
        if mayMove {
          Button("Move…", systemImage: "folder") { actions.moving = entry }
        }
        if entry.access.may(.delete) {
          Divider()
          Button("Delete…", systemImage: "trash", role: .destructive) { actions.deleting = entry }
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
          Button("Delete", systemImage: "trash") { actions.deleting = entry }
            .tint(.red)
        }
        if mayMove {
          Button("Move", systemImage: "folder") { actions.moving = entry }
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

  private var mayMove: Bool { movable && entry.access.may(.move) }

  private var deleting: Binding<Bool> {
    Binding {
      actions.deleting?.id == entry.id
    } set: { shown in
      if !shown { actions.deleting = nil }
    }
  }
}

private struct FileActionPresenters: ViewModifier {
  @Bindable var actions: FileActions

  func body(content: Content) -> some View {
    content
      .alert("Rename", isPresented: renaming, presenting: actions.renaming) { entry in
        TextField("Title", text: $actions.title)
        Button("Cancel", role: .cancel) {}
        Button("Rename") {
          let title = actions.title
          Task { await actions.rename(entry, to: title) }
        }
      }
      .sheet(item: $actions.moving) { entry in
        MoveSheet(entry: entry)
      }
      .alert(
        actions.failure?.title ?? "", isPresented: failing, presenting: actions.failure
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

  private var renaming: Binding<Bool> {
    Binding { actions.renaming != nil } set: { if !$0 { actions.renaming = nil } }
  }

  private var failing: Binding<Bool> {
    Binding { actions.failure != nil } set: { if !$0 { actions.failure = nil } }
  }
}

/// Picks where a file goes by browsing the folders from Home, offering only
/// the places the server would take it.
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
  @State private var folders: [Entry]?
  @State private var failure: String?

  var body: some View {
    List {
      Section {
        ForEach(folders ?? []) { candidate in
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
        if let folder, !entry.mayMove(into: folder) {
          Text(
            entry.access == .owner
              ? "You can only view “\(folder.title)”, so nothing can move into it."
              : "Only the owner of “\(entry.title)” can move it into a folder.")
        }
      }
    }
    .overlay {
      if let failure {
        ContentUnavailableView {
          Label("Couldn't load the folders", systemImage: "wifi.exclamationmark")
        } description: {
          Text(failure)
        } actions: {
          Button("Try Again") { Task { await load() } }
        }
      } else if folders == nil {
        ProgressView()
      }
    }
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
        Button("Cancel") { actions.moving = nil }
      }
      ToolbarItem(placement: .confirmationAction) {
        Button("Move Here") { Task { await actions.move(entry, to: folder) } }
          .disabled(!entry.mayMove(into: folder) || entry.parentId == folder?.id)
      }
    }
    .task { await load() }
  }

  private func load() async {
    do {
      folders = try await actions.session.folders(in: folder?.id)
      failure = nil
    } catch is CancellationError {
      return
    } catch {
      failure = error.localizedDescription
    }
  }
}
