import LexidrawKit
import SwiftUI

struct ProNarrationComposer: View {
  @State private var flow: NativeNarrationFlow
  let onPlay: (NarrationPlayback) -> Void
  init(flow: NativeNarrationFlow, onPlay: @escaping (NarrationPlayback) -> Void) {
    _flow = State(initialValue: flow); self.onPlay = onPlay
  }
  private var pendingID: String? {
    if case .job(let job) = flow.state, job.pending { return job.id }; return nil
  }
  var body: some View {
    NavigationStack {
      Form {
        Section("Pro narration") {
          Text("One curated voice. Review a quote for missing audio before generating. Saved replay is free after your credits expire or run out.")
          switch flow.readState {
          case .current: EmptyView()
          case .loading: Text("Checking latest status. Retained progress may be out of date.")
          case .stale(let message):
            Text(message)
            Button("Retry status read") { Task { await flow.refresh() } }
          case .denied:
            Button("Retry access read") { Task { await flow.restore() } }
          }
          if flow.cancellationUnconfirmed {
            Text("Cancellation is not confirmed. Further work may still be running. Refresh status to check.")
          }
          switch flow.state {
          case .idle: Button("Review narration quote") { Task { await flow.review() } }.disabled(flow.readState != .current)
          case .loading, .accepting: ProgressView("Preparing narration…")
          case .quote(let quote, _):
            Text("\(quote.missing) parts need synthesis; \(quote.cached) parts are retained. Maximum \(Double(quote.maximum) / 1_000_000, specifier: "%.3f") credits. Audio is bounded to \(quote.maxSeconds / 60) minutes.")
            Text(quote.policy)
            Button("Decline quote") { flow.decline() }
            Button("Accept maximum and generate") { Task { await flow.accept() } }.disabled(flow.readState != .current)
          case .acceptanceUncertain:
            Text("The acceptance response was interrupted. Recover the same action before starting another. Credits may remain reserved.")
            Button("Recover accepted action") { Task { await flow.accept() } }.disabled(flow.readState != .current)
          case .job(let job):
            Text("\(job.made) of \(job.planned) parts ready.")
            Text(job.policy)
            if job.pending {
              ProgressView(value: Double(job.made), total: Double(job.planned))
              Button("Cancel generation") { Task { await flow.cancel() } }
            } else if job.state == "unknown" {
              Text("Provider outcome is uncertain. Credits remain reserved until reconciliation. No new request will be sent.")
              Button("Refresh status") { Task { await flow.refresh() } }
            } else if job.retryable {
              Text("All reserved credits were returned. Completed parts are retained for retry.")
              Button("Review retry quote") { Task { await flow.review() } }.disabled(flow.readState != .current)
            } else {
              Text("Saved recording. Replay is free.")
              Button("Review narration quote") { Task { await flow.review() } }.disabled(flow.readState != .current)
            }
            if !job.parts.isEmpty {
              Button("Play retained audio") { onPlay(.init(job: job, source: .pro)) }
            }
          case .failed(let message):
            Text(message)
            Button("Reload narration status") { Task { await flow.restore() } }
            Button("Review narration quote") { Task { await flow.review() } }.disabled(flow.readState != .current)
          }
          Button("Play saved Pro narration") { Task { await flow.saved() } }
        }
      }.navigationTitle("Pro narration")
    }
    .task { await flow.restore() }
    // The external durable job continues even when this polling surface closes.
    .task(id: pendingID) {
      guard pendingID != nil else { return }
      while !Task.isCancelled {
        do { try await Task.sleep(for: .seconds(1)) } catch { return }
        await flow.refresh()
        if pendingID == nil || flow.readState != .current { return }
      }
    }
  }
}
