import Foundation
import OSLog
import QuartzCore
import TextKitEditor
import UIKit

/// Calls the keyboard's public input seam at evenly spaced document positions.
/// Input processing and layout are timed separately from the first subsequent
/// display-link timestamp. This is cadence evidence, not confirmation that
/// the edited glyph was presented.
@MainActor final class TypingProbe {
  private let view: EditorView
  private let report: URL
  private var timing: Harness.Timing
  private var link: CADisplayLink?
  private var positions: [Int] = []
  private var pending: (started: CFTimeInterval, processingMs: Double, phase: Double)?
  private var scheduled = false
  private var samples: [Sample] = []
  private var frameIntervals: [Double] = []
  private var previousFrame: CFTimeInterval?
  private static let count = 200
  private static let signposter = OSSignposter(subsystem: "xyz.raiju.lexidraw.editor-harness", category: .pointsOfInterest)

  private struct Sample: Encodable {
    let processingAndLayoutMs: Double
    let nextDisplayLinkTimestampMs: Double
    let actualInsertionPhase: Double
  }

  init(view: EditorView, report: URL, timing: Harness.Timing) {
    self.view = view
    self.report = report
    self.timing = timing
  }

  func start() {
    let link = CADisplayLink(target: self, selector: #selector(tick))
    link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
    link.add(to: .main, forMode: .common)
    self.link = link
  }

  @objc private func tick(_ link: CADisplayLink) {
    guard view.window != nil else { return }
    if timing.firstScreen == nil {
      timing.firstScreen = link.timestamp
      guard let range = view.textRange(from: view.beginningOfDocument, to: view.endOfDocument),
        let text = view.text(in: range)
      else { preconditionFailure("The synthetic document has no text") }
      positions = text.utf16.enumerated().compactMap { $0.element == 32 ? $0.offset : nil }
      precondition(!positions.isEmpty, "The synthetic document has no word spaces")
      _ = view.becomeFirstResponder()
      return
    }
    // Let the keyboard's presentation settle before sampling input.
    guard CACurrentMediaTime() - timing.firstScreen! >= 1 else { return }
    if let previousFrame { frameIntervals.append((link.timestamp - previousFrame) * 1000) }
    previousFrame = link.timestamp
    if let pending {
      guard link.timestamp >= pending.started + pending.processingMs / 1000 else { return }
      samples.append(Sample(
        processingAndLayoutMs: pending.processingMs,
        nextDisplayLinkTimestampMs: (link.timestamp - pending.started) * 1000,
        actualInsertionPhase: pending.phase))
      self.pending = nil
      if samples.count == Self.count { finish(); return }
    }
    guard !scheduled else { return }
    scheduled = true
    let index = samples.count * (positions.count - 1) / (Self.count - 1)
    // UIKit suggestions may replace earlier input; refresh offsets outside
    // the timed edit rather than assuming every input adds one code unit.
    guard let range = view.textRange(from: view.beginningOfDocument, to: view.endOfDocument),
      let text = view.text(in: range) else { preconditionFailure("No document text") }
    positions = text.utf16.enumerated().compactMap { $0.element == 32 ? $0.offset : nil }
    let currentIndex = min(index, positions.count - 1)
    guard let position = view.position(from: view.beginningOfDocument, offset: positions[currentIndex]) else {
      preconditionFailure("The synthetic input position is outside the document")
    }
    view.selectedTextRange = view.textRange(from: position, to: position)
    view.layoutIfNeeded()
    // Spread input through the display interval instead of always issuing it
    // at the refresh callback, which would bias presentation latency.
    let phase = Double((samples.count * 37) % 100) / 100
    let frameTimestamp = link.timestamp
    let frameInterval = max(link.targetTimestamp - frameTimestamp, 0.001)
    let desired = frameTimestamp + frameInterval * phase
    let delay = max(desired - CACurrentMediaTime(), 0)
    DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [self] in
      let interval = Self.signposter.beginInterval("input processing and layout")
      let beforeEnd = view.offset(from: view.beginningOfDocument, to: view.endOfDocument)
      let started = CACurrentMediaTime()
      view.insertText("x")
      view.layoutIfNeeded()
      let elapsed = (CACurrentMediaTime() - started) * 1000
      let afterEnd = view.offset(from: view.beginningOfDocument, to: view.endOfDocument)
      precondition(afterEnd == beforeEnd + 1, "The measured input did not insert a character: \(beforeEnd) -> \(afterEnd)")
      Self.signposter.endInterval("input processing and layout", interval)
      pending = (started, elapsed, (started - frameTimestamp) / frameInterval)
      scheduled = false
    }
  }

  private func finish() {
    link?.invalidate()
    let first = timing.firstScreen!
    let output = Report(
      document: timing.document, samples: samples,
      processingAndLayoutMs: ScrollProbe.Percentiles(samples.map(\.processingAndLayoutMs)),
      nextDisplayLinkTimestampMs: ScrollProbe.Percentiles(samples.map(\.nextDisplayLinkTimestampMs)),
      frameIntervalMs: ScrollProbe.Percentiles(frameIntervals),
      decodingMs: (timing.decoded - timing.opened) * 1000,
      modelLoadMs: (timing.loaded - timing.decoded) * 1000,
      loadMs: (timing.loaded - timing.opened) * 1000,
      makingTheViewMs: (timing.viewInitialized - timing.viewMade) * 1000,
      openToFirstScreenMs: (first - timing.opened) * 1000)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    do { try encoder.encode(output).write(to: report, options: .atomic) }
    catch { preconditionFailure("Couldn't write the input report: \(error)") }
    exit(0)
  }

  private struct Report: Encodable {
    let document: String
    let measurementScope = "Synchronous insertText and layoutIfNeeded; excludes keyboard delivery, drawing and compositing. Display-link timestamp is cadence evidence, not verified glyph presentation."
    let samples: [Sample]
    let processingAndLayoutMs: ScrollProbe.Percentiles
    let nextDisplayLinkTimestampMs: ScrollProbe.Percentiles
    let frameIntervalMs: ScrollProbe.Percentiles
    let decodingMs: Double
    let modelLoadMs: Double
    let loadMs: Double
    let makingTheViewMs: Double
    let openToFirstScreenMs: Double
  }
}
