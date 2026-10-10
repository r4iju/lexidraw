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
    // Chat publishes only complete guarded NDJSON frames. Other responses keep
    // whole-body scanning so artifact and ordinary API guards remain unchanged.
    let checked = answer.map {
      if operationID == "chat.stream" {
        return HTTPBody(CheckedChatBody(body: $0), length: $0.length, iterationBehavior: $0.iterationBehavior)
      }
      return HTTPBody(CheckedResponseBody(body: $0, limit: operationID == "generatedImage.read" ? 2 << 20 : Int.max), length: $0.length, iterationBehavior: $0.iterationBehavior)
    }
    return (response, checked)
  }
}

private struct CheckedChatBody: AsyncSequence, Sendable {
  typealias Element = ArraySlice<UInt8>
  let body: HTTPBody
  struct AsyncIterator: AsyncIteratorProtocol {
    var underlying: HTTPBody.AsyncIterator
    var wire = Data()
    var delivered = 0
    var finished = false
    mutating func next() async throws -> Element? {
      guard !finished else { return nil }
      do {
        while true {
          try Task.checkCancellation()
          if let newline = wire[delivered...].firstIndex(of: 10) {
            guard newline - delivered <= 128 << 10 else { throw NativeAIError.rejected }
            let frame = wire[delivered...newline]
            // Retain the bounded wire prefix for encoded/raw values spanning
            // transport chunks, and scan each JSON frame's decoded strings too.
            try NativeCredentialGuard.shared.check(wire)
            try NativeCredentialGuard.shared.check(Data(frame))
            delivered = newline + 1
            return ArraySlice(frame)
          }
          guard wire.count - delivered <= 128 << 10 else { throw NativeAIError.rejected }
          guard let chunk = try await underlying.next() else {
            finished = true
            try NativeCredentialGuard.shared.check(wire)
            guard delivered == wire.count else { throw NativeAIError.rejected }
            return nil
          }
          try Task.checkCancellation()
          guard chunk.count <= (1 << 20) - wire.count else { throw NativeAIError.rejected }
          wire.append(contentsOf: chunk)
        }
      } catch {
        finished = true
        try NativeCredentialGuard.shared.check(error: error)
        throw error
      }
    }
  }
  func makeAsyncIterator() -> AsyncIterator { .init(underlying: body.makeAsyncIterator()) }
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
