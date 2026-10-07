import Testing

@testable import DrawingKit

@Suite struct EmbeddedDrawingLayoutTests {
  /// A drawing exporting 400 wide, in a column 1200 wide at a 16pt em.
  func width(_ figure: String?, requested: Double? = nil, available: Double = 1200, empty: Bool = false) -> Double {
    EmbeddedDrawingLayout.width(figure: figure, requested: requested, naturalWidth: 400, empty: empty, available: available, em: 16)
  }

  @Test func aPlacedDrawingFillsItsFigureWidthAsTheWebDoes() {
    #expect(width("50%") == 352)
    #expect(width("wide") == 1024)
    #expect(width("full") == 1200)
    #expect(width("wide", requested: 300) == 1024)
  }

  @Test func anUnplacedDrawingKeepsItsOwnWidthWithinTheColumn() {
    #expect(width(nil) == 500)
    #expect(width(nil, requested: 300) == 300)
    #expect(width(nil, requested: 900) == 704)
  }

  @Test func anEmptyDrawingTakesTheColumnSoItCanBeSeenAndTapped() {
    #expect(width(nil, empty: true) == 704)
    #expect(EmbeddedDrawingLayout.emptyHeight(em: 16) == 112)
  }
}
