import Foundation
import HTTPTypes
import OpenAPIRuntime

public struct ProAllowance: Decodable, Sendable {
  public let eligible: Bool
  public let entitled: Bool
  public let availableSubcredits: Int64
  public let reservedSubcredits: Int64
  public let renewalAt: Int64?
  public let previousPeriodReservedSubcredits: Int64?
  public let history: [Usage]
  public let policy: Policy
  public let billing: Billing?
  public struct Billing: Decodable, Sendable {
    public let environment: String
    public let available: Bool
    public let monthlyUsd: Int
    public let monthlyCredits: Int
    public let state: String
    public let cancelAtEnd: Bool
    public let expiresAt: Int64?
    public let customerBound: Bool
  }
  public struct Usage: Decodable, Sendable, Identifiable {
    public let id: String
    public let feature: String
    public let state: String
    public let quote: Int64
    public let charged: Int64
    public let created_at: Int64
  }
  public struct Policy: Decodable, Sendable {
    public let version: String
    public let disclosure: String
  }
}

extension Session {
  public func proAllowance() async throws -> ProAllowance {
    let request = HTTPRequest(method: .get, scheme: nil, authority: nil, path: "/pro.status")
    let (response, body) = try await connection.exchange(
      request, json: nil, operationID: "pro.status", baseURL: origin.appending(path: "api/trpc"))
    guard (200..<300).contains(response.status.code), let body else { throw NativeAIError.unavailable }
    let bytes = try await Data(collecting: body, upTo: 1 << 18)
    struct Envelope: Decodable {
      struct Result: Decodable {
        struct Body: Decodable { let json: ProAllowance }
        let data: Body
      }
      let result: Result
    }
    let allowance = try JSONDecoder().decode(Envelope.self, from: bytes).result.data.json
    guard allowance.availableSubcredits >= 0, allowance.reservedSubcredits >= 0,
      allowance.history.allSatisfy({ $0.charged >= 0 && $0.charged <= $0.quote })
    else { throw NativeAIError.unavailable }
    return allowance
  }
}
