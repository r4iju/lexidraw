import DrawingKit
import LexidrawKit
import SwiftUI

/// A drawing in the app's appearance as the web shows it in its theme:
/// edited where the user may edit it, and shown read-only elsewhere.
struct DrawingScreen: View {
  let session: Session
  let id: String
  let title: String
  @State private var drawing: Loaded<StoredDrawing> = .loading
  @State private var images: [String: DrawingImage] = [:]
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    Group {
      if let stored = drawing.value {
        let theme: DrawingTheme = colorScheme == .dark ? .dark : .light
        if stored.access == .edit {
          DrawingEditorScreen(session: session, drawing: stored, theme: theme, reload: load)
            .id(stored.updatedAt)
        } else {
          DrawingCanvas(elements: stored.elements, background: stored.background, theme: theme, images: images)
            .id(stored.updatedAt)
            .ignoresSafeArea(edges: .bottom)
            .task(id: stored.updatedAt) {
              await DrawingImages.load(for: stored.elements, drawing: stored.id, session: session) {
                images[$0] = $1
              }
            }
        }
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
