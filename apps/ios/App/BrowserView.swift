import LexidrawKit
import SwiftUI

/// File mutations and foreground refresh invalidate every destination without
/// sharing its navigation path or filters.
@MainActor @Observable
final class BrowserUpdates {
  var revision = 0
}

/// One destination’s root, folder path and filters. Its screens share this
/// context so the sidebar, breadcrumbs and listings agree.
@MainActor @Observable
final class Browser {
  enum Section: Hashable {
    case home, shared, trash, search
  }

  /// A destination root, or a folder selected from the sidebar. Listing
  /// navigation pushes onto `path`; each destination retains its own context.
  enum Root: Hashable {
    case section(Section)
    case folder(Place.Folder)
  }

  private(set) var root: Root
  private let updates: BrowserUpdates

  init(root: Root = .section(.home), updates: BrowserUpdates = BrowserUpdates()) {
    self.root = root
    self.updates = updates
  }

  enum Route: Hashable {
    case trash
    case folder(Place.Folder)
    case searchFile(SearchResult)
  }

  var path: [Route] = []
  var file: FileReference?
  /// Kept while moving between folders, as the web keeps its query string.
  var tags: Set<String> = []
  /// Bumped to have every screen load again, as when the app comes back.
  var reloads: Int { updates.revision }

  func reload() { updates.revision += 1 }

  func show(_ section: Section) {
    go(to: .section(section))
  }

  func open(_ folder: Place.Folder) {
    go(to: .folder(folder))
  }

  func go(to root: Root) {
    self.root = root
    path = []
  }

  /// Back to `folder` when it is on the way here, keeping the way back to
  /// it, or straight to it when not.
  func back(to folder: Place.Folder) {
    if let index = path.firstIndex(where: {
      if case .folder(let place) = $0 { place.id == folder.id } else { false }
    }) {
      path.removeSubrange((index + 1)...)
    } else if case .folder(let start) = root, start.id == folder.id {
      path = []
    } else if root == .section(.search) {
      path = [.folder(folder)]
    } else {
      open(folder)
    }
  }
}

struct BrowserView: View {
  let session: Session
  @State private var browser: Browser
  @State private var sharedBrowser: Browser
  @State private var search: FileSearch
  @State private var destination = Destination.library
  @State private var phoneSelection = Destination.library
  @State private var actions: FileActions
  @State private var listener: Listener
  @State private var column = NavigationSplitViewColumn.content
  @State private var columns = NavigationSplitViewVisibility.all
  @State private var fileNavigation = FileNavigation()
  @State private var navigationEpoch = 0
  @State private var away = false
  @Environment(\.scenePhase) private var scenePhase
  @Environment(\.dynamicTypeSize) private var typeSize

  init(session: Session) {
    self.session = session
    let updates = BrowserUpdates()
    let browser = Browser(updates: updates)
    _browser = State(initialValue: browser)
    _search = State(initialValue: FileSearch(session: session, updates: updates))
    _sharedBrowser = State(initialValue: Browser(root: .section(.shared), updates: updates))
    _actions = State(initialValue: FileActions(session: session, browser: browser))
    _listener = State(initialValue: Listener(session: session))
  }

  var body: some View {
    Group {
      if UIDevice.current.userInterfaceIdiom == .phone {
        phoneNavigation
      } else {
        NavigationSplitView(columnVisibility: $columns, preferredCompactColumn: $column) {
          Sidebar(session: session, destination: destination, select: select, openFolder: openFolder, openTrash: openTrash)
            .navigationSplitViewColumnWidth(min: typeSize.isAccessibilitySize ? 300 : 220, ideal: typeSize.isAccessibilitySize ? 340 : 250, max: 400)
        } content: {
          if destination == .search {
            searchStack
          } else {
            stack(for: activeBrowser)
              .navigationSplitViewColumnWidth(min: 320, ideal: 380, max: 460)
          }
        } detail: {
          NavigationStack {
            if let file = activeBrowser.file {
              FileDestination(file: file)
                .id(file.id)
                .toolbar {
                  ToolbarItem(placement: .topBarLeading) {
                    Button("Close file", systemImage: "xmark") {
                      fileNavigation.perform { activeBrowser.file = nil; column = .content }
                    }
                  }
                }
            } else {
              ContentUnavailableView("Choose a file", systemImage: "doc.text.magnifyingglass",
                description: Text("Browse Library, Shared, or Search to open a file here."))
            }
          }
        }
        .navigationSplitViewStyle(.balanced)
        .onGeometryChange(for: Bool.self) { $0.size.width >= 1100 } action: { wide in
          // Narrow tablet windows give their space to the listing and file;
          // the native sidebar toggle keeps destinations and folders available.
          columns = wide ? .all : .doubleColumn
        }
        .environment(\.fileNavigation, fileNavigation)
        .environment(\.openFile, { file in
          fileNavigation.perform { activeBrowser.file = FileReference(file); column = .detail }
        })
      }
    }
    .fileActionPresenters(actions)
    .nowPlayingBar(listener)
    .onDisappear { listener.stop() }
    .environment(browser)
    .onChange(of: browser.reloads) { search.run() }
    .environment(actions)
    .environment(\.session, session)
    // Changes made on the web while the app was away show on return.
    .onChange(of: scenePhase) { _, phase in
      switch phase {
      case .background: away = true
      case .active where away:
        away = false
        browser.reload()
      default: break
      }
    }
  }

  fileprivate enum Destination: Hashable {
    case library, shared, search
  }

  private func activate(_ destination: Destination) {
    navigationEpoch += 1
    search.select(active: destination == .search)
    self.destination = destination
    phoneSelection = destination
    column = activeBrowser.file == nil ? .content : .detail
  }

  private func select(_ destination: Destination) {
    let change = {
      if UIDevice.current.userInterfaceIdiom == .pad, self.destination == destination, destination == .library {
        browser.show(.home)
      }
      activate(destination)
    }
    fileNavigation.perform(change)
  }

  private var activeBrowser: Browser {
    switch destination {
    case .library: browser
    case .shared: sharedBrowser
    case .search: search.browser
    }
  }

  private func openTrash() {
    fileNavigation.perform {
      activate(.library)
      if browser.path.last != .trash { browser.path.append(.trash) }
      column = .content
    }
  }

  private func openFolder(_ folder: Place.Folder) {
    fileNavigation.perform {
      navigationEpoch += 1
      search.select(active: false)
      destination = .library
      browser.open(folder)
      column = .content
    }
  }

  private var phoneNavigation: some View {
    TabView(selection: Binding(get: { phoneSelection }, set: { requested in
      // SwiftUI updates its selected tab before an awaited save can finish.
      // Keep its binding explicit so failure restores the still-mounted editor.
      fileNavigation.perform({ activate(requested) }, completed: { _ in phoneSelection = destination })
      phoneSelection = requested
    })) {
      Tab("Library", systemImage: "books.vertical", value: .library) {
        stack(for: browser)
      }
      Tab("Shared", systemImage: "person.2", value: .shared) {
        stack(for: sharedBrowser)
      }
      Tab("Search", systemImage: "magnifyingglass", value: .search) {
        searchStack
      }
    }
    .environment(\.phoneDrawingNavigation, fileNavigation)
  }

  private var searchStack: some View {
    SearchStack(session: session, search: search) { result in
      let interaction = search.interactionID
      let path = search.browser.path
      let file = search.browser.file?.id
      let epoch = navigationEpoch
      let isCurrent = {
        search.active && search.interactionID == interaction && search.browser.path == path
          && search.browser.file?.id == file && navigationEpoch == epoch && !Task.isCancelled
      }
      let location: Destination
      if result.folder != nil {
        location = .library
      } else {
        // A private parent and the root both arrive as nil. Resolve only the
        // accessible listings, without disclosing private folder metadata.
        let root = try await session.listing(of: nil)
        if (root.files + root.folders).contains(where: { $0.id == result.id }) {
          location = .library
        } else {
          let shared = try await session.sharedWithMe()
          guard shared.contains(where: { $0.id == result.id }) else { throw RevealUnavailable() }
          location = .shared
        }
      }
      guard isCurrent() else { throw CancellationError() }
      var revealed = false
      let change = {
        // Saving can suspend after location resolution, so validate again at commit.
        guard isCurrent() else { return }
        revealed = true
        let context = location == .library ? browser : sharedBrowser
        context.tags = []
        context.show(location == .library ? .home : .shared)
        if let folder = result.folder { context.path = [.folder(folder)] }
        activate(location)
      }
      if UIDevice.current.userInterfaceIdiom == .pad {
        let saved = await fileNavigation.navigate(change)
        guard revealed || isCurrent() else { throw CancellationError() }
        guard saved else { throw SaveBeforeReveal() }
      } else { change() }
      guard revealed else { throw CancellationError() }
    }
  }

  private struct SaveBeforeReveal: LocalizedError {
    var errorDescription: String? { "Finish saving the open file or resolve its conflict, then reveal this result again." }
  }

  private struct RevealUnavailable: LocalizedError {
    var errorDescription: String? {
      "This file’s location is no longer available. Search again to refresh its location."
    }
  }

  private func stack(for context: Browser) -> some View {
    @Bindable var context = context
    let epoch = navigationEpoch
    let path = Binding { context.path } set: { path in
      guard UIDevice.current.userInterfaceIdiom == .phone || (activeBrowser === context && epoch == navigationEpoch) else { return }
      context.path = path
    }
    return NavigationStack(path: path) {
      Group {
        switch context.root {
        case .section(.home): FolderView(session: session, folder: nil)
        case .section(.shared): SharedView(session: session)
        case .section(.trash): TrashView(session: session)
        case .section(.search): EmptyView()
        case .folder(let folder): FolderView(session: session, folder: folder)
        }
      }
      .id(context.root)
      .navigationDestination(for: Browser.Route.self) { route in
        switch route {
        case .trash: TrashView(session: session)
        case .folder(let folder):
          FolderView(session: session, folder: folder).id(folder.id)
        case .searchFile(let result):
          FileDestination(file: result)
        }
      }
    }
    .environment(context)
  }
}

/// The sections, and the folder tree.
private struct Sidebar: View {
  let session: Session
  let destination: BrowserView.Destination
  let select: (BrowserView.Destination) -> Void
  let openFolder: (Place.Folder) -> Void
  let openTrash: () -> Void
  @Environment(Browser.self) private var browser
  @State private var folders = FolderList()

  var body: some View {
    List {
      Section {
        destinationButton("Library", symbol: "books.vertical", destination: .library)
        destinationButton("Shared", symbol: "person.2", destination: .shared)
        destinationButton("Search", symbol: "magnifyingglass", destination: .search)
      }
      Section("Folders") {
        FolderRows(list: folders, session: session, openFolder: openFolder)
      }
      Section {
        Button("Trash", systemImage: "trash", action: openTrash)
        SettingsButton().keyboardShortcut(",", modifiers: .command)
      }
    }
    .listStyle(.sidebar)
    .accessibilityIdentifier("Sidebar")
    .navigationTitle("Lexidraw")
    .task(id: [browser.reloads, folders.attempts]) {
      await folders.load { try await session.folders(in: nil) }
    }
  }

  private func destinationButton(_ title: String, symbol: String, destination: BrowserView.Destination) -> some View {
    Button { select(destination) } label: {
      Label(title, systemImage: symbol)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 4)
    }
    .listRowBackground(self.destination == destination ? Color.accentColor.opacity(0.15) : nil)
    .accessibilityAddTraits(self.destination == destination ? .isSelected : [])
    .keyboardShortcut(destination == .library ? "1" : destination == .shared ? "2" : "3", modifiers: .command)
  }

  /// A folder in the tree, whose own folders load when it is expanded.
  fileprivate struct FolderNode: View {
    let session: Session
    let folder: Entry
    let openFolder: (Place.Folder) -> Void
    @Environment(Browser.self) private var browser
    @State private var expanded = false
    @State private var children = FolderList()
    @Environment(\.dynamicTypeSize) private var typeSize

    private var place: Place.Folder { Place.Folder(id: folder.id, title: folder.title) }

    var body: some View {
      if folder.folderCount == 0 {
        row
      } else {
        DisclosureGroup(isExpanded: $expanded) {
          FolderRows(list: children, session: session, openFolder: openFolder)
        } label: {
          row.task(id: [expanded ? 1 : 0, browser.reloads, children.attempts]) {
            guard expanded else { return }
            await children.load { try await session.folders(in: folder.id) }
          }
        }
      }
    }

    /// A button as well as a tag, since a disclosure group's row only expands
    /// when pressed.
    private var row: some View {
      Button {
        openFolder(place)
      } label: {
        if typeSize.isAccessibilitySize { Text(folder.title) }
        else { Label(folder.title, systemImage: "folder") }
      }
      .tag(Browser.Root.folder(place))
    }
  }
}

/// Folders in the tree as they last loaded, so a failure shows with a way to
/// try again rather than as no folders.
@MainActor @Observable
private final class FolderList {
  private(set) var loaded: Loaded<[Entry]> = .loading
  /// Bumped to load again.
  private(set) var attempts = 0

  func retry() { attempts += 1 }

  func load(_ fetch: () async throws -> [Entry]) async {
    if let result = await Loaded.from(fetch) { loaded = result }
  }
}

private struct FolderRows: View {
  let list: FolderList
  let session: Session
  let openFolder: (Place.Folder) -> Void

  var body: some View {
    switch list.loaded {
    case .loading:
      EmptyView()
    case .loaded(let folders):
      ForEach(folders) { folder in
        Sidebar.FolderNode(session: session, folder: folder, openFolder: openFolder)
      }
    case .failed, .unreadable:
      Button("Couldn’t load folders. Try Again", systemImage: "exclamationmark.arrow.circlepath") { list.retry() }
    }
  }
}
