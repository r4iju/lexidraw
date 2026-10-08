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
  private(set) var restoring: Set<String> = []

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

  private var homeTitle: String { UIDevice.current.userInterfaceIdiom == .phone ? "Library" : "Home" }

  /// Into `folder`, or to the top of Home when it is nil.
  func move(_ entry: Entry, to folder: Entry?) async {
    step = nil
    do {
      try await session.move(entry.id, to: folder?.id)
      finish("Moved “\(entry.title)” to \(folder.map { "“\($0.title)”" } ?? homeTitle).")
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
    guard restoring.insert(entry.id).inserted else { return }
    defer { restoring.remove(entry.id) }
    do {
      switch try await session.restore(entry.id) {
      case .itsFolder: finish("Restored “\(entry.title)” to its folder.")
      case .home: finish("Restored “\(entry.title)” to \(homeTitle).")
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
  /// or a long press, and through a visible menu.
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
  @Environment(\.dynamicTypeSize) private var typeSize

  func body(content: Content) -> some View {
    HStack(alignment: typeSize.isAccessibilitySize ? .top : .center, spacing: 8) {
      content
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity, alignment: .leading)
      Menu {
        FileMenuContents(entry: entry)
      } label: {
        Image(systemName: "ellipsis")
          .font(.body.weight(.semibold))
          .frame(width: 44, height: 44)
          .contentShape(.rect)
      }
      .buttonStyle(.borderless)
      .accessibilityLabel("Actions for \(entry.title)")
      .accessibilityHint("Share or organize this \(entry.kind.label.lowercased())")
    }
      .contextMenu { FileMenuContents(entry: entry) }
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

private struct FileMenuContents: View {
  let entry: Entry
  @Environment(FileActions.self) private var actions

  var body: some View {
    ListenButton(file: entry)
    ShareLink(item: actions.session.link(to: entry), subject: Text(entry.title)) {
      Label("Share Link…", systemImage: "square.and.arrow.up")
    }
    if entry.access.may(.rename) {
      Divider()
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
}

private struct FileActionPresenters: ViewModifier {
  @Bindable var actions: FileActions
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  func body(content: Content) -> some View {
    content
      .sheet(item: actions.item(\.renaming)) { entry in
        RenameSheet(entry: entry, actions: actions)
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
      .animation(reduceMotion ? nil : .default, value: actions.done)
  }
}

private struct RenameSheet: View {
  let entry: Entry
  @Bindable var actions: FileActions
  @FocusState private var naming: Bool

  private var valid: Bool {
    let title = actions.title.trimmingCharacters(in: .whitespacesAndNewlines)
    return !title.isEmpty && title != entry.title
  }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          FileRow(entry: entry)
        }
        Section("File name") {
          TextField("Title", text: $actions.title)
            .accessibilityLabel("Title")
            .autocorrectionDisabled()
            .focused($naming)
            .submitLabel(.done)
            .onSubmit(submit)
        }
      }
      .navigationTitle("Rename")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { actions.step = nil }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Rename", action: submit).disabled(!valid)
        }
      }
      .onAppear { naming = true }
    }
    .presentationDetents([.medium, .large])
  }

  private func submit() {
    guard valid, actions.renaming?.id == entry.id else { return }
    let title = actions.title
    actions.step = nil
    Task { await actions.rename(entry, to: title) }
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
      Section("Moving") {
        FileRow(entry: entry)
      }
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
      } header: {
        Text("Choose a destination")
      } footer: {
        if let note {
          Text(note)
        }
      }
    }
    .overlay(for: folders, what: "the folders", retry: load)
    .navigationTitle(folder?.title ?? homeTitle)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
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

  private var homeTitle: String { UIDevice.current.userInterfaceIdiom == .phone ? "Library" : "Home" }

  /// Why this folder can't take the file, and what to do instead.
  private var note: String? {
    guard let folder, !entry.mayMove(into: folder) else { return nil }
    return entry.access == .owner
      ? "You can only view “\(folder.title)”, so nothing can move into it."
      : "Someone else owns “\(entry.title)”, so it can go into a folder only where they can edit too. Move it to \(homeTitle), or ask them to move it."
  }

  private func load() async {
    if let loaded = await Loaded.from({ try await actions.folders(in: folder) }) { folders = loaded }
  }
}
