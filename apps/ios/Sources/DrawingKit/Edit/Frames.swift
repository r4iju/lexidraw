import Foundation

/// What is in a frame, as `frame.ts` and the web editor's pointer handlers
/// keep it: an element is in the frame its `frameId` names.
extension DrawingEditor {
  func frameId(_ element: RawElement) -> String? {
    element["frameId"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
  }

  /// `getTopLayerFrameAtSceneCoords`: the topmost frame whose box holds `p`.
  func topLayerFrame(at p: Point2D) -> String? {
    store.last { frame in
      guard !frame.isDeleted, frame.type?.isFrameLike == true else { return false }
      let (x, y) = (frame.number("x"), frame.number("y"))
      let (right, bottom) = (x + frame.number("width"), y + frame.number("height"))
      return p.x >= min(x, right) && p.x <= max(x, right) && p.y >= min(y, bottom) && p.y <= max(y, bottom)
    }?.id
  }

  /// The frames' children dragged with them, as `dragSelectedElements`
  /// moves a selected frame with what is in it.
  func withFrameChildren(_ selected: [RawElement]) -> [RawElement] {
    let frames = Set(selected.filter { $0.type?.isFrameLike == true }.map(\.id))
    guard !frames.isEmpty else { return selected }
    let ids = Set(selected.map(\.id))
    return selected
      + store.filter { !$0.isDeleted && !ids.contains($0.id) && frameId($0).map(frames.contains) == true }
  }

  // MARK: Pointer up

  /// `handleCanvasPointerUp` once the selection has been dragged: what is
  /// let go over a frame joins it, and what was dragged off its frame
  /// leaves. `highlight` is the frame the last move was over, which the
  /// web still holds here, the state it cleared not yet applied.
  func updateFramesAfterDrag(to point: Point2D, highlight: String?) {
    let geometry = makeGeometry(of: store, includingDeleted: true)
    let context = FrameContext(dragging: true, highlight: highlight)
    let top = topLayerFrame(at: point)
    let selected = selectedElements
    var leftGroup = false
    if let top, !selectedIds.contains(top) {
      let joining = selected.filter { frameId($0) != top && isInFrame($0, context, geometry) }.map(\.id)
      leftGroup = leaveEditingGroup(joining)
      addToFrame(joining, top)
    } else if top == nil {
      let leaving = selected.filter { frameId($0) != nil && !isInFrame($0, context, geometry) }.map(\.id)
      leftGroup = leaveEditingGroup(leaving)
    }
    updateFrameMembershipOfSelected(context, geometry)
    if leftGroup { editingGroupId = nil }
  }

  /// `handleCanvasPointerUp` once a resize or turn ends: a selected frame
  /// holds what its new box holds.
  func updateFramesAfterResize() {
    let geometry = makeGeometry(of: store, includingDeleted: true)
    updateFrameMembershipOfSelected(FrameContext(dragging: false, highlight: nil), geometry)
    for frame in selectedElements where frame.type?.isFrameLike == true {
      replaceChildren(of: frame.id, with: childrenAfterResizing(frame.id, geometry))
    }
  }

  /// `updateGroupIdsAfterEditingGroup`: what is dragged into or out of a
  /// frame leaves the group being edited, and a group left with one
  /// element is no group. Answers whether any element left.
  private func leaveEditingGroup(_ ids: [String]) -> Bool {
    guard let editing = editingGroupId, !ids.isEmpty else { return false }
    for id in ids {
      guard let element = element(id) else { continue }
      let groups = groupIds(element)
      // `slice(0, indexOf(…))`, which drops the last group when the
      // element isn't in the one being edited.
      let end = groups.firstIndex(of: editing) ?? max(groups.count - 1, 0)
      mutate(id, ["groupIds": .array(groups[..<end].map(JSONValue.string))])
    }
    for position in store.indices {
      guard let last = groupIds(store[position]).last else { continue }
      if store.filter({ groupIds($0).contains(last) }).count < 2 {
        environment.mutate(&store[position], ["groupIds": []])
      }
    }
    return true
  }

  // MARK: Membership

  /// What `isElementInFrame` reads from the web's state: whether the
  /// selection is being dragged, and the frame it was last dragged over.
  struct FrameContext {
    var dragging: Bool
    var highlight: String?
  }

  /// `isElementInFrame`: whether `element`, or the shape it labels, stays
  /// in, or joins, the frame it is headed for.
  private func isInFrame(_ element: RawElement, _ context: FrameContext, _ geometry: SceneGeometry) -> Bool {
    let subject =
      element.type == .text ? (element["containerId"]?.stringValue.flatMap(self.element) ?? element) : element
    let selected = { (id: String) in self.selectedIds.contains(id) }
    let containing = frameId(subject).flatMap { self.element($0) == nil ? nil : $0 }
    let target: String?
    if let frame = frameId(subject), selected(subject.id), selected(frame) {
      target = containing
    } else if selected(subject.id) && context.dragging {
      target = context.highlight
    } else {
      target = containing
    }
    guard let frameId = target, let frame = geometry.elements[frameId] else { return false }
    if !selected(subject.id) || !context.dragging || selected(frameId) { return true }
    let groups = groupIds(subject)
    if groups.isEmpty {
      return geometry.elements[subject.id].map { geometry.overlapsFrame($0, frame) } ?? false
    }
    var inGroups = store.filter { groupIds($0).contains(where: groups.contains) }
    if editingGroupId != nil {
      if context.highlight != nil { return true }
      inGroups.removeAll { selected($0.id) }
    }
    if inGroups.contains(where: { $0.type?.isFrameLike == true }) { return false }
    return inGroups.contains { raw in geometry.elements[raw.id].map { geometry.overlapsFrame($0, frame) } ?? false }
  }

  /// `updateFrameMembershipOfSelectedElements`: a selected element, or one
  /// in a group with it while a group is edited, leaves a frame it isn't
  /// in anymore.
  private func updateFrameMembershipOfSelected(_ context: FrameContext, _ geometry: SceneGeometry) {
    let selected = store.filter { selectedIds.contains($0.id) }
    var candidates = selected
    if editingGroupId != nil {
      for element in selected {
        let groups = groupIds(element)
        candidates += store.filter { groupIds($0).contains(where: groups.contains) }
      }
    }
    var seen: Set<String> = []
    let leaving = candidates.map(\.id).filter { seen.insert($0).inserted }.compactMap(element).filter {
      frameId($0) != nil && $0.type?.isFrameLike != true && !isInFrame($0, context, geometry)
    }
    removeFromFrames(leaving.map(\.id))
  }

  /// `addElementsToFrame`: `ids`, and the labels they hold, join `frame`,
  /// except frames, what is in another frame joining, and groups holding a
  /// frame.
  func addToFrame(_ ids: [String], _ frame: String) {
    let adding = ids.compactMap(element)
    let current = Set(store.filter { frameId($0) == frame }.map(\.id))
    let supplied = Set(ids)
    let otherFrames = Set(adding.filter { $0.type?.isFrameLike == true && $0.id != frame }.map(\.id))
    var joining: [String] = []
    for element in omitGroupsContainingFrames(adding) {
      if element.type?.isFrameLike == true || frameId(element).map(otherFrames.contains) == true { continue }
      if let parent = frameId(element), selectedIds.contains(element.id), selectedIds.contains(parent) { continue }
      if !current.contains(element.id) { joining.append(element.id) }
      if let label = label(of: element), !supplied.contains(label), !current.contains(label) {
        joining.append(label)
      }
    }
    for id in joining { mutate(id, ["frameId": .string(frame)]) }
  }

  /// `removeElementsFromFrame`: `ids`, and the labels they hold, leave the
  /// frames they are in.
  func removeFromFrames(_ ids: [String]) {
    var leaving: [String] = []
    for element in ids.compactMap(element) where frameId(element) != nil {
      leaving.append(element.id)
      if let label = label(of: element) { leaving.append(label) }
    }
    for id in leaving { mutate(id, ["frameId": nil]) }
  }

  /// `replaceAllElementsInFrame`: every child leaves `frame`, then `ids`
  /// join it, as two changes to each child that stays.
  func replaceChildren(of frame: String, with ids: [String]) {
    removeFromFrames(store.filter { frameId($0) == frame }.map(\.id))
    addToFrame(ids, frame)
  }

  private func label(of element: RawElement) -> String? {
    labelId(of: element).flatMap { id in self.element(id).flatMap { $0.isDeleted ? nil : id } }
  }

  /// `omitGroupsContainingFrameLikes`: `elements` without those whose
  /// outermost group holds a frame.
  private func omitGroupsContainingFrames(_ elements: [RawElement]) -> [RawElement] {
    let outermost = Set(elements.compactMap { groupIds($0).last })
    let holdingFrames = outermost.filter { group in
      store.contains { $0.type?.isFrameLike == true && groupIds($0).contains(group) }
    }
    return elements.filter { groupIds($0).last.map { !holdingFrames.contains($0) } ?? true }
  }

  // MARK: A frame's new box

  /// `getElementsInResizingFrame`: what `frame` holds once its box has
  /// changed, a group kept whole or let go whole.
  func childrenAfterResizing(_ frame: String, _ geometry: SceneGeometry) -> [String] {
    guard let frameShape = geometry.elements[frame] else { return [] }
    let shape = { (element: RawElement) in geometry.elements[element.id] }
    let before = store.filter { frameId($0) == frame }
    var next = before.map(\.id)
    var completely = completelyIn(frame, geometry)
    for element in before where !completely.contains(where: { $0.id == element.id }) {
      if let s = shape(element), geometry.isContainingFrame(s, frameShape) { completely.append(element) }
    }
    let completelyIds = Set(completely.map(\.id))
    let partly = before.filter { !completelyIds.contains($0.id) }
    var groupsToKeep = Set(completely.flatMap(groupIds))
    for element in partly {
      let intersecting = shape(element).map { geometry.isIntersectingFrame($0, frameShape) } ?? false
      if !intersecting {
        if groupIds(element).isEmpty { next.removeAll { $0 == element.id } }
      } else {
        groupsToKeep.formUnion(groupIds(element))
      }
    }
    for element in partly where !groupIds(element).isEmpty {
      if !groupIds(element).contains(where: groupsToKeep.contains) { next.removeAll { $0 == element.id } }
    }
    for element in completely where groupIds(element).isEmpty && !next.contains(element.id) {
      next.append(element.id)
    }
    for group in selectedGroups(of: completely.filter { !groupIds($0).isEmpty }) {
      let members = store.filter { groupIds($0).contains(group) }
      if geometry.areInFrameBounds(members.compactMap(shape), frameShape) {
        for member in members where !next.contains(member.id) { next.append(member.id) }
      }
    }
    return next.filter { id in
      element(id).map { !($0.type == .text && $0["containerId"]?.stringValue != nil) } ?? false
    }
  }

  /// `getElementsCompletelyInFrame`: what lies wholly in `frame`'s box,
  /// seen as clipped by the frame each is in, and in no other frame.
  private func completelyIn(_ frame: String, _ geometry: SceneGeometry) -> [RawElement] {
    guard let box = geometry.elements[frame].map(geometry.absoluteCoords) else { return [] }
    let containing = { (element: RawElement) -> DrawingElement? in
      self.frameId(element).flatMap { geometry.elements[$0] }.flatMap { $0.isDeleted ? nil : $0 }
    }
    let within = store.filter { element in
      guard let shape = geometry.elements[element.id], !shape.locked,
        !(element.type == .text && element["containerId"]?.stringValue != nil)
      else { return false }
      var b = geometry.bounds(shape)
      if let parent = containing(element) {
        let f = geometry.bounds(parent)
        b = Bounds(
          minX: max(f.minX, b.minX), minY: max(f.minY, b.minY), maxX: min(f.maxX, b.maxX),
          maxY: min(f.maxY, b.maxY))
      }
      guard box.x1 <= b.minX && box.y1 <= b.minY && box.x2 >= b.maxX && box.y2 >= b.maxY else { return false }
      return containing(element).map { geometry.overlapsFrame(shape, $0) } ?? true
    }
    return omitGroupsContainingFrames(within).filter { element in
      (element.type?.isFrameLike != true && frameId(element) == nil) || frameId(element) == frame
    }
  }

  /// `selectGroupsFromGivenElements`: the groups selecting `elements` would
  /// select, those with two of them or more.
  private func selectedGroups(of elements: [RawElement]) -> [String] {
    var groups: [String] = []
    for element in elements {
      var ids = groupIds(element)
      if let editingGroupId, let index = ids.firstIndex(of: editingGroupId) { ids = Array(ids[..<index]) }
      guard let group = ids.last, !groups.contains(group) else { continue }
      if elements.filter({ groupIds($0).contains(group) }).count >= 2 { groups.append(group) }
    }
    return groups
  }
}
