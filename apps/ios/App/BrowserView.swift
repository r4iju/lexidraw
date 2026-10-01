import LexidrawKit
import SwiftUI

/// Where the signed-in app is: the place the detail column starts from, the
/// folders opened beyond it, and what narrows the listings, shared by every
/// screen so the sidebar, breadcrumbs and listings agree.
@MainActor @Observable
final class Browser {
  enum Section: Hashable {
    case home, shared, trash
  }

  /// A section, or a folder gone to directly. It is the sidebar's selection,
  /// and the split view empties the detail stack whenever its selection
  /// changes, so only going somewhere new changes it; opening a folder from a
  /// listing pushes onto `path` instead.
  enum Root: Hashable {
    case section(Section)
    case folder(Place.Folder)
  }

  private(set) var root = Root.section(.home)
  var path: [Place.Folder] = []
  /// Kept while moving between folders, as the web keeps its query string.
  var tags: Set<String> = []
  /// Bumped to have every screen load again, as when the app comes back.
  private(set) var reloads = 0

  func reload() { reloads += 1 }

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
    if let index = path.firstIndex(where: { $0.id == folder.id }) {
      path.removeSubrange((index + 1)...)
    } else if case .folder(let start) = root, start.id == folder.id {
      path = []
    } else {
      open(folder)
    }
  }
}

struct BrowserView: View {
  let session: Session
  @State private var browser: Browser
  @State private var actions: FileActions
  @State private var listener: Listener
  @State private var column = NavigationSplitViewColumn.detail
  @State private var away = false
  @Environment(\.scenePhase) private var scenePhase

  init(session: Session) {
    self.session = session
    let browser = Browser()
    _browser = State(initialValue: browser)
    _actions = State(initialValue: FileActions(session: session, browser: browser))
    _listener = State(initialValue: Listener(session: session))
  }

  var body: some View {
    @Bindable var browser = browser
    NavigationSplitView(preferredCompactColumn: $column) {
      Sidebar(session: session)
    } detail: {
      NavigationStack(path: $browser.path) {
        Group {
          switch browser.root {
          case .section(.home): FolderView(session: session, folder: nil)
          case .section(.shared): SharedView(session: session)
          case .section(.trash): TrashView(session: session)
          case .folder(let folder): FolderView(session: session, folder: folder)
          }
        }
        .id(browser.root)
        .navigationDestination(for: Place.Folder.self) { folder in
          FolderView(session: session, folder: folder)
        }
      }
    }
    .fileActionPresenters(actions)
    .nowPlayingBar(listener)
    .onDisappear { listener.stop() }
    .environment(browser)
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
}

/// The sections, and the folder tree.
private struct Sidebar: View {
  let session: Session
  @Environment(Browser.self) private var browser
  @State private var folders = FolderList()

  var body: some View {
    List(selection: selection) {
      Label("Home", systemImage: "house").tag(Browser.Root.section(.home))
      Label("Shared with Me", systemImage: "person.2").tag(Browser.Root.section(.shared))
      Label("Trash", systemImage: "trash").tag(Browser.Root.section(.trash))
      Section("Folders") {
        FolderRows(list: folders, session: session)
      }
    }
    .navigationTitle("Lexidraw")
    .task(id: [browser.reloads, folders.attempts]) {
      await folders.load { try await session.folders(in: nil) }
    }
  }

  private var selection: Binding<Browser.Root?> {
    Binding {
      browser.root
    } set: { root in
      if let root { browser.go(to: root) }
    }
  }

  /// A folder in the tree, whose own folders load when it is expanded.
  fileprivate struct FolderNode: View {
    let session: Session
    let folder: Entry
    @Environment(Browser.self) private var browser
    @State private var expanded = false
    @State private var children = FolderList()

    private var place: Place.Folder { Place.Folder(id: folder.id, title: folder.title) }

    var body: some View {
      if folder.folderCount == 0 {
        row
      } else {
        DisclosureGroup(isExpanded: $expanded) {
          FolderRows(list: children, session: session)
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

  var body: some View {
    switch list.loaded {
    case .loading:
      EmptyView()
    case .loaded(let folders):
      ForEach(folders) { folder in
        Sidebar.FolderNode(session: session, folder: folder)
      }
    case .failed, .unreadable:
      Button("Couldn’t load folders. Try Again", systemImage: "exclamationmark.arrow.circlepath") { list.retry() }
    }
  }
}
