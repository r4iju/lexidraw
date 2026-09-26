import Foundation

/// A file read aloud: its parts, played one after another.
public struct Recording: Sendable, Equatable {
  public struct Part: Sendable, Equatable {
    public let text: String
    public let audio: URL
    /// The heading the part is read under, when it is under one.
    public let section: String?

    public init(text: String, audio: URL, section: String?) {
      self.text = text
      self.audio = audio
      self.section = section
    }
  }

  /// Where a listen is: a part, and how far into it.
  public struct Position: Sendable, Equatable, Codable {
    public var part: Int
    public var seconds: Double

    public init(part: Int, seconds: Double) {
      self.part = part
      self.seconds = seconds
    }

    public static let start = Position(part: 0, seconds: 0)
  }

  /// How far the audio is while it is being made.
  public enum Progress: Sendable, Equatable {
    case started
    case made(Int, of: Int)
  }

  public let parts: [Part]

  public init(parts: [Part]) {
    self.parts = parts
  }

  /// How far into a part "previous" still means its own start, as in Music
  /// and Podcasts.
  static let restartsWithin = 3.0

  public func previous(from position: Position) -> Position {
    position.seconds > Self.restartsWithin || position.part == 0
      ? Position(part: position.part, seconds: 0)
      : Position(part: position.part - 1, seconds: 0)
  }

  /// Nil after the last part.
  public func next(from position: Position) -> Position? {
    position.part + 1 < parts.count ? Position(part: position.part + 1, seconds: 0) : nil
  }

  /// Where a listen kept from before goes on, in this recording.
  public func resuming(_ kept: Position?) -> Position {
    guard let kept, parts.indices.contains(kept.part) else { return .start }
    return kept
  }
}

/// The audio of a file couldn't be made.
public struct ListenFailed: Error, LocalizedError, Equatable, Sendable {
  public let message: String

  public init(message: String) {
    self.message = message
  }

  public var errorDescription: String? { message }
}

/// Where each file's listen stopped, so it goes on from there next time.
public struct ResumePoints {
  private let defaults: UserDefaults

  public init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  private static func key(_ file: String) -> String { "listen.position.\(file)" }

  public func position(of file: String) -> Recording.Position? {
    defaults.data(forKey: Self.key(file)).flatMap { try? JSONDecoder().decode(Recording.Position.self, from: $0) }
  }

  public func keep(_ position: Recording.Position, of file: String) {
    defaults.set(try? JSONEncoder().encode(position), forKey: Self.key(file))
  }

  public func finished(_ file: String) {
    defaults.removeObject(forKey: Self.key(file))
  }
}

/// A file's audio as the server reports it.
private struct Listening {
  enum Status {
    case none, queued, processing, ready, error, cancelled
  }

  let status: Status
  let made: Int?
  let planned: Int?
  let error: String?
  let parts: [Recording.Part]
}

extension Session {
  /// The audio of a document or link, made first when it isn't yet, as the
  /// web's Listen makes it. `progress` hears how far the making is, and
  /// `pause` is waited between asking again.
  public func recording(
    of file: String,
    progress: @Sendable (Recording.Progress) -> Void = { _ in },
    pause: @Sendable () async throws -> Void = { try await Task.sleep(for: .seconds(2)) }
  ) async throws -> Recording {
    var listening = try await listening(file)
    var started = false
    while true {
      switch listening.status {
      case .ready:
        return Recording(parts: listening.parts)
      case .error:
        throw ListenFailed(message: listening.error ?? "The audio couldn’t be made.")
      case .cancelled where started:
        throw ListenFailed(message: "The audio was started again elsewhere, so it stopped here.")
      case .none, .cancelled:
        listening = try await listen(file)
        started = true
        continue
      case .queued:
        progress(.started)
      case .processing:
        progress(listening.planned.map { .made(listening.made ?? 0, of: $0) } ?? .started)
      }
      try await pause()
      listening = try await self.listening(file)
    }
  }

  private func listen(_ file: String) async throws -> Listening {
    Listening(try await ask { try await $0.ttsListen(path: .init(id: file)) }.ok.body.json)
  }

  private func listening(_ file: String) async throws -> Listening {
    Listening(try await ask { try await $0.ttsListening(path: .init(id: file)) }.ok.body.json)
  }
}

extension Listening {
  fileprivate init(_ answer: Components.Schemas.Listening) {
    status =
      switch answer.status {
      case .none: .none
      case .queued: .queued
      case .processing: .processing
      case .ready: .ready
      case .error: .error
      case .cancelled: .cancelled
      }
    made = answer.segmentCount
    planned = answer.plannedCount
    error = answer.error
    parts = answer.segments.compactMap { segment in
      URL(string: segment.audioUrl).map { Recording.Part(text: segment.text, audio: $0, section: segment.sectionTitle) }
    }
  }
}
