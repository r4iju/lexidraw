import SwiftUI

extension View {
  /// An alert up for as long as there is a `message`; dismissing it clears it.
  func alert(_ title: LocalizedStringKey, message: Binding<String?>) -> some View {
    alert(
      title,
      isPresented: Binding(
        get: { message.wrappedValue != nil },
        set: { if !$0 { message.wrappedValue = nil } }
      )
    ) {
      Button("OK") {}
    } message: {
      Text(message.wrappedValue ?? "")
    }
  }
}
