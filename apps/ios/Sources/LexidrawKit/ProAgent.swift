import Foundation
import HTTPTypes
import OpenAPIRuntime
import Observation
public struct ProAgentResult: Decodable, Sendable {
 public struct Operation: Decodable, Sendable { public let id:String; public let state:String; public let charged:Int64; public let quote:Int64 }
 public struct Report: Decodable, Sendable {
  public struct Edit: Decodable, Sendable { public let revision:Int64; public let description:String }
  public let status:String; public let completed:[Edit]; public let incomplete:[String]; public let reason:String?
 }
 public let operation:Operation; public let report:Report
}
public struct ProAgentCapability: Decodable, Sendable { public let available:Bool; public let reason:String }
public struct ProAgentQuote: Decodable, Sendable { public let maximum:Int64; public let revision:Int64 }
private struct AgentEnvelope<Value:Decodable>:Decodable {struct Result:Decodable {struct Body:Decodable {let json:Value};let data:Body};let result:Result}
private struct AgentPayload<Value:Encodable>:Encodable {let json:Value}
extension Session {
 public func proAgentCapability() async throws -> ProAgentCapability {try await agentRPC("agentPower.capability",input:Optional<String>.none,as:ProAgentCapability.self)}
 public func quoteProAgent(document:String,prompt:String) async throws -> ProAgentQuote {
  struct Input:Encodable{let documentId:String;let prompt:String}
  return try await agentRPC("agentPower.quote",input:Input(documentId:document,prompt:prompt),as:ProAgentQuote.self)
 }
 public func startProAgent(document:String,revision:Int64,prompt:String,id:String,maximum:Int64) async throws -> ProAgentResult {
  guard prompt.utf8.count<=1500,maximum>0 else {throw NativeAIError.unavailable}
  struct Input:Encodable{let documentId:String;let revision:Int64;let prompt:String;let idempotencyKey:String;let acceptedMaximum:Int64}
  return try await agentRPC("agentPower.start",input:Input(documentId:document,revision:revision,prompt:prompt,idempotencyKey:id,acceptedMaximum:maximum),as:ProAgentResult.self)
 }
 public func stopProAgent(_ id:String) async throws -> ProAgentResult {struct Input:Encodable{let id:String};return try await agentRPC("agentPower.cancel",input:Input(id:id),as:ProAgentResult.self)}
 public func currentProAgent(document:String) async throws -> ProAgentResult? {
  struct Input:Encodable{let documentId:String}
  let data=try JSONEncoder().encode(AgentPayload(json:Input(documentId:document)))
  var components=URLComponents();components.path="/agentPower.current";components.queryItems=[URLQueryItem(name:"input",value:String(decoding:data,as:UTF8.self))]
  return try await agentRPC("agentPower.current",input:Optional<String>.none,as:Optional<ProAgentResult>.self,path:components.string)
 }
 public func proAgentOperation(_ id:String) async throws -> ProAgentResult {
  struct Input:Encodable{let id:String}
  let data=try JSONEncoder().encode(AgentPayload(json:Input(id:id)))
  var components=URLComponents();components.path="/agentPower.operation";components.queryItems=[URLQueryItem(name:"input",value:String(decoding:data,as:UTF8.self))]
  return try await agentRPC("agentPower.operation",input:Optional<String>.none,as:ProAgentResult.self,path:components.string)
 }
 private func agentRPC<Input:Encodable,Value:Decodable>(_ procedure:String,input:Input?,as:Value.Type,path:String?=nil) async throws -> Value {
  let data=try input.map{try JSONEncoder().encode(AgentPayload(json:$0))};if let data{try NativeCredentialGuard.shared.check(data)}
  let request=HTTPRequest(method:input == nil ? .get : .post,scheme:nil,authority:nil,path:path ?? "/"+procedure)
  let (response,body)=try await connection.exchange(request,json:data,operationID:procedure,baseURL:origin.appending(path:"api/trpc"))
  guard (200..<300).contains(response.status.code),let body else {throw NativeAIError.unavailable}
  let bytes=try await Data(collecting:body,upTo:1<<18);try NativeCredentialGuard.shared.check(bytes)
  let result=try JSONDecoder().decode(AgentEnvelope<Value>.self,from:bytes).result.data.json
  if let action=result as? ProAgentResult {guard action.operation.charged>=0,action.operation.charged<=action.operation.quote else{throw NativeAIError.unavailable}}
  return result
 }
}
@MainActor @Observable public final class NativeAgentFlow {
 public enum State {case loading,ready,unavailable(String),quoting,quote(String,ProAgentQuote,String),acceptanceUncertain(String,ProAgentQuote,String),running(String),result(ProAgentResult),error(String)}
 public private(set) var readState: ProReadState = .current
 public private(set) var cancellationUnconfirmed = false
 public enum Capability { case loading, available, unavailable(String), failed }
 public private(set) var capability: Capability = .loading
 public private(set) var state:State = .loading
 private var generationSelected = true
 public func selectGeneration(_ selected: Bool) { generationSelected = selected }
 public var canStart: Bool {
  guard generationSelected, case .available = capability, readState == .current else { return false }
  switch state { case .ready, .quote, .acceptanceUncertain, .error: return true; case .result(let result): return !["reserved","running","unknown"].contains(result.operation.state); default: return false }
 }
 private let session:Session
 private let document:String
 public init(session:Session,document:String){self.session=session;self.document=document}
 public func load() async {
  // Existing account/document-owned work is readable without a generation capability.
  readState = .loading
  do {
   _ = try session.aiHandle.existing()
   if let current = try await session.currentProAgent(document: document) { state = .result(current) }
   else if case .acceptanceUncertain = state { /* No record yet does not invalidate a submitted identity. */ }
   else { state = .ready }
   _ = try session.aiHandle.existing()
   readState = .current
  } catch { failedRead(error, message: "Action status could not be loaded. Retry status before starting new work.") }
  await retryCapability()
 }
 public func retryCapability() async {
  capability = .loading
  do {
   let value = try await session.proAgentCapability()
   capability = value.available ? .available : .unavailable(value.reason)
  } catch { capability = .failed }
 }
 public func quote(_ prompt:String) async {guard canStart else{return};state = .quoting;do{state = .quote(prompt,try await session.quoteProAgent(document:document,prompt:prompt),UUID().uuidString)}catch{state = .error("Could not quote this document action. Check Pro access and save the document first.")}}
 public func decline(){
  if case .acceptanceUncertain = state { return }
  if case .result(let result) = state, ["reserved","running","unknown"].contains(result.operation.state) { return }
  state = .ready
 }
 public func accept() async {
  guard canStart else { return }
  let prompt: String; let quote: ProAgentQuote; let id: String
  switch state { case .quote(let p, let q, let k), .acceptanceUncertain(let p, let q, let k): prompt = p; quote = q; id = k; default: return }
  state = .running(id)
  do{let result=try await session.startProAgent(document:document,revision:quote.revision,prompt:prompt,id:id,maximum:quote.maximum);state = .result(result)}catch{state = .acceptanceUncertain(prompt,quote,id)}
 }
 public func refresh() async {
  guard case .result(let result) = state else { await load(); return }
  readState = .loading
  do {
   _ = try session.aiHandle.existing()
   let updated = try await session.proAgentOperation(result.operation.id)
   _ = try session.aiHandle.existing()
   guard updated.operation.id == result.operation.id else { throw NativeAIError.unavailable }
   state = .result(updated)
   readState = .current
   if !["reserved","running","unknown"].contains(updated.operation.state) { cancellationUnconfirmed = false }
  } catch { failedRead(error, message: "Action status could not be refreshed. Displayed progress may be out of date.") }
 }
 public func cancel() async {
  guard case .result(let result) = state else { return }
  cancellationUnconfirmed = true
  do {
   _ = try session.aiHandle.existing()
   let stopped = try await session.stopProAgent(result.operation.id)
   _ = try session.aiHandle.existing()
   guard stopped.operation.id == result.operation.id else { throw NativeAIError.unavailable }
   state = .result(stopped)
   readState = .current
   cancellationUnconfirmed = ["reserved","running","unknown"].contains(stopped.operation.state)
  } catch { failedRead(error, message: "Cancellation could not be confirmed. Refresh status before assuming further work stopped.") }
 }
 private func failedRead(_ error: any Error, message: String) {
  if proAccessDenied(error) {
   state = .error("Access to this action is no longer available.")
   readState = .denied
   capability = .failed
   cancellationUnconfirmed = false
  } else {
   readState = .stale(message)
   if case .loading = state { state = .error(message) }
  }
 }
}
