import Foundation

/// Groups, as `groups.ts` and the group actions have them.
extension DrawingEditor {
  func groupIds(_ element: RawElement) -> [String] {
    element["groupIds"]?.arrayValue?.compactMap(\.stringValue) ?? []
  }

  /// An element's groups outside the one being edited, which selecting the
  /// element selects.
  private func outerGroups(_ element: RawElement) -> [String] {
    let groups = groupIds(element)
    guard let editingGroupId, let index = groups.firstIndex(of: editingGroupId) else { return groups }
    return Array(groups[..<index])
  }

  /// `selectedGroupIds`, as `selectGroupsForSelectedElements` works them
  /// out: the outermost group of each selected element, if it has two
  /// elements or more.
  public var selectedGroupIds: Set<String> {
    var groups: Set<String> = []
    for element in store where !element.isDeleted && selectedIds.contains(element.id) {
      if let last = outerGroups(element).last { groups.insert(last) }
    }
    var members: [String: Int] = [:]
    for element in store where !element.isDeleted {
      if let group = groupIds(element).first(where: groups.contains) { members[group, default: 0] += 1 }
    }
    return groups.filter { (members[$0] ?? 0) >= 2 }
  }

  /// `selectGroupsForSelectedElements`: a selected element selects the rest
  /// of its outermost group.
  func withGroups(_ ids: Set<String>) -> Set<String> {
    var groups: Set<String> = []
    for element in store where !element.isDeleted && ids.contains(element.id) {
      if let last = outerGroups(element).last { groups.insert(last) }
    }
    guard !groups.isEmpty else { return ids }
    let members = store.filter { !$0.isDeleted && groupIds($0).contains(where: groups.contains) }.map(\.id)
    return ids.union(members)
  }

  /// `enableActionGroup`: at least two are selected, not all already in
  /// one group, and no frame with what is in it.
  public var canGroup: Bool {
    let selected = selectedWithLabels()
    guard selected.count >= 2 else { return false }
    let allInOneGroup = groupIds(selected[0]).contains { group in selected.allSatisfy { groupIds($0).contains(group) } }
    let ids = Set(selected.map(\.id))
    let frameWithChildren = selected.contains { $0["frameId"]?.stringValue.map(ids.contains) == true }
    return !allInOneGroup && !frameWithChildren
  }

  public var canUngroup: Bool { !selectedGroupIds.isEmpty }

  private func selectedWithLabels() -> [RawElement] {
    store.filter { element in
      !element.isDeleted
        && (selectedIds.contains(element.id)
          || (element.type == .text && element["containerId"]?.stringValue.map(selectedIds.contains) == true))
    }
  }

  /// `getRootElements` of the selection with the labels its shapes hold.
  private func groupable() -> [RawElement] {
    let selected = selectedWithLabels()
    let frames = Set(selected.filter { $0.type == .frame || $0.type == .magicframe }.map(\.id))
    return selected.filter { element in
      frames.contains(element.id) || !(element["frameId"]?.stringValue.map(frames.contains) ?? false)
    }
  }

  /// `actionGroup`: the selected elements, and the labels they hold, become
  /// one group, drawn together where the topmost of them was.
  public func group() {
    guard editing == nil, gesture == nil else { return }
    let selected = groupable()
    guard selected.count >= 2 else { return }
    let ids = Set(selected.map(\.id))
    let current = selectedGroupIds
    if current.count == 1, let group = current.first {
      let members = Set(store.filter { groupIds($0).contains(group) }.map(\.id))
      if members.union(ids).count == members.count { return }
    }
    let newGroup = environment.newId()
    for position in store.indices where ids.contains(store[position].id) {
      var groups = groupIds(store[position])
      let insertAt = editingGroupId.flatMap { groups.firstIndex(of: $0) } ?? groups.count
      groups.insert(newGroup, at: insertAt)
      environment.update(&store[position], ["groupIds": .array(groups.map(JSONValue.string))])
    }
    let members = store.filter { groupIds($0).contains(newGroup) }
    if let last = members.last, let lastPosition = store.lastIndex(where: { $0.id == last.id }) {
      let before = store[..<lastPosition].filter { !groupIds($0).contains(newGroup) }
      store = before + members + store[(lastPosition + 1)...]
      syncMovedIndices(Set(members.map(\.id)))
    }
    selectedIds = selectedIds.union(store.filter { !$0.isDeleted && groupIds($0).contains(newGroup) }.map(\.id))
    capture()
  }

  /// `actionUngroup`: the selected groups are taken apart, and what was in
  /// them stays selected, the labels in shapes aside.
  public func ungroup() {
    guard editing == nil, gesture == nil else { return }
    let groups = selectedGroupIds
    guard !groups.isEmpty else { return }
    var labels: Set<String> = []
    for position in store.indices {
      let element = store[position]
      if element.type == .text, element["containerId"]?.stringValue != nil { labels.insert(element.id) }
      let before = groupIds(element)
      let after = before.filter { !groups.contains($0) }
      if after.count != before.count {
        environment.update(&store[position], ["groupIds": .array(after.map(JSONValue.string))])
      }
    }
    selectedIds = withGroups(selectedIds).subtracting(labels)
    capture()
  }

  /// A second tap on an element of a selected group: the group is entered,
  /// and the element alone is selected.
  func enterGroup(at p: Point2D) -> Bool {
    let groups = selectedGroupIds
    guard !groups.isEmpty, let hit = elementAt(p), let element = element(hit),
      let group = groupIds(element).first(where: groups.contains)
    else { return false }
    editingGroupId = group
    selectedIds = withGroups([hit])
    capture()
    return true
  }

  /// `syncMovedIndices`: new keys for the moved elements that no longer sit
  /// between their neighbours' keys.
  func syncMovedIndices(_ moved: Set<String>) {
    let indices = store.map(\.index)
    let groups = FractionalIndex.movedGroups(indices) { i in
      moved.contains(store[i].id)
        && !FractionalIndex.isValid(
          indices[i], after: i > 0 ? indices[i - 1] : nil, before: i + 1 < indices.count ? indices[i + 1] : nil)
    }
    var candidate = indices
    let updates = FractionalIndex.generate(indices, groups: groups)
    for (position, key) in updates { candidate[position] = key }
    if FractionalIndex.areValid(candidate) {
      for (position, key) in updates { environment.mutate(&store[position], ["index": .string(key)]) }
    } else {
      syncInvalidIndices()
    }
  }
}
