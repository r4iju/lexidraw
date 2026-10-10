import Foundation
import HTTPTypes
import OpenAPIRuntime

/// All app API and signed-storage calls pass this boundary. Provider transport
/// is deliberately separate and cannot receive the account's transport/token.
struct CredentialGuardedTransport: ClientTransport {
  let underlying: any ClientTransport
  func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws
    -> (HTTPResponse, HTTPBody?)
  {
    do {
      return try await sendChecked(request, body: body, baseURL: baseURL, operationID: operationID)
    } catch {
      try NativeCredentialGuard.shared.check(error: error)
      throw error
    }
  }

  private func sendChecked(
    _ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String
  ) async throws
    -> (HTTPResponse, HTTPBody?)
  {
    let guardrail = NativeCredentialGuard.shared
    try guardrail.check(Data((baseURL.absoluteString + (request.path ?? "")).utf8))
    for header in request.headerFields {
      try guardrail.check(Data((header.name.rawName + header.value).utf8))
    }
    let bytes = try await body.mapAsync { try await Data(collecting: $0, upTo: Int.max) }
    if let bytes { try guardrail.check(bytes) }
    // Body collection can suspend while credential custody changes.
    try guardrail.check(Data((baseURL.absoluteString + (request.path ?? "")).utf8))
    for header in request.headerFields {
      try guardrail.check(Data((header.name.rawName + header.value).utf8))
    }
    let (response, answer) = try await underlying.send(
      request, body: bytes.map { HTTPBody($0) },
      baseURL: baseURL, operationID: operationID)
    for header in response.headerFields {
      try guardrail.check(Data((header.name.rawName + header.value).utf8))
    }
    // Preserve lazy HTTPBody consumption. Scan the complete body on first
    // consumption so encoded values split across chunks cannot escape.
    let checked = answer.map {
      HTTPBody(CheckedResponseBody(body: $0, limit: operationID == "generatedImage.read" ? 2 << 20 : Int.max), length: $0.length, iterationBehavior: $0.iterationBehavior)
    }
    return (response, checked)
  }
}

extension Optional where Wrapped == HTTPBody {
  fileprivate func mapAsync(_ transform: (HTTPBody) async throws -> Data) async rethrows -> Data? {
    guard let value = self else { return nil }
    return try await transform(value)
  }
}

private struct CheckedResponseBody: AsyncSequence, Sendable {
  typealias Element = ArraySlice<UInt8>
  let body: HTTPBody
  let limit: Int
  struct AsyncIterator: AsyncIteratorProtocol {
    var body: HTTPBody?
    let limit: Int
    mutating func next() async throws -> Element? {
      guard let current = body else { return nil }
      body = nil
      do {
        let bytes = try await Data(collecting: current, upTo: limit)
        try NativeCredentialGuard.shared.check(bytes)
        return ArraySlice(bytes)
      } catch {
        try NativeCredentialGuard.shared.check(error: error)
        throw error
      }
    }
  }
  func makeAsyncIterator() -> AsyncIterator { .init(body: body, limit: limit) }
}
