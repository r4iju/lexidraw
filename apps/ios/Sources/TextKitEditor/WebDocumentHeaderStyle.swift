// Generated from document.css by apps/ios/codegen/document-header.ts.

enum WebDocumentHeaderStyle {
  static let coverAfter: Double = 32
  static let coverAspect: Double = 2.3333333333333335
  static let coverMaximumViewportShare: Double = 0.38
  static let coverRadius: Double = 8
  static let subtitleSize: Double = 1.25
  static let subtitleLineHeight: Double = 1.4
  static let subtitleBefore: Double = -0.25
  static let subtitleAfter: Double = 1.25
  static let propertyRowGap: Double = 6
  static let propertyColumnGap: Double = 24
  static let propertiesAfter: Double = 24
  static let narrowWidth: Double = 479
  static let narrowRowGap: Double = 0
  static let narrowValueAfter: Double = 8
  static let termSize: Double = 14
  static let termLineHeight: Double = 1.5
  static let valueSize: Double = 15
  static let valueLineHeight: Double = 1.5
  static let valueGap: Double = 4
  static let statusPaddingY: Double = 0
  static let statusPaddingX: Double = 8
  static let statusSize: Double = 13
  static let statusWeight: Double = 500
  static let statusLineHeight: Double = 1.6
  static let mentionPaddingY: Double = 0
  static let mentionPaddingX: Double = 4
  static let mentionRadius: Double = 4
  static let mentionWeight: Double = 500
  static let contentsAfter: Double = 32
  static let contentsSize: Double = 15
  static let contentsLineHeight: Double = 1.5
  static let contentsLabelSize: Double = 13
  static let contentsLabelWeight: Double = 600
  static let contentsLabelAfter: Double = 4
  static let contentsItemPadding: Double = 2
  static let contentsSubitemIndent: Double = 1.25
  static let contentsSubitemSize: Double = 14
  static let contentsLabel = "Contents"
  static let coverBackground = ThemeColor(light: RGBA(0.9331, 0.9335, 0.9452, 1), dark: RGBA(0.1666, 0.167, 0.193, 1))
  static let subtitleColor = ThemeColor(light: RGBA(0.3741, 0.3748, 0.4045, 1), dark: RGBA(0.6416, 0.6423, 0.6696, 1))
  static let termColor = ThemeColor(light: RGBA(0.3741, 0.3748, 0.4045, 1), dark: RGBA(0.6416, 0.6423, 0.6696, 1))
  static let linkColor = ThemeColor(light: RGBA(0.4526, 0.2814, 0.8863, 1), dark: RGBA(0.6203, 0.5486, 0.9581, 1))
  static let contentsLabelColor = ThemeColor(light: RGBA(0.3741, 0.3748, 0.4045, 1), dark: RGBA(0.6416, 0.6423, 0.6696, 1))
  static let mentionBackground = ThemeColor(light: RGBA(0.4526, 0.2814, 0.8863, 0.12), dark: RGBA(0.6203, 0.5486, 0.9581, 0.12))
  static let mentionForeground = ThemeColor(light: RGBA(0.3762, 0.2551, 0.7209, 1), dark: RGBA(0.6706, 0.6211, 0.9536, 1))
  /// By lowercased status, with "" for any other.
  static let statusColors: [String: (background: ThemeColor, foreground: ThemeColor)] = [
    "": (background: ThemeColor(light: RGBA(0.3741, 0.3748, 0.4045, 0.14), dark: RGBA(0.6416, 0.6423, 0.6696, 0.14)), foreground: ThemeColor(light: RGBA(0.3039, 0.3045, 0.332, 1), dark: RGBA(0.7032, 0.7038, 0.7282, 1))),
    "done": (background: ThemeColor(light: RGBA(0, 0.4211, 0.25, 0.14), dark: RGBA(0.3397, 0.7802, 0.5696, 0.14)), foreground: ThemeColor(light: RGBA(0.0914, 0.3394, 0.2221, 1), dark: RGBA(0.506, 0.8114, 0.6538, 1))),
    "complete": (background: ThemeColor(light: RGBA(0, 0.4211, 0.25, 0.14), dark: RGBA(0.3397, 0.7802, 0.5696, 0.14)), foreground: ThemeColor(light: RGBA(0.0914, 0.3394, 0.2221, 1), dark: RGBA(0.506, 0.8114, 0.6538, 1))),
    "completed": (background: ThemeColor(light: RGBA(0, 0.4211, 0.25, 0.14), dark: RGBA(0.3397, 0.7802, 0.5696, 0.14)), foreground: ThemeColor(light: RGBA(0.0914, 0.3394, 0.2221, 1), dark: RGBA(0.506, 0.8114, 0.6538, 1))),
    "published": (background: ThemeColor(light: RGBA(0, 0.4211, 0.25, 0.14), dark: RGBA(0.3397, 0.7802, 0.5696, 0.14)), foreground: ThemeColor(light: RGBA(0.0914, 0.3394, 0.2221, 1), dark: RGBA(0.506, 0.8114, 0.6538, 1))),
    "approved": (background: ThemeColor(light: RGBA(0, 0.4211, 0.25, 0.14), dark: RGBA(0.3397, 0.7802, 0.5696, 0.14)), foreground: ThemeColor(light: RGBA(0.0914, 0.3394, 0.2221, 1), dark: RGBA(0.506, 0.8114, 0.6538, 1))),
    "final": (background: ThemeColor(light: RGBA(0, 0.4211, 0.25, 0.14), dark: RGBA(0.3397, 0.7802, 0.5696, 0.14)), foreground: ThemeColor(light: RGBA(0.0914, 0.3394, 0.2221, 1), dark: RGBA(0.506, 0.8114, 0.6538, 1))),
    "in progress": (background: ThemeColor(light: RGBA(0.4823, 0.318, 0, 0.14), dark: RGBA(0.8569, 0.6945, 0.3342, 0.14)), foreground: ThemeColor(light: RGBA(0.3832, 0.2656, 0.0909, 1), dark: RGBA(0.8674, 0.7467, 0.4974, 1))),
    "review": (background: ThemeColor(light: RGBA(0.4823, 0.318, 0, 0.14), dark: RGBA(0.8569, 0.6945, 0.3342, 0.14)), foreground: ThemeColor(light: RGBA(0.3832, 0.2656, 0.0909, 1), dark: RGBA(0.8674, 0.7467, 0.4974, 1))),
    "in review": (background: ThemeColor(light: RGBA(0.4823, 0.318, 0, 0.14), dark: RGBA(0.8569, 0.6945, 0.3342, 0.14)), foreground: ThemeColor(light: RGBA(0.3832, 0.2656, 0.0909, 1), dark: RGBA(0.8674, 0.7467, 0.4974, 1))),
    "wip": (background: ThemeColor(light: RGBA(0.4823, 0.318, 0, 0.14), dark: RGBA(0.8569, 0.6945, 0.3342, 0.14)), foreground: ThemeColor(light: RGBA(0.3832, 0.2656, 0.0909, 1), dark: RGBA(0.8674, 0.7467, 0.4974, 1))),
    "blocked": (background: ThemeColor(light: RGBA(0.7736, 0.1121, 0.1571, 0.14), dark: RGBA(0.9701, 0.3651, 0.3496, 0.14)), foreground: ThemeColor(light: RGBA(0.5983, 0.1523, 0.1649, 1), dark: RGBA(0.971, 0.5174, 0.4914, 1))),
    "cancelled": (background: ThemeColor(light: RGBA(0.7736, 0.1121, 0.1571, 0.14), dark: RGBA(0.9701, 0.3651, 0.3496, 0.14)), foreground: ThemeColor(light: RGBA(0.5983, 0.1523, 0.1649, 1), dark: RGBA(0.971, 0.5174, 0.4914, 1))),
    "canceled": (background: ThemeColor(light: RGBA(0.7736, 0.1121, 0.1571, 0.14), dark: RGBA(0.9701, 0.3651, 0.3496, 0.14)), foreground: ThemeColor(light: RGBA(0.5983, 0.1523, 0.1649, 1), dark: RGBA(0.971, 0.5174, 0.4914, 1))),
    "archived": (background: ThemeColor(light: RGBA(0.7736, 0.1121, 0.1571, 0.14), dark: RGBA(0.9701, 0.3651, 0.3496, 0.14)), foreground: ThemeColor(light: RGBA(0.5983, 0.1523, 0.1649, 1), dark: RGBA(0.971, 0.5174, 0.4914, 1))),
  ]
}
