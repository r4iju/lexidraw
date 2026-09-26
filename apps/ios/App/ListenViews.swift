import LexidrawKit
import SwiftUI

/// Listen, in a file's menu, for the files the web reads aloud.
struct ListenButton: View {
  let file: any FileItem
  @Environment(Listener.self) private var listener

  var body: some View {
    if file.kind == .document || file.kind == .url {
      Button("Listen", systemImage: "headphones") {
        listener.listen(to: .init(id: file.id, title: file.title))
      }
    }
  }
}

extension View {
  /// The listen under way, at the foot of the screen above the content.
  func nowPlayingBar(_ listener: Listener) -> some View {
    safeAreaInset(edge: .bottom) {
      if listener.file != nil {
        NowPlayingBar()
          .padding(.horizontal)
          .padding(.bottom, 8)
      }
    }
    .environment(listener)
  }
}

private struct NowPlayingBar: View {
  @Environment(Listener.self) private var listener
  @State private var expanded = false

  var body: some View {
    HStack(spacing: 12) {
      Button {
        expanded = true
      } label: {
        VStack(alignment: .leading, spacing: 2) {
          Text(listener.file?.title ?? "").font(.subheadline.weight(.semibold)).lineLimit(1)
          Text(status).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(.rect)
      }
      .buttonStyle(.plain)
      .disabled(listener.recording == nil)
      .accessibilityHint("Shows the controls")
      switch listener.state {
      case .preparing(_, let progress):
        if case .made(let made, let planned) = progress {
          ProgressView(value: Double(made), total: Double(max(planned, 1)))
            .progressViewStyle(.circular)
        } else {
          ProgressView()
        }
      case .failed(let file, _):
        Button("Try Again", systemImage: "arrow.clockwise") { listener.listen(to: file) }
          .labelStyle(.iconOnly)
      case .loaded:
        PlayPauseButton()
      case .idle:
        EmptyView()
      }
      Button("Stop Listening", systemImage: "xmark") { listener.stop() }
        .labelStyle(.iconOnly)
        .foregroundStyle(.secondary)
    }
    .font(.title3)
    .padding(.horizontal, 16)
    .padding(.vertical, 10)
    .glassEffect(.regular.interactive(), in: .capsule)
    .sheet(isPresented: $expanded) {
      NowPlayingSheet()
        .presentationDetents([.medium, .large])
    }
  }

  private var status: String {
    switch listener.state {
    case .idle: ""
    case .preparing(_, .started): "Making the audio…"
    case .preparing(_, .made(let made, let planned)): "Making the audio, \(made) of \(planned) parts…"
    case .failed(_, let message): message
    case .loaded(_, let recording):
      listener.part?.section ?? "Part \(listener.position.part + 1) of \(recording.parts.count)"
    }
  }
}

private struct PlayPauseButton: View {
  @Environment(Listener.self) private var listener

  var body: some View {
    Button(
      listener.isPlaying ? "Pause" : "Play",
      systemImage: listener.isPlaying ? "pause.fill" : "play.fill",
      action: listener.togglePlaying
    )
    .labelStyle(.iconOnly)
    .contentTransition(.symbolEffect(.replace))
  }
}

/// The whole of the listen: what is being read, and every control.
private struct NowPlayingSheet: View {
  @Environment(Listener.self) private var listener

  var body: some View {
    NavigationStack {
      ScrollView {
        Text(listener.part?.text ?? "")
          .font(.title3)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding()
      }
      .safeAreaInset(edge: .bottom) { controls.padding() }
      .navigationTitle(listener.file?.title ?? "")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        if let recording = listener.recording {
          ToolbarItem(placement: .principal) {
            VStack {
              Text(listener.file?.title ?? "").font(.headline).lineLimit(1)
              Text(listener.part?.section ?? "Part \(listener.position.part + 1) of \(recording.parts.count)")
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
          }
        }
      }
    }
  }

  private var controls: some View {
    VStack(spacing: 16) {
      if let recording = listener.recording {
        ProgressView(value: min(listener.position.seconds, listener.duration ?? 0), total: max(listener.duration ?? 1, 1))
        HStack {
          Text(Duration.seconds(listener.position.seconds).formatted(.time(pattern: .minuteSecond)))
          Spacer()
          Text("Part \(listener.position.part + 1) of \(recording.parts.count)")
        }
        .font(.caption.monospacedDigit())
        .foregroundStyle(.secondary)
      }
      HStack {
        Button("Previous Part", systemImage: "backward.end.fill", action: listener.previousPart)
        Spacer()
        Button("Back \(Int(Listener.skip)) Seconds", systemImage: "gobackward.15") { listener.skip(by: -Listener.skip) }
        Spacer()
        PlayPauseButton().font(.largeTitle)
        Spacer()
        Button("Forward \(Int(Listener.skip)) Seconds", systemImage: "goforward.15") {
          listener.skip(by: Listener.skip)
        }
        Spacer()
        Button("Next Part", systemImage: "forward.end.fill", action: listener.nextPart)
          .disabled(listener.recording?.next(from: listener.position) == nil)
      }
      .labelStyle(.iconOnly)
      .font(.title2)
      .padding(.horizontal)
    }
  }
}
