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

  func select(active: Bool) {
    navigationEpoch += 1
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
  @State private var revealing: String?
  @State private var revealFailure: String?

  var body: some View {
    List {
      if case .results(let results) = search.state {
        Section {
          ForEach(results) { result in
            VStack(alignment: .leading, spacing: 10) {
              NavigationLink(value: result.kind == .folder
                ? Browser.Route.folder(Place.Folder(id: result.id, title: result.title))
                : .searchFile(result)) {
                FileRow(file: result, caption: "Updated \(result.updatedAt.formatted(.relative(presentation: .named)))")
              }
              Label("In \(result.folder?.title ?? "Library or Shared")", systemImage: "folder")
                .font(.subheadline)
                .foregroundStyle(.secondary)
              Button {
                guard revealing == nil else { return }
                revealing = result.id
                Task {
                  defer { revealing = nil }
                  do { try await reveal(result) }
                  catch { revealFailure = error.localizedDescription }
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
        } footer: {
          Text("Search titles across all files you can access. Document contents aren’t searched.")
        }
      }
    }
    .overlay {
      switch search.state {
      case .idle:
        ContentUnavailableView {
          Label("Find a file", systemImage: "magnifyingglass")
        } description: {
          Text("Search titles across all files you can access. Document contents aren’t searched.")
        }
      case .loading:
        ProgressView("Searching titles…")
          .accessibilityLabel("Searching titles")
      case .empty:
        ContentUnavailableView {
          Label("No matching titles", systemImage: "magnifyingglass")
        } description: {
          Text("No accessible file titles match “\(search.query)”. Try a shorter title or a different word.")
        }
      case .failed(let message):
        ContentUnavailableView {
          Label("Couldn’t search", systemImage: "wifi.exclamationmark")
        } description: { Text(message) } actions: {
          Button("Try Again") { search.run() }
        }
      case .results: EmptyView()
      }
    }
    .safeAreaInset(edge: .top, spacing: 0) {
      if !search.query.isEmpty {
        HStack(alignment: .firstTextBaseline) {
          Text("All accessible file titles")
            .font(.subheadline)
            .foregroundStyle(.secondary)
          Spacer()
          clearButton
            .font(.subheadline)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .background(Color(uiColor: .systemGroupedBackground))
      }
    }
    .alert("Couldn’t reveal file", message: $revealFailure)
    .navigationTitle("Search")
    .phoneAccountControl()
    .searchable(text: $search.query, prompt: "Search all file titles")
    .autocorrectionDisabled()
    .textInputAutocapitalization(.never)
    .toolbar {
      if UIDevice.current.userInterfaceIdiom == .pad {
        ToolbarItem { SettingsButton() }
      }
    }
  }

  private var clearButton: some View {
    Button { search.query = "" } label: {
      Label("Clear query", systemImage: "xmark.circle")
        .frame(minHeight: 44)
        .contentShape(.rect)
    }
  }
}
