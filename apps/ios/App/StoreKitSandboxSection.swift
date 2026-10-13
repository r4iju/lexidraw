import LexidrawKit
import SwiftUI

struct StoreKitSandboxSection: View {
  let eligible: Bool
  let refresh: @MainActor () async -> Void
  private let purchase: StoreKitSandbox
  private enum State { case checking, unavailable, ready(String?), working }
  @State private var state = State.checking
  @State private var action: Task<Void, Never>?
  init(session: Session, eligible: Bool, refresh: @escaping @MainActor () async -> Void) {
    self.eligible = eligible
    self.refresh = refresh
    purchase = StoreKitSandbox(session: session)
  }
  var body: some View {
    Section("Apple sandbox/test purchase") {
      if !eligible {
        Text("Pro Coming soon. Public purchases are unavailable.")
      } else {
        Text("Sandbox test only · $12/month · 1,000 credits per period")
        Text("Purchase and restore require a dedicated internal iOS test build and verified Apple sandbox setup. App Store builds cannot purchase Pro.").font(.footnote)
        switch state {
        case .checking: ProgressView("Checking sandbox availability…")
        case .unavailable:
          Text("Apple sandbox billing unavailable. This build, product or server verification is unavailable.")
          Button("Check sandbox availability") { action = Task { await check() } }
        case .working: ProgressView("Waiting for sandbox verification…")
        case .ready(let message):
          if let message { Text(message) }
          Button("Buy sandbox monthly Pro") { perform(restore: false) }
          Button("Restore sandbox purchases") { perform(restore: true) }
        }
        Text("One account allowance shared with web. No rollover, top-ups or overage. A pending or unverified purchase grants no credits.").font(.footnote)
      }
    }
    .task {
      await check()
      await purchase.observeUpdates { await refresh() }
    }
    .onDisappear { action?.cancel() }
  }
  private func check() async {
    state = .checking
    let available = eligible ? await purchase.availability() : false
    guard !Task.isCancelled else { return }
    state = available ? .ready(nil) : .unavailable
  }
  private func perform(restore: Bool) {
    state = .working
    action = Task {
      do {
        let result = try await (restore ? purchase.restore() : purchase.purchase())
        guard !Task.isCancelled else { return }
        await refresh()
        switch result {
        case .verified: state = .ready("Sandbox transaction verified. Account allowance refreshed.")
        case .restored(let count): state = .ready(count == 0 ? "No sandbox purchases found." : "Sandbox purchases restored. The shared allowance was refreshed.")
        case .pending: state = .ready("Sandbox purchase pending. No allowance granted yet.")
        case .cancelled: state = .ready("Sandbox purchase cancelled.")
        }
      } catch { state = .unavailable }
    }
  }
}
