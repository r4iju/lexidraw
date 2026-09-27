import Foundation
import OSLog
import QuartzCore
import TextKitEditor
import UIKit
import notify

/// Scrolls the editor through the whole document, a fixed distance a frame,
/// and writes what that cost to a JSON report (`EDITOR_SCROLL_REPORT`), then
/// quits, which ends an Instruments recording that launched the harness.
///
/// It jumps to the middle, as a drag of the scroll indicator does, scrolls
/// up to the top through text laying out above what is shown for the first
/// time, then down to the bottom. Each frame's work is a Points of Interest
/// interval, for Instruments to line up with its commits and hitches.
@MainActor final class ScrollProbe {
  static let signposter = OSSignposter(subsystem: "xyz.raiju.lexidraw.editor-harness", category: .pointsOfInterest)

  private let view: EditorView
  private let report: URL
  private let step: CGFloat
  private var timing: Harness.Timing
  private var link: CADisplayLink?
  private var scrolling = false
  private var waiting = false
  private var jumpedToTheMiddle = false
  private var jumpWork = 0.0
  private var phase = Phase.up
  private var previous: CFTimeInterval?
  private var frames: [Frame] = []
  private var jumps: [Jump] = []
  private var memory = Memory()

  private enum Phase: String { case down, up }

  private struct Frame {
    var phase: Phase
    /// Since the frame before, and what the display asked for.
    var interval: Double
    var expected: Double
    /// Moving the content and laying out what came into view.
    var work: Double
  }

  private struct Jump: Encodable {
    var phase: String
    var offset: Double
    /// How far the text moved beyond the scroll, in points.
    var by: Double
  }

  init(view: EditorView, report: URL, step: CGFloat, timing: Harness.Timing) {
    self.view = view
    self.report = report
    self.step = step
    self.timing = timing
    memory.start = timing.footprintAtOpen
  }

  /// A probe launched with `EDITOR_SCROLL_WAIT` sets `ready`'s state to its
  /// pid once the editor is on screen, and scrolls once `go` is posted, when
  /// Instruments has attached (`notifyutil`).
  static let ready = "xyz.raiju.lexidraw.editor-harness.ready"
  static let go = "xyz.raiju.lexidraw.editor-harness.scroll"

  /// Scrolls as soon as the editor is on screen, or with `waiting`, once
  /// `go` is posted.
  func start(waiting: Bool) {
    scrolling = !waiting
    self.waiting = waiting
    if waiting {
      var token: Int32 = 0
      notify_register_dispatch(Self.go, &token, .main) { [self] token in
        notify_cancel(token)
        MainActor.assumeIsolated { scrolling = true }
      }
    }
    let link = CADisplayLink(target: self, selector: #selector(tick))
    link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
    link.add(to: .main, forMode: .common)
    self.link = link
  }

  @objc private func tick(_ link: CADisplayLink) {
    guard view.window != nil else { return }
    if timing.firstScreen == nil {
      // The first frame with the editor in it has been committed.
      timing.firstScreen = link.timestamp
      memory.firstScreen = Memory.footprint()
      previous = link.timestamp
      if waiting {
        // The state lasts while the name has a registration: until the app quits.
        var token: Int32 = 0
        notify_register_check(Self.ready, &token)
        notify_set_state(token, UInt64(getpid()))
      }
      return
    }
    guard scrolling else {
      previous = link.timestamp
      return
    }
    if !jumpedToTheMiddle {
      jumpedToTheMiddle = true
      let started = CACurrentMediaTime()
      view.contentOffset.y = (view.contentSize.height / 2).rounded()
      view.layoutIfNeeded()
      jumpWork = CACurrentMediaTime() - started
      // The jump itself isn't a frame of the scroll.
      previous = nil
      return
    }
    let expected = link.targetTimestamp - link.timestamp
    let interval = link.timestamp - (previous ?? link.timestamp)
    previous = link.timestamp

    let anchor = self.anchor()
    let delta = phase == .down ? step : -step
    let state = Self.signposter.beginInterval("frame")
    let started = CACurrentMediaTime()
    let scrolled = min(max(view.contentOffset.y + delta, 0), maxOffset)
    view.contentOffset.y = scrolled
    view.layoutIfNeeded()
    let work = CACurrentMediaTime() - started
    Self.signposter.endInterval("frame", state)
    // Against the scroll asked for, which the layout may add to
    // (`BlockLayout`).
    let moved = scrolled - (anchor?.offset ?? 0)
    if let anchor, let now = y(of: anchor.position) {
      let by = now - (anchor.y - moved)
      if abs(by) > 0.5 { jumps.append(Jump(phase: phase.rawValue, offset: view.contentOffset.y, by: by)) }
    }
    frames.append(Frame(phase: phase, interval: interval, expected: expected, work: work))
    memory.sample()

    switch phase {
    case .up where view.contentOffset.y <= 0: phase = .down
    case .down where view.contentOffset.y >= maxOffset: finish()
    default: break
    }
  }

  private var maxOffset: CGFloat { max(view.contentSize.height - view.bounds.height, 0) }

  /// The text a third of the way down the viewport, and where it is on screen.
  private func anchor() -> (position: UITextPosition, y: CGFloat, offset: CGFloat)? {
    let point = CGPoint(x: 40, y: view.contentOffset.y + view.bounds.height / 3)
    guard let position = view.closestPosition(to: view.convert(point, to: view.textInputView)),
      let y = y(of: position)
    else { return nil }
    return (position, y, view.contentOffset.y)
  }

  private func y(of position: UITextPosition) -> CGFloat? {
    let caret = view.caretRect(for: position)
    guard !caret.isNull, !caret.isInfinite else { return nil }
    return view.convert(caret, from: view.textInputView).minY - view.contentOffset.y
  }

  private func finish() {
    link?.invalidate()
    memory.sample()
    let summary = Summary(
      timing: timing, frames: frames, jumpWork: jumpWork, jumps: jumps, memory: memory,
      contentHeight: Double(view.contentSize.height))
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    do {
      try encoder.encode(summary).write(to: report, options: .atomic)
    } catch {
      Logger(subsystem: "xyz.raiju.lexidraw.editor-harness", category: "ScrollProbe").error("\(error)")
    }
    exit(0)
  }

  private struct Summary: Encodable {
    var document: String
    var contentHeight: Double
    /// Loading the model, from its JSON.
    var loadMs: Double
    /// Making the view: the text of the whole document, and its blocks' heights.
    var makingTheViewMs: Double
    /// From making the view to the first frame with it committed.
    var viewToFirstScreenMs: Double
    var openToFirstScreenMs: Double
    /// Moving to the middle and laying out what is there, in one frame.
    var jumpToTheMiddleMs: Double
    var frames: Int
    var hitches: Int
    var hitchTimeMs: Double
    var intervalMs: Percentiles
    var workMs: Percentiles
    var workByPhaseMs: [String: Percentiles]
    var jumps: Int
    var largestJumps: [Jump]
    var memoryMB: [String: Double]

    init(timing: Harness.Timing, frames: [Frame], jumpWork: Double, jumps: [Jump], memory: Memory, contentHeight: Double) {
      document = timing.document
      self.contentHeight = contentHeight
      loadMs = (timing.loaded - timing.opened) * 1000
      let first = timing.firstScreen ?? timing.viewMade
      makingTheViewMs = (timing.viewInitialized - timing.viewMade) * 1000
      viewToFirstScreenMs = (first - timing.viewMade) * 1000
      openToFirstScreenMs = (first - timing.opened) * 1000
      jumpToTheMiddleMs = jumpWork * 1000
      self.frames = frames.count
      // A frame shown later than the display asked for, as Instruments counts
      // a hitch; the frame after the jump has no interval.
      let late = frames.filter { $0.interval > $0.expected * 1.5 }
      hitches = late.count
      hitchTimeMs = late.reduce(0) { $0 + ($1.interval - $1.expected) } * 1000
      intervalMs = Percentiles(frames.filter { $0.interval > 0 }.map { $0.interval * 1000 })
      workMs = Percentiles(frames.map { $0.work * 1000 })
      workByPhaseMs = Dictionary(grouping: frames, by: \.phase.rawValue).mapValues {
        Percentiles($0.map { $0.work * 1000 })
      }
      self.jumps = jumps.count
      largestJumps = Array(jumps.sorted { abs($0.by) > abs($1.by) }.prefix(10))
      memoryMB = [
        "atStart": memory.start, "firstScreen": memory.firstScreen, "peak": memory.peak, "end": memory.last,
      ].mapValues { $0 / 1_048_576 }
    }
  }

  struct Percentiles: Encodable {
    var p50: Double
    var p95: Double
    var p99: Double
    var max: Double

    init(_ values: [Double]) {
      let sorted = values.sorted()
      func at(_ fraction: Double) -> Double {
        sorted.isEmpty ? 0 : sorted[min(Int((Double(sorted.count - 1) * fraction).rounded()), sorted.count - 1)]
      }
      p50 = at(0.5)
      p95 = at(0.95)
      p99 = at(0.99)
      max = sorted.last ?? 0
    }
  }

  /// The app's physical footprint, as Xcode's memory gauge and jetsam count it.
  struct Memory {
    var start = 0.0
    var firstScreen = 0.0
    var peak = 0.0
    var last = 0.0

    mutating func sample() {
      last = Memory.footprint()
      peak = Swift.max(peak, last)
    }

    static func footprint() -> Double {
      var info = task_vm_info_data_t()
      var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
      let result = withUnsafeMutablePointer(to: &info) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
          task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
        }
      }
      return result == KERN_SUCCESS ? Double(info.phys_footprint) : 0
    }
  }
}
