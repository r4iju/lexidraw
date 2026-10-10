import LexidrawKit
import SwiftUI

@MainActor enum ReadAloudDisclosure {
  static let explanation: LocalizedStringKey =
    "With Built-in local selected in AI Power, Listen uses Apple voices available on this device for free. No provider key, subscription or cloud generation is used. Temporary local audio does not sync. Play Saved Recording opens audio already saved with your account. Your microphone is not used."
}

/// Listen, in a file's menu, for the files the web reads aloud.
struct ListenButton: View {
  let file: any FileItem
  @Environment(Listener.self) private var listener
  @State private var proNarration = false
  @State private var deviceNarration = false

  var body: some View {
    if file.kind.isListenable {
      Button("Listen", systemImage: "headphones") {
        listener.listen(to: .init(id: file.id, title: file.title))
      }
      Button("My OpenRouter narration", systemImage: "waveform") { deviceNarration = true }
        .sheet(isPresented: $deviceNarration) {
          DeviceNarrationComposer(session: listener.narrationSession, document: file.id) { job in
            listener.playNarration(job, to: .init(id: file.id, title: file.title))
          }
        }
      Button("Pro narration", systemImage: "waveform") { proNarration = true }
        .sheet(isPresented: $proNarration) {
          ProNarrationComposer(flow: listener.proNarrationFlow(for: file.id)) { job in
            listener.playNarration(job, to: .init(id: file.id, title: file.title))
          }
        }
      Button("Play Saved Recording", systemImage: "play.rectangle") {
        listener.listen(to: .init(id: file.id, title: file.title), savedOnly: true)
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
  }
}

private struct NowPlayingBar: View {
  @Environment(Listener.self) private var listener
  @State private var expanded = false
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

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
      case .failed:
        Button("Try Again", systemImage: "arrow.clockwise", action: listener.retry)
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
        .presentationDetents(dynamicTypeSize.isAccessibilitySize ? [.large] : [.medium, .large])
    }
  }

  private var status: String {
    switch listener.state {
    case .idle: ""
    case .preparing(_, .started): "Preparing narration…"
    case .preparing(_, .made(let made, let planned)):
      "Making the audio, \(made) of \(planned) parts…"
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
      VStack(spacing: 0) {
        ScrollView {
          VStack(alignment: .leading, spacing: 24) {
            if let description = listener.voiceDescription {
              Text(description).font(.footnote).foregroundStyle(.secondary)
                .accessibilityIdentifier("local-voice-description")
            }
            Text(listener.part?.text ?? "")
              .font(.title3)
              .frame(maxWidth: .infinity, alignment: .leading)
          }
          .padding()
        }
        Divider()
        controls.padding()
          .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
          .background(.regularMaterial)
      }
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
        ProgressView(
          value: min(listener.position.seconds, listener.duration ?? 0),
          total: max(listener.duration ?? 1, 1))
        HStack {
          Text(Duration.seconds(listener.position.seconds).formatted(.time(pattern: .minuteSecond)))
            .accessibilityIdentifier("listen-elapsed")
          Spacer()
          Text(recording.partNumber(at: listener.position))
        }
        .font(.caption.monospacedDigit())
        .foregroundStyle(.secondary)
      }
      HStack {
        Button("Previous Part", systemImage: "backward.end.fill", action: listener.previousPart)
        Spacer()
        Button(
          "Back \(Int(Listener.skip)) Seconds", systemImage: "gobackward.\(Int(Listener.skip))"
        ) {
          listener.skip(by: -Listener.skip)
        }
        Spacer()
        PlayPauseButton().font(.largeTitle)
        Spacer()
        Button(
          "Forward \(Int(Listener.skip)) Seconds", systemImage: "goforward.\(Int(Listener.skip))"
        ) {
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
