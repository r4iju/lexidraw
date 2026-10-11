import LexidrawKit
import SwiftUI

struct DocumentImageComposer: View {
  let session: Session
  let document: String
  let onSaved: (URL, String) async throws -> DocumentSaveReceipt?
  var body: some View {
    OwnedDocumentImageComposer(session: session, document: document, onSaved: onSaved)
      .id("\(session.scopeID):\(document)")
  }
}
private struct OwnedDocumentImageComposer: View {
  let session: Session
  let document: String
  let onSaved: (URL, String) async throws -> DocumentSaveReceipt?
  private enum Load { case loading, ready(NativeImageFlow), unavailable }
  @State private var load = Load.loading
  var body: some View {
    Group {
      switch load {
      case .loading: ProgressView("Checking image capability…")
      case .ready(let flow): ImageComposerContent(flow: flow, onSaved: onSaved).onDisappear { flow.end() }
      case .unavailable: Text("Image generation is unavailable for this account or device. Local AI does not support images.")
      }
    }.padding().task {
      do {
        let flow = try await session.imageFlow(document: document)
        if Task.isCancelled { flow.end(); return }
        load = .ready(flow)
      } catch { if !Task.isCancelled { load = .unavailable } }
    }
  }
}
struct ImageComposerContent: View {
  @Bindable var flow: NativeImageFlow
  let onSaved: (URL, String) async throws -> DocumentSaveReceipt?
  @State private var prompt = ""
  private var working: Bool { switch flow.state { case .admitting, .generating, .uploading: true; default: false } }
  var body: some View {
    Form {
      Section("Generate an image") {
        Text("Uses the selected AI Power source and one tuned configuration. Local AI does not support images. Unverified provider access is unavailable.")
        TextField("Describe the image", text: $prompt, axis: .vertical).accessibilityIdentifier("image prompt")
        Button("Generate image") { Task { await flow.generate(prompt) } }.disabled(working || prompt.isEmpty)
      }
      switch flow.state {
      case .idle: EmptyView()
      case .quote(_, _, let maximum, let fixture):
        Section("Accept maximum") {
          Text("Maximum \(Double(maximum) / 1_000_000) credits. Technical failures return the reservation; uncertain work remains reserved. Regeneration is a new action.")
          if fixture { Text("Injected fixture only. No actual service verification.") }
          Button("Decline quote") { flow.decline() }
          Button("Accept maximum and generate") { Task { await flow.accept() } }
        }
      case .admitting: ProgressView("Checking image admission...")
      case .uncertain:
        Section("Image outcome uncertain") {
          Text("The original generation is retained. New generation is blocked while its outcome is uncertain.")
          Button("Read original Pro image") { Task { await flow.recover() } }
        }
      case .generating: ProgressView("Generating image…")
      case .uploading: ProgressView("Syncing completed image…")
      case .completed(let image, _), .syncFailed(let image, _):
        Section("Completed device image") {
          if !flow.durable {
            Text("Retained in memory. Reopening durability is unconfirmed.")
            Button("Retry local retention") { flow.retryCheckpoint() }
          }
          if let preview = UIImage(data: image.bytes) { Image(uiImage: preview).resizable().scaledToFit().frame(maxHeight: 220) }
          if case .syncFailed = flow.state { Text("Sync failed. The safe completed image is retained. Retry upload without regenerating or paying again.") }
          Button("Save image to document") { Task { _ = await flow.upload(confirm: onSaved) } }
        }
      case .saved(let image, let url):
        Section("Synced image artifact") {
          if let preview = UIImage(data: image.bytes) { Image(uiImage: preview).resizable().scaledToFit().frame(maxHeight: 220) }
          Text(url.absoluteString).font(.caption)
          if flow.checkpoint == nil { Text("Image saved in the document.") }
          else {
            Text("Image synced. Document insertion is not yet confirmed. The image remains on this device.")
            Button("Retry document insertion") { Task { _ = await flow.upload(confirm: onSaved) } }
          }
        }
      case .failed(let reason): Text(reason)
      }
    }
  }
}
