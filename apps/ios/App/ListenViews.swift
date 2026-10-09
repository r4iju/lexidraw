import LexidrawKit
import SwiftUI

@MainActor enum ReadAloudDisclosure {
  static let explanation: LocalizedStringKey = "When you choose Listen, Lexidraw sends the file’s text to Google or OpenAI to generate spoken audio. The audio is saved with your Lexidraw account. Your microphone is not used."
}

/// Listen, in a file's menu, for the files the web reads aloud.
struct ListenButton: View {
  let file: any FileItem
  @Environment(Listener.self) private var listener

  var body: some View {
    if file.kind.isListenable {
      Button("Listen", systemImage: "headphones") {
        listener.listen(to: .init(id: file.id, title: file.title))
      }
    }
  }
}

extension View {
  /// The listen under way, at the foot of the screen above the content.
  func nowPlayingBar(_ listener: Listener) -> some View {
    Group {
      if UIDevice.current.userInterfaceIdiom == .pad {
        // Split-view columns do not inherit an outer bottom inset reliably.
        // Give the player its own space so every column keeps usable controls.
        VStack(spacing: 0) {
          self
          if listener.file != nil {
            NowPlayingBar().padding(.horizontal).padding(.bottom, 8)
          }
        }
      } else {
        safeAreaInset(edge: .bottom) {
          if listener.file != nil {
            NowPlayingBar().padding(.horizontal).padding(.bottom, 8)
          }
        }
      }
    }
    .environment(listener)
    .sheet(item: Binding(get: { listener.generationRequest }, set: { request in
      if request == nil { listener.cancelGeneration() }
    })) { file in
      NavigationStack {
        ScrollView {
          VStack(alignment: .leading, spacing: 20) {
            Text("Read aloud with AI")
              .font(.title2.bold())
              .fixedSize(horizontal: false, vertical: true)
            Text(ReadAloudDisclosure.explanation)
              .fixedSize(horizontal: false, vertical: true)
            Text(file.title)
              .font(.headline)
              .fixedSize(horizontal: false, vertical: true)
            if let server = Bundle.main.object(forInfoDictionaryKey: "LexidrawServerURL") as? String,
               let origin = URL(string: server) {
              Link("Privacy Policy", destination: origin.appending(path: "privacy-policy"))
            }
            Button(action: listener.allowGeneration) {
              Text("Allow Read Aloud")
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding()
        }
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button("Cancel", action: listener.cancelGeneration)
          }
        }
      }
      .presentationDetents([.medium, .large])
    }
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
      .frame(minHeight: 44)
      .disabled(listener.recording == nil)
      .accessibilityElement(children: .ignore)
      .accessibilityAddTraits(.isButton)
      .accessibilityLabel("Read aloud: \(listener.file?.title ?? "")")
      .accessibilityValue(status)
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
        .frame(width: 44, height: 44)
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
    case .loaded(_, let recording): recording.partTitle(at: listener.position)
    }
  }
}

private struct PlayPauseButton: View {
  @Environment(Listener.self) private var listener
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    Button(
      listener.isPlaying ? "Pause" : "Play",
      systemImage: listener.isPlaying ? "pause.fill" : "play.fill",
      action: listener.togglePlaying
    )
    .labelStyle(.iconOnly)
    .frame(minWidth: 44, minHeight: 44)
    .contentTransition(reduceMotion ? .identity : .symbolEffect(.replace))
  }
}

/// The whole of the listen: what is being read, and every control.
private struct NowPlayingSheet: View {
  @Environment(Listener.self) private var listener
  @Environment(\.dismiss) private var dismiss

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
        ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
        if let recording = listener.recording {
          ToolbarItem(placement: .principal) {
            VStack {
              Text(listener.file?.title ?? "").font(.headline).lineLimit(1)
              Text(recording.partTitle(at: listener.position))
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
          Text(recording.partNumber(at: listener.position))
        }
        .font(.caption.monospacedDigit())
        .foregroundStyle(.secondary)
      }
      HStack {
        Button("Previous Part", systemImage: "backward.end.fill", action: listener.previousPart)
        Spacer()
        Button("Back \(Int(Listener.skip)) Seconds", systemImage: "gobackward.\(Int(Listener.skip))") {
          listener.skip(by: -Listener.skip)
        }
        Spacer()
        PlayPauseButton().font(.largeTitle)
        Spacer()
        Button("Forward \(Int(Listener.skip)) Seconds", systemImage: "goforward.\(Int(Listener.skip))") {
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
