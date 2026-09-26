import DrawingKit
import SwiftUI

/// The web's style panel, for what is selected or else for what the tool
/// draws next: each section the editor offers, as swatches with a picker
/// for any other colour, or as a choice of one.
struct StyleInspector: View {
  let controls: StyleControls
  let theme: DrawingTheme
  let change: (StyleChange) -> Void

  var body: some View {
    let sections = controls.sections
    VStack(alignment: .leading, spacing: 16) {
      ForEach(sections) { section in
        VStack(alignment: .leading, spacing: 8) {
          Text(section.title).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
          switch section.options {
          case .colors(let colors, let picked, let property):
            swatches(colors, picked: picked) { change(property.change($0)) }
          case .choices(let choices):
            self.choices(choices)
          }
        }
      }
      if sections.isEmpty {
        Text("Nothing here takes a style.").foregroundStyle(.secondary)
      }
    }
    .padding()
    .frame(minWidth: 280)
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
  private func choices(_ choices: [StyleChoice]) -> some View {
    Picker(
      selection: Binding(
        get: { choices.first(where: \.isPicked)?.label },
        set: { label in if let choice = choices.first(where: { $0.label == label }) { change(choice.change) } })
    ) {
      ForEach(choices) { choice in
        Text(choice.label).tag(Optional(choice.label))
      }
    } label: {
      EmptyView()
    }
    .pickerStyle(.segmented)
  }
}
