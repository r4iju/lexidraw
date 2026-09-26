import Foundation
import LexicalSwift
import Testing

@Suite struct JSONValueTests {
  @Test func everyStoredCaseReadsAndWritesBackAsTheWebWroteIt() throws {
    let lines = try String(contentsOf: Support.storedBytes, encoding: .utf8)
      .split(separator: "\n").filter { $0.hasPrefix("{") }
      .map { $0.hasSuffix(",") ? String($0.dropLast()) : String($0) }

    #expect(lines.count > 4000)
    #expect(try lines.filter { try JSONValue(parsing: $0).stringified != $0 } == [])
  }

  @Test func anObjectKeepsItsKeysInJavaScriptsOrder() throws {
    let object = try JSONValue(parsing: #"{"b":1,"10":2,"a":3,"2":4,"01":5,"b":6}"#)

    #expect(object.stringified == #"{"2":4,"10":2,"b":6,"a":3,"01":5}"#)
  }

  @Test func objectsAreEqualWhateverTheirKeyOrder() throws {
    #expect(try JSONValue(parsing: #"{"a":1,"b":2}"#) == JSONValue(parsing: #"{"b":2,"a":1}"#))
  }

  @Test(arguments: [
    (0.0, "0"), (-0.0, "0"), (1.0, "1"), (-12.5, "-12.5"), (0.1, "0.1"), (1e21, "1e+21"),
    (123456789012345680000.0, "123456789012345680000"), (1e-7, "1e-7"), (1.5e-7, "1.5e-7"),
    (0.000001, "0.000001"), (5e-324, "5e-324"), (1.7976931348623157e308, "1.7976931348623157e+308"),
    (0.30000000000000004, "0.30000000000000004"), (1e16, "10000000000000000"),
  ])
  func aNumberIsWrittenAsJavaScriptWritesIt(_ value: Double, _ written: String) {
    #expect(JSONValue.number(value).stringified == written)
  }

  @Test func aStringIsEscapedAsJavaScriptEscapesIt() throws {
    let string = "quote \" backslash \\ slash / tab \t line \n return \r feed \u{0C} back \u{08} nul \u{00} unit \u{1F} é 🙂"

    #expect(
      JSONValue.string(string).stringified
        == #""quote \" backslash \\ slash / tab \t line \n return \r feed \f back \b nul \u0000 unit \u001f é 🙂""#)
    #expect(try JSONValue(parsing: #""é🙂\/""#) == .string("é🙂/"))
  }

  @Test func textThatIsntJSONIsRefused() {
    #expect(throws: (any Error).self) { try JSONValue(parsing: #"{"a":1"#) }
    #expect(throws: (any Error).self) { try JSONValue(parsing: "[1,]") }
    #expect(throws: (any Error).self) { try JSONValue(parsing: "1 2") }
  }
}
