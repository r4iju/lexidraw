import DrawingKit
import LexidrawKit
import SwiftUI

/// A drawing in the app's appearance as the web shows it in its theme:
/// edited where the user may edit it, and shown read-only elsewhere.
struct DrawingScreen: View {
  let session: Session
  let id: String
  let title: String
  @State private var images: [String: DrawingImage] = [:]
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    FileScreen(what: "the drawing", title: title, titled: \.title) {
      try await session.drawing(id)
    } content: { stored, reload in
      let theme: DrawingTheme = colorScheme == .dark ? .dark : .light
      if stored.access == .edit {
        DrawingEditorScreen(session: session, drawing: stored, theme: theme, reload: reload)
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
    }
  }
}
