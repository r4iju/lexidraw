import SwiftUI

/// What a screen loads: not yet, what came, or why nothing did.
enum Loaded<Value> {
  case loading
  case loaded(Value)
  case failed(String)
  /// What came can't be shown, and fetching it again would bring the same.
  case unreadable

  var value: Value? {
    if case .loaded(let value) = self { value } else { nil }
  }

  /// What `fetch` gave, or why it failed; nil when the task was cancelled,
  /// as it is when a newer load takes over, so what is shown stays. A
  /// cancelled request can fail as a URL error rather than as cancellation.
  @MainActor static func from(_ fetch: () async throws -> Value) async -> Loaded? {
    do {
      return .loaded(try await fetch())
    } catch is CancellationError {
      return nil
    } catch is Unreadable {
      return .unreadable
    } catch {
      return Task.isCancelled ? nil : .failed(error.localizedDescription)
    }
  }
}

/// Thrown by a fetch that got what it asked for but can't show it.
struct Unreadable: Error {}

extension View {
  /// Stands over a list while it loads, when it couldn't, and when it has
  /// nothing in it. `what` finishes "Couldn’t load".
  func overlay<Value, Empty: View>(
    for loaded: Loaded<Value>,
    what: String,
    retry: @escaping () async -> Void,
    isEmpty: @escaping (Value) -> Bool = { _ in false },
    @ViewBuilder empty: @escaping () -> Empty = { EmptyView() }
  ) -> some View {
    overlay {
      GeometryReader { geometry in
        ScrollView {
          VStack {
            switch loaded {
            case .loading:
              ProgressView("Loading \(what)…")
                .accessibilityLabel("Loading \(what)")
            case .failed(let message):
              ContentMessage(title: "Couldn’t load \(what)", symbol: "wifi.exclamationmark", description: message) {
                Button("Try Again") { Task { await retry() } }
              }
            case .unreadable:
              ContentMessage(title: "Can’t open \(what)", symbol: "exclamationmark.triangle",
                description: "The app can’t read what it holds.") { EmptyView() }
            case .loaded(let value) where isEmpty(value):
              empty()
            case .loaded:
              EmptyView()
            }
          }
          .frame(maxWidth: .infinity, minHeight: geometry.size.height)
        }
        .allowsHitTesting(loaded.value.map(isEmpty) ?? true)
      }
    }
  }
}

/// Intrinsic content height lets recovery copy and actions scroll even when the
/// native search field and keyboard leave only a small content viewport.
struct ContentMessage<Actions: View>: View {
  let title: String
  let symbol: String
  let description: String
  @ViewBuilder var actions: Actions

  var body: some View {
    VStack(spacing: 16) {
      Image(systemName: symbol)
        .font(.largeTitle)
        .foregroundStyle(.secondary)
        .accessibilityHidden(true)
      Text(title)
        .font(.title2.bold())
        .accessibilityAddTraits(.isHeader)
      Text(description)
        .foregroundStyle(.secondary)
      actions
    }
    .multilineTextAlignment(.center)
    .fixedSize(horizontal: false, vertical: true)
    .frame(maxWidth: .infinity)
    .padding(24)
  }
}

/// A file's screen: `content` once `fetch` has loaded the file, under its
/// title, and what the overlay says until then. `content` is given a reload.
struct FileScreen<Value, Content: View>: View {
  /// Finishes "Couldn’t load".
  let what: String
  /// The title until the file's own comes.
  let title: String
  let titled: (Value) -> String
  let fetch: () async throws -> Value
  @ViewBuilder let content: (Value, _ reload: @escaping () async -> Void) -> Content
  @State private var loaded: Loaded<Value> = .loading

  var body: some View {
    Group {
      if let value = loaded.value { content(value, load) } else { Color.clear }
    }
    .overlay(for: loaded, what: what, retry: load)
    .navigationTitle(loaded.value.map(titled) ?? title)
    .navigationBarTitleDisplayMode(.inline)
    .task { await load() }
  }

  private func load() async {
    if let result = await Loaded.from(fetch) { loaded = result }
  }
}
