import Foundation
import HTTPTypes
import OpenAPIRuntime

extension Session {
  /// Uses the web's public font stylesheet and actual font data. Third-party
  /// requests bypass the API middleware, so the account token stays private.
  public func documentFontData(resource: String) async throws -> [Data] {
    guard let url = URL(string: resource, relativeTo: origin)?.absoluteURL,
      url.scheme == origin.scheme, url.host == origin.host, url.port == origin.port,
      url.path == "/api/fonts"
    else { throw DocumentSettingsUnsupported("Unexpected font resource") }
    let cssData = try await fontData(url, upTo: 1 << 20)
    guard let css = String(data: cssData, encoding: .utf8) else {
      throw DocumentSettingsUnsupported("Invalid font CSS")
    }
    let faces = try NSRegularExpression(pattern: #"@font-face\s*\{([^{}]*)\}"#)
    let sources = try NSRegularExpression(
      pattern:
        #"\bsrc\s*:\s*url\(\s*(['"]?)(https://[^'\")\s]+)\1\s*\)\s*format\(\s*['"]woff2['"]\s*\)"#)
    let full = NSRange(css.startIndex..., in: css)
    var urls: [URL] = []
    for face in faces.matches(in: css, range: full) {
      guard let bodyRange = Range(face.range(at: 1), in: css) else {
        throw DocumentSettingsUnsupported("Invalid font face")
      }
      let body = String(css[bodyRange])
      guard let source = sources.firstMatch(in: body, range: NSRange(body.startIndex..., in: body)),
        let range = Range(source.range(at: 2), in: body),
        let sourceURL = URL(string: String(body[range])),
        sourceURL.scheme == "https", sourceURL.host == "fonts.gstatic.com", sourceURL.user == nil,
        sourceURL.password == nil, sourceURL.port == nil
      else { throw DocumentSettingsUnsupported("Unported font source") }
      if !urls.contains(sourceURL) { urls.append(sourceURL) }
    }
    guard !urls.isEmpty, urls.count <= 512 else {
      throw DocumentSettingsUnsupported("Font face count is unsupported")
    }
    // Bounded parallelism, total bytes, and per-face bytes; all unicode subsets
    // are loaded so later edits can use characters absent from the initial text.
    return try await withThrowingTaskGroup(of: (Int, Data).self) { group in
      var next = 0
      var bytes = 0
      var result: [(Int, Data)] = []
      func enqueue() {
        guard next < urls.count else { return }
        let index = next
        let url = urls[index]
        next += 1
        group.addTask { (index, try await self.fontData(url, upTo: 4 << 20)) }
      }
      for _ in 0..<min(4, urls.count) { enqueue() }
      while let value = try await group.next() {
        bytes += value.1.count
        guard bytes <= 64 << 20 else {
          throw DocumentSettingsUnsupported("Font exceeds the native load limit")
        }
        result.append(value)
        enqueue()
      }
      return result.sorted { $0.0 < $1.0 }.map(\.1)
    }
  }

  private func fontData(_ url: URL, upTo limit: Int) async throws -> Data {
    guard
      let host = URL(
        string: "\(url.scheme ?? "https")://\(url.host ?? "")\(url.port.map { ":\($0)" } ?? "")")
    else {
      throw URLError(.badURL)
    }
    let components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
    let path =
      components.percentEncodedPath + (components.percentEncodedQuery.map { "?\($0)" } ?? "")
    let (response, body) = try await connection.transport.send(
      HTTPRequest(method: .get, scheme: nil, authority: nil, path: path), body: nil, baseURL: host,
      operationID: "document-fontData")
    guard response.status.kind == .successful, let body else {
      throw Refusal(
        status: response.status.code,
        message: "The document font couldn’t be fetched. Try opening the document again.")
    }
    return try await Data(collecting: body, upTo: limit)
  }
}
