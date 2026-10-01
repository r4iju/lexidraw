import UIKit
import LexidrawJSON
import CSSValues
import EditorModelInterface

/// The native track grammars currently supported without a browser layout engine.
indirect enum NativeColumnTrack {
  case fraction(CGFloat), pixels(CGFloat), percentage(CGFloat)
  case minimum(CGFloat, fraction: CGFloat)
  case percentageMinimum(CGFloat, fraction: CGFloat)

  init?(_ source: String) {
    let value = source.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if value.hasPrefix("minmax("), value.hasSuffix(")") {
      let arguments = Self.split(String(value.dropFirst(7).dropLast()), separator: ",")
      guard let arguments, arguments.count == 2,
        let minimum = Self(arguments[0]), let maximum = Self(arguments[1]),
        case .fraction(let factor) = maximum else { return nil }
      switch minimum {
      case .pixels(let amount): self = .minimum(amount, fraction: factor)
      case .percentage(let amount): self = .percentageMinimum(amount, fraction: factor)
      default: return nil
      }
      return
    }
    if value == "0" { self = .pixels(0); return }
    let suffix: String
    if value.hasSuffix("fr") { suffix = "fr" }
    else if value.hasSuffix("px") { suffix = "px" }
    else if value.hasSuffix("%") { suffix = "%" }
    else { return nil }
    guard let number = Double(value.dropLast(suffix.count)), number.isFinite, number >= 0 else { return nil }
    switch suffix {
    case "fr": self = .fraction(number)
    case "px": self = .pixels(number)
    default: self = .percentage(number / 100)
    }
  }

  static func parse(_ source: String) -> [Self]? { parse(source, allowsRepeat: true) }

  private static func parse(_ source: String, allowsRepeat: Bool) -> [Self]? {
    guard let tokens = split(source, separator: nil), !tokens.isEmpty else { return nil }
    var tracks: [Self] = []
    for token in tokens {
      if token.lowercased().hasPrefix("repeat("), token.hasSuffix(")") {
        guard allowsRepeat, let arguments = split(String(token.dropFirst(7).dropLast()), separator: ","), arguments.count == 2,
          let count = Int(arguments[0].trimmingCharacters(in: .whitespacesAndNewlines)), count > 0,
          let repeated = parse(arguments[1], allowsRepeat: false), count <= 4096 / repeated.count else { return nil }
        for _ in 0..<count { tracks.append(contentsOf: repeated) }
      } else {
        guard let track = Self(token) else { return nil }
        tracks.append(track)
      }
      guard tracks.count <= 4096 else { return nil }
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

  var factor: CGFloat? {
    switch self {
    case .fraction(let value), .minimum(_, let value), .percentageMinimum(_, let value): value
    default: nil
    }
  }
  func base(width: CGFloat) -> CGFloat {
    switch self {
    case .pixels(let value), .minimum(let value, _): value
    case .percentage(let value), .percentageMinimum(let value, _): width * value
    case .fraction: 2 * (StructuralBlockConfiguration.columnPadding + StructuralBlockConfiguration.columnBorderWidth)
    }
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
    var widths = Array(repeating: width, count: stacked ? 1 : tracks.count)
    if !stacked {
      widths = tracks.enumerated().map { index, track in
        if case .fraction = track, index >= columns.count { return 0 }
        return track.base(width: width)
      }
      var flexible = Set(tracks.indices.filter { tracks[$0].factor != nil })
      while !flexible.isEmpty {
        let fixed = widths.indices.filter { !flexible.contains($0) }.reduce(CGFloat(0)) { $0 + widths[$1] }
        let factors = flexible.reduce(CGFloat(0)) { $0 + (tracks[$1].factor ?? 0) }
        guard fixed.isFinite, factors.isFinite else { showUnavailable(width: width); return }
        let available = max(0, width - gap * CGFloat(max(0, tracks.count - 1)) - fixed)
        let unit = available / max(1, factors)
        let frozen = flexible.filter { widths[$0] > unit * (tracks[$0].factor ?? 0) }
        if frozen.isEmpty {
          for index in flexible { widths[index] = unit * (tracks[index].factor ?? 0) }
          break
        }
        flexible.subtract(frozen)
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
      x += widths[trackIndex] + gap
      tallest = max(tallest, size.height)
      if trackIndex == widths.count - 1 || index == columns.count - 1 {
        frames.append(contentsOf: row.map { CGRect(x: $0.minX, y: y, width: $0.width, height: tallest) })
        y += tallest + gap
        row = []; x = 0; tallest = 0
      }
    }
    measuredHeight = max(0, y - gap)
    measuredWidth = stacked ? width : max(width, widths.reduce(0, +) + gap * CGFloat(max(0, widths.count - 1)))
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

/// The web's column outline guides editing; readers retain a transparent border.
@MainActor final class NativeColumnBox: UIStackView {
  private let outline = CAShapeLayer()
  private let borderColor: UIColor

  init(editable: Bool) throws {
    let values = StructuralBlockConfiguration.columnBorderColors
    guard values.count == 2, let light = CSSColor(values[0]), let dark = CSSColor(values[1]) else {
      throw EditorError.unsupported("The column border color cannot be represented natively (#133)")
    }
    borderColor = editable ? UIColor { traits in
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
