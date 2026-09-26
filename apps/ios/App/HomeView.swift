import LexidrawKit
import SwiftUI

struct HomeView: View {
  let session: Session
  @Environment(AppModel.self) private var model
  @State private var home: Home?
  @State private var failure: String?
  @State private var signOutFailure: String?
  @State private var openFolder: Home.Folder?

  var body: some View {
    List {
      if let home {
        if !home.folders.isEmpty {
          Section("Folders") {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 8)], spacing: 8) {
              ForEach(home.folders) { folder in
                // A NavigationLink here would make the whole row one link, opening the
                // last tile whichever was tapped; borderless buttons each keep their tap.
                Button {
                  openFolder = folder
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
              }
            }
          }
          .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
          .listRowBackground(Color.clear)
        }
        if !home.files.isEmpty {
          Section("Files") {
            ForEach(home.files) { file in
              NavigationLink {
                NotYet(title: file.title, systemImage: file.kind.systemImage, what: "Files open")
              } label: {
                VStack(alignment: .leading, spacing: 2) {
                  Label(file.title, systemImage: file.kind.systemImage)
                  Text(file.updatedAt, format: .relative(presentation: .named))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
              }
            }
          }
        }
      }
    }
    .overlay {
      if let failure {
        ContentUnavailableView {
          Label("Couldn't load Home", systemImage: "wifi.exclamationmark")
        } description: {
          Text(failure)
        } actions: {
          Button("Try Again") { Task { await load() } }
        }
      } else if home == nil {
        ProgressView()
      } else if home?.folders.isEmpty == true && home?.files.isEmpty == true {
        ContentUnavailableView("Nothing here yet", systemImage: "doc", description: Text("Files you make on the web show up here."))
      }
    }
    .navigationTitle("Home")
    .navigationDestination(item: $openFolder) { folder in
      NotYet(title: folder.title, systemImage: "folder", what: "Folders open")
    }
    .toolbar {
      Menu {
        Button("Sign Out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
          Task { await signOut() }
        }
      } label: {
        Label("Account", systemImage: "person.crop.circle")
      }
    }
    .alert("Couldn't sign out", isPresented: .constant(signOutFailure != nil)) {
      Button("OK") { signOutFailure = nil }
    } message: {
      Text(signOutFailure ?? "")
    }
    .task { await load() }
    .refreshable { await load() }
  }

  private func load() async {
    do {
      home = try await session.home()
      failure = nil
    } catch {
      failure = error.localizedDescription
    }
  }

  private func signOut() async {
    do {
      if try await session.signOut() == .stillValidOnServer {
        model.notice =
          "Lexidraw couldn't confirm with the server that this \(UIDevice.current.model)'s token was revoked. Revoke it under API tokens in Settings on the web."
      }
      model.state = .signedOut
    } catch {
      signOutFailure = "The token couldn't be removed from this \(UIDevice.current.model): \(error.localizedDescription)"
    }
  }
}

/// Where opening a file or folder will go, said rather than left a dead end.
private struct NotYet: View {
  let title: String
  let systemImage: String
  let what: String

  var body: some View {
    ContentUnavailableView(
      title, systemImage: systemImage, description: Text("\(what) in a later version of the app."))
  }
}

extension Home.File.Kind {
  fileprivate var systemImage: String {
    switch self {
    case .document: "doc.text"
    case .drawing: "scribble.variable"
    case .url: "link"
    }
  }
}
