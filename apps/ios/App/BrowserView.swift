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

  /// A section, or a folder gone to directly. It is the sidebar's selection,
  /// and the split view empties the detail stack whenever its selection
  /// changes, so only going somewhere new changes it; opening a folder from a
  /// listing pushes onto `path` instead.
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
    case folder(Place.Folder)
    case searchFile(SearchResult)
  }

  var path: [Route] = []
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
  @State private var actions: FileActions
  @State private var listener: Listener
  @State private var column = NavigationSplitViewColumn.detail
  @State private var away = false
  @Environment(\.scenePhase) private var scenePhase

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
        NavigationSplitView(preferredCompactColumn: $column) {
          Sidebar(session: session, searching: searching)
        } detail: {
          if destination == .search {
            searchStack
          } else {
            stack(for: browser)
          }
        }
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

  private enum Destination: Hashable {
    case library, shared, search
  }

  private func select(_ destination: Destination) {
    search.select(active: destination == .search)
    self.destination = destination
  }

  private var searching: Binding<Bool> {
    Binding { destination == .search } set: { select($0 ? .search : .library) }
  }

  private var phoneNavigation: some View {
    TabView(selection: Binding(get: { destination }, set: select)) {
      Tab("Library", systemImage: "books.vertical", value: .library) {
        stack(for: browser)
      }
      Tab("Shared", systemImage: "person.2", value: .shared) {
        stack(for: sharedBrowser)
      }
      Tab("Search", systemImage: "magnifyingglass", value: .search, role: .search) {
        searchStack
      }
    }
  }

  private var searchStack: some View {
    SearchStack(session: session, search: search) { result in
      if let folder = result.folder {
        browser.tags = []
        browser.show(.home)
        browser.path = [.folder(folder)]
        select(.library)
      } else {
        // The API conceals unreadable parents. Resolve the accessible listing
        // instead of claiming every nil parent means the Library root.
        let root = try await session.listing(of: nil)
        if (root.files + root.folders).contains(where: { $0.id == result.id }) {
          browser.tags = []
          browser.show(.home)
          select(.library)
        } else {
          let shared = try await session.sharedWithMe()
          guard shared.contains(where: { $0.id == result.id }) else {
            throw RevealUnavailable()
          }
          sharedBrowser.tags = []
          sharedBrowser.show(.shared)
          if UIDevice.current.userInterfaceIdiom == .pad { browser.show(.shared) }
          select(.shared)
        }
      }
    }
  }

  private struct RevealUnavailable: LocalizedError {
    var errorDescription: String? {
      "This file’s location is no longer available. Search again to refresh its location."
    }
  }

  private func stack(for context: Browser) -> some View {
    @Bindable var context = context
    return NavigationStack(path: $context.path) {
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
  @Binding var searching: Bool
  @Environment(Browser.self) private var browser
  @State private var folders = FolderList()

  var body: some View {
    List(selection: selection) {
      Label("Home", systemImage: "house").tag(Browser.Root.section(.home))
      Label("Shared with Me", systemImage: "person.2").tag(Browser.Root.section(.shared))
      Label("Search", systemImage: "magnifyingglass").tag(Browser.Root.section(.search))
      Label("Trash", systemImage: "trash").tag(Browser.Root.section(.trash))
      Section("Folders") {
        FolderRows(list: folders, session: session, searching: $searching)
      }
    }
    .navigationTitle("Lexidraw")
    .task(id: [browser.reloads, folders.attempts]) {
      await folders.load { try await session.folders(in: nil) }
    }
  }

  private var selection: Binding<Browser.Root?> {
    Binding {
      searching ? .section(.search) : browser.root
    } set: { root in
      guard let root else { return }
      if root == .section(.search) {
        searching = true
      } else {
        searching = false
        browser.go(to: root)
      }
    }
  }

  /// A folder in the tree, whose own folders load when it is expanded.
  fileprivate struct FolderNode: View {
    let session: Session
    let folder: Entry
    @Binding var searching: Bool
    @Environment(Browser.self) private var browser
    @State private var expanded = false
    @State private var children = FolderList()

    private var place: Place.Folder { Place.Folder(id: folder.id, title: folder.title) }

    var body: some View {
      if folder.folderCount == 0 {
        row
      } else {
        DisclosureGroup(isExpanded: $expanded) {
          FolderRows(list: children, session: session, searching: $searching)
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
        searching = false
        browser.open(place)
      } label: {
        Label(folder.title, systemImage: "folder")
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
  @Binding var searching: Bool

  var body: some View {
    switch list.loaded {
    case .loading:
      EmptyView()
    case .loaded(let folders):
      ForEach(folders) { folder in
        Sidebar.FolderNode(session: session, folder: folder, searching: $searching)
      }
    case .failed, .unreadable:
      Button("Couldn’t load folders. Try Again", systemImage: "exclamationmark.arrow.circlepath") { list.retry() }
    }
  }
}
