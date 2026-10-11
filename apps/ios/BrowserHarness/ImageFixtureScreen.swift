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
  @State private var document = ImageFixtureDocument()
  private var editor: EditorView { document.view }
  @State private var saved = ""
  @State private var saver: DocumentSaver?
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
        guard let saver else { return nil }
        editor.setEditingEnabled(true)
        let before = try document.model.serializedState()
        if DocumentSaveReceipt.imageCount(before["root"], url: url) == 0 {
          guard editor.insertGeneratedImage(url, altText: prompt) else { return nil }
        }
        let snapshot = try document.model.serializedState()
        await saver.changed { snapshot }
        let receipt = await saver.saveNow()
        if receipt?.containsImage(url) == true { saved = receipt!.state.stringified }
        return receipt
      } }
      ImageFixtureEditor(editor: editor).frame(height: 150)
      Text(saved.isEmpty ? "No saved image yet" : "Saved image inserted into document").accessibilityIdentifier("image saved document")
    }.task {
      do {
        let stored = try await session.document("fixture")
        try document.model.load(stored.state)
        saver = DocumentSaver(session: session, document: stored.id, readAt: stored.updatedAt)
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

@MainActor private final class ImageFixtureDocument {
  let model = Editor()
  let view: EditorView
  init() {
    try! model.load(["root": ["type": "root", "version": 1, "children": [["type": "paragraph", "version": 1, "children": []]]]])
    view = EditorView(model: model, isEditable: false)
  }
}

/// Simulator builds without signing cannot use Keychain entitlements. This fake key stays native in memory.
private final class ImageFixtureKey: TokenStore {
  private let key = Mutex<String?>(nil)
  func load() throws -> String? { key.withLock { $0 } }
  func save(_ value: String) throws { key.withLock { $0 = value } }
  func delete() throws { key.withLock { $0 = nil } }
}
