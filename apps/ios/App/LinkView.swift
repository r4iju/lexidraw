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
        } else if let html = link.distilled?["contentHtml"]?.stringValue, !html.isEmpty {
          SavedArticleBody(session: session, link: link, html: html)
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

/// The kept text as the web draws it, or as native text when that drawing
/// fails, as it does for an article beyond the renderer's 16 megapixels.
private struct SavedArticleBody: View {
  let session: Session
  let link: SavedLink
  let html: String
  /// Nil while the drawing stands; once it fails, the native text, or nil
  /// within when the importer can't take it either.
  @State private var fallback: EditorView??

  var body: some View {
    switch fallback {
    case nil:
      SavedArticle(session: session, link: link) {
        if fallback == nil { fallback = .some(nativeArticleText(html: html, plainText: "")) }
      }
    case let editor??:
      NativeArticleText(editor: editor)
    case .some(nil):
      ContentUnavailableView {
        Label(link.title, systemImage: "link")
      } description: {
        Text("The app can’t show this page’s text.")
      } actions: {
        if let url = link.url { Link("Open page", destination: url) }
      }
    }
  }
}

private struct NativeArticleText: UIViewRepresentable {
  let editor: EditorView
  func makeUIView(context: Context) -> NativeEditorHost { NativeEditorHost(editor: editor) }
  func updateUIView(_ view: NativeEditorHost, context: Context) {}
}

/// The kept text drawn by the article block documents show, read-only.
private struct SavedArticle: UIViewRepresentable {
  let session: Session
  let link: SavedLink
  let failed: () -> Void

  func makeUIView(context: Context) -> ArticleScroll {
    // The web's link page sets no font of its own, so the renderer's default.
    ArticleScroll(article: ArticleBlockView(session: session, fontFamily: "sans", imageLoader: nativeMediaImageLoader(session: session)))
  }

  func updateUIView(_ view: ArticleScroll, context: Context) {
    view.failed = failed
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
  var failed: (() -> Void)?

  init(article: ArticleBlockView) {
    self.article = article
    super.init(frame: .zero)
    alwaysBounceVertical = true
    addSubview(article)
    article.onChange = { [weak self] in
      guard let self else { return }
      if article.renderFailed { failed?() }
      measuredWidth = nil
      setNeedsLayout()
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
