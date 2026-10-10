import Foundation
import LexidrawKit
import SwiftUI
struct DeviceAgentFixtureScreen: View {
 let session: Session
 @State private var runtime: NativeBYOK?
 @State private var flow: NativeDeviceAgentFlow?
 @State private var evidence = ""
 @State private var keyRevision = 0
 var body: some View {
  VStack {
   Text("288 injected device action fixture").font(.headline)
   Text("Production composer and authenticated document adapter. Provider intercepted, actual access and quality unverified.").font(.caption)
   HStack {
    Button("Connect fixture key") { try? runtime?.replaceKey("opaque-native-agent-fixture-288"); keyRevision += 1 }
    Button("Remove fixture key") { try? runtime?.removeKey(); keyRevision += 1 }
   }
   if let flow { DeviceAgentContent(flow: flow).id(keyRevision) }
   Button("Read saved document and usage") { Task { do { let doc = try await session.deviceAgentSource(document: "doc"); let allowance = try await session.proAllowance(); evidence = "Saved: \(doc.text)\nHistory: \(allowance.history.count), available: \(Double(allowance.availableSubcredits)/1_000_000)" } catch { evidence = "Fixture read failed" } } }
   Text(evidence).font(.caption)
  }.task {
   let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [NativeAIProviderFixture.self]
   let value = NativeBYOK(store: DeviceAgentFixtureKey(), configuration: configuration, agentFixture: true)
   let directory = FileManager.default.temporaryDirectory.appending(path: "288-device-agent-fixture")
   let action = NativeDeviceAgentFlow(account: "alice", document: "doc", runtime: value, directory: directory, available: true, read: { try await session.deviceAgentSource(document: "doc") }, apply: { try await session.commitDeviceAgentEdit($0) })
   try? action.restore()
   runtime = value; flow = action
  }
 }
}
private final class DeviceAgentFixtureKey: TokenStore, @unchecked Sendable {
 private var value: String?
 func load() throws -> String? { value }
 func save(_ token: String) throws { value = token }
 func delete() throws { value = nil }
}
