import LexidrawKit
import SwiftUI

struct DocumentImageComposer: View {
  let session: Session
  let document: String
  let onSaved: (URL, String) -> Void
  private enum Load { case loading, ready(NativeImageFlow), unavailable }
  @State private var load = Load.loading
  var body: some View {
    Group {
      switch load {
      case .loading: ProgressView("Checking image capability…")
      case .ready(let flow): ImageComposerContent(flow: flow, onSaved: onSaved)
      case .unavailable: Text("Image generation is unavailable for this account or device. Local AI does not support images.")
      }
    }.padding().task {
      do { load = .ready(try await session.imageFlow(document: document)) }
      catch { load = .unavailable }
    }
  }
}
struct ImageComposerContent: View {
  @Bindable var flow: NativeImageFlow
  let onSaved: (URL, String) -> Void
  @State private var prompt = ""
  private var working: Bool { switch flow.state { case .generating, .uploading: true; default: false } }
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
      case .generating: ProgressView("Generating image…")
      case .uploading: ProgressView("Syncing completed image…")
      case .completed(let image, _), .syncFailed(let image, _):
        Section("Completed device image") {
          if let preview = UIImage(data: image.bytes) { Image(uiImage: preview).resizable().scaledToFit().frame(maxHeight: 220) }
          if case .syncFailed = flow.state { Text("Sync failed. The safe completed image is retained. Retry upload without regenerating or paying again.") }
          Button("Save image to document") { Task { if let url = await flow.upload() { onSaved(url, prompt) } } }
        }
      case .saved(let image, let url):
        Section("Saved image") {
          if let preview = UIImage(data: image.bytes) { Image(uiImage: preview).resizable().scaledToFit().frame(maxHeight: 220) }
          Text(url.absoluteString).font(.caption)
          Text("Generate image again explicitly starts a new action.")
        }
      case .failed(let reason): Text(reason)
      }
    }
  }
}
