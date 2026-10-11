import Foundation

public struct ProNonAcceptance: Error, Decodable, Equatable, Sendable {
  public enum Kind: String, Decodable, Sendable { case not_accepted }
  public enum Feature: String, Decodable, Sendable { case text, chat, autocomplete, image, narration, agent }
  public enum Reason: String, Decodable, Sendable { case request_limit, active_autocomplete, insufficient_credits }
  public let kind: Kind
  public let feature: Feature
  public let idempotencyKey: String
  public let reason: Reason

  static func fromRPC(_ data: Data) -> ProNonAcceptance? {
    struct Failure: Decodable {
      struct Body: Decodable {
        struct JSON: Decodable {
          struct Fields: Decodable { let proNonAcceptance: ProNonAcceptance? }
          let data: Fields
        }
        let json: JSON
      }
      let error: Body
    }
    return try? JSONDecoder().decode(Failure.self, from: data).error.json.data.proNonAcceptance
  }
}
