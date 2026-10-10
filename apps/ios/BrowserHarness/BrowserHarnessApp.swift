import Foundation
import HTTPTypes
import LexidrawKit
import OpenAPIRuntime
import SwiftUI
import Synchronization

/// Environment for XCTest, native launch arguments for hands-on fixture review.
private enum BrowserScenario {
  static var name: String? {
    ProcessInfo.processInfo.environment["BROWSER_SCENARIO"]
      ?? UserDefaults.standard.string(forKey: "BROWSER_SCENARIO")
  }
}

/// The production browser against external service fixtures for complete journeys.
@main
struct BrowserHarnessApp: App {
  private let signInBrowser = SignInBrowserFixture()
  @State private var model = AppModel(
    account: Account(
      origin: BrowserScenario.name == "sign-in"
        ? SignInBrowserFixture.origin : URL(string: "https://harness.invalid")!,
      store: AccountHarnessToken(), transport: HarnessServer(),
      providerKeyStore: { id in
        let store = KeychainProviderStore(
          accountID: id, origin: URL(string: "https://harness.invalid")!)
        try? store.delete()
        if BrowserScenario.name == "autocomplete-byok" {
          try? store.save("sk-or-v1-283-injected-native-fixture-only")
        }
        return store
      },
      providerConfiguration: {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [NativeAIProviderFixture.self]
        return configuration
      }))

  var body: some Scene {
    WindowGroup {
      Group {
        switch model.state {
        case .signedIn(let session):
          if BrowserScenario.name == "native-pro-recovery" {
            NativeProRecoveryFixtureScreen()
          } else if BrowserScenario.name == "chat-migration" {
            NativeChatFixtureScreen()
          } else if BrowserScenario.name == "recording-integration-291" {
            SavedRecordingIntegrationScreen(session: session)
          } else if BrowserScenario.name == "device-agent" {
            DeviceAgentFixtureScreen(session: session)
          } else if ["agent", "agent-integration-291"].contains(BrowserScenario.name ?? "") {
            AgentFixtureScreen(session: session)
          } else if BrowserScenario.name == "device-narration" {
            DeviceNarrationFixtureScreen(session: session)
          } else if BrowserScenario.name == "narration" {
            NarrationFixtureScreen(session: session)
          } else if BrowserScenario.name == "image" {
            ImageFixtureScreen(session: session)
          } else {
            BrowserView(session: session)
          }
        case .signedOut: NavigationStack { SignInView() }
        }
      }
      .environment(model)
    }
  }
}

/// Stateful service fixture at the external HTTP transport boundary. Every
/// relaunch starts a fresh account; mutations return through real service APIs.
actor HarnessServer: ClientTransport {
  private struct Item {
    let id: String
    var title: String
    let type: String
    var parent: String?
    var access = "owner"
    var tags: [String] = []
    var deleted = false
    var shared = false
    var preview = ""
  }

  private var items: [Item]
  private let scenario: String
  private var failures: Set<String> = []
  private var documents: [String: String] = [:]
  private var revisions: [String: String] = [:]
  private var saves = 0
  private var searched = false
  private var powerPreference = ["mode": "local"]
  private var writingSuggestions = false
  private var suggestionCharges = 0

  init() {
    scenario = BrowserScenario.name ?? "basic"
    items = [
      Item(id: "projects", title: "Projects", type: "directory", parent: nil),
      Item(id: "recipes", title: "Recipes", type: "directory", parent: nil),
      Item(id: "readme", title: "Readme", type: "document", parent: nil),
      Item(id: "q3", title: "Q3", type: "directory", parent: "projects"),
      Item(
        id: "plan", title: "Projects plan", type: "document", parent: "projects", tags: ["Work"]),
      Item(id: "notes", title: "Q3 notes", type: "document", parent: "q3"),
      Item(id: "pasta", title: "Pasta", type: "document", parent: "recipes"),
    ]
    if scenario != "basic" {
      items += [
        Item(
          id: "drawing",
          title: "A drawing with a wonderfully long title for our next adventure together",
          type: "drawing", parent: "projects",
          preview: "https://harness.invalid/missing-preview.png"),
        Item(id: "link", title: "Design reference", type: "url", parent: "projects"),
        Item(
          id: "shared-read", title: "Private team brief", type: "document", parent: "inaccessible",
          access: "read", shared: true),
        Item(
          id: "shared-edit", title: "Collaborative sketch", type: "drawing", parent: "inaccessible",
          access: "edit", shared: true),
        Item(
          id: "shared-folder", title: "Reference only", type: "directory", parent: "inaccessible",
          access: "read", shared: true),
      ]
    }
    if scenario == "autocomplete-pro" { powerPreference = ["mode": "pro"] }
    if scenario == "autocomplete-byok" {
      powerPreference = ["mode": "byok", "provider": "openrouter"]
    }
    if scenario == "listening" { powerPreference = ["mode": "pro"] }
    if scenario == "local-narration" {
      for key in UserDefaults.standard.dictionaryRepresentation().keys
      where key.hasPrefix("listen.position.local.readme.") {
        UserDefaults.standard.removeObject(forKey: key)
      }
    }
    if scenario == "empty" { items = [] }
    if ["restore-failure", "restore-delayed"].contains(scenario) {
      items.append(
        Item(
          id: "deleted", title: "Recovered notes", type: "document", parent: "missing-folder",
          deleted: true))
    }
  }

  private static func silentAudio() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appending(path: "273-read-aloud.wav")
    guard !FileManager.default.fileExists(atPath: url.path) else { return url }
    let byteCount: UInt32 = 8_000 * 120 * 2
    var data = Data()
    func append(_ value: UInt32) {
      var little = value.littleEndian
      withUnsafeBytes(of: &little) { data.append(contentsOf: $0) }
    }
    data.append(Data("RIFF".utf8))
    append(36 + byteCount)
    data.append(Data("WAVEfmt ".utf8))
    append(16)
    data.append(contentsOf: [1, 0, 1, 0])
    append(8_000)
    append(16_000)
    data.append(contentsOf: [2, 0, 16, 0])
    data.append(Data("data".utf8))
    append(byteCount)
    data.append(Data(repeating: 0, count: Int(byteCount)))
    try data.write(to: url)
    return url
  }

  func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws
    -> (HTTPResponse, HTTPBody?)
  {
    if scenario == "device-agent", operationID.hasPrefix("deviceAgent.") || operationID == "pro.status" {
      var forwarded = URLRequest(url: URL(string: "http://127.0.0.1:3088/api/trpc" + (request.path ?? ""))!)
      forwarded.httpMethod = request.method.rawValue
      forwarded.setValue("application/json", forHTTPHeaderField: "Content-Type")
      if let body { forwarded.httpBody = try await Data(collecting: body, upTo: 4 << 20) }
      try NativeCredentialGuard.shared.check(forwarded, body: forwarded.httpBody ?? Data())
      let (data, response) = try await URLSession.shared.data(for: forwarded)
      guard let response = response as? HTTPURLResponse else { throw NativeAIError.unavailable }
      return (HTTPResponse(status: .init(code: response.statusCode)), HTTPBody(data))
    }
    if ["agent", "agent-integration-291", "recording-integration-291"].contains(scenario), operationID.hasPrefix("agentPower.") || operationID == "pro.status" || (scenario != "agent" && (operationID.hasPrefix("auth.") || operationID.hasPrefix("deviceNarration."))) {
      var forwarded=URLRequest(url:URL(string:"http://127.0.0.1:3087/api/trpc"+(request.path ?? ""))!)
      forwarded.httpMethod=request.method.rawValue
      forwarded.setValue("application/json",forHTTPHeaderField:"Content-Type")
      if let body {forwarded.httpBody=try await Data(collecting:body,upTo:1<<18)}
      try NativeCredentialGuard.shared.check(forwarded,body:forwarded.httpBody ?? Data())
      let (data,response)=try await URLSession.shared.data(for:forwarded)
      guard let response=response as? HTTPURLResponse else {throw NativeAIError.unavailable}
      return (HTTPResponse(status:.init(code:response.statusCode)),HTTPBody(data))
    }
    if scenario == "device-narration", operationID == "auth.getPowerPreference" {
      return (
        HTTPResponse(status: .ok),
        HTTPBody(Data(#"{"result":{"data":{"json":{"mode":"byok","provider":"openrouter"}}}}"#.utf8))
      )
    }
    if scenario == "device-narration", operationID.hasPrefix("deviceNarration.") {
      var forwarded = URLRequest(
        url: URL(string: "http://127.0.0.1:3086/api/trpc" + (request.path ?? ""))!)
      forwarded.httpMethod = request.method.rawValue
      forwarded.setValue("application/json", forHTTPHeaderField: "Content-Type")
      if let body { forwarded.httpBody = try await Data(collecting: body, upTo: 63_000_000) }
      try NativeCredentialGuard.shared.check(forwarded, body: forwarded.httpBody ?? Data())
      let (data, response) = try await URLSession.shared.data(for: forwarded)
      guard let response = response as? HTTPURLResponse else { throw NativeAIError.unavailable }
      return (HTTPResponse(status: .init(code: response.statusCode)), HTTPBody(data))
    }
    if scenario == "narration",
      operationID.hasPrefix("narration.") || operationID == "auth.getPowerPreference"
    {
      if operationID == "auth.getPowerPreference" {
        return (
          HTTPResponse(status: .ok),
          HTTPBody(Data(#"{"result":{"data":{"json":{"mode":"pro"}}}}"#.utf8))
        )
      }
      var forwarded = URLRequest(
        url: URL(string: "http://127.0.0.1:3085/api/trpc" + (request.path ?? ""))!)
      forwarded.httpMethod = request.method.rawValue
      forwarded.setValue("application/json", forHTTPHeaderField: "Content-Type")
      if let body { forwarded.httpBody = try await Data(collecting: body, upTo: 1 << 20) }
      try NativeCredentialGuard.shared.check(forwarded, body: forwarded.httpBody ?? Data())
      let (data, response) = try await URLSession.shared.data(for: forwarded)
      guard let response = response as? HTTPURLResponse else { throw NativeAIError.unavailable }
      return (HTTPResponse(status: .init(code: response.statusCode)), HTTPBody(data))
    }
    if scenario == "image",
      [
        "imagePower.capability", "imagePower.generate", "imagePower.save",
        "auth.getPowerPreference", "auth.setPowerPreference", "pro.status",
      ].contains(operationID)
    {
      var forwarded = URLRequest(
        url: URL(string: "http://127.0.0.1:3084/api/trpc" + (request.path ?? ""))!)
      forwarded.httpMethod = request.method.rawValue
      forwarded.setValue("application/json", forHTTPHeaderField: "Content-Type")
      if let body { forwarded.httpBody = try await Data(collecting: body, upTo: 3 << 20) }
      try NativeCredentialGuard.shared.check(forwarded, body: forwarded.httpBody ?? Data())
      let (data, response) = try await URLSession.shared.data(for: forwarded)
      guard let response = response as? HTTPURLResponse else { throw NativeImageError.unavailable }
      return (HTTPResponse(status: .init(code: response.statusCode)), HTTPBody(data))
    }
    if scenario == "sandbox-shared-290", operationID == "pro.appleSandboxGate" {
      let url = URL(string: "http://127.0.0.1:3090/api/trpc/pro.appleSandboxGate")!
      var request = URLRequest(url: url)
      request.setValue("fixture-account=alice", forHTTPHeaderField: "Cookie")
      let (data, response) = try await URLSession.shared.data(for: request)
      guard let response = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
      return (HTTPResponse(status: .init(code: response.statusCode)), HTTPBody(data))
    }
    let components = URLComponents(string: request.path ?? "")
    let query = components?.queryItems ?? []
    let segments = (components?.path ?? "").split(separator: "/").map(String.init)
    let entityIndex = segments.firstIndex(of: "entities")
    let id = entityIndex.flatMap { segments.indices.contains($0 + 1) ? segments[$0 + 1] : nil }
    let json: [String: Any]
    if let body {
      let data = try await Data(collecting: body, upTo: 1_000_000)
      json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
    } else {
      json = [:]
    }
    if scenario == "retry"
      && ["entities-list", "entities-sharedWithMe", "entities-trash"].contains(operationID),
      !failures.contains(operationID)
    {
      failures.insert(operationID)
      return try response(
        ["message": "Connection interrupted. Please try again.", "code": "INTERNAL_SERVER_ERROR"],
        status: .internalServerError)
    }
    if scenario == "delayed", operationID == "entities-list" {
      try await Task.sleep(for: .seconds(10))
    }
    let answer: Any
    switch operationID {
    case "nativeSignIn-exchange":
      guard json["code"] as? String == "fixture-code",
        json["redirectUri"] as? String == Account.callback.absoluteString,
        let verifier = json["codeVerifier"] as? String, !verifier.isEmpty
      else {
        return try response(
          ["message": "Invalid sign-in exchange.", "code": "BAD_REQUEST"], status: .badRequest)
      }
      try await Task.sleep(for: .seconds(4))
      if failures.insert(operationID).inserted {
        return try response(
          ["message": "The sign-in code expired.", "code": "BAD_REQUEST"], status: .badRequest)
      }
      answer = ["token": "fixture-token", "name": "iPhone", "scope": "write"]
    case "auth-deletionConfirmation":
      if scenario == "deletion-confirmation-failure", failures.insert(operationID).inserted {
        try await Task.sleep(for: .seconds(3))
        return try response(
          ["message": "Connection interrupted.", "code": "INTERNAL_SERVER_ERROR"],
          status: .internalServerError)
      }
      answer = ["confirmation": "reader@example.test"]
    case "auth-deleteAccount":
      guard
        (json["confirmation"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
          .lowercased() == "reader@example.test"
      else {
        return try response(
          ["message": "The confirmation does not match this account.", "code": "BAD_REQUEST"],
          status: .badRequest)
      }
      try await Task.sleep(for: .seconds(4))
      if scenario == "deletion-failure", failures.insert(operationID).inserted {
        return try response(
          [
            "message": "Deletion is temporarily unavailable. Please try again.",
            "code": "INTERNAL_SERVER_ERROR",
          ], status: .internalServerError)
      }
      answer = ["id": "reader"]
    case "tokens-revokeCurrent":
      if scenario == "signout-local-failure" { try await Task.sleep(for: .seconds(4)) }
      if scenario == "signout-server-failure" { throw URLError(.notConnectedToInternet) }
      answer = ["id": "fixture-token"]
    case "config.getAutocompleteConfig":
      answer = ["result": ["data": ["json": ["enabled": writingSuggestions]]]]
    case "config.updateAutocompleteConfig":
      writingSuggestions = (json["json"] as? [String: Bool])?["enabled"] ?? false
      answer = ["result": ["data": ["json": ["enabled": writingSuggestions]]]]
    case "pro.autocomplete":
      guard scenario == "autocomplete-pro", writingSuggestions else {
        throw URLError(.unsupportedURL)
      }
      suggestionCharges += 31_000
      answer = [
        "result": [
          "data": [
            "json": [
              "id": "fixture-suggestion", "state": "settled", "result": "sentence.",
              "charged": 31_000, "feature": "autocomplete",
            ]
          ]
        ]
      ]
    case "pro.status":
      if scenario == "autocomplete-pro" {
        answer = [
          "result": [
            "data": [
              "json": [
                "eligible": true, "entitled": true,
                "availableSubcredits": 10_000_000 - suggestionCharges, "reservedSubcredits": 0,
                "renewalAt": NSNull(),
                "history": suggestionCharges == 0
                  ? []
                  : [
                    [
                      "id": "fixture-suggestion", "feature": "autocomplete", "state": "settled",
                      "quote": 1_120_000, "charged": suggestionCharges, "created_at": 1000,
                    ]
                  ],
                "policy": [
                  "version": "private-cancellation-v1",
                  "disclosure":
                    "Deterministic UI fixture. Actual provider acceptance is unverified.",
                ],
              ] as [String: Any]
            ]
          ]
        ]
        break
      }
      if scenario == "pro-shared-local" || scenario == "sandbox-shared-289" || scenario == "sandbox-shared-290" {
        // Opt-in loopback fixture shares the actual isolated SQLite allowance with the browser. No provider endpoint is involved.
        let port = scenario == "sandbox-shared-290" ? 3090 : scenario == "sandbox-shared-289" ? 3089 : 3080
        var request = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/api/trpc/pro.status")!)
        request.setValue("fixture-account=alice", forHTTPHeaderField: "Cookie")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let response = response as? HTTPURLResponse else {
          throw URLError(.badServerResponse)
        }
        return (HTTPResponse(status: .init(code: response.statusCode)), HTTPBody(data))
      }
      answer = [
        "result": [
          "data": [
            "json": [
              "eligible": false, "entitled": false, "availableSubcredits": 0,
              "reservedSubcredits": 0, "renewalAt": NSNull(), "history": [],
              "policy": [
                "version": "private-cancellation-v1",
                "disclosure":
                  "Public Pro is coming soon. Private trial completed results are charged; uncertain outcomes stay reserved.",
              ],
            ] as [String: Any]
          ]
        ]
      ]
    case "auth.getPowerPreference":
      answer = ["result": ["data": ["json": powerPreference]]]
    case "auth.setPowerPreference":
      if let value = json["json"] as? [String: String] { powerPreference = value }
      answer = ["result": ["data": ["json": NSNull()]]]
    case "auth-me":
      if scenario == "identity-failure", failures.insert(operationID).inserted {
        return try response(
          ["message": "Connection interrupted.", "code": "INTERNAL_SERVER_ERROR"],
          status: .internalServerError)
      }
      answer = [
        "userId": "reader", "name": "Native Reader", "email": "reader@example.test",
        "authKind": "token", "scope": "write",
      ]
    case "entities-list":
      let parent = query.first { $0.name == "parentId" }?.value
      if scenario == "reveal-delayed", searched, parent == nil,
        failures.insert("delayed-reveal").inserted
      {
        // The obsolete reveal transport deliberately ignores cancellation.
        await Task.detached { try? await Task.sleep(for: .seconds(10)) }.value
      }
      let types = query.filter { $0.name == "entityTypes" }.compactMap(\.value)
      let tags = query.filter { $0.name == "tagNames" }.compactMap(\.value)
      answer = items.filter {
        !$0.deleted && $0.parent == parent && (types.isEmpty || types.contains($0.type))
          && tags.allSatisfy($0.tags.contains)
      }.map(listed)
    case "entities-search":
      searched = true
      let text = query.first { $0.name == "query" }?.value ?? ""
      if scenario == "search-retry" {
        try await Task.sleep(for: .seconds(4))
        if !failures.contains(operationID) {
          failures.insert(operationID)
          return try response(
            [
              "message": "Connection interrupted. Please try again.",
              "code": "INTERNAL_SERVER_ERROR",
            ], status: .internalServerError)
        }
      }
      if scenario == "search-obsolete", text == "Projects" {
        // This external transport deliberately finishes despite cancellation.
        await Task.detached { try? await Task.sleep(for: .seconds(10)) }.value
      }
      answer = items.filter { !$0.deleted && $0.title.localizedCaseInsensitiveContains(text) }.map {
        item in
        let parent = items.first { $0.id == item.parent && !$0.deleted }
        return [
          "id": item.id, "title": item.title, "entityType": item.type,
          "updatedAt": Self.date, "screenShotLight": item.preview, "screenShotDark": item.preview,
          "snippet": NSNull(), "parentId": parent?.id as Any? ?? NSNull(),
          "folderTitle": parent?.title as Any? ?? NSNull(),
        ]
      }
    case "entities-getMetadata":
      guard let item = items.first(where: { $0.id == id && !$0.deleted }) else {
        return try missing()
      }
      answer = [
        "id": item.id, "title": item.title, "entityType": item.type, "publicAccess": "PRIVATE",
        "parentId": item.parent as Any? ?? NSNull(), "access": item.access,
        "ancestors": ancestors(of: item).map {
          ["id": $0.id, "title": $0.title, "access": $0.access]
        },
      ]
    case "entities-getUserTags": answer = scenario == "basic" ? [] : ["Work", "Unassigned"]
    case "entities-sharedWithMe": answer = items.filter { $0.shared && !$0.deleted }.map(listed)
    case "entities-trash":
      answer = items.filter(\.deleted).map { item in
        [
          "id": item.id, "title": item.title, "entityType": item.type,
          "screenShotLight": item.preview,
          "screenShotDark": item.preview, "createdAt": Self.date, "updatedAt": Self.date,
          "deletedAt": Self.date,
        ]
      }
    case "entities-create":
      let parent = json["parentId"] as? String
      if let parent {
        guard let destination = items.first(where: { $0.id == parent && !$0.deleted }),
          destination.type == "directory", destination.access != "read"
        else { return try forbidden() }
      }
      let type = json["entityType"] as? String ?? "document"
      let title = type == "directory" ? "New folder" : "New \(type)"
      let item = Item(
        id: json["id"] as? String ?? UUID().uuidString, title: json["title"] as? String ?? title,
        type: type, parent: parent)
      items.append(item)
      answer = summary(item)
    case "entities-update", "entities-delete", "entities-restore":
      guard let index = items.firstIndex(where: { $0.id == id }) else { return try missing() }
      if items[index].access == "read"
        || (operationID != "entities-update" && items[index].access != "owner")
      {
        return try forbidden()
      }
      if operationID == "entities-update" {
        if let title = json["title"] as? String { items[index].title = title }
        if json.keys.contains("parentId") {
          let parent = json["parentId"] as? String
          if let parent {
            guard items[index].access == "owner",
              let destination = items.first(where: { $0.id == parent && !$0.deleted }),
              destination.type == "directory", destination.access != "read"
            else { return try forbidden() }
            if destination.id == items[index].id
              || ancestors(of: destination).contains(where: { $0.id == items[index].id })
            {
              return try response(
                [
                  "message": "A folder cannot move into itself or its descendants.",
                  "code": "BAD_REQUEST",
                ], status: .badRequest)
            }
          }
          items[index].parent = parent
        }
      } else if operationID == "entities-delete" {
        items[index].deleted = true
      } else {
        if scenario == "restore-failure", !failures.contains(operationID) {
          failures.insert(operationID)
          return try response(
            [
              "message": "Connection interrupted. Please try again.",
              "code": "INTERNAL_SERVER_ERROR",
            ], status: .internalServerError)
        }
        if scenario == "restore-delayed" { try await Task.sleep(for: .seconds(6)) }
        items[index].deleted = false
        if !items.contains(where: {
          $0.id == items[index].parent && !$0.deleted && $0.access != "read"
        }) {
          items[index].parent = nil
        }
      }
      if operationID == "entities-restore" {
        answer = summary(items[index])
      } else {
        answer = ["id": items[index].id]
      }
    case "entities-save":
      guard let id, let item = items.first(where: { $0.id == id && !$0.deleted }),
        ["document", "drawing"].contains(item.type)
      else { return try missing() }
      guard item.access != "read" else { return try forbidden() }
      if scenario == "drawing-save-failure" {
        return try response(
          [
            "message": "Connection interrupted. Please try again.", "code": "INTERNAL_SERVER_ERROR",
          ], status: .internalServerError)
      }
      if scenario == "reveal-save-delayed" {
        await Task.detached { try? await Task.sleep(for: .seconds(20)) }.value
      }
      guard json["ifUnmodifiedSince"] as? String == (revisions[id] ?? Self.date) else {
        return try response(["message": "Newer edits", "code": "CONFLICT"], status: .conflict)
      }
      guard let elements = json["elements"] as? String else { return try missing() }
      documents[id] = elements
      saves += 1
      let revision = "2026-09-25T09:31:\(String(format: "%02d", saves)).000Z"
      revisions[id] = revision
      answer = ["id": id, "updatedAt": revision]
    case "entities-load":
      guard let item = items.first(where: { $0.id == id && !$0.deleted }) else {
        return try missing()
      }
      var elements: String
      switch item.type {
      case "document":
        elements =
          #"{"root":{"type":"root","version":1,"format":"","indent":0,"direction":null,"children":[{"type":"paragraph","version":1,"format":"","indent":0,"direction":null,"children":[{"type":"text","version":1,"text":"A thoughtful plan starts here.","format":0,"style":"","mode":"normal","detail":0}]}]}}"#
      case "url": elements = #"{"url":"https://example.com/design"}"#
      default: elements = "[]"
      }
      if scenario == "wide-table", item.type == "document" {
        func node(_ type: String, _ children: [[String: Any]]) -> [String: Any] {
          [
            "type": type, "version": 1, "format": "", "indent": 0,
            "direction": NSNull(), "children": children,
          ]
        }
        let rows = (0..<3).map { row in
          node(
            "tablerow",
            (0..<4).map { column in
              var cell = node(
                "tablecell",
                [
                  node(
                    "paragraph",
                    [
                      [
                        "type": "text", "version": 1,
                        "text": "Row \(row) column \(column)", "format": 0, "style": "",
                        "mode": "normal", "detail": 0,
                      ]
                    ])
                ])
              cell.merge(["colSpan": 1, "rowSpan": 1, "headerState": 0, "width": 240]) { _, new in
                new
              }
              return cell
            })
        }
        var table = node("table", rows)
        table["colWidths"] = [240, 240, 240, 240]
        elements = String(
          decoding: try JSONSerialization.data(withJSONObject: ["root": node("root", [table])]),
          as: UTF8.self)
      }
      if scenario == "local-narration", item.type == "document" {
        let text = String(
          repeating:
            "A thoughtful plan starts here. Built-in speech reads this document on this device. ",
          count: 12)
        elements = String(
          decoding: try JSONSerialization.data(withJSONObject: [
            "root": [
              "type": "root",
              "children": [["type": "paragraph", "children": [["type": "text", "text": text]]]],
            ]
          ]), as: UTF8.self)
      }
      answer = [
        "id": item.id, "title": item.title, "entityType": item.type, "appState": NSNull(),
        "elements": documents[item.id] ?? elements, "publicAccess": "PRIVATE",
        "shared": item.shared,
        "accessLevel": item.access == "read" ? "READ" : "EDIT",
        "updatedAt": revisions[item.id] ?? Self.date,
      ]
    case "tts-listening":
      if scenario == "listening" {
        answer = [
          "status": "ready", "segmentCount": 1, "plannedCount": 1,
          "segments": [
            [
              "index": 0,
              "text": "A thoughtful plan starts here. This is a native read-aloud fixture.",
              "audioUrl": try Self.silentAudio().absoluteString,
              "sectionTitle": "A thoughtful plan",
            ]
          ],
        ]
      } else {
        answer = ["status": "none", "segments": [Any]()]
      }
    case "drawings-files": answer = ["files": [Any]()]
    default: return try missing()
    }
    return try response(answer)
  }

  private static let date = "2026-09-25T09:30:00.000Z"

  private func ancestors(of item: Item) -> [Item] {
    guard let parent = items.first(where: { $0.id == item.parent }) else { return [] }
    return ancestors(of: parent) + [parent]
  }

  private func summary(_ item: Item) -> [String: Any] {
    [
      "id": item.id, "title": item.title, "entityType": item.type,
      "parentId": item.parent as Any? ?? NSNull(),
      "createdAt": Self.date, "updatedAt": Self.date,
    ]
  }

  private func listed(_ item: Item) -> [String: Any] {
    [
      "id": item.id, "title": item.title, "entityType": item.type, "createdAt": Self.date,
      "updatedAt": Self.date, "screenShotLight": item.preview, "screenShotDark": item.preview,
      "thumbnailStatus": NSNull(), "thumbnailVersion": NSNull(), "thumbnailUpdatedAt": NSNull(),
      "access": item.access,
      "publicAccess": "PRIVATE",
      "parentId": item.shared ? NSNull() : item.parent as Any? ?? NSNull(), "favoritedAt": NSNull(),
      "archivedAt": NSNull(), "sharedWithCount": item.shared ? 1 : 0, "tags": item.tags,
      "childCount": items.count { $0.parent == item.id && !$0.deleted },
      "folderCount": items.count { $0.parent == item.id && !$0.deleted && $0.type == "directory" },
    ]
  }

  private func response(_ object: Any, status: HTTPResponse.Status = .ok) throws -> (
    HTTPResponse, HTTPBody?
  ) {
    var response = HTTPResponse(status: status)
    response.headerFields[.contentType] = "application/json"
    return (response, HTTPBody(try JSONSerialization.data(withJSONObject: object)))
  }

  private func missing() throws -> (HTTPResponse, HTTPBody?) {
    try response(["message": "Not found", "code": "NOT_FOUND"], status: .notFound)
  }

  private func forbidden() throws -> (HTTPResponse, HTTPBody?) {
    try response(
      ["message": "You don’t have permission to change this file.", "code": "FORBIDDEN"],
      status: .forbidden)
  }
}

/// The external secure-storage boundary, reset for each fixture launch.
final class AccountHarnessToken: TokenStore {
  private struct Stored {
    var token: String? =
      ["signed-out", "sign-in"].contains(BrowserScenario.name ?? "") ? nil : "harness"
    var removals = 0
  }
  private let stored = Mutex(Stored())

  func load() throws -> String? { stored.withLock { $0.token } }
  func save(_ token: String) throws { stored.withLock { $0.token = token } }
  func delete() throws {
    try stored.withLock {
      $0.removals += 1
      if BrowserScenario.name == "signout-local-failure", $0.removals == 1 {
        throw NSError(
          domain: "FixtureSecureStorage", code: 1,
          userInfo: [NSLocalizedDescriptionKey: "Secure storage is temporarily unavailable."])
      }
      $0.token = nil
    }
  }
}

private struct NarrationFixtureScreen: View {
  @State private var listener: Listener
  @State private var flow: NativeNarrationFlow
  init(session: Session) {
    _listener = State(initialValue: Listener(session: session))
    _flow = State(initialValue: NativeNarrationFlow(session: session, document: "doc"))
  }
  var body: some View {
    VStack {
      Text("Injected silent audio fixture. No actual provider generation.").font(.caption)
      ProNarrationComposer(flow: flow) { job in
        listener.playNarration(job, to: .init(id: "doc", title: "Private narration fixture"))
      }
    }.nowPlayingBar(listener)
  }
}

private struct DeviceNarrationFixtureScreen: View {
  let session: Session
  @State private var listener: Listener
  @State private var flow: NativeDeviceNarrationFlow?
  @State private var runtime: NativeBYOK?
  @State private var revision = 0
  init(session: Session) {
    self.session = session
    _listener = State(initialValue: Listener(session: session))
  }
  var body: some View {
    VStack {
      Text("Injected silent device narration. No actual provider requests.")
      HStack {
        Button("Connect fixture key") {
          try? runtime?.replaceKey("sk-or-v1-286-native-narration-fixture")
          revision += 1
        }
        Button("Remove fixture key") {
          try? runtime?.removeKey()
          revision += 1
        }
      }
      Text("Fixture key: \(runtime?.hasKey == true ? "connected" : "absent") (\(revision))")
      if let flow {
        DeviceNarrationComposer(session: session, document: "doc", flow: flow) { job in
          listener.playNarration(job, to: .init(id: "doc", title: "Device narration fixture"))
        }
      }
    }.nowPlayingBar(listener).task {
      let config = URLSessionConfiguration.ephemeral
      config.protocolClasses = [NativeAIProviderFixture.self]
      let runtime = NativeBYOK(
        store: NarrationHarnessKey(), configuration: config, narrationFixture: true)
      self.runtime = runtime
      let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appending(path: "286-device-fixture")
      let created = NativeDeviceNarrationFlow(
        account: "alice", document: "doc", runtime: runtime,
        files: NativeDeviceNarrationStore(directory: root), available: true,
        save: { id, recording in
          try await session.saveDeviceNarration(recording, id: id, document: "doc")
        })
      try? created.restore()
      flow = created
    }
  }
}

private final class NarrationHarnessKey: TokenStore, @unchecked Sendable {
  private let value = Mutex<String?>(nil)
  func load() throws -> String? { value.withLock { $0 } }
  func save(_ token: String) throws { value.withLock { $0 = token } }
  func delete() throws { value.withLock { $0 = nil } }
}

/// Production composer/player with the #291 persistent authenticated fixture host.
private struct SavedRecordingIntegrationScreen: View {
  let session: Session
  @State private var listener: Listener
  init(session: Session) {
    self.session = session
    _listener = State(initialValue: Listener(session: session))
  }
  var body: some View {
    VStack {
      Text("291 keyless saved artifact fixture. Synthetic silent audio, no provider call.")
      DeviceNarrationComposer(session: session, document: "doc") { job in
        listener.playNarration(job, to: .init(id: "doc", title: "291 synthetic recording"))
      }
    }.nowPlayingBar(listener)
  }
}

private final class ChatFixtureKey: TokenStore, @unchecked Sendable {
  var value: String? = "sk-or-v1-native-chat-fixture-only-123456"
  func load() throws -> String? { value }
  func save(_ value: String) throws { self.value = value }
  func delete() throws { value = nil }
}
nonisolated private final class ChatFixtureProvider: URLProtocol, @unchecked Sendable {
  private let stopped = Mutex(false)
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    guard request.url?.absoluteString == "https://openrouter.ai/api/v1/chat/completions" else {
      client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
      return
    }
    let response = HTTPURLResponse(
      url: request.url!, statusCode: 200, httpVersion: nil,
      headerFields: ["Content-Type": "text/event-stream"])!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(
      self,
      didLoad: Data(#"data: {"choices":[{"delta":{"content":"The bridge "}}]}"#.utf8)
        + Data([10, 10]))
    DispatchQueue.global().asyncAfter(deadline: .now() + 4) { [self] in
      guard !stopped.withLock({ $0 }) else { return }
      client?.urlProtocol(
        self,
        didLoad: Data(#"data: {"choices":[{"delta":{"content":"is closed for repairs."}}]}"#.utf8)
          + Data([10, 10]) + Data("data: [DONE]\n\n".utf8))
      client?.urlProtocolDidFinishLoading(self)
    }
  }
  override func stopLoading() { stopped.withLock { $0 = true } }
}
private struct NativeChatFixtureScreen: View {
  @State private var flow: NativeChatFlow
  init() {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [ChatFixtureProvider.self]
    let byok = NativeBYOK(store: ChatFixtureKey(), configuration: configuration, chatFixture: true)
    _flow = State(
      initialValue: NativeChatFlow(
        source: .byok,
        messages: [
          .init(role: "user", content: "Which bridge?"),
          .init(role: "assistant", content: "The east bridge."),
        ], context: "The east bridge is closed for repairs."
      ) { input, update in
        try await byok.chat(input, reference: byok.credentialReference(), onText: update)
      })
  }
  var body: some View { NativeChatView(flow: flow) }
}
