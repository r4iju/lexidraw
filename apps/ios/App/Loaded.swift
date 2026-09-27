import SwiftUI

/// What a screen loads: not yet, what came, or why nothing did.
enum Loaded<Value> {
  case loading
  case loaded(Value)
  case failed(String)

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
    } catch {
      return .failed(error.localizedDescription)
    }
  }
}

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
      case .loaded(let value) where isEmpty(value):
        empty()
      case .loaded:
        EmptyView()
      }
    }
  }
}
