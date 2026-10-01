import EditorModelInterface
import LexidrawKit
import SwiftUI
import TextKitEditor
import UIKit

/// A saved link opened from a list: the page's kept text, as the web's link
/// page shows it, with the page itself a tap away.
struct LinkScreen: View {
  let session: Session
  let file: any FileItem

  var body: some View {
    FileScreen(what: "the link", title: file.title, titled: \.title) {
      try await session.savedLink(file.id)
    } content: { link, _ in
      Group {
        if link.address.isEmpty {
          ContentUnavailableView {
            Label("No page saved yet", systemImage: "link")
          } description: {
            Text("Add a web address on the web to save the page’s text and read it here.")
          } actions: {
            Link("Open in Lexidraw on the web", destination: link.webPage)
          }
        } else if link.distilled?["contentHtml"]?.stringValue?.isEmpty == false {
          SavedArticle(session: session, link: link)
        } else {
          ContentUnavailableView {
            Label(link.title, systemImage: "link")
          } description: {
            Text("The page’s text hasn’t been saved.")
          } actions: {
            if let url = link.url { Link("Open page", destination: url) }
          }
        }
      }
      .toolbar {
        ToolbarItemGroup(placement: .primaryAction) {
          ListenButton(file: file)
          if let url = link.url {
            Link(destination: url) { Label("Open page", systemImage: "safari") }
          }
        }
      }
    }
  }
}

/// The kept text drawn by the article block documents show, read-only.
private struct SavedArticle: UIViewRepresentable {
  let session: Session
  let link: SavedLink

  func makeUIView(context: Context) -> ArticleScroll {
    // The web's link page sets no font of its own, so the renderer's default.
    ArticleScroll(article: ArticleBlockView(session: session, fontFamily: "sans", imageLoader: nativeMediaImageLoader(session: session)))
  }

  func updateUIView(_ view: ArticleScroll, context: Context) {
    // The web titles a page kept without one by the link's own title.
    var distilled = link.distilled?.objectValue ?? [:]
    if distilled["title"]?.stringValue?.isEmpty != false { distilled["title"] = .string(link.title) }
    let data: JSONObject = ["mode": "url", "url": .string(link.address), "distilled": .object(distilled)]
    view.article.show(["type": "article", "version": 1, "data": .object(data)])
  }
}

final class ArticleScroll: UIScrollView {
  let article: ArticleBlockView
  /// The web's medium reading width, `max-w-2xl`.
  private let column: CGFloat = 672
  /// Scrolling lays the view out every frame and measuring renders, so only a
  /// new width or a finished render measures again.
  private var measuredWidth: CGFloat?

  init(article: ArticleBlockView) {
    self.article = article
    super.init(frame: .zero)
    alwaysBounceVertical = true
    addSubview(article)
    article.onChange = { [weak self] in
      self?.measuredWidth = nil
      self?.setNeedsLayout()
    }
  }
  required init?(coder: NSCoder) { fatalError("ArticleScroll is made in code") }

  override func layoutSubviews() {
    super.layoutSubviews()
    let width = min(readableContentGuide.layoutFrame.width, column)
    guard width > 0, bounds.width != measuredWidth else { return }
    measuredWidth = bounds.width
    let size = article.contentSize(fitting: width)
    article.frame = CGRect(x: (bounds.width - width) / 2, y: 16, width: width, height: size.height)
    contentSize = CGSize(width: bounds.width, height: article.frame.maxY + 16)
  }
}
