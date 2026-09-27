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
  /// as it is when a newer load takes over, so what is shown stays.
  @MainActor static func from(_ fetch: () async throws -> Value) async -> Loaded? {
    do {
      return .loaded(try await fetch())
    } catch is CancellationError {
      return nil
    } catch is Unreadable {
      return .unreadable
    } catch {
      return .failed(error.localizedDescription)
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
    @ViewBuilder empty: () -> Empty = { EmptyView() }
  ) -> some View {
    overlay {
      switch loaded {
      case .loading:
        ProgressView()
      case .failed(let message):
        ContentUnavailableView {
          Label("Couldn’t load \(what)", systemImage: "wifi.exclamationmark")
        } description: {
          Text(message)
        } actions: {
          Button("Try Again") { Task { await retry() } }
        }
      case .unreadable:
        ContentUnavailableView(
          "Can’t open \(what)", systemImage: "exclamationmark.triangle",
          description: Text("The app can’t read what it holds."))
      case .loaded(let value) where isEmpty(value):
        empty()
      case .loaded:
        EmptyView()
      }
    }
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
