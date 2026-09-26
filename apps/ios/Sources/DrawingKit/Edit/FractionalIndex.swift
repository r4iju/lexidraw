import Foundation

/// The `fractional-indexing` package Excalidraw orders elements with: keys
/// that sort as strings, so an element can go between two others without
/// renumbering the rest.
enum FractionalIndex {
  private static let digits = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz")
  private static let zero = digits[0]

  /// `generateKeyBetween`: a key after `a` and before `b`.
  static func keyBetween(_ a: String?, _ b: String?) -> String {
    guard let a else {
      guard let b else { return "a0" }
      let ib = integerPart(b)
      let fb = String(b.dropFirst(ib.count))
      if ib == "A" + String(repeating: zero, count: 26) { return ib + midpoint("", fb) }
      if ib < b { return ib }
      return decrementInteger(ib)!
    }
    guard let b else {
      let ia = integerPart(a)
      let fa = String(a.dropFirst(ia.count))
      return incrementInteger(ia) ?? ia + midpoint(fa, nil)
    }
    let ia = integerPart(a)
    let fa = String(a.dropFirst(ia.count))
    let ib = integerPart(b)
    let fb = String(b.dropFirst(ib.count))
    if ia == ib { return ia + midpoint(fa, fb) }
    let i = incrementInteger(ia)!
    return i < b ? i : ia + midpoint(fa, nil)
  }

  /// `generateNKeysBetween`.
  static func keysBetween(_ a: String?, _ b: String?, count: Int) -> [String] {
    if count == 0 { return [] }
    if count == 1 { return [keyBetween(a, b)] }
    if b == nil {
      var c = keyBetween(a, b)
      var result = [c]
      for _ in 0..<(count - 1) {
        c = keyBetween(c, b)
        result.append(c)
      }
      return result
    }
    if a == nil {
      var c = keyBetween(a, b)
      var result = [c]
      for _ in 0..<(count - 1) {
        c = keyBetween(a, c)
        result.append(c)
      }
      return result.reversed()
    }
    let mid = count / 2
    let c = keyBetween(a, b)
    return keysBetween(a, c, count: mid) + [c] + keysBetween(c, b, count: count - mid - 1)
  }

  private static func index(of digit: Character) -> Int { digits.firstIndex(of: digit) ?? 0 }

  private static func midpoint(_ a: String, _ b: String?) -> String {
    let a = Array(a)
    let b = b.map(Array.init)
    if let b, !b.isEmpty {
      var n = 0
      while n < b.count, (n < a.count ? a[n] : zero) == b[n] { n += 1 }
      if n > 0 {
        return String(b[0..<n]) + midpoint(String(a.dropFirst(n)), String(b.dropFirst(n)))
      }
    }
    let digitA = a.first.map(index(of:)) ?? 0
    let digitB = b.flatMap { $0.first }.map(index(of:)) ?? digits.count
    if digitB - digitA > 1 {
      return String(digits[Int((0.5 * Double(digitA + digitB)).rounded(.toNearestOrAwayFromZero))])
    }
    if let b, b.count > 1 { return String(b[0]) }
    return String(digits[digitA]) + midpoint(String(a.dropFirst()), nil)
  }

  private static func integerLength(_ head: Character) -> Int {
    let value = Int(head.asciiValue ?? 0)
    if head >= "a" && head <= "z" { return value - 97 + 2 }
    return 90 - value + 2
  }

  private static func integerPart(_ key: String) -> String {
    String(key.prefix(integerLength(key.first ?? "a")))
  }

  private static func incrementInteger(_ x: String) -> String? {
    let head = x.first!
    var digs = Array(x.dropFirst())
    var carry = true
    var i = digs.count - 1
    while carry && i >= 0 {
      let d = index(of: digs[i]) + 1
      if d == digits.count {
        digs[i] = zero
      } else {
        digs[i] = digits[d]
        carry = false
      }
      i -= 1
    }
    guard carry else { return String(head) + String(digs) }
    if head == "Z" { return "a" + String(zero) }
    if head == "z" { return nil }
    let h = Character(UnicodeScalar(head.asciiValue! + 1))
    if h > "a" { digs.append(zero) } else { digs.removeLast() }
    return String(h) + String(digs)
  }

  private static func decrementInteger(_ x: String) -> String? {
    let head = x.first!
    var digs = Array(x.dropFirst())
    var borrow = true
    var i = digs.count - 1
    while borrow && i >= 0 {
      let d = index(of: digs[i]) - 1
      if d == -1 {
        digs[i] = digits.last!
      } else {
        digs[i] = digits[d]
        borrow = false
      }
      i -= 1
    }
    guard borrow else { return String(head) + String(digs) }
    if head == "a" { return "Z" + String(digits.last!) }
    if head == "A" { return nil }
    let h = Character(UnicodeScalar(head.asciiValue! - 1))
    if h < "Z" { digs.append(digits.last!) } else { digs.removeLast() }
    return String(h) + String(digs)
  }

  // MARK: Keeping a scene's keys in order

  /// `isValidFractionalIndex`.
  static func isValid(_ index: String?, after predecessor: String?, before successor: String?)
    -> Bool
  {
    guard let index, !index.isEmpty else { return false }
    let predecessor = predecessor?.isEmpty == false ? predecessor : nil
    let successor = successor?.isEmpty == false ? successor : nil
    switch (predecessor, successor) {
    case (let p?, let s?): return p < index && index < s
    case (nil, let s?): return index < s
    case (let p?, nil): return p < index
    case (nil, nil): return true
    }
  }

  /// `getMovedIndicesGroups`: runs of moved elements, each with the
  /// positions of the neighbours it goes between.
  static func movedGroups(_ indices: [String?], moved: (Int) -> Bool) -> [[Int]] {
    var groups: [[Int]] = []
    var i = 0
    while i < indices.count {
      if moved(i) {
        var group = [i - 1, i]
        i += 1
        while i < indices.count, moved(i) {
          group.append(i)
          i += 1
        }
        group.append(i)
        groups.append(group)
      } else {
        i += 1
      }
    }
    return groups
  }

  /// `getInvalidIndicesGroups`.
  static func invalidGroups(_ indices: [String?]) -> [[Int]] {
    func at(_ i: Int) -> String? {
      i >= 0 && i < indices.count ? indices[i].flatMap { $0.isEmpty ? nil : $0 } : nil
    }
    var groups: [[Int]] = []
    var lowerBoundIndex = -1
    var upperBoundIndex = 0
    func lower(_ index: Int) -> (String?, Int) {
      let bound = at(lowerBoundIndex)
      let candidate = at(index - 1)
      if (bound == nil && candidate != nil) || (bound != nil && candidate != nil && candidate! > bound!) {
        return (candidate, index - 1)
      }
      return (bound, lowerBoundIndex)
    }
    func upper(_ index: Int) -> (String?, Int) {
      let bound = at(upperBoundIndex)
      if bound != nil && index < upperBoundIndex { return (bound, upperBoundIndex) }
      var i = upperBoundIndex + 1
      while i < indices.count {
        let candidate = at(i)
        if (bound == nil && candidate != nil) || (bound != nil && candidate != nil && candidate! > bound!) {
          return (candidate, i)
        }
        i += 1
      }
      return (nil, i)
    }
    var i = 0
    while i < indices.count {
      var lowerBound: String?
      var upperBound: String?
      (lowerBound, lowerBoundIndex) = lower(i)
      (upperBound, upperBoundIndex) = upper(i)
      if !isValid(at(i), after: lowerBound, before: upperBound) {
        var group = [lowerBoundIndex, i]
        i += 1
        while i < indices.count {
          let (nextLower, nextLowerIndex) = lower(i)
          let (nextUpper, nextUpperIndex) = upper(i)
          if isValid(at(i), after: nextLower, before: nextUpper) { break }
          (lowerBound, lowerBoundIndex) = (nextLower, nextLowerIndex)
          (upperBound, upperBoundIndex) = (nextUpper, nextUpperIndex)
          group.append(i)
          i += 1
        }
        group.append(upperBoundIndex)
        groups.append(group)
      } else {
        i += 1
      }
    }
    return groups
  }

  /// `generateIndices`: new keys for the elements of each group.
  static func generate(_ indices: [String?], groups: [[Int]]) -> [(position: Int, key: String)] {
    func at(_ i: Int) -> String? {
      i >= 0 && i < indices.count ? indices[i].flatMap { $0.isEmpty ? nil : $0 } : nil
    }
    var updates: [(Int, String)] = []
    for group in groups {
      let inner = Array(group.dropFirst().dropLast())
      let keys = keysBetween(at(group.first!), at(group.last!), count: inner.count)
      updates += zip(inner, keys).map { ($0, $1) }
    }
    return updates
  }

  /// Whether every key sorts after the one before it, as
  /// `validateFractionalIndices` checks.
  static func areValid(_ indices: [String?]) -> Bool {
    indices.indices.allSatisfy { i in
      isValid(
        indices[i], after: i > 0 ? indices[i - 1] : nil,
        before: i + 1 < indices.count ? indices[i + 1] : nil)
    }
  }
}
