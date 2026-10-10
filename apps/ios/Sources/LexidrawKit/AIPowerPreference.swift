import Foundation
import HTTPTypes
import OpenAPIRuntime

public enum AIPowerPreference: String, Sendable, CaseIterable {
  case local, byok
}

extension Session {
  public func powerPreference() async throws -> AIPowerPreference {
    let data = try await powerRPC("auth.getPowerPreference", value: nil)
    struct Envelope: Decodable {
      struct Result: Decodable {
        struct Body: Decodable {
          struct Preference: Decodable {
            let mode: String
            let provider: String?
          }
          let json: Preference
        }
        let data: Body
      }
      let result: Result
    }
    guard let preference = try? JSONDecoder().decode(Envelope.self, from: data).result.data.json,
      preference.mode == "local"
        || (preference.mode == "byok" && preference.provider == "openrouter")
    else {
      throw NativeAIError.unavailable
    }
    return preference.mode == "byok" ? .byok : .local
  }

  public func setPowerPreference(_ preference: AIPowerPreference) async throws {
    var value = ["mode": preference.rawValue]
    if preference == .byok { value["provider"] = "openrouter" }
    _ = try await powerRPC("auth.setPowerPreference", value: value)
  }

  private func powerRPC(_ procedure: String, value: [String: String]?) async throws -> Data {
    let data = try value.map { try JSONSerialization.data(withJSONObject: ["json": $0]) }
    let request = HTTPRequest(
      method: value == nil ? .get : .post,
      scheme: nil, authority: nil, path: "/" + procedure)
    let (response, body) = try await connection.exchange(
      request, json: data,
      operationID: procedure, baseURL: origin.appending(path: "api/trpc"))
    guard (200..<300).contains(response.status.code), let body else {
      throw NativeAIError.unavailable
    }
    return try await Data(collecting: body, upTo: 1 << 16)
  }
}
