import EditorModelInterface
import Testing
@testable import TextKitEditor

@Suite struct MediaFigureTests {
  @Test func placedFiguresUseWebColumnsAndPhoneShareRules() throws {
    func width(_ placement: String?, available: Double) throws -> Double {
      var node: JSONValue = ["type": "image", "width": 200, "height": 100]
      if let placement, case .object(var fields) = node {
        fields["$"] = ["figure": ["width": .string(placement)]]
        node = .object(fields)
      }
      return try #require(MediaPayload(node)).figureWidth(fitting: available, em: 16)
    }
    #expect(try width(nil, available: 1200) == 704)
    #expect(try width("wide", available: 1200) == 1024)
    #expect(try width("full", available: 1200) == 1200)
    #expect(try width("50%", available: 1200) == 352)
    #expect(try width("10%", available: 1200) == 320)
    #expect(try width("50%", available: 500) == 500)
    #expect(try width("5%", available: 1200) == 704)
  }
}
