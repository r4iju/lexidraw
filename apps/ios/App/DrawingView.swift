import DrawingKit
import LexidrawKit
import SwiftUI

/// A drawing, read-only, in the app's appearance as the web shows it in its
/// theme.
struct DrawingScreen: View {
  let session: Session
  let id: String
  let title: String
  @State private var drawing: Loaded<StoredDrawing> = .loading
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    Group {
      if let stored = drawing.value {
        DrawingCanvas(
          elements: stored.elements, background: stored.background,
          theme: colorScheme == .dark ? .dark : .light
        )
        .id(stored.updatedAt)
        .ignoresSafeArea(edges: .bottom)
      } else {
        Color.clear
      }
    }
    .overlay(for: drawing, what: "the drawing", retry: load)
    .navigationTitle(drawing.value?.title ?? title)
    .navigationBarTitleDisplayMode(.inline)
    .task { await load() }
  }

  private func load() async {
    if let loaded = await Loaded.from({ try await session.drawing(id) }) { drawing = loaded }
  }
}

