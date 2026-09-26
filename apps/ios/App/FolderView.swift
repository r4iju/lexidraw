import LexidrawKit
import SwiftUI

/// Home, or a folder: its folders as a compact group above its files, with
/// search over everything the caller can open.
struct FolderView: View {
  let session: Session
  /// Nil for Home.
  let folder: Place.Folder?
  @Environment(Browser.self) private var browser
  @State private var shown: Loaded<Shown> = .loading
  @State private var query = ""
  @State private var results: [SearchResult]?

  /// A folder's contents, where it is, and the tags that could narrow it.
  private struct Shown {
    let listing: Listing
    /// Nil for Home.
    let place: Place?
    let ownTags: [String]
  }

  var body: some View {
    Group {
      if let results {
        List { SearchResultsSection(query: query, results: results) }
      } else {
        List {
          if let listing = shown.value?.listing {
            if !browser.tags.isEmpty {
              FilterHint()
            }
            ListingSections(listing: listing)
          }
        }
        .overlay(
          for: shown, what: title, retry: load,
          isEmpty: { $0.listing.folders.isEmpty && $0.listing.files.isEmpty }
        ) {
          if browser.tags.isEmpty {
            ContentUnavailableView(
              "Nothing here yet", systemImage: folder == nil ? "doc" : "folder",
              description: Text("Files you make here or on the web show up here."))
          } else {
            ContentUnavailableView(
              "No files tagged \(browser.tags.sorted().formatted(.list(type: .and)))",
              systemImage: "tag")
          }
        }
      }
    }
    .navigationTitle(title)
    // A large title hides the breadcrumbs' menu until the list scrolls.
    .navigationBarTitleDisplayMode(folder == nil ? .automatic : .inline)
    .toolbarTitleMenu {
      if let place = shown.value?.place {
        Breadcrumbs(place: place)
      }
    }
    .searchable(text: $query, prompt: "Search titles")
    .toolbar {
      ToolbarItem {
        TagFilter(ownTags: shown.value?.ownTags ?? [])
      }
      if mayCreate {
        ToolbarItem {
          NewMenu(folder: folder)
        }
      }
      if folder == nil {
        ToolbarItem {
          SettingsButton()
        }
      }
    }
    .task(id: LoadKey(reloads: browser.reloads, tags: browser.tags)) { await load() }
    .task(id: query) { await search() }
    .refreshable { await load() }
  }

  private var title: String { shown.value?.place?.title ?? folder?.title ?? "Home" }

  /// Anyone may make files at Home; in a folder, only who may edit it.
  private var mayCreate: Bool {
    folder == nil || shown.value?.place.map { $0.access >= .edit } == true
  }

  private struct LoadKey: Equatable {
    let reloads: Int
    let tags: Set<String>
  }

  private func load() async {
    let loaded = await Loaded.from {
      async let listing = session.listing(of: folder?.id, taggedWith: browser.tags.sorted())
      async let tags = session.tags()
      let place: Place? = if let folder { try await session.place(of: folder.id) } else { nil }
      return Shown(listing: try await listing, place: place, ownTags: try await tags)
    }
    if let loaded { shown = loaded }
  }

  private func search() async {
    let text = query.trimmingCharacters(in: .whitespaces)
    guard !text.isEmpty else {
      results = nil
      return
    }
    // Each keystroke restarts this task, so only a pause searches.
    try? await Task.sleep(for: .milliseconds(250))
    guard !Task.isCancelled else { return }
    if let found = try? await session.search(text) { results = found }
  }
}

/// The folders above this one that the caller may open, from Home down; the
/// server leaves out the rest.
private struct Breadcrumbs: View {
  let place: Place
  @Environment(Browser.self) private var browser

  var body: some View {
    Button("Home", systemImage: "house") { browser.show(.home) }
    ForEach(Array(place.ancestors.enumerated()), id: \.element.id) { index, ancestor in
      Button(ancestor.title, systemImage: "folder") {
        browser.open(ancestor, below: Array(place.ancestors.prefix(index)))
      }
    }
  }
}

private struct ListingSections: View {
  let listing: Listing
  @Environment(Browser.self) private var browser

  var body: some View {
    if !listing.folders.isEmpty {
      Section("Folders") {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 8)], spacing: 8) {
          ForEach(listing.folders) { folder in
            // A NavigationLink here would make the whole row one link, opening the
            // last tile whichever was tapped; borderless buttons each keep their tap.
            Button {
              browser.path.append(Place.Folder(id: folder.id, title: folder.title))
            } label: {
              Label(folder.title, systemImage: "folder")
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(.fill.tertiary, in: .rect(cornerRadius: 10))
                .contentShape(.rect)
            }
            .buttonStyle(.borderless)
            .tint(.primary)
            .fileActions(for: folder)
          }
        }
      }
      .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
      .listRowBackground(Color.clear)
    }
    if !listing.files.isEmpty {
      Section("Files") {
        ForEach(listing.files) { file in
          OpenLink(file: file) { FileRow(entry: file) }
            .fileActions(for: file)
        }
      }
    }
  }
}

private struct NewMenu: View {
  let folder: Place.Folder?
  @Environment(FileActions.self) private var actions

  var body: some View {
    Menu {
      ForEach(Entry.Kind.blank, id: \.self) { kind in
        Button(kind.label, systemImage: kind.systemImage) {
          Task { await actions.create(kind, in: folder) }
        }
      }
    } label: {
      Label("New", systemImage: "plus")
    }
  }
}

/// Says what is narrowing the listing, so a filter set in another folder never
/// makes this one look emptier than it is without a reason.
private struct FilterHint: View {
  @Environment(Browser.self) private var browser

  var body: some View {
    HStack {
      Label(
        "Tagged \(browser.tags.sorted().formatted(.list(type: .and)))",
        systemImage: "line.3.horizontal.decrease.circle")
      Spacer()
      Button("Clear") { browser.tags = [] }
        .buttonStyle(.borderless)
    }
    .font(.subheadline)
    .foregroundStyle(.secondary)
  }
}

private struct TagFilter: View {
  /// The caller's own tags; a reader never sees an owner's.
  let ownTags: [String]
  @Environment(Browser.self) private var browser

  var body: some View {
    Menu {
      if ownTags.isEmpty {
        Text("No tags yet. Tag files on the web to filter by them here.")
      } else {
        Section("Show Files Tagged") {
          ForEach(ownTags, id: \.self) { tag in
            Toggle(tag, isOn: chosen(tag))
          }
        }
        if !browser.tags.isEmpty {
          Button("Show All Files", systemImage: "xmark.circle") { browser.tags = [] }
        }
      }
    } label: {
      Label(
        "Filter by Tags",
        systemImage: browser.tags.isEmpty
          ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
    }
  }

  private func chosen(_ tag: String) -> Binding<Bool> {
    Binding {
      browser.tags.contains(tag)
    } set: { on in
      if on { browser.tags.insert(tag) } else { browser.tags.remove(tag) }
    }
  }
}

private struct SearchResultsSection: View {
  let query: String
  let results: [SearchResult]
  @Environment(Browser.self) private var browser

  var body: some View {
    if results.isEmpty {
      ContentUnavailableView.search(text: query)
    } else {
      Section(results.count == 1 ? "1 file" : "\(results.count) files") {
        ForEach(results) { result in
          OpenLink(file: result) {
            FileRow(
              file: result,
              caption: "\(result.location) · \(result.updatedAt.formatted(.relative(presentation: .named)))")
          }
          .contextMenu {
            ListenButton(file: result)
            if let folder = result.folder {
              Button("Show in \(folder.title)", systemImage: "folder") {
                browser.open(folder, below: [])
              }
            }
          }
        }
      }
    }
  }
}
