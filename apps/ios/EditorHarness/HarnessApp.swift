import EditorModelInterface
import Foundation
import LexicalReference
import LexicalSwift
import SwiftUI
import TextKitEditor

/// A document from a bundled fixture in the TextKit editor, for trying the
/// editor and for the UI scripts. The launch environment picks the model
/// (`EDITOR_MODEL`, an `EditorModelChoice`), the document (`EDITOR_DOCUMENT`,
/// serialized editor state), where Save writes it (`EDITOR_SAVE_PATH`) and
/// where Save also writes each call the keyboard made (`EDITOR_INPUT_LOG`).
@main
struct HarnessApp: App {
  var body: some Scene {
    WindowGroup {
      NavigationStack { HarnessView() }
    }
  }
}

struct HarnessView: View {
  @State private var opened = Result { try Harness.open() }
  @State private var message: String?

  var body: some View {
    switch opened {
    case .success(let harness):
      EditorRepresentable(harness: harness)
        .navigationTitle(harness.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          Button("Save") {
            do { try harness.save() } catch { message = "\(error)" }
          }
        }
        .alert("Couldn't save", message: $message)
    case .failure(let error):
      ContentUnavailableView(
        "Couldn't open the document", systemImage: "exclamationmark.triangle",
        description: Text(String(describing: error)))
    }
  }
}

@MainActor
final class Harness {
  let model: any EditorModel
  let title: String
  private(set) var inputs: [TextInputRecord] = []
  private let saveURL: URL
  private let inputLogURL: URL?

  private init(model: any EditorModel, title: String, saveURL: URL, inputLogURL: URL?) {
    self.model = model
    self.title = title
    self.saveURL = saveURL
    self.inputLogURL = inputLogURL
  }

  static func open() throws -> Harness {
    let environment = ProcessInfo.processInfo.environment
    let name = environment["EDITOR_MODEL"] ?? EditorModelChoice.lexicalSwift.rawValue
    guard let choice = EditorModelChoice(rawValue: name) else { throw HarnessError("No model named \(name)") }
    let model: any EditorModel
    let title: String
    switch choice {
    case .lexicalSwift:
      model = Editor()
      title = "LexicalSwift"
    case .reference:
      guard let script = Bundle.main.url(forResource: "lexical-reference", withExtension: "js") else {
        throw HarnessError("The JS reference isn't in the app; run `bun run build:reference` and build again")
      }
      model = try ReferenceEditor(scriptURL: script)
      title = "Lexical (JS)"
    }
    let document: Data
    if let given = environment["EDITOR_DOCUMENT"] {
      document = Data(given.utf8)
    } else if let bundled = Bundle.main.url(forResource: "tracer", withExtension: "json") {
      document = try Data(contentsOf: bundled)
    } else {
      throw HarnessError("The app has no tracer.json to open")
    }
    try model.load(try JSONDecoder().decode(JSONValue.self, from: document))
    let saveURL =
      environment["EDITOR_SAVE_PATH"].map { URL(fileURLWithPath: $0) }
      ?? URL.documentsDirectory.appending(path: "saved.json")
    return Harness(
      model: model, title: title, saveURL: saveURL,
      inputLogURL: environment["EDITOR_INPUT_LOG"].map { URL(fileURLWithPath: $0) })
  }

  func record(_ input: TextInputRecord) { inputs.append(input) }

  func save() throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    if let inputLogURL { try encoder.encode(inputs).write(to: inputLogURL, options: .atomic) }
    try encoder.encode(try model.snapshot().state).write(to: saveURL, options: .atomic)
  }
}

struct HarnessError: Error, CustomStringConvertible {
  let description: String
  init(_ description: String) { self.description = description }
}

struct EditorRepresentable: UIViewRepresentable {
  let harness: Harness

  func makeUIView(context: Context) -> EditorView {
    let view = EditorView(model: harness.model)
    view.accessibilityIdentifier = "editor"
    view.onInput = { [harness] in harness.record($0) }
    return view
  }

  func updateUIView(_ view: EditorView, context: Context) {}
}
