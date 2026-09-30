#if canImport(UIKit)
import CoreText
import UIKit

/// A verified native family, optionally backed by downloaded OpenType/WOFF2
/// descriptors. An unavailable family is refused instead of substituted.
public final class DocumentFont {
  public let family: String
  private let descriptors: [CTFontDescriptor]
  private let native: UIFont?
  private let fallback: [UIFontDescriptor]
  private struct Key: Hashable {
    let weight: CGFloat
    let italic: Bool
  }
  private var prepared: [Key: UIFont] = [:]

  public init(family: String, data: [Data] = [], cascade: [String] = []) throws {
    self.family = family
    fallback = cascade.compactMap { Self.nativeFont($0)?.fontDescriptor }
    descriptors = try data.flatMap { bytes in
      guard
        let descriptors = CTFontManagerCreateFontDescriptorsFromData(bytes as CFData)
          as? [CTFontDescriptor], !descriptors.isEmpty
      else {
        throw Unavailable(family: family)
      }
      for descriptor in descriptors {
        let actual =
          CTFontCopyFamilyName(CTFontCreateWithFontDescriptor(descriptor, 17, nil)) as String
        guard actual.caseInsensitiveCompare(family) == .orderedSame else {
          throw Unavailable(family: family)
        }
      }
      return descriptors
    }
    native = data.isEmpty ? Self.nativeFont(family) : nil
    guard native != nil || !descriptors.isEmpty else { throw Unavailable(family: family) }
    for weight in [
      UIFont.Weight.ultraLight, .thin, .light, .regular, .medium, .semibold, .bold, .heavy,
      .black,
    ] {
      for italic in [false, true] {
        prepared[Key(weight: weight.rawValue, italic: italic)] = try makeFont(
          size: 17, weight: weight, italic: italic)
      }
    }
  }

  private static func nativeFont(_ family: String) -> UIFont? {
    switch family {
    case "ui-sans-serif", "-apple-system", "BlinkMacSystemFont", "system-ui", "sans-serif":
      .systemFont(ofSize: 17)
    case "ui-monospace", "monospace": .monospacedSystemFont(ofSize: 17, weight: .regular)
    case "serif":
      UIFont.systemFont(ofSize: 17).fontDescriptor.withDesign(.serif).map {
        UIFont(descriptor: $0, size: 17)
      }
    default: UIFont(name: family, size: 17)
    }
  }

  public func font(size: CGFloat, weight: UIFont.Weight, italic: Bool) -> UIFont {
    guard let font = prepared[Key(weight: weight.rawValue, italic: italic)] else {
      preconditionFailure("Unported document font weight (#130): \(weight)")
    }
    return font.withSize(size)
  }

  private func makeFont(size: CGFloat, weight: UIFont.Weight, italic: Bool) throws -> UIFont {
    var traits: CTFontSymbolicTraits = []
    if weight >= .semibold { traits.insert(.traitBold) }
    if italic { traits.insert(.traitItalic) }
    if let native {
      var symbolic: UIFontDescriptor.SymbolicTraits = []
      if traits.contains(.traitBold) { symbolic.insert(.traitBold) }
      if italic { symbolic.insert(.traitItalic) }
      let descriptor = native.fontDescriptor.addingAttributes([
        .traits: [UIFontDescriptor.TraitKey.weight: weight.rawValue], .cascadeList: fallback,
      ])
      guard let styled = descriptor.withSymbolicTraits(symbolic) else {
        throw Unavailable(family: family)
      }
      return UIFont(descriptor: styled, size: size)
    }
    let fonts = descriptors.map { CTFontCreateWithFontDescriptor($0, size, nil) }
    let exact = fonts.first {
      CTFontGetSymbolicTraits($0).intersection([.traitBold, .traitItalic]) == traits
    }
    let sameStyle = fonts.first { CTFontGetSymbolicTraits($0).contains(.traitItalic) == italic }
    let base = exact ?? sameStyle ?? fonts[0]
    let cascade = CTFontDescriptorCreateCopyWithAttributes(
      CTFontCopyFontDescriptor(base),
      [kCTFontCascadeListAttribute: descriptors + fallback.map { $0 as CTFontDescriptor }]
        as CFDictionary)
    var font = CTFontCreateWithFontDescriptor(cascade, size, nil)
    // A CSS request can return a variable font shared by regular/bold faces.
    // Preserve intermediate heading weights rather than rounding them to bold.
    let weightAxis = "wght".utf8.reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
    let axes = CTFontCopyVariationAxes(font) as? [[String: Any]] ?? []
    let axis = axes.first {
      ($0[kCTFontVariationAxisIdentifierKey as String] as? NSNumber)?.uint32Value == weightAxis
    }
    let hasWeightAxis = axis != nil
    if let axis {
      let weights: [UIFont.Weight] = [
        .ultraLight, .thin, .light, .regular, .medium, .semibold, .bold, .heavy, .black,
      ]
      guard let index = weights.firstIndex(of: weight) else { throw Unavailable(family: family) }
      guard let minimum = (axis[kCTFontVariationAxisMinimumValueKey as String] as? NSNumber)?.doubleValue,
        let maximum = (axis[kCTFontVariationAxisMaximumValueKey as String] as? NSNumber)?.doubleValue
      else { throw Unavailable(family: family) }
      let selected = min(max(Double((index + 1) * 100), minimum), maximum)
      let variation = CTFontDescriptorCreateWithAttributes(
        [kCTFontVariationAttribute: [NSNumber(value: weightAxis): selected]]
          as CFDictionary)
      font = CTFontCreateCopyWithAttributes(font, size, nil, variation)
    }
    if !hasWeightAxis, traits.contains(.traitBold), !CTFontGetSymbolicTraits(font).contains(.traitBold) {
      guard let bold = CTFontCreateCopyWithSymbolicTraits(font, size, nil, .traitBold, .traitBold) else {
        throw Unavailable(family: family)
      }
      font = bold
    }
    if italic, !CTFontGetSymbolicTraits(font).contains(.traitItalic) {
      if let actual = CTFontCreateCopyWithSymbolicTraits(font, size, nil, .traitItalic, .traitItalic),
        CTFontGetSymbolicTraits(actual).contains(.traitItalic),
        (CTFontCopyFamilyName(actual) as String).caseInsensitiveCompare(family) == .orderedSame
      {
        font = actual
      } else {
        // CSS Fonts permits synthetic oblique when a family has no italic;
        // its default oblique angle is 14deg. Keep this font's actual glyphs.
        var matrix = CTFontGetMatrix(font)
        matrix.c += tan(14 * .pi / 180)
        font = CTFontCreateCopyWithAttributes(font, size, &matrix, nil)
      }
    }
    guard (CTFontCopyFamilyName(font) as String).caseInsensitiveCompare(family) == .orderedSame
    else { throw Unavailable(family: family) }
    return font as UIFont
  }

  public struct Unavailable: Error, LocalizedError {
    public let family: String
    public var errorDescription: String? {
      "The document font “\(family)” isn’t available yet (#130)."
    }
  }
}
#endif
