import OrderedCollections

/// A JSON object's properties in the order JavaScript keeps them: keys that
/// are array indexes first, ascending, then the others as they were added. A
/// key set again keeps its place. Objects compare and hash by value, not key
/// order.
public struct JSONObject: Hashable, Sendable, Sequence, ExpressibleByDictionaryLiteral {
  private var storage: OrderedDictionary<String, JSONValue>

  public init() {
    storage = [:]
  }

  /// A key given twice keeps its first place and its last value, as
  /// `JSON.parse` does.
  public init(_ pairs: some Sequence<(String, JSONValue)>) {
    storage = [:]
    for (key, value) in pairs { storage[key] = value }
  }

  public init(dictionaryLiteral elements: (String, JSONValue)...) {
    self.init(elements)
  }

  public subscript(key: String) -> JSONValue? {
    get { storage[key] }
    set { storage[key] = newValue }
  }

  @discardableResult
  public mutating func removeValue(forKey key: String) -> JSONValue? {
    storage.removeValue(forKey: key)
  }

  public var keys: [String] {
    let indexes = storage.keys.filter(Self.isArrayIndex)
    guard !indexes.isEmpty else { return Array(storage.keys) }
    return indexes.sorted { UInt32($0)! < UInt32($1)! } + storage.keys.filter { !Self.isArrayIndex($0) }
  }

  public var values: [JSONValue] { keys.map { storage[$0]! } }
  public var count: Int { storage.count }
  public var isEmpty: Bool { storage.isEmpty }

  public func makeIterator() -> IndexingIterator<[(key: String, value: JSONValue)]> {
    keys.map { (key: $0, value: storage[$0]!) }.makeIterator()
  }

  public func mapValues(_ transform: (JSONValue) throws -> JSONValue) rethrows -> JSONObject {
    var mapped = self
    mapped.storage = try storage.mapValues(transform)
    return mapped
  }

  /// The same properties with the keys `order` lists first, in its order, and
  /// the others after them as they were.
  public func ordered(by order: [String]) -> JSONObject {
    var ordered = JSONObject(order.compactMap { key in storage[key].map { (key, $0) } })
    for (key, value) in storage where ordered[key] == nil { ordered[key] = value }
    return ordered
  }

  public static func == (lhs: JSONObject, rhs: JSONObject) -> Bool {
    lhs.storage.count == rhs.storage.count && lhs.storage.allSatisfy { rhs.storage[$0.key] == $0.value }
  }

  public func hash(into hasher: inout Hasher) {
    hasher.combine(Dictionary(uniqueKeysWithValues: storage.map { ($0.key, $0.value) }))
  }

  /// A canonical array index: a number below 2³² − 1 without leading zeros.
  private static func isArrayIndex(_ key: String) -> Bool {
    guard let first = key.utf8.first, key.utf8.allSatisfy({ (48...57).contains($0) }),
      first != 48 || key.utf8.count == 1, let index = UInt32(key)
    else { return false }
    return index != .max
  }
}
