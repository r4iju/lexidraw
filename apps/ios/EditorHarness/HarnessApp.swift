import EditorModelInterface
import Foundation
import LexicalFuzz
import LexicalReference
import LexicalSwift
import SwiftUI
import TextKitEditor

/// A document from a bundled fixture in the TextKit editor, for trying the
/// editor and for the UI scripts. The launch environment picks the model
/// (`EDITOR_MODEL`, an `EditorModelChoice`), the document (`EDITOR_DOCUMENT`,
/// serialized editor state), where Save writes it (`EDITOR_SAVE_PATH`) and
/// where Save also writes each call the keyboard made (`EDITOR_INPUT_LOG`).
/// `EDITOR_SYNTHETIC` (`small` or `large`) opens a `SyntheticDocument`
/// instead; with `EDITOR_SCROLL_REPORT` a `ScrollProbe` scrolls it through.
/// It shows how many hardware key presses the editor passed on unhandled,
/// for scripts that wait for the simulator to deliver one.
/// `EDITOR_PREVIEW_ACCESS` opens the app's document screen instead, as a
/// `DocumentPreview`.
@main
struct HarnessApp: App {
  var body: some Scene {
    WindowGroup {
      NavigationStack {
        if let access = ProcessInfo.processInfo.environment["EDITOR_PREVIEW_ACCESS"] {
          DocumentPreview(access: access)
        } else {
          HarnessView()
        }
      }
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
          ToolbarItem(placement: .topBarLeading) {
            Text("\(harness.hardwareKeys)").accessibilityIdentifier("hardware keys")
          }
          ToolbarItem {
            Button("Save") {
              do { try harness.save() } catch { message = "\(error)" }
            }
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

@MainActor @Observable
final class Harness {
  let model: any EditorModel
  let title: String
  let scrollReport: URL?
  var timing: Timing
  private(set) var inputs: [TextInputRecord] = []
  var hardwareKeys = 0
  private let saveURL: URL
  private let inputLogURL: URL?

  /// When opening the document got where, in `CACurrentMediaTime`.
  struct Timing {
    var document: String
    var footprintAtOpen: Double
    var opened: CFTimeInterval
    var loaded: CFTimeInterval = 0
    var viewMade: CFTimeInterval = 0
    var viewInitialized: CFTimeInterval = 0
    var firstScreen: CFTimeInterval?
  }

  private init(
    model: any EditorModel, title: String, timing: Timing, scrollReport: URL?,
    saveURL: URL, inputLogURL: URL?
  ) {
    self.model = model
    self.title = title
    self.timing = timing
    self.scrollReport = scrollReport
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
    let synthetic: SyntheticDocument?
    switch environment["EDITOR_SYNTHETIC"] {
    case nil: synthetic = nil
    case "small": synthetic = .small
    case "large": synthetic = .large
    case let other?: throw HarnessError("No synthetic document named \(other); small or large")
    }
    var timing = Timing(
      document: synthetic.map { "\($0)" } ?? "given", footprintAtOpen: ScrollProbe.Memory.footprint(),
      opened: CACurrentMediaTime())
    let document: Data
    if let synthetic {
      document = try JSONEncoder().encode(synthetic.state)
      timing.opened = CACurrentMediaTime()
    } else if let given = environment["EDITOR_DOCUMENT"] {
      document = Data(given.utf8)
    } else if let bundled = Bundle.main.url(forResource: "tracer", withExtension: "json") {
      document = try Data(contentsOf: bundled)
    } else {
      throw HarnessError("The app has no tracer.json to open")
    }
    try model.load(try JSONDecoder().decode(JSONValue.self, from: document))
    timing.loaded = CACurrentMediaTime()
    let saveURL =
      environment["EDITOR_SAVE_PATH"].map { URL(fileURLWithPath: $0) }
      ?? URL.documentsDirectory.appending(path: "saved.json")
    return Harness(
      model: model, title: title, timing: timing,
      scrollReport: environment["EDITOR_SCROLL_REPORT"].map { URL(filePath: $0, relativeTo: .documentsDirectory) },
      saveURL: saveURL,
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

  func makeUIView(context: Context) -> KeyCountingView {
    harness.timing.viewMade = CACurrentMediaTime()
    let editor = EditorView(model: harness.model)
    harness.timing.viewInitialized = CACurrentMediaTime()
    editor.accessibilityIdentifier = "editor"
    editor.onInput = { [harness] in harness.record($0) }
    if let report = harness.scrollReport {
      // Its display link keeps it.
      ScrollProbe(view: editor, report: report, step: 60, timing: harness.timing)
        .start(waiting: ProcessInfo.processInfo.environment["EDITOR_SCROLL_WAIT"] != nil)
    }
    return KeyCountingView(editor, harness: harness)
  }

  func updateUIView(_ view: KeyCountingView, context: Context) {}
}

/// The editor, counting the hardware key presses it passes up the
/// responder chain, as it does a key it has no command for.
final class KeyCountingView: UIView {
  private let harness: Harness

  init(_ editor: EditorView, harness: Harness) {
    self.harness = harness
    super.init(frame: .zero)
    editor.frame = bounds
    editor.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(editor)
  }

  required init?(coder: NSCoder) { fatalError("KeyCountingView is made in code") }

  override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    harness.hardwareKeys += presses.count
    super.pressesBegan(presses, with: event)
  }
}
