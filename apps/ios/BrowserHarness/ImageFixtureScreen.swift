import Foundation
import Synchronization
import LexidrawKit
import LexicalSwift
import SwiftUI
import TextKitEditor

/// Production composer, transport and editor against injected provider/storage and a real local ledger.
struct ImageFixtureScreen: View {
  let session: Session
  @State private var flow: NativeImageFlow?
  @State private var byok: NativeBYOK?
  @State private var editing: DocumentEditing?
  @State private var editor: EditorView?
  @State private var saved = ""
  var body: some View {
    VStack {
      Text("284 injected image fixture, no actual service verification")
      HStack {
        Button("Fixture Pro") { Task { try? await session.setPowerPreference(.pro) } }
        Button("Fixture BYOK") { Task { try? await session.setPowerPreference(.byok) } }
        Button("Remove device key") { try? byok?.removeKey() }
        Button("Fail sync") { Task { await control(true) } }
        Button("Restore storage") { Task { await control(false) } }
      }
      if let flow { ImageComposerContent(flow: flow) { url, prompt in
        guard let editing, let editor else { return nil }
        let receipt = try await editing.saveImage(url, prompt: prompt, in: editor)
        if receipt?.containsImage(url) == true {
          saved = try await session.document("fixture").state.stringified
        }
        return receipt
      } }
      if let editor { ImageFixtureEditor(editor: editor).frame(height: 150) }
      Text(saved.isEmpty ? "No saved image yet" : "Saved image inserted into document").accessibilityIdentifier("image saved document")
      Text(saved).font(.caption).accessibilityIdentifier("actual saved image JSON")
    }.task {
      do {
        let stored = try await session.document("fixture")
        let settings = try DocumentSettings(state: stored.state, appState: stored.appState)
        let value = try DocumentEditing(session: session, stored: stored, settings: settings, font: DocumentFont(family: "Helvetica"))
        editing = value
        editor = EditorView(model: value.model, isEditable: false)
      } catch { return }
      let store = ImageFixtureKey()
      let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [NativeAIProviderFixture.self]
      let runtime = NativeBYOK(store: store, configuration: config, imageFixture: true)
      try? runtime.replaceKey("sk-or-v1-284-native-image-fixture")
      byok = runtime
      flow = NativeImageFlow(source: { try await session.powerPreference() }, capability: { try await session.imageCapability() },
        generatePro: { prompt,id,maximum in try await session.generateProImage(prompt:prompt,id:id,acceptedMaximum:maximum) },
        generateBYOK: { prompt in try await runtime.generateImage(prompt:prompt) },
        save: { id,image in try await session.saveGeneratedImage(image,id:id,document:"fixture") })
    }.onDisappear { try? byok?.removeKey() }
  }
  private func control(_ fail: Bool) async {
    var request = URLRequest(url: URL(string:"http://127.0.0.1:3084/fixture-control")!); request.httpMethod = "POST"
    request.httpBody = try? JSONSerialization.data(withJSONObject: ["failSync":fail])
    _ = try? await URLSession.shared.data(for: request)
  }
}
private struct ImageFixtureEditor: UIViewRepresentable {
  let editor: EditorView
  func makeUIView(context: Context) -> EditorView { editor }
  func updateUIView(_ view: EditorView, context: Context) {}
}

/// Simulator builds without signing cannot use Keychain entitlements. This fake key stays native in memory.
private final class ImageFixtureKey: TokenStore {
  private let key = Mutex<String?>(nil)
  func load() throws -> String? { key.withLock { $0 } }
  func save(_ value: String) throws { key.withLock { $0 = value } }
  func delete() throws { key.withLock { $0 = nil } }
}
