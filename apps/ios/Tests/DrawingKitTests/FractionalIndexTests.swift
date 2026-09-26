import Testing

@testable import DrawingKit

@Suite struct FractionalIndexTests {
  /// Keys from `fractional-indexing` 3.2.0 itself, so an element placed here
  /// sorts where the web would place it.
  @Test(arguments: [
    (nil, nil, "a0"), ("a0", nil, "a1"), ("a9", nil, "aA"), ("az", nil, "b00"),
    ("Zz", nil, "a0"), (nil, "a0", "Zz"), ("a0", "a1", "a0V"), ("a0", "a0V", "a0G"),
    ("a0V", "a1", "a0l"), ("b00", nil, "b01"),
    ("zzzzzzzzzzzzzzzzzzzzzzzzzzz", nil, "zzzzzzzzzzzzzzzzzzzzzzzzzzzV"),
  ] as [(String?, String?, String)])
  func makesTheKeysTheWebMakes(_ a: String?, _ b: String?, _ key: String) {
    #expect(FractionalIndex.keyBetween(a, b) == key)
  }

  @Test func spreadsSeveralKeysAsTheWebDoes() {
    #expect(FractionalIndex.keysBetween("a0", "a1", count: 3) == ["a0G", "a0V", "a0l"])
    #expect(FractionalIndex.keysBetween(nil, "a0", count: 3) == ["Zx", "Zy", "Zz"])
  }

  /// Drawings saved before Excalidraw ordered elements by key have none; the
  /// web gives them keys when it opens them, as a change to each element.
  @Test func ordersADrawingSavedWithoutKeys() {
    let editor = DrawingEditor(
      elements: [
        ["id": "x", "type": "rectangle", "version": 3],
        ["id": "y", "type": "rectangle", "version": 3, "index": "a0"],
        ["id": "z", "type": "rectangle", "version": 3, "index": nil],
      ], measurer: FontLibrary.shared, environment: .counting)

    #expect(editor.elements.map { $0["index"] } == ["Zz", "a0", "a1"])
    #expect(editor.elements.map { $0["version"] } == [4, 3, 4])
  }
}
