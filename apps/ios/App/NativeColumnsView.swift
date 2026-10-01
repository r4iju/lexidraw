import UIKit

/// The native track grammars currently supported without a browser layout engine.
enum NativeColumnTrack {
  case fraction(CGFloat), pixels(CGFloat), percentage(CGFloat)

  init?(_ source: String) {
    let value = source.lowercased()
    let suffix: String
    if value.hasSuffix("fr") { suffix = "fr" }
    else if value.hasSuffix("px") { suffix = "px" }
    else if value.hasSuffix("%") { suffix = "%" }
    else { return nil }
    guard let number = Double(value.dropLast(suffix.count)), number.isFinite, number > 0 else { return nil }
    switch suffix {
    case "fr": self = .fraction(number)
    case "px": self = .pixels(number)
    default: self = .percentage(number / 100)
    }
  }
}

/// Fixed tracks may overflow their grid; they must not become conflicting stack constraints.
@MainActor final class NativeColumnsView: UIView {
  private let tracks: [NativeColumnTrack]
  private let gap: CGFloat
  private let viewport = UIScrollView()
  private var columns: [UIStackView] = []
  private var frames: [CGRect] = []
  private var measuredHeight: CGFloat = 0
  private var measuredWidth: CGFloat = 0
  private let unavailable = UILabel()

  init(tracks: [NativeColumnTrack], gap: CGFloat) {
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
    var widths = Array(repeating: width, count: columns.count)
    if !stacked {
      var fixed: CGFloat = 0
      var fractions: CGFloat = 0
      for (index, track) in tracks.enumerated() {
        switch track {
        case .pixels(let value): widths[index] = value; fixed += value
        case .percentage(let value): widths[index] = width * value; fixed += widths[index]
        case .fraction(let value): widths[index] = 0; fractions += value
        }
      }
      guard fixed.isFinite, fractions.isFinite else { showUnavailable(width: width); return }
      let remaining = max(0, width - gap * CGFloat(max(0, tracks.count - 1)) - fixed)
      for (index, track) in tracks.enumerated() {
        if case .fraction(let value) = track { widths[index] = remaining * (value / max(1, fractions)) }
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
    var x: CGFloat = 0
    var y: CGFloat = 0
    var tallest: CGFloat = 0
    for (index, column) in columns.enumerated() {
      let size = column.systemLayoutSizeFitting(CGSize(width: widths[index], height: 0),
        withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel)
      frames.append(CGRect(x: stacked ? 0 : x, y: stacked ? y : 0, width: widths[index], height: size.height))
      x += widths[index] + gap
      y += size.height + gap
      tallest = max(tallest, size.height)
    }
    if !stacked { frames = frames.map { CGRect(x: $0.minX, y: 0, width: $0.width, height: tallest) } }
    measuredHeight = stacked ? max(0, y - gap) : tallest
    measuredWidth = stacked ? width : max(width, x - gap)
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
    unavailable.frame = bounds
    for (column, frame) in zip(columns, frames) { column.frame = frame }
  }
}
