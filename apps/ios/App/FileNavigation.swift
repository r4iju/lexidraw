import SwiftUI

/// All tablet file replacement waits for the current editor's save boundary.
@MainActor @Observable
final class FileNavigation {
  private var prepareToLeave: (() async -> Bool)?
  private var owner: ObjectIdentifier?

  func register(_ owner: AnyObject, prepare: @escaping () async -> Bool) {
    self.owner = ObjectIdentifier(owner)
    prepareToLeave = prepare
  }

  func unregister(_ owner: AnyObject) {
    guard self.owner == ObjectIdentifier(owner) else { return }
    self.owner = nil
    prepareToLeave = nil
  }
  private(set) var changing = false

  func perform(_ change: @escaping () -> Void) {
    Task { await navigate(change) }
  }

  @discardableResult
  func navigate(_ change: () -> Void) async -> Bool {
    guard !changing else { return false }
    changing = true
    defer { changing = false }
    guard await prepareToLeave?() ?? true else { return false }
    change()
    return true
  }
}

extension EnvironmentValues {
  @Entry var fileNavigation: FileNavigation?
}
