import DrawingKit
import SwiftUI

/// The web's style panel: the colours it offers first and a picker for any
/// other, and its fill, stroke width and sloppiness choices, for what is
/// selected or else for what the tool draws next.
struct StyleInspector: View {
  let controls: StyleControls
  let theme: DrawingTheme
  let change: (StyleChange) -> Void

  private static let strokeColors = ["#1e1e1e", "#e03131", "#2f9e44", "#1971c2", "#f08c00"]
  private static let backgroundColors = ["transparent", "#ffc9c9", "#b2f2bb", "#a5d8ff", "#ffec99"]

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      if controls.showsStrokeColor {
        section("Stroke") {
          swatches(Self.strokeColors, picked: controls.strokeColor) { change(.strokeColor($0)) }
        }
      }
      if controls.showsBackgroundColor {
        section("Background") {
          swatches(Self.backgroundColors, picked: controls.backgroundColor) { change(.backgroundColor($0)) }
        }
      }
      if controls.showsFillStyle {
        section("Fill") {
          choices(
            [("Hachure", FillStyle.hachure), ("Cross-Hatch", .crossHatch), ("Solid", .solid)],
            picked: controls.fillStyle
          ) { change(.fillStyle($0)) }
        }
      }
      if controls.showsStrokeWidth {
        section("Stroke Width") {
          choices([("Thin", 1.0), ("Bold", 2.0), ("Extra Bold", 4.0)], picked: controls.strokeWidth) {
            change(.strokeWidth($0))
          }
        }
      }
      if controls.showsRoughness {
        section("Sloppiness") {
          choices([("Architect", 0.0), ("Artist", 1.0), ("Cartoonist", 2.0)], picked: controls.roughness) {
            change(.roughness($0))
          }
        }
      }
      if !(controls.showsStrokeColor || controls.showsBackgroundColor || controls.showsStrokeWidth
        || controls.showsRoughness)
      {
        Text("Nothing here takes a style.").foregroundStyle(.secondary)
      }
    }
    .padding()
    .frame(minWidth: 280)
  }

  private func section(_ title: String, @ViewBuilder content: () -> some View) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
      content()
    }
  }

  /// Colours as the drawing shows them in this theme.
  private func swatches(_ colors: [String], picked: String?, pick: @escaping (String) -> Void) -> some View {
    HStack(spacing: 10) {
      ForEach(colors, id: \.self) { color in
        Button {
          pick(color)
        } label: {
          ZStack {
            RoundedRectangle(cornerRadius: 6).fill(Color(cgColor: theme.color(color)))
            if color == "transparent" {
              Image(systemName: "line.diagonal").foregroundStyle(.secondary)
            }
            RoundedRectangle(cornerRadius: 6)
              .strokeBorder(color == picked ? Color.accentColor : Color.secondary.opacity(0.4), lineWidth: color == picked ? 2.5 : 1)
          }
          .frame(width: 36, height: 36)
          .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(color == "transparent" ? "Transparent" : color)
        .accessibilityAddTraits(color == picked ? .isSelected : [])
      }
      ColorPicker(
        "Other Colour",
        selection: Binding(
          get: { Color(cgColor: DrawingTheme.light.color(picked ?? "transparent")) },
          set: { pick(hex($0)) }),
        supportsOpacity: false
      )
      .labelsHidden()
    }
  }

  /// A colour as the `#rrggbb` the web writes.
  private func hex(_ color: Color) -> String {
    var (red, green, blue, alpha): (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
    UIColor(color).getRed(&red, green: &green, blue: &blue, alpha: &alpha)
    let byte = { (value: CGFloat) in Int((min(max(value, 0), 1) * 255).rounded()) }
    return String(format: "#%02x%02x%02x", byte(red), byte(green), byte(blue))
  }

  /// A choice the selection doesn't share shows none picked, as on the web.
  private func choices<Value: Hashable>(
    _ options: [(String, Value)], picked: Value?, pick: @escaping (Value) -> Void
  ) -> some View {
    Picker(selection: Binding(get: { picked }, set: { if let value = $0 { pick(value) } })) {
      ForEach(options, id: \.1) { option in
        Text(option.0).tag(Optional(option.1))
      }
    } label: {
      EmptyView()
    }
    .pickerStyle(.segmented)
  }
}
