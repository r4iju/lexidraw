#if canImport(UIKit)
  import LexicalSwift
  import Testing
  @testable import TextKitEditor
  import UIKit

  @Suite(.serialized) @MainActor struct AutocompleteEditorTests {
    private func editor(_ text: String) throws -> (Editor, EditorView, UIWindow) {
      let model = Editor()
      try model.load([
        "root": [
          "type": "root", "version": 1,
          "children": [
            [
              "type": "paragraph", "version": 1,
              "children": [
                [
                  "type": "text", "version": 1, "text": .string(text), "mode": "normal",
                  "format": 0, "style": "", "detail": 0,
                ]
              ],
            ]
          ],
        ]
      ])
      try model.apply(.caret(Point(path: [0, 0], offset: text.utf16.count, type: .text)))
      let view = EditorView(model: model)
      let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 700, height: 900))
      view.frame = window.bounds
      window.addSubview(view)
      window.makeKeyAndVisible()
      view.becomeFirstResponder()
      view.selectedTextRange = view.textRange(from: view.endOfDocument, to: view.endOfDocument)
      return (model, view, window)
    }
    @Test func nativeSuggestionRequiresExplicitAcceptanceAndUndoRestoresText() async throws {
      let (model, view, window) = try editor("Hello")
      defer { window.isHidden = true }
      view.setWritingSuggestions(delay: 0, interval: 0) { _ in " world." }
      try await Task.sleep(for: .milliseconds(100))
      #expect(view.writingSuggestion == " world.")
      let button = try #require(
        view.subviews.compactMap { $0 as? UIButton }.first {
          $0.accessibilityIdentifier == "accept-writing-suggestion"
        })
      let selection = try #require(view.selectedTextRange)
      let caret = view.caretRect(for: selection.end)
      #expect(!button.frame.intersects(caret))
      #expect(try model.node(at: [0, 0])["text"] == "Hello")
      #expect(view.acceptWritingSuggestion())
      #expect(try model.node(at: [0, 0])["text"] == "Hello world.")
      view.undoManager?.undo()
      #expect(try model.node(at: [0, 0])["text"] == "Hello")
      view.setWritingSuggestions(nil)
    }
    @Test func markedJapaneseInputDiscardsLateOutputAndDoesNotEnterModelUntilCommit() async throws {
      let (model, view, window) = try editor("今日は")
      defer { window.isHidden = true }
      view.setWritingSuggestions(delay: 0, interval: 0) { _ in
        try? await Task.sleep(for: .milliseconds(100))
        return "晴れです。"
      }
      try await Task.sleep(for: .milliseconds(20))
      view.setMarkedText("にほん", selectedRange: NSRange(location: 3, length: 0))
      try await Task.sleep(for: .milliseconds(130))
      #expect(view.writingSuggestion == nil)
      #expect(!view.acceptWritingSuggestion())
      #expect(try model.node(at: [0, 0])["text"] == "今日は")
      view.unmarkText()
      #expect(try model.node(at: [0, 0])["text"] == "今日はにほん")
      view.setWritingSuggestions(nil)
    }
    @Test func switchingSourcesWaitsForOutstandingRequestAndRejectsItsLateResult() async throws {
      let (_, view, window) = try editor("Hello")
      defer { window.isHidden = true }
      var calls = 0
      var reply: CheckedContinuation<String, Never>?
      view.setWritingSuggestions(delay: 0, interval: 0) { _ in
        calls += 1
        return await withCheckedContinuation { reply = $0 }
      }
      try await Task.sleep(for: .milliseconds(50))
      #expect(calls == 1)
      view.setWritingSuggestions(nil)
      view.setWritingSuggestions(delay: 0, interval: 0) { _ in
        calls += 1
        return " new source"
      }
      try await Task.sleep(for: .milliseconds(50))
      #expect(calls == 1)
      reply?.resume(returning: " stale source")
      try await Task.sleep(for: .milliseconds(80))
      #expect(calls == 2)
      #expect(view.writingSuggestion == " new source")
      view.setWritingSuggestions(nil)
    }

    @Test func sourceChangesRetainNativeEditorRateLimit() async throws {
      let (_, view, window) = try editor("Hello")
      defer { window.isHidden = true }
      var calls = 0
      view.setWritingSuggestions(delay: 0, interval: 0.25) { _ in
        calls += 1
        return ""
      }
      try await Task.sleep(for: .milliseconds(50))
      #expect(calls == 1)
      view.setWritingSuggestions(nil)
      view.setWritingSuggestions(delay: 0, interval: 0.25) { _ in
        calls += 1
        return ""
      }
      try await Task.sleep(for: .milliseconds(50))
      #expect(calls == 1)
      try await Task.sleep(for: .milliseconds(250))
      #expect(calls == 2)
      view.setWritingSuggestions(nil)
    }

    @Test func changingDocumentsKeepsOnlyOneNativeRequestOutstanding() async throws {
      let (_, first, window1) = try editor("First document")
      defer { window1.isHidden = true }
      var calls = 0
      var reply: CheckedContinuation<String, Never>?
      first.setWritingSuggestions(delay: 0, interval: 0) { _ in
        calls += 1
        return await withCheckedContinuation { reply = $0 }
      }
      try await Task.sleep(for: .milliseconds(50))
      first.setWritingSuggestions(nil)
      let (_, second, window2) = try editor("Second document")
      defer { window2.isHidden = true }
      second.setWritingSuggestions(delay: 0, interval: 0) { _ in
        calls += 1
        return " new document"
      }
      try await Task.sleep(for: .milliseconds(50))
      #expect(calls == 1)
      reply?.resume(returning: " stale document")
      try await Task.sleep(for: .milliseconds(80))
      #expect(calls == 2)
      #expect(second.writingSuggestion == " new document")
      #expect(first.writingSuggestion == nil)
      second.setWritingSuggestions(nil)
    }

  }
#endif
