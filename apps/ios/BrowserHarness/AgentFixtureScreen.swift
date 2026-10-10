import LexidrawKit
import SwiftUI
struct AgentFixtureScreen:View {
 let session:Session
 @State private var evidence=""
 var body:some View {
  VStack {
   Text("287 injected whole-action fixture").font(.headline)
   Text("Production action UI and document adapter with isolated shared account ledger. No actual provider verification.").font(.caption)
   DocumentAgentComposer(session:session,document:"doc")
   Button("Read saved document and usage") {Task{do{let (data,_)=try await URLSession.shared.data(from:URL(string:"http://127.0.0.1:3087/fixture-state")!);let json=try JSONSerialization.jsonObject(with:data) as? [String:Any];let document=json?["document"] as? [String:Any];let allowance=try await session.proAllowance();evidence="Saved: \(document?["text"] as? String ?? "")\nAvailable: \(Double(allowance.availableSubcredits)/1_000_000)"}catch{evidence="Fixture read failed"}}}
   Text(evidence).font(.caption).accessibilityIdentifier("agent fixture evidence")
  }
 }
}
