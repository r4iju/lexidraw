import EditorModelInterface
import LexidrawKit
import TextKitEditor
import UIKit

@MainActor func configureArticleBlocks(_ editor: EditorView, session: Session, fontFamily: String) {
  let previous = editor.embeddedContent
  let articles = NSCache<NSString, ArticleBlockView>()
  articles.countLimit = 100
  editor.embeddedContent = { [weak editor] key, node in
    guard node["type"] == "article", let editor else { return previous?(key, node) }
    let article = articles.object(forKey: key as NSString) ?? ArticleBlockView(session: session, fontFamily: fontFamily, imageLoader:editor.mediaImageLoader)
    articles.setObject(article, forKey: key as NSString)
    article.onChange = { [weak editor] in editor?.refreshEmbeddedContent() }
    article.editable = editor.isEditable
    article.perform = { [weak editor, weak article] action in
      guard let editor, let article else { return }
      switch action {
      case .remove:
        var responder: UIResponder? = editor
        while responder != nil, !(responder is UIViewController) { responder = responder?.next }
        let alert = UIAlertController(title: "Remove this link block?", message: "This only removes the block from the document. The saved link stays in your files.", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Remove", style: .destructive) { _ in
          do { try editor.replaceEmbeddedNode(key: key, expected: node, replacement: nil) }
          catch { article.showError(error) }
        })
        (responder as? UIViewController)?.present(alert, animated: true)
      case .convert:
        guard let html = article.currentSnapshot?["contentHtml"]?.stringValue, !html.isEmpty else { return }
        do { try editor.convertArticle(key: key, expected: node, html: html) }
        catch { article.showError(error) }
      case .refresh:
        article.refresh { next in try editor.replaceEmbeddedNode(key: key, expected: node, replacement: next) }
      }
    }
    article.show(node)
    return article
  }
}

@MainActor final class ArticleBlockView: EmbeddedContentView {
  private let session: Session
  private let title = UILabel()
  private let metadata = UILabel()
  enum Action { case refresh, convert, remove }
  var perform: ((Action) -> Void)?
  var editable = false { didSet { actions.isHidden = !editable } }
  var currentSnapshot: JSONValue? { snapshot }
  private let openArticle = UIButton(type: .system)
  private let actions = UIStackView()
  private let content: RenderedEmbedView
  private var node: JSONValue = .null
  private var snapshot: JSONValue?
  private var task: Task<Void, Never>?
  private var missing = false
  var onChange: (() -> Void)?

  init(session: Session, fontFamily: String, imageLoader:MediaImageLoader? = nil) {
    self.session = session
    content = RenderedEmbedView(session: session, fontFamily: fontFamily)
    content.articleImageLoader=imageLoader
    super.init(frame: .zero)
    title.font = .preferredFont(forTextStyle: .subheadline)
    metadata.font = .preferredFont(forTextStyle: .caption1)
    metadata.textColor = .secondaryLabel
    title.numberOfLines = 1
    metadata.numberOfLines = 1
    openArticle.setTitle("Open article", for: .normal)
    openArticle.addAction(UIAction { [weak self] _ in
      guard let self, let id = node["data"]?["entityId"]?.stringValue,
        let origin = Bundle.main.object(forInfoDictionaryKey: "LexidrawServerURL") as? String,
        let base = URL(string: origin), let address = URL(string: WebArticleData.routePrefix + id, relativeTo: base)?.absoluteURL else { return }
      UIApplication.shared.open(address)
    }, for: .touchUpInside)
    addSubview(openArticle)
    actions.axis = .horizontal
    actions.isHidden = !editable
    actions.distribution = .fillEqually
    for (name, action) in [("Refresh", Action.refresh), ("Convert to text", .convert), ("Remove", .remove)] {
      let button = UIButton(type: .system)
      button.setTitle(name, for: .normal)
      button.addAction(UIAction { [weak self] _ in self?.perform?(action) }, for: .touchUpInside)
      actions.addArrangedSubview(button)
    }
    addSubview(title); addSubview(metadata); addSubview(content); addSubview(actions)
    content.onRendered = { [weak self] in self?.onChange?() }
    content.open = { [weak content] in content?.retryIfFailed() }
    content.isAccessibilityElement = true
    content.failureDescription = "Couldn’t render article. Tap to retry."
  }
  required init?(coder: NSCoder) { fatalError("ArticleBlockView is made in code") }
  override func show(_ node: JSONValue) {
    guard self.node != node else { return }
    self.node = node
    task?.cancel()
    missing = false
    let data = node["data"]
    snapshot = data?["mode"] == "url" ? data?["distilled"] : data?["snapshot"]
    updateContent()
    if data?["mode"] == "entity", let id = data?["entityId"]?.stringValue {
      task = Task { [weak self, session] in
        do {
          let latest = try await session.articleSnapshot(entityID: id)
          guard !Task.isCancelled, let self else { return }
          if let latest, latest != .null { snapshot = latest }
          updateContent()
          onChange?()
        } catch {
          guard !Task.isCancelled, let self else { return }
          missing = true
          updateContent()
          onChange?()
        }
      }
    }
  }
  private func updateContent() {
    title.text = missing ? "Article not found." : snapshot?["title"]?.stringValue
    if title.text?.isEmpty != false { title.text = node["data"]?["url"]?.stringValue ?? "Article" }
    var details: [String] = []
    for field in ["byline", "siteName"] {
      if let value = snapshot?[field]?.stringValue, !value.isEmpty { details.append(value) }
    }
    if let words = snapshot?["wordCount"]?.numberValue, words != 0 { details.append("\(JSONValue.number(words).stringified) words") }
    if let updated = snapshot?["updatedAt"]?.stringValue,
      let date = (try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(updated)) ?? (try? Date.ISO8601FormatStyle().parse(updated)) {
      details.append(date.formatted(date: .abbreviated, time: .shortened))
    }
    metadata.text = details.joined(separator: " · ")
    openArticle.isHidden = missing || node["data"]?["mode"] != "entity"
    if var payload = node.objectValue, var data = node["data"]?.objectValue {
      data[data["mode"] == "url" ? "distilled" : "snapshot"] = snapshot
      payload["data"] = .object(data)
      content.show(.object(payload))
      if content.image == nil { content.accessibilityLabel = "Rendering article" }
    }
    content.isHidden = missing || snapshot?["contentHtml"]?.stringValue == nil
    setNeedsLayout()
  }
  func showError(_ error: Error) {
    var responder: UIResponder? = self
    while responder != nil, !(responder is UIViewController) { responder = responder?.next }
    let alert = UIAlertController(title: "Couldn’t update article", message: error.localizedDescription, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "OK", style: .default))
    (responder as? UIViewController)?.present(alert, animated: true)
  }
  func refresh(save: @escaping (JSONValue) throws -> Void) {
    let opened = node
    task?.cancel()
    task = Task { [weak self, session] in
      do {
        guard let data = opened["data"] else { return }
        if data["mode"] == "entity", let id = data["entityId"]?.stringValue {
          let latest = try await session.articleSnapshot(entityID: id)
          guard !Task.isCancelled, let self, self.node == opened else { return }
          if let latest, latest != .null { snapshot = latest }
          missing = false
          updateContent(); onChange?()
        } else if let original = data["url"]?.stringValue, let url = URL(string: original) {
          let raw = try await session.extractArticle(url: url)
          guard !Task.isCancelled, let self, self.node == opened,
            let html = raw["contentHtml"]?.stringValue, !html.isEmpty, var fields = opened.objectValue else { return }
          var distilled: JSONObject = [:]
          for field in ["byline", "siteName", "wordCount", "excerpt", "bestImageUrl", "datePublished"] { distilled[field] = raw[field] ?? .null }
          distilled["title"] = raw["title"]?.stringValue?.isEmpty == false ? raw["title"] : .string(original)
          distilled["contentHtml"] = .string(html)
          distilled["updatedAt"] = raw["updatedAt"] ?? .string(Date.now.ISO8601Format(.init(includingFractionalSeconds: true)))
          fields["data"] = ["mode": "url", "url": .string(original), "distilled": .object(distilled)]
          try save(.object(fields))
        }
      } catch {
        guard !Task.isCancelled, let self else { return }
        showError(error)
      }
    }
  }
  override func contentSize(fitting width: CGFloat) -> CGSize {
    let header = title.font.lineHeight + metadata.font.lineHeight + 8 + (editable ? 36 : 0) + (openArticle.isHidden ? 0 : 36)
    return CGSize(width: width, height: header + (content.isHidden ? 0 : content.contentSize(fitting: width).height))
  }
  override func layoutSubviews() {
    super.layoutSubviews()
    title.frame = CGRect(x: 0, y: 0, width: bounds.width, height: title.font.lineHeight)
    metadata.frame = CGRect(x: 0, y: title.frame.maxY, width: bounds.width, height: metadata.font.lineHeight)
    openArticle.frame = CGRect(x: 0, y: metadata.frame.maxY, width: bounds.width, height: openArticle.isHidden ? 0 : 36)
    actions.frame = CGRect(x: 0, y: metadata.frame.maxY + openArticle.frame.height, width: bounds.width, height: editable ? 36 : 0)
    let top = metadata.frame.maxY + openArticle.frame.height + (editable ? 36 : 0) + 8
    content.frame = CGRect(x: 0, y: top, width: bounds.width, height: max(0, bounds.height - top))
  }
  deinit { task?.cancel() }
}
