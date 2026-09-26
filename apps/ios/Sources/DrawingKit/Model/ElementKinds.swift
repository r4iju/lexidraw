import Foundation

/// The element types the web draws. `restoreElement` drops an element of
/// any other type, so a restored element always has one of these; a stored
/// element of another type is still kept whole and saved as it was.
public enum ElementType: String, CaseIterable, Sendable {
  case rectangle, diamond, ellipse, line, arrow, freedraw, text, image, frame, magicframe, iframe, embeddable

  public var isLinear: Bool { self == .line || self == .arrow }
  public var isFrameLike: Bool { self == .frame || self == .magicframe }
}

/// How a shape's background is filled. One the app doesn't know is kept as
/// written, and drawn as Rough.js draws it.
public enum FillStyle: RawRepresentable, Hashable, Sendable {
  case hachure, crossHatch, solid, zigzag
  case unknown(String)

  public init(rawValue: String) {
    switch rawValue {
    case "hachure": self = .hachure
    case "cross-hatch": self = .crossHatch
    case "solid": self = .solid
    case "zigzag": self = .zigzag
    default: self = .unknown(rawValue)
    }
  }

  public var rawValue: String {
    switch self {
    case .hachure: "hachure"
    case .crossHatch: "cross-hatch"
    case .solid: "solid"
    case .zigzag: "zigzag"
    case .unknown(let value): value
    }
  }
}

/// How a shape's outline is stroked. One the app doesn't know is kept as
/// written, and drawn as the web draws it: unbroken, but not as `solid`.
public enum StrokeStyle: RawRepresentable, Hashable, Sendable {
  case solid, dashed, dotted
  case unknown(String)

  public init(rawValue: String) {
    switch rawValue {
    case "solid": self = .solid
    case "dashed": self = .dashed
    case "dotted": self = .dotted
    default: self = .unknown(rawValue)
    }
  }

  public var rawValue: String {
    switch self {
    case .solid: "solid"
    case .dashed: "dashed"
    case .dotted: "dotted"
    case .unknown(let value): value
    }
  }
}
