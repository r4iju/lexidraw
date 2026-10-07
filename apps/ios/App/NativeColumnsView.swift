import UIKit
import LexidrawJSON
import CSSValues
import EditorModelInterface

/// The native track grammars currently supported without a browser layout engine.
indirect enum NativeColumnTrack {
  case fraction(CGFloat), pixels(CGFloat), percentage(CGFloat)
  case intrinsic(stretches: Bool)
  case bounded(minimum: Self, maximum: Self)
  case fitContent(Self)
  case automatic(repeated: [Self], collapses: Bool)

  init?(_ source: String) {
    let value = source.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if value.hasPrefix("minmax("), value.hasSuffix(")") {
      guard let arguments = Self.split(String(value.dropFirst(7).dropLast()), separator: ","), arguments.count == 2,
        let minimum = Self(primitive: arguments[0]), let maximum = Self(primitive: arguments[1]),
        minimum.factor == nil else { return nil }
      self = .bounded(minimum: minimum, maximum: maximum)
    } else if value.hasPrefix("fit-content("), value.hasSuffix(")") {
      guard let limit = Self(primitive: String(value.dropFirst(12).dropLast())) else { return nil }
      switch limit {
      case .pixels, .percentage: self = .fitContent(limit)
      default: return nil
      }
    } else {
      guard let track = Self(primitive: value) else { return nil }
      self = track
    }
  }

  // Functions accept only CSS track-breadth primitives, never nested functions.
  private init?(primitive source: String) {
    let value = source.trimmingCharacters(in: .whitespacesAndNewlines)
    if value == "auto" { self = .intrinsic(stretches: true); return }
    if value == "min-content" || value == "max-content" { self = .intrinsic(stretches: false); return }
    if value == "0" { self = .pixels(0); return }
    let suffix: String
    if value.hasSuffix("fr") { suffix = "fr" }
    else if value.hasSuffix("%") { suffix = "%" }
    else if let unit = ["px", "in", "cm", "mm", "pt", "pc", "q"].first(where: { value.hasSuffix($0) }) { suffix = unit }
    else { return nil }
    guard let number = Double(value.dropLast(suffix.count)), number.isFinite, number >= 0 else { return nil }
    switch suffix {
    case "fr": self = .fraction(number)
    case "%": self = .percentage(number / 100)
    default:
      // CSS absolute units use the fixed 96px/in ratio, independent of screen DPI.
      let scale: Double
      switch suffix {
      case "in": scale = 96
      case "cm": scale = 96 / 2.54
      case "mm": scale = 96 / 25.4
      case "q": scale = 96 / 101.6
      case "pt": scale = 96 / 72
      case "pc": scale = 16
      default: scale = 1
      }
      guard (number * scale).isFinite else { return nil }
      self = .pixels(number * scale)
    }
  }

  static func parse(_ source: String) -> [Self]? { parse(source, allowsRepeat: true) }

  private static func parse(_ source: String, allowsRepeat: Bool) -> [Self]? {
    guard let tokens = split(source, separator: nil), !tokens.isEmpty else { return nil }
    var tracks: [Self] = []
    for token in tokens {
      if token.lowercased().hasPrefix("repeat("), token.hasSuffix(")") {
        guard allowsRepeat, let arguments = split(String(token.dropFirst(7).dropLast()), separator: ","), arguments.count == 2,
          let repeated = parse(arguments[1], allowsRepeat: false) else { return nil }
        let countSource = arguments[0].trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if countSource == "auto-fill" || countSource == "auto-fit" {
          guard repeated.allSatisfy(\.isFixedRepeatSize) else { return nil }
          tracks.append(.automatic(repeated: repeated, collapses: countSource == "auto-fit"))
        } else {
          guard let count = Int(countSource), count > 0, count <= 4096 / repeated.count else { return nil }
          for _ in 0..<count { tracks.append(contentsOf: repeated) }
        }
      } else {
        guard let track = Self(token) else { return nil }
        tracks.append(track)
      }
      guard tracks.count <= 4096 else { return nil }
    }
    let automaticCount = tracks.filter { if case .automatic = $0 { true } else { false } }.count
    guard automaticCount <= 1 else { return nil }
    if automaticCount == 1 {
      guard tracks.allSatisfy({ if case .automatic = $0 { true } else { $0.isFixedRepeatSize } }) else { return nil }
    }
    return tracks
  }

  private static func split(_ source: String, separator: Character?) -> [String]? {
    var depth = 0, token = "", result: [String] = []
    for character in source {
      if character == "(" { depth += 1 }
      if character == ")" { depth -= 1; if depth < 0 { return nil } }
      let separates = separator.map { character == $0 } ?? " \t\n\r\u{000C}".contains(character)
      if depth == 0 && separates {
        if !token.isEmpty { result.append(token); token = "" }
        else if separator != nil { return nil }
      } else { token.append(character) }
    }
    guard depth == 0, separator == nil || !token.isEmpty else { return nil }
    if !token.isEmpty { result.append(token) }
    return result
  }

  private var isFixedBreadth: Bool {
    switch self { case .pixels, .percentage: true; default: false }
  }
  private var isFixedRepeatSize: Bool {
    switch self {
    case .pixels, .percentage: true
    case .bounded(let minimum, let maximum): minimum.isFixedBreadth || maximum.isFixedBreadth
    default: false
    }
  }
  private func repetitionSize(width: CGFloat) -> CGFloat {
    if case .bounded(let minimum, let maximum) = self {
      let minimumSize = minimum.isFixedBreadth ? minimum.base(width: width, occupied: false) : 0
      return maximum.isFixedBreadth ? max(minimumSize, maximum.base(width: width, occupied: false)) : minimumSize
    }
    return base(width: width, occupied: false)
  }
  static func resolve(_ source: [Self], width: CGFloat, gap: CGFloat, occupied: Int) -> (tracks: [Self], collapsed: Set<Int>)? {
    guard let automaticIndex = source.firstIndex(where: { if case .automatic = $0 { true } else { false } }) else {
      return (source, [])
    }
    guard case .automatic(let repeated, let collapses) = source[automaticIndex],
      !repeated.isEmpty, source.filter({ if case .automatic = $0 { true } else { false } }).count == 1 else { return nil }
    let fixed = source.enumerated().filter { $0.offset != automaticIndex }.map(\.element)
    guard fixed.allSatisfy(\.isFixedRepeatSize), repeated.allSatisfy(\.isFixedRepeatSize) else { return nil }
    // CSS auto-repeat counts definite maxima, floored by definite minima.
    // Subpixel repeat contributions depend on the browser's UA floor/zoom.
    // Refuse that unported #133 context rather than guessing a repeat count.
    let contributions = repeated.map { $0.repetitionSize(width: width) }
    guard contributions.allSatisfy({ $0.isFinite && $0 >= 1 }) else { return nil }
    let fixedSize = fixed.reduce(CGFloat(0)) { $0 + $1.repetitionSize(width: width) }
    let groupSize = contributions.reduce(0, +)
    let available = width + gap - fixedSize - gap * CGFloat(fixed.count)
    let denominator = groupSize + gap * CGFloat(repeated.count)
    let repetitions = max(1, floor(available / denominator))
    guard repetitions.isFinite, repetitions <= CGFloat((4096 - fixed.count) / repeated.count) else { return nil }
    var tracks: [Self] = [], collapsed = Set<Int>()
    for (index, track) in source.enumerated() {
      if index == automaticIndex {
        for _ in 0..<Int(repetitions) {
          for item in repeated {
            if collapses && tracks.count >= occupied { collapsed.insert(tracks.count) }
            tracks.append(item)
          }
        }
      } else { tracks.append(track) }
    }
    return (tracks, collapsed)
  }

  var factor: CGFloat? {
    switch self {
    case .fraction(let value): value
    case .bounded(_, let maximum): maximum.factor
    default: nil
    }
  }
  var stretches: Bool {
    switch self {
    case .intrinsic(let stretches): stretches
    case .bounded(_, let maximum): maximum.stretches
    default: false
    }
  }
  func base(width: CGFloat, occupied: Bool) -> CGFloat {
    let intrinsic = occupied ? 2 * (StructuralBlockConfiguration.columnPadding + StructuralBlockConfiguration.columnBorderWidth) : 0
    switch self {
    case .pixels(let value): return value
    case .percentage(let value): return width * value
    case .bounded(let minimum, _): return minimum.base(width: width, occupied: occupied)
    case .fraction, .intrinsic, .fitContent: return intrinsic
    case .automatic: preconditionFailure("Automatic tracks must resolve before sizing")
    }
  }
  func growthLimit(width: CGFloat, occupied: Bool) -> CGFloat {
    let minimum = base(width: width, occupied: occupied)
    if case .bounded(_, let maximum) = self {
      // Flexible maxima participate only in the later fr phase.
      if maximum.factor != nil { return minimum }
      return max(minimum, maximum.base(width: width, occupied: occupied))
    }
    return minimum
  }

}

/// Fixed tracks may overflow their grid; they must not become conflicting stack constraints.
@MainActor final class NativeColumnsView: UIView {
  private let rightToLeft: Bool
  private var initialScrollPosition = true
  private var wasStacked = false
  private let tracks: [NativeColumnTrack]
  private let gap: CGFloat
  private let viewport = UIScrollView()
  private var columns: [UIStackView] = []
  private var frames: [CGRect] = []
  private var measuredHeight: CGFloat = 0
  private var measuredWidth: CGFloat = 0
  private let unavailable = UILabel()

  init(tracks: [NativeColumnTrack], gap: CGFloat, rightToLeft: Bool = false) {
    self.rightToLeft = rightToLeft
    self.tracks = tracks
    self.gap = gap
    super.init(frame: .zero)
    viewport.isDirectionalLockEnabled = true
    viewport.accessibilityIdentifier = "layout-columns"
    addSubview(viewport)
    unavailable.text = "Column dimensions cannot be represented natively (#133)"
    unavailable.numberOfLines = 0
    unavailable.isHidden = true
    addSubview(unavailable)
  }
  required init?(coder: NSCoder) { fatalError("NativeColumnsView is made in code") }
  func addColumn(_ column: UIStackView) { columns.append(column); viewport.addSubview(column) }
  override var intrinsicContentSize: CGSize { CGSize(width: UIView.noIntrinsicMetric, height: measuredHeight) }

  func prepare(width: CGFloat, stacked: Bool) {
    if stacked != wasStacked { initialScrollPosition = true; wasStacked = stacked }
    guard let resolved = NativeColumnTrack.resolve(tracks, width: width, gap: gap, occupied: columns.count), !resolved.tracks.isEmpty else {
      showUnavailable(width: width); return
    }
    let tracks = resolved.tracks
    let collapsed = stacked ? Set<Int>() : resolved.collapsed
    let active = tracks.indices.filter { !collapsed.contains($0) }
    var gapsAfter = Array(repeating: CGFloat(0), count: stacked ? 1 : tracks.count)
    if !stacked { for index in active.dropLast() { gapsAfter[index] = gap } }
    let gutters = gapsAfter.reduce(0, +)
    var widths = Array(repeating: width, count: stacked ? 1 : tracks.count)
    if !stacked {
      widths = tracks.enumerated().map { index, track in
        collapsed.contains(index) ? 0 : track.base(width: width, occupied: index < columns.count)
      }
      let available = max(0, width - gutters)
      let limits = tracks.enumerated().map { index, track in
        collapsed.contains(index) ? 0 : track.growthLimit(width: width, occupied: index < columns.count)
      }
      // CSS Grid maximize phase: equal growth, freezing each bounded maximum.
      var growing = Set(tracks.indices.filter { limits[$0] > widths[$0] })
      while !growing.isEmpty {
        let free = max(0, available - widths.reduce(0, +))
        guard free > 0 else { break }
        let share = free / CGFloat(growing.count)
        let frozen = growing.filter { limits[$0] - widths[$0] <= share }
        if frozen.isEmpty {
          for index in growing { widths[index] += share }
          break
        }
        for index in frozen { widths[index] = limits[index] }
        growing.subtract(frozen)
      }
      var flexible = Set(tracks.indices.filter { !collapsed.contains($0) && tracks[$0].factor != nil })
      while !flexible.isEmpty {
        let fixed = widths.indices.filter { !flexible.contains($0) }.reduce(CGFloat(0)) { $0 + widths[$1] }
        let factors = flexible.reduce(CGFloat(0)) { $0 + (tracks[$1].factor ?? 0) }
        guard fixed.isFinite, factors.isFinite else { showUnavailable(width: width); return }
        let available = max(0, width - gutters - fixed)
        let unit = available / max(1, factors)
        let frozen = flexible.filter { widths[$0] > unit * (tracks[$0].factor ?? 0) }
        if frozen.isEmpty {
          for index in flexible { widths[index] = unit * (tracks[index].factor ?? 0) }
          break
        }
        flexible.subtract(frozen)
      }
      // Normal justify-content stretches only tracks with an auto maximum.
      let stretching = tracks.indices.filter { !collapsed.contains($0) && tracks[$0].stretches }
      if !stretching.isEmpty {
        let free = max(0, available - widths.reduce(0, +)) / CGFloat(stretching.count)
        for index in stretching { widths[index] += free }
      }
    }
    guard widths.allSatisfy({ $0.isFinite && $0 >= 0 }),
      widths.reduce(0, +).isFinite, widths.reduce(0, +) < CGFloat(Float.greatestFiniteMagnitude) else {
      showUnavailable(width: width)
      return
    }
    unavailable.isHidden = true
    columns.forEach { $0.isHidden = false }
    frames = []
    var y: CGFloat = 0
    var row: [CGRect] = []
    var x: CGFloat = 0
    var tallest: CGFloat = 0
    for (index, column) in columns.enumerated() {
      let trackIndex = index % widths.count
      let boxWidth = max(widths[trackIndex], 2 * (StructuralBlockConfiguration.columnPadding + StructuralBlockConfiguration.columnBorderWidth))
      let size = column.systemLayoutSizeFitting(CGSize(width: boxWidth, height: 0),
        withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel)
      row.append(CGRect(x: x, y: y, width: boxWidth, height: size.height))
      x += widths[trackIndex] + gapsAfter[trackIndex]
      tallest = max(tallest, size.height)
      if trackIndex == widths.count - 1 || index == columns.count - 1 {
        frames.append(contentsOf: row.map { CGRect(x: $0.minX, y: y, width: $0.width, height: tallest) })
        y += tallest + gap
        row = []; x = 0; tallest = 0
      }
    }
    measuredHeight = max(0, y - gap)
    measuredWidth = stacked ? width : max(width, widths.reduce(0, +) + gutters)
    measuredWidth = max(measuredWidth, frames.map(\.maxX).max() ?? 0)
    if rightToLeft && !stacked {
      frames = frames.map { CGRect(x: measuredWidth - $0.maxX, y: $0.minY, width: $0.width, height: $0.height) }
    }
    viewport.isScrollEnabled = !stacked && measuredWidth > width
    if stacked { viewport.contentOffset = .zero }
    invalidateIntrinsicContentSize()
    setNeedsLayout()
  }
  private func showUnavailable(width: CGFloat) {
    columns.forEach { $0.isHidden = true }
    unavailable.isHidden = false
    frames = []
    measuredWidth = width
    measuredHeight = unavailable.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height
    invalidateIntrinsicContentSize()
    setNeedsLayout()
  }
  override func layoutSubviews() {
    super.layoutSubviews()
    viewport.frame = bounds
    viewport.contentSize = CGSize(width: measuredWidth, height: measuredHeight)
    if initialScrollPosition {
      viewport.contentOffset = CGPoint(x: rightToLeft && !wasStacked ? max(0, measuredWidth - bounds.width) : 0, y: 0)
      initialScrollPosition = false
    }
    unavailable.frame = bounds
    for (column, frame) in zip(columns, frames) { column.frame = frame }
  }
}

/// The web's column outline guides editing while a row is hovered or selected
/// in; native has neither, so unless the web shows it at rest the border keeps
/// its box and stays transparent, as it does for readers.
@MainActor final class NativeColumnBox: UIStackView {
  private let outline = CAShapeLayer()
  private let borderColor: UIColor

  init(editable: Bool) throws {
    let values = StructuralBlockConfiguration.columnBorderColors
    guard values.count == 2, let light = CSSColor(values[0]), let dark = CSSColor(values[1]) else {
      throw EditorError.unsupported("The column border color cannot be represented natively (#133)")
    }
    borderColor = editable && StructuralBlockConfiguration.columnFramesShowAtRest ? UIColor { traits in
      let color = traits.userInterfaceStyle == .dark ? dark : light
      return UIColor(red: color.red, green: color.green, blue: color.blue, alpha: color.alpha)
    } : .clear
    super.init(frame: .zero)
    outline.fillColor = UIColor.clear.cgColor
    outline.lineWidth = StructuralBlockConfiguration.columnBorderWidth
    outline.lineDashPattern = [NSNumber(value: 3 * outline.lineWidth), NSNumber(value: 3 * outline.lineWidth)]
    layer.addSublayer(outline)
    registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (view: NativeColumnBox, _: UITraitCollection) in
      view.updateBorder()
    }
  }
  required init(coder: NSCoder) { fatalError("NativeColumnBox is made in code") }
  private func updateBorder() { outline.strokeColor = borderColor.resolvedColor(with: traitCollection).cgColor }
  override func layoutSubviews() {
    super.layoutSubviews()
    outline.frame = bounds
    outline.path = CGPath(rect: bounds.insetBy(dx: outline.lineWidth / 2, dy: outline.lineWidth / 2), transform: nil)
    updateBorder()
  }
}
