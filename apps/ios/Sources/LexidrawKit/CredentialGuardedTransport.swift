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
    let bytes = try await body.mapAsync { try await Data(collecting: $0, upTo: 32 << 20) }
    if let bytes { try guardrail.check(bytes) }
    let (response, answer) = try await underlying.send(
      request, body: bytes.map { HTTPBody($0) },
      baseURL: baseURL, operationID: operationID)
    for header in response.headerFields {
      try guardrail.check(Data((header.name.rawName + header.value).utf8))
    }
    let returned = try await answer.mapAsync { try await Data(collecting: $0, upTo: 64 << 20) }
    if let returned { try guardrail.check(returned) }
    return (response, returned.map { HTTPBody($0) })
  }
}

extension Optional where Wrapped == HTTPBody {
  fileprivate func mapAsync(_ transform: (HTTPBody) async throws -> Data) async rethrows -> Data? {
    guard let value = self else { return nil }
    return try await transform(value)
  }
}
