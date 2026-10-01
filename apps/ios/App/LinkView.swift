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
        if link.url == nil {
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
    var data: JSONObject = ["mode": "url", "distilled": link.distilled ?? .null]
    if let url = link.url { data["url"] = .string(url.absoluteString) }
    view.article.show(["type": "article", "version": 1, "data": .object(data)])
  }
}

final class ArticleScroll: UIScrollView {
  let article: ArticleBlockView
  /// The web's medium reading width, `max-w-2xl`.
  private let column: CGFloat = 672

  init(article: ArticleBlockView) {
    self.article = article
    super.init(frame: .zero)
    alwaysBounceVertical = true
    addSubview(article)
    article.onChange = { [weak self] in self?.setNeedsLayout() }
  }
  required init?(coder: NSCoder) { fatalError("ArticleScroll is made in code") }

  override func layoutSubviews() {
    super.layoutSubviews()
    let margins = readableContentGuide.layoutFrame
    let width = min(margins.width, column)
    let size = article.contentSize(fitting: width)
    article.frame = CGRect(x: (bounds.width - width) / 2, y: 16, width: width, height: size.height)
    contentSize = CGSize(width: bounds.width, height: article.frame.maxY + 16)
  }
}
