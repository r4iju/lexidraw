import LexidrawKit
import SwiftUI

/// Where the signed-in app is: a section of the sidebar, the folders opened
/// inside it, and what narrows the listings, shared by every screen so the
/// sidebar, breadcrumbs and listings agree.
@MainActor @Observable
final class Browser {
  enum Section: Hashable {
    case home, shared, trash
  }

  var section: Section = .home
  var path: [Place.Folder] = []
  /// Kept while moving between folders, as the web keeps its query string.
  var tags: Set<String> = []
  /// Bumped to have every screen load again, as when the app comes back.
  private(set) var reloads = 0

  func reload() { reloads += 1 }

  func show(_ section: Section) {
    self.section = section
    path = []
  }

  /// Goes to a folder whose breadcrumbs are `above`, from the top down.
  func open(_ folder: Place.Folder, below above: [Place.Folder]) {
    section = .home
    path = above + [folder]
  }
}

struct BrowserView: View {
  let session: Session
  @State private var browser: Browser
  @State private var actions: FileActions
  @State private var column = NavigationSplitViewColumn.detail
  @State private var away = false
  @Environment(\.scenePhase) private var scenePhase

  init(session: Session) {
    self.session = session
    let browser = Browser()
    _browser = State(initialValue: browser)
    _actions = State(initialValue: FileActions(session: session, browser: browser))
  }

  var body: some View {
    @Bindable var browser = browser
    NavigationSplitView(preferredCompactColumn: $column) {
      Sidebar(session: session)
    } detail: {
      NavigationStack(path: $browser.path) {
        Group {
          switch browser.section {
          case .home: FolderView(session: session, folder: nil)
          case .shared: SharedView(session: session)
          case .trash: TrashView(session: session)
          }
        }
        .navigationDestination(for: Place.Folder.self) { folder in
          FolderView(session: session, folder: folder)
        }
      }
    }
    .fileActionPresenters(actions)
    .environment(browser)
    .environment(actions)
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

private struct Sidebar: View {
  enum Item: Hashable {
    case section(Browser.Section)
    /// A folder, with the folders above it from the top down.
    case folder([Place.Folder])
  }

  let session: Session
  @Environment(Browser.self) private var browser
  @State private var folders: [Entry] = []

  var body: some View {
    List(selection: selection) {
      Label("Home", systemImage: "house").tag(Item.section(.home))
      Label("Shared with Me", systemImage: "person.2").tag(Item.section(.shared))
      Label("Trash", systemImage: "trash").tag(Item.section(.trash))
      Section("Folders") {
        ForEach(folders) { folder in
          FolderNode(session: session, folder: folder, above: [])
        }
      }
    }
    .navigationTitle("Lexidraw")
    .task(id: browser.reloads) {
      if let loaded = try? await session.folders(in: nil) { folders = loaded }
    }
  }

  private var selection: Binding<Item?> {
    Binding {
      switch browser.section {
      case .home where !browser.path.isEmpty: .folder(browser.path)
      case let section: .section(section)
      }
    } set: { item in
      switch item {
      case .section(let section): browser.show(section)
      case .folder(let chain):
        if let folder = chain.last { browser.open(folder, below: chain.dropLast()) }
      case nil: break
      }
    }
  }

  /// A folder in the tree, whose own folders load when it is opened.
  private struct FolderNode: View {
    let session: Session
    let folder: Entry
    let above: [Place.Folder]
    @Environment(Browser.self) private var browser
    @State private var expanded = false
    @State private var children: [Entry] = []

    private var chain: [Place.Folder] { above + [Place.Folder(id: folder.id, title: folder.title)] }

    var body: some View {
      if folder.itemCount == 0 {
        label
      } else {
        DisclosureGroup(isExpanded: $expanded) {
          ForEach(children) { child in
            FolderNode(session: session, folder: child, above: chain)
          }
        } label: {
          label.task(id: [expanded ? 1 : 0, browser.reloads]) {
            guard expanded else { return }
            if let loaded = try? await session.folders(in: folder.id) { children = loaded }
          }
        }
      }
    }

    private var label: some View {
      Label(folder.title, systemImage: "folder").tag(Item.folder(chain))
    }
  }
}
