import CryptoKit
import Foundation

/// Fingerprints survive retirement to detect late results and queued egress,
/// without extending the lifetime of recoverable Keychain material.
public final class NativeCredentialGuard: @unchecked Sendable {
  public static let shared = NativeCredentialGuard()
  private struct Fingerprint: Hashable, Codable {
    let digest: Data
    let prefix: Data
    let length: Int
  }
  private let lock = NSLock()
  private var fingerprints = Set<Fingerprint>()

  public func remember(_ key: String) {
    let bytes = Data(key.utf8)
    let fingerprint = Fingerprint(
      digest: Data(SHA256.hash(data: bytes)),
      prefix: Data(bytes.prefix(min(4, bytes.count / 2))), length: bytes.count)
    lock.lock()
    defer { lock.unlock() }
    fingerprints.insert(fingerprint)
  }

  public func snapshot() throws -> Data {
    lock.lock()
    let values = Array(fingerprints)
    lock.unlock()
    return try JSONEncoder().encode(values)
  }
  public func restore(_ data: Data) throws {
    guard data.count <= 32_000 else { throw NativeAIError.rejected }
    let values = try JSONDecoder().decode([Fingerprint].self, from: data)
    guard values.count <= 128,
      values.allSatisfy({
        $0.digest.count == 32 && $0.prefix.count <= 4 && (1...4096).contains($0.length)
      })
    else { throw NativeAIError.rejected }
    lock.lock()
    fingerprints.formUnion(values)
    lock.unlock()
  }
  public func check(_ data: Data) throws {
    lock.lock()
    let known = fingerprints
    lock.unlock()
    func checkBytes(_ bytes: Data) throws {
      for key in known where bytes.count >= key.length {
        var offset = bytes.startIndex
        while offset <= bytes.endIndex - key.length {
          if !key.prefix.isEmpty {
            guard let range = bytes.range(of: key.prefix, in: offset..<bytes.endIndex),
              range.lowerBound <= bytes.endIndex - key.length
            else { break }
            offset = range.lowerBound
          }
          if Data(SHA256.hash(data: bytes[offset..<(offset + key.length)])) == key.digest {
            throw NativeAIError.rejected
          }
          offset += 1
        }
      }
    }
    if data.range(of: Data([0x1f, 0x8b, 0x08])) != nil
      || data.range(of: Data([0x50, 0x4b, 0x03, 0x04])) != nil
      || (data.first == 0x78 && data.count > 1
        && [0x01, 0x9c, 0xda].contains(data[data.startIndex + 1]))
    {
      throw NativeAIError.rejected
    }
    try checkBytes(data)
    let initial = String(decoding: data, as: UTF8.self)
    // Each decoding step shrinks its input. No node cap rejects legitimate
    // large artifacts merely because they contain many encoded safe fields.
    var pending = [initial]
    var seen = Set<Data>()
    let minimum = known.map(\.length).min() ?? 16
    while let text = pending.popLast() {
      guard seen.insert(Data(SHA256.hash(data: Data(text.utf8)))).inserted else { continue }
      try checkBytes(Data(text.utf8))
      if text.range(
        of: #"(?:^\x{78}[\x{01}\x{9c}\x{da}]|\x{1f}\x{8b}\x{08}|PK\x{03}\x{04})"#,
        options: .regularExpression) != nil
        || text.range(
          of:
            #""(?:apiKey|baseURL|providerOptions|rawResponse|providerConfig|requestBody|providerMetadata)"\s*:"#,
          options: .regularExpression) != nil
      {
        throw NativeAIError.rejected
      }
      if text.range(of: #"sk-(?:or-v1-|ant-)?[A-Za-z0-9_-]{16,}"#, options: .regularExpression)
        != nil
      {
        throw NativeAIError.rejected
      }
      guard !known.isEmpty else { continue }
      func enqueue(_ decoded: String) {
        if decoded.utf8.count < text.utf8.count { pending.append(decoded) }
      }
      enqueue(
        Self.replace(text, pattern: #"(?:%[a-fA-F0-9]{2})+"#) { match in
          let bytes = Self.matches(match[0], pattern: #"%([a-fA-F0-9]{2})"#).compactMap {
            UInt8($0[1], radix: 16)
          }
          // Invalid UTF-8 next to ASCII credentials must not discard the valid bytes.
          return String(decoding: bytes, as: UTF8.self)
        })
      enqueue(
        Self.replace(text, pattern: #"\\u([a-fA-F0-9]{4})"#) { match in
          guard let value = UInt32(match[1], radix: 16), let scalar = UnicodeScalar(value) else {
            return match[0]
          }
          return String(scalar)
        })
      enqueue(
        Self.replace(text, pattern: #"&#(x[a-fA-F0-9]+|[0-9]+);"#) { match in
          let code = match[1]
          guard
            let value = UInt32(
              code.hasPrefix("x") ? String(code.dropFirst()) : code,
              radix: code.hasPrefix("x") ? 16 : 10), let scalar = UnicodeScalar(value)
          else { return match[0] }
          return String(scalar)
        })
      for token in Self.matches(text, pattern: #"(?:[a-fA-F0-9]{2}){6,}"#)
      where token[0].count >= minimum * 2 {
        let hex = Array(token[0].utf8)
        var bytes = Data()
        for index in stride(from: 0, to: hex.count, by: 2) {
          if let byte = UInt8(String(decoding: hex[index..<index + 2], as: UTF8.self), radix: 16) {
            bytes.append(byte)
          }
        }
        enqueue(String(decoding: bytes, as: UTF8.self))
      }
      for token in Self.matches(text, pattern: #"[A-Za-z0-9+/_-]{8,}={0,2}"#)
      where token[0].count >= (minimum * 4 + 2) / 3 {
        var base64 = token[0].replacingOccurrences(of: "-", with: "+").replacingOccurrences(
          of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        if let bytes = Data(base64Encoded: base64) {
          enqueue(String(decoding: bytes, as: UTF8.self))
        }
      }
      if let json = try? JSONSerialization.jsonObject(
        with: Data(text.utf8), options: .fragmentsAllowed)
      {
        var values: [Any] = [json]
        while let value = values.popLast() {
          if let string = value as? String {
            enqueue(string)
          } else if let list = value as? [Any] {
            values.append(contentsOf: list)
          } else if let object = value as? [String: Any] {
            values.append(contentsOf: object.keys.map { $0 as Any })
            values.append(contentsOf: object.values)
          }
        }
      }
    }
  }

  private static func matches(_ text: String, pattern: String) -> [[String]] {
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
    return regex.matches(in: text, range: NSRange(text.startIndex..., in: text)).map { match in
      (0..<match.numberOfRanges).map { index in
        Range(match.range(at: index), in: text).map { String(text[$0]) } ?? ""
      }
    }
  }

  private static func replace(_ text: String, pattern: String, transform: ([String]) -> String)
    -> String
  {
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return text }
    var result = ""
    var start = text.startIndex
    for match in regex.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
      guard let range = Range(match.range, in: text) else { continue }
      result += text[start..<range.lowerBound]
      let captures = (0..<match.numberOfRanges).map { index in
        Range(match.range(at: index), in: text).map { String(text[$0]) } ?? ""
      }
      result += transform(captures)
      start = range.upperBound
    }
    result += text[start...]
    return result
  }

  public func check(error: Error) throws {
    try check(Data(error.localizedDescription.utf8))
    try check(Data(String(describing: error).utf8))
    // Swift Error payloads need not appear in NSError.userInfo. Inspect their
    // stored fields before returning an error to callers that may log it.
    var pending: [Any] = [error, (error as NSError).userInfo]
    var seen = Set<ObjectIdentifier>()
    while let value = pending.popLast() {
      if let text = value as? String {
        try check(Data(text.utf8))
        continue
      }
      if let bytes = value as? Data {
        try check(bytes)
        continue
      }
      if let url = value as? URL {
        try check(Data(url.absoluteString.utf8))
        continue
      }
      let mirror = Mirror(reflecting: value)
      if mirror.displayStyle == .class {
        guard seen.insert(ObjectIdentifier(value as AnyObject)).inserted else { continue }
      }
      var fields: Mirror? = mirror
      while let current = fields {
        pending.append(contentsOf: current.children.map(\.value))
        fields = current.superclassMirror
      }
    }
  }

  public func check(_ request: URLRequest, body: Data? = nil) throws {
    try check(Data((request.url?.absoluteString ?? "").utf8))
    for (name, value) in request.allHTTPHeaderFields ?? [:] { try check(Data((name + value).utf8)) }
    if let data = body ?? request.httpBody { try check(data) }
  }
}
