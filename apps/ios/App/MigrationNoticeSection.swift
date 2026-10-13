import SwiftUI

enum MigrationNoticePhase: String {
  case absent
  case advance
}

struct MigrationNoticeCopy {
  let title: String
  let paragraphs: [String]

  static func select(_ phase: String?) -> MigrationNoticeCopy? {
    guard phase == "advance" else { return nil }

    return MigrationNoticeCopy(
      title: "Planned changes to cloud AI",
      paragraphs: [
        "The planned change would move new cloud AI generation supplied by Lexidraw to Pro. This advance notice does not announce that the change has taken effect.",
        "Pro is Coming soon and is not available for public purchase.",
        "Core writing and drawing remain free. This informational notice does not change your documents, drawings, or saved recordings. The planned cloud AI transition is intended to preserve them.",
        "BYOK and local AI are possible alternatives. Their availability for each feature on this device has not been confirmed in this notice.",
      ]
    )
  }
}

struct MigrationNoticeSection: View {
  let phase: MigrationNoticePhase

  var body: some View {
    if let notice = MigrationNoticeCopy.select(phase.rawValue) {
      Section {
        ForEach(notice.paragraphs, id: \.self) { paragraph in
          Text(paragraph)
        }
      } header: {
        Text(notice.title)
      }
    }
  }
}
