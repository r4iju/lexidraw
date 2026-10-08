import LexidrawKit
import SwiftUI

/// Search outlives its screen, so a tab switch or an opened file retains the query.
@MainActor @Observable
final class FileSearch {
  enum State {
    case idle, loading, results([SearchResult]), empty, failed(String)
  }

  var query = "" {
    didSet { if query != oldValue { run() } }
  }
  private(set) var state = State.idle
  let browser: Browser
  private(set) var active = false
  private(set) var navigationEpoch = 0
  private(set) var interactionID = UUID()

  func select(active: Bool) {
    navigationEpoch += 1
    interactionID = UUID()
    self.active = active
  }
  private let session: Session
  // A cancelled transport can still finish, including after the same query is retried.
  private var generation = 0
  private var request: Task<Void, Never>?

  init(session: Session, updates: BrowserUpdates) {
    self.session = session
    browser = Browser(root: .section(.search), updates: updates)
  }

  isolated deinit { request?.cancel() }

  func run() {
    interactionID = UUID()
    generation += 1
    let current = generation
    request?.cancel()
    let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { state = .idle; return }
    state = .loading
    request = Task { [weak self, session] in
      do {
        try await Task.sleep(for: .milliseconds(250))
        let results = try await session.search(text)
        guard let self, current == self.generation, !Task.isCancelled else { return }
        self.state = results.isEmpty ? .empty : .results(results)
      } catch is CancellationError {
      } catch {
        guard let self, current == self.generation, !Task.isCancelled else { return }
        self.state = .failed(error.localizedDescription)
      }
    }
  }
}

struct SearchStack: View {
  let session: Session
  @Bindable var search: FileSearch
  let reveal: (SearchResult) async throws -> Void

  var body: some View {
    let epoch = search.navigationEpoch
    let path = Binding {
      search.browser.path
    } set: { path in
      // NavigationSplitView clears a departing stack. Its old binding must
      // not erase the destination's retained route, even after reselecting it.
      guard search.active, epoch == search.navigationEpoch else { return }
      search.browser.path = path
    }
    return NavigationStack(path: path) {
      SearchView(search: search, reveal: reveal)
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
    .environment(search.browser)
  }
}

private struct SearchView: View {
  @Bindable var search: FileSearch
  let reveal: (SearchResult) async throws -> Void
  @Environment(\.openFile) private var openFile
  @FocusState private var enteringQuery: Bool
  @State private var revealing: String?
  @State private var revealFailure: String?
  @State private var revealRequest: Task<Void, Never>?
  @State private var revealAttempt: UUID?

  var body: some View {
    List {

      if case .results(let results) = search.state {
        clearButton
          .font(.subheadline)
          .frame(maxWidth: .infinity, alignment: .trailing)
        Section {
          ForEach(results) { result in
            VStack(alignment: .leading, spacing: 10) {
              if result.kind != .folder, let openFile {
                Button { openFile(result) } label: {
                  FileRow(file: result, caption: "Updated \(result.updatedAt.formatted(.relative(presentation: .named)))")
                }
                .buttonStyle(.borderless)
                .tint(.primary)
              } else {
                NavigationLink(value: result.kind == .folder
                  ? Browser.Route.folder(Place.Folder(id: result.id, title: result.title))
                  : .searchFile(result)) {
                  FileRow(file: result, caption: "Updated \(result.updatedAt.formatted(.relative(presentation: .named)))")
                }
              }
              Label("In \(result.folder?.title ?? "Library or Shared")", systemImage: "folder")
                .font(.subheadline)
                .foregroundStyle(.secondary)
              Button {
                guard revealing == nil else { return }
                let attempt = UUID()
                revealAttempt = attempt
                revealing = result.id
                revealRequest = Task {
                  defer {
                    if revealAttempt == attempt { revealing = nil; revealAttempt = nil; revealRequest = nil }
                  }
                  do { try await reveal(result) }
                  catch is CancellationError { }
                  catch {
                    if revealAttempt == attempt { revealFailure = error.localizedDescription }
                  }
                }
              } label: {
                Label("Reveal in \(result.folder?.title ?? "Library or Shared")", systemImage: "folder.badge.magnifyingglass")
              }
              .accessibilityLabel("Reveal \(result.title) in \(result.folder?.title ?? "Library or Shared")")
              .accessibilityValue(revealing == result.id ? "Finding location" : "")
              .disabled(revealing != nil)
              .buttonStyle(.borderless)
              .frame(minHeight: 44, alignment: .leading)
            }
            .padding(.vertical, 4)
            .contextMenu { ListenButton(file: result) }
          }
        } header: {
          Text(results.count == 1 ? "1 matching title" : "\(results.count) matching titles")
        }
        Text("Search titles across all files you can access. Document contents aren’t searched.")
          .font(.footnote)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
          .listRowSeparator(.hidden)
          .listRowBackground(Color.clear)
      }
    }
    .overlay {
      if case .results = search.state { EmptyView() } else {
        GeometryReader { geometry in
          ScrollView {
            VStack {
              if !search.query.isEmpty {
                clearButton
                  .font(.subheadline)
                  .frame(maxWidth: .infinity, alignment: .trailing)
                  .padding(.horizontal, 24)
              }
              switch search.state {
              case .idle:
                ContentMessage(title: "Find a file", symbol: "magnifyingglass",
                  description: "Search titles across all files you can access. Document contents aren’t searched.") { EmptyView() }
              case .loading:
                ProgressView("Searching titles…")
                  .accessibilityLabel("Searching titles")
              case .empty:
                ContentMessage(title: "No matching titles", symbol: "magnifyingglass",
                  description: "No accessible file titles match “\(search.query)”. Try a shorter title or a different word.") { EmptyView() }
              case .failed(let message):
                ContentMessage(title: "Couldn’t search", symbol: "wifi.exclamationmark", description: message) {
                  Button("Try Again") { search.run() }
                    .buttonStyle(.borderedProminent)
                    .frame(minHeight: 44)
                }
              case .results: EmptyView()
              }
            }
            .frame(maxWidth: .infinity, minHeight: geometry.size.height)
          }
          .scrollDismissesKeyboard(.interactively)
        }
      }
    }
    .scrollDismissesKeyboard(.interactively)
    .alert("Couldn’t reveal file", message: $revealFailure)
    .onChange(of: search.interactionID) { invalidateReveal() }
    .onChange(of: search.browser.path) { invalidateReveal() }
    .onChange(of: search.browser.file?.id) { invalidateReveal() }
    .navigationTitle("Search")
    .accountControl()
    .searchable(text: $search.query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search all file titles")
    .searchFocused($enteringQuery)
    // A pushed editor owns tab-bar visibility; ending search focus must yield to it.
    .modifier(PhoneSearchDestinations(hidden: enteringQuery && search.browser.path.isEmpty))
    .onSubmit(of: .search) { enteringQuery = false }
    .autocorrectionDisabled()
    .textInputAutocapitalization(.never)
    .toolbar {
      ToolbarItem(placement: .keyboard) {
        Button("Hide keyboard", systemImage: "keyboard.chevron.compact.down") {
          enteringQuery = false
          UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        }
      }
    }
  }

  private func invalidateReveal() {
    revealRequest?.cancel()
    revealRequest = nil
    revealAttempt = nil
    revealing = nil
    revealFailure = nil
  }

  private var clearButton: some View {
    Button { search.query = ""; enteringQuery = false } label: {
      Label("Clear query", systemImage: "xmark.circle")
        .frame(minHeight: 44)
        .contentShape(.rect)
    }
  }
}

/// A tablet split view has no phone destination bar to hide.
private struct PhoneSearchDestinations: ViewModifier {
  let hidden: Bool

  @ViewBuilder func body(content: Content) -> some View {
    if UIDevice.current.userInterfaceIdiom == .phone {
      content.toolbar(hidden ? .hidden : .automatic, for: .tabBar)
    } else {
      content
    }
  }
}
