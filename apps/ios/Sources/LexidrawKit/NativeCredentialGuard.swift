import CryptoKit
import Foundation
import zlib

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

  public init() {}
  private static func encoded(_ values: Set<Fingerprint>) throws -> Data {
    guard values.count <= 128,
      values.allSatisfy({
        $0.digest.count == 32 && $0.prefix.count <= 4 && (1...4096).contains($0.length)
      })
    else { throw NativeAIError.rejected }
    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys
    let data = try encoder.encode(values.sorted { $0.digest.lexicographicallyPrecedes($1.digest) })
    guard data.count <= 32_000 else { throw NativeAIError.rejected }
    return data
  }

  public func remember(_ key: String) throws {
    let bytes = Data(key.utf8)
    let fingerprint = Fingerprint(
      digest: Data(SHA256.hash(data: bytes)),
      prefix: Data(bytes.prefix(min(4, bytes.count / 2))), length: bytes.count)
    lock.lock()
    defer { lock.unlock() }
    let admitted = fingerprints.union([fingerprint])
    _ = try Self.encoded(admitted)
    fingerprints = admitted
  }

  public func snapshot() throws -> Data {
    lock.lock()
    defer { lock.unlock() }
    return try Self.encoded(fingerprints)
  }
  public func restore(_ data: Data) throws {
    guard data.count <= 32_000 else { throw NativeAIError.rejected }
    let values = try JSONDecoder().decode([Fingerprint].self, from: data)
    guard values.count <= 128 else { throw NativeAIError.rejected }
    let restored = Set(values)
    _ = try Self.encoded(restored)
    lock.lock()
    defer { lock.unlock() }
    let union = fingerprints.union(restored)
    _ = try Self.encoded(union)
    fingerprints = union
  }
  public func check(_ data: Data) throws {
    try scan(data, audioSamples: NativeAudioFormat.isCanonicalWAV(data))
  }
  // Only the declared raw PCM provider adapter may use this boundary. JSON/outbound callers use check.
  func checkPCM(_ data: Data) throws {
    guard !data.isEmpty, data.count <= 5_760_000, data.count % 2 == 0 else { throw NativeAIError.rejected }
    try scan(data, audioSamples: true)
  }
  private struct PNG { let idat: Data; let channels: Int }
  private static func boundedPNG(_ raw: Data) -> PNG? {
    guard raw.count >= 57, raw.count <= 2 << 20,
      raw.prefix(8) == Data([137, 80, 78, 71, 13, 10, 26, 10]) else { return nil }
    let data = Data(raw)
    func word(_ offset: Int) -> Int {
      (0..<4).reduce(0) { $0 * 256 + Int(data[offset + $1]) }
    }
    func crc(_ range: Range<Int>) -> UInt32 {
      var value: UInt32 = 0xffff_ffff
      for byte in data[range] {
        value ^= UInt32(byte)
        for _ in 0..<8 { value = (value >> 1) ^ (value & 1 == 1 ? 0xedb8_8320 : 0) }
      }
      return value ^ 0xffff_ffff
    }
    var offset = 8, chunks = 0, channels = 0
    var idat = Data()
    while offset + 12 <= data.count {
      let size = word(offset)
      guard size <= 2 << 20, offset + size + 12 <= data.count,
        crc(offset + 4..<offset + size + 8) == UInt32(word(offset + size + 8)) else { return nil }
      let type = String(decoding: data[offset + 4..<offset + 8], as: UTF8.self)
      if chunks == 0 {
        guard type == "IHDR", size == 13, word(offset + 8) == 1024, word(offset + 12) == 1024,
          data[offset + 16] == 8, [2, 6].contains(data[offset + 17]),
          data[offset + 18...offset + 20] == Data([0, 0, 0]) else { return nil }
        channels = data[offset + 17] == 2 ? 3 : 4
      } else if type == "IDAT" { idat.append(data[offset + 8..<offset + 8 + size]) }
      else if type == "IEND" {
        return !idat.isEmpty && size == 0 && offset + 12 == data.count
          ? PNG(idat: idat, channels: channels) : nil
      }
      else { return nil }
      chunks += 1
      offset += size + 12
    }
    return nil
  }
  private func scan(_ data: Data, audioSamples: Bool) throws {
    // Enforce the scan budget before candidate searches, hashing or decoding.
    guard data.count <= 512 << 20 else { throw NativeAIError.rejected }
    lock.lock()
    let known = fingerprints
    lock.unlock()
    var fingerprintChecks = 0
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
          fingerprintChecks += 1
          guard fingerprintChecks <= 16_384 else { throw NativeAIError.rejected }
          if Data(SHA256.hash(data: bytes[offset..<(offset + key.length)])) == key.digest {
            throw NativeAIError.rejected
          }
          offset += 1
        }
      }
    }
    // PCM/WAV validates the format, never the confidentiality of its samples.
    // A valid (or partially recoverable) compressed node is not PCM content.
    // Invalid incidental markers are allowed in typed audio and PNG channel bytes.
    var candidates = 0
    var inflatedWork = 0
    var compressedWork = 0
    var imageWork = 0
    var compressedDecoded: [Data] = []
    var audioContext = audioSamples
    func compressed(_ bytes: Data, samples: Bool, depth: Int = 0, typedPixels: Bool = false) throws {
      guard depth <= 8 else { throw NativeAIError.rejected }
      guard bytes.count >= 2 else { return }
      if samples { audioContext = true }
      if !audioContext, let png = Self.boundedPNG(bytes) {
        let stride = 1024 * png.channels + 1
        let expected = stride * 1024
        imageWork += expected
        guard imageWork <= 512 << 20 else { throw NativeAIError.rejected }
        var recovered = Data(count: expected + 1)
        var size = uLongf(recovered.count)
        var inputSize = uLong(png.idat.count)
        let result = recovered.withUnsafeMutableBytes { output in
          png.idat.withUnsafeBytes { input in
            uncompress2(output.bindMemory(to: UInt8.self).baseAddress!, &size,
              input.bindMemory(to: UInt8.self).baseAddress!, &inputSize)
          }
        }
        guard result == Z_OK, size == expected, inputSize == png.idat.count else {
          throw NativeAIError.rejected
        }
        recovered.count = expected
        try checkBytes(recovered)
        // Typed channels can contain incidental headers. Recoverable compressed
        // nodes still use the same finite scanner before image admission.
        try compressed(recovered, samples: false, depth: depth + 1, typedPixels: true)
        // Inspect both the inflated IDAT bytes and reconstructed channel bytes.
        // PNG filters are reversible and cannot hide the supplied credential.
        var pixels = Data(capacity: expected - 1024)
        for row in 0..<1024 {
          let start = row * stride, filter = Int(recovered[start])
          guard filter <= 4 else { throw NativeAIError.rejected }
          if filter != 0 {
            for column in 1..<stride {
              let index = start + column
              let a = column > png.channels ? Int(recovered[index - png.channels]) : 0
              let b = row > 0 ? Int(recovered[index - stride]) : 0
              let c = row > 0 && column > png.channels ? Int(recovered[index - stride - png.channels]) : 0
              let predictor: Int
              switch filter {
              case 1: predictor = a
              case 2: predictor = b
              case 3: predictor = (a + b) / 2
              default:
                let p = a + b - c
                let pa = abs(p - a), pb = abs(p - b), pc = abs(p - c)
                predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
              }
              recovered[index] = UInt8((Int(recovered[index]) + predictor) & 255)
            }
          }
          pixels.append(recovered[start + 1..<start + stride])
        }
        try checkBytes(pixels)
        try compressed(pixels, samples: false, depth: depth + 1, typedPixels: true)
        // Standard textual representations in channel bytes use the same
        // finite decoder queue as text and audio, without treating pixels as UTF-8.
        pixels.withUnsafeBytes { raw in
          let bytes = raw.bindMemory(to: UInt8.self)
          var start: Int?
          for index in bytes.indices {
            let byte = bytes[index]
            if (byte >= 32 && byte <= 126) || byte == 9 || byte == 10 || byte == 13 {
              if start == nil { start = index }
            } else if let lower = start {
              if index - lower >= 8 { compressedDecoded.append(Data(bytes[lower..<index])) }
              start = nil
            }
          }
          if let start, bytes.count - start >= 8 {
            compressedDecoded.append(Data(bytes[start..<bytes.count]))
          }
        }
        return
      }
      var offsets = Set<Int>()
      // Foundation's byte search avoids a Swift loop over every sample in a
      // large ordinary transfer. Only plausible headers reach zlib.
      for lead in [UInt8](arrayLiteral: 0x1f, 0x08, 0x18, 0x28, 0x38, 0x48, 0x58, 0x68, 0x78, 0x50) {
        var cursor = bytes.startIndex
        while cursor < bytes.endIndex,
          let range = bytes.range(of: Data([lead]), in: cursor..<bytes.endIndex) {
          let offset = range.lowerBound
          cursor = offset + 1
          guard offset + 1 < bytes.endIndex else { break }
          let gzip = lead == 0x1f && bytes[offset + 1] == 0x8b
            && offset + 2 < bytes.endIndex && bytes[offset + 2] == 8
          let header = lead & 15 == 8 && lead >> 4 <= 7
            && (Int(lead) * 256 + Int(bytes[offset + 1])) % 31 == 0
          let zip = lead == 0x50 && offset + 3 < bytes.endIndex
            && bytes[offset...offset + 3] == Data([0x50, 0x4b, 3, 4])
          if zip {
            // Samples can contain magic bytes. Recognize an actual bounded local
            // file header before treating typed samples as an archive.
            let remaining = bytes.endIndex - offset
            func word(_ index: Int) -> Int {
              Int(bytes[offset + index]) + Int(bytes[offset + index + 1]) * 256
            }
            if !samples && !typedPixels { throw NativeAIError.rejected }
            if remaining >= 30 {
              let version = word(4), name = word(26), extra = word(28)
              if (10...63).contains(version) && (1...4096).contains(name)
                && extra <= 16_384 && 30 + name + extra <= remaining {
                throw NativeAIError.rejected
              }
            }
          }
          guard gzip || header else { continue }
          if !audioContext && !typedPixels && (gzip || (offset == bytes.startIndex && lead == 0x78 && [0x01, 0x9c, 0xda].contains(bytes[offset + 1]))) { throw NativeAIError.rejected }
          offsets.insert(offset)
        }
      }
      for offset in offsets.sorted() {
        var stream = z_stream()
        guard inflateInit2_(&stream, 47, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) == Z_OK
        else { throw NativeAIError.rejected }
        defer { inflateEnd(&stream) }
        var output = [UInt8](repeating: 0, count: 4096)
        let result = bytes.withUnsafeBytes { raw in
          let source = raw.bindMemory(to: UInt8.self)
          return output.withUnsafeMutableBufferPointer { destination in
            stream.next_in = UnsafeMutablePointer(mutating: source.baseAddress! + offset - bytes.startIndex)
            stream.avail_in = uInt(min(bytes.endIndex - offset, 65_536))
            stream.next_out = destination.baseAddress!
            stream.avail_out = uInt(destination.count)
            return inflate(&stream, Z_NO_FLUSH)
          }
        }
        inflatedWork += Int(stream.total_out)
        guard inflatedWork <= 262_144 else { throw NativeAIError.rejected }
        compressedWork += Int(stream.total_in)
        guard compressedWork <= 512 << 20 else { throw NativeAIError.rejected }
        // Header bytes alone occur in ordinary PCM. Only a recoverable node
        // spends candidate capacity; all attempted input still spends work.
        if stream.total_out > 0 || result == Z_STREAM_END {
          candidates += 1
          guard candidates <= 4096 else { throw NativeAIError.rejected }
        }
        // Even an incomplete stream with recoverable output can contain a key.
        if stream.total_out > 0 {
          try checkBytes(Data(output.prefix(Int(stream.total_out))))
          let plain = String(decoding: output.prefix(Int(stream.total_out)), as: UTF8.self)
          if result == Z_STREAM_END || stream.avail_out == 0
            || plain.range(of: #"sk-(?:or-v1-|ant-)?[A-Za-z0-9_-]{16,}"#, options: .regularExpression) != nil {
            throw NativeAIError.rejected
          }
          let recovered = Data(output.prefix(Int(stream.total_out)))
          try compressed(recovered, samples: false, depth: depth + 1)
          compressedDecoded.append(recovered)
        }
        if result == Z_STREAM_END || (result == Z_OK && stream.avail_in == 0 && bytes.endIndex - offset > 65_536) {
          throw NativeAIError.rejected
        }
      }
    }
    try compressed(data, samples: audioSamples)
    try checkBytes(data)
    if data.allSatisfy({ $0 == 0 || $0 == 32 }) { return }
    let initial = String(decoding: data, as: UTF8.self)
    // Decode within a finite total work budget; sample status never propagates to a decoded node.
    var pending = [(initial, false)]
    var seen = Set<Data>()
    var decodedWork = 0
    while !pending.isEmpty || !compressedDecoded.isEmpty {
      for bytes in compressedDecoded { pending.append((String(decoding: bytes, as: UTF8.self), false)) }
      compressedDecoded.removeAll(keepingCapacity: true)
      guard let (text, inspectOctets) = pending.popLast() else { break }
      decodedWork += text.utf8.count
      guard decodedWork <= 512 << 20 else { throw NativeAIError.rejected }
      guard seen.insert(Data(SHA256.hash(data: Data(text.utf8)))).inserted else { continue }
      try checkBytes(Data(text.utf8))
      // JSON/Unicode/hex decoding can represent binary octets as Latin-1
      // scalars. Inspect those bytes before a UTF-8 conversion changes them.
      if inspectOctets && text.utf8.contains(where: { $0 >= 128 }) {
        var octets = Data()
        func inspectRun() throws {
          guard !octets.isEmpty else { return }
          try checkBytes(octets)
          try compressed(octets, samples: NativeAudioFormat.isCanonicalWAV(octets))
          octets.removeAll(keepingCapacity: true)
        }
        for scalar in text.unicodeScalars {
          if scalar.value <= 255 { octets.append(UInt8(scalar.value)) }
          else { try inspectRun() }
        }
        try inspectRun()
      }
      if text.range(
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
      func enqueue(_ decoded: String, octets: Bool = true) {
        if decoded.utf8.count < text.utf8.count { pending.append((decoded, octets)) }
      }
      for run in Self.matches(text, pattern: #"(?:%[a-fA-F0-9]{2})+"#) {
        let bytes = Data(Self.matches(run[0], pattern: #"%([a-fA-F0-9]{2})"#).compactMap { UInt8($0[1], radix: 16) })
        try checkBytes(bytes)
        try compressed(bytes, samples: NativeAudioFormat.isCanonicalWAV(bytes))
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
      // Compressed encodings can be shorter than the supplied credential.
      // Candidate admission is independent of raw fingerprint length.
      for token in Self.matches(text, pattern: #"(?:[a-fA-F0-9]{2}){6,}"#) {
        let hex = Array(token[0].utf8)
        var bytes = Data()
        for index in stride(from: 0, to: hex.count, by: 2) {
          if let byte = UInt8(String(decoding: hex[index..<index + 2], as: UTF8.self), radix: 16) {
            bytes.append(byte)
          }
        }
        try compressed(bytes, samples: NativeAudioFormat.isCanonicalWAV(bytes))
        try checkBytes(bytes)
        enqueue(String(decoding: bytes, as: UTF8.self), octets: false)
      }
      for token in Self.matches(text, pattern: #"[A-Za-z0-9+/_-]{8,}={0,2}"#) {
        var base64 = token[0].replacingOccurrences(of: "-", with: "+").replacingOccurrences(
          of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        if let bytes = Data(base64Encoded: base64) {
          try checkBytes(bytes)
          try compressed(bytes, samples: NativeAudioFormat.isCanonicalWAV(bytes))
          enqueue(String(decoding: bytes, as: UTF8.self), octets: false)
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
