extension Array {
  /// JavaScript's `array[index]` or `text[index]`, which is undefined out of
  /// range.
  public subscript(safe index: Int) -> Element? {
    indices.contains(index) ? self[index] : nil
  }
}
