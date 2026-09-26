import Foundation

/// `String(number)` as JavaScript writes it. Excalidraw builds SVG path data
/// by string interpolation and then trims digits with a regular expression,
/// so the digits it trims are these.
func jsNumberString(_ value: Double) -> String {
  if value.isNaN { return "NaN" }
  if value == 0 { return "0" }
  if value.isInfinite { return value < 0 ? "-Infinity" : "Infinity" }
  let sign = value < 0 ? "-" : ""
  // Swift's description is the shortest round-tripping digits, as JS uses.
  let description = "\(abs(value))"
  let parts = description.split(separator: "e", maxSplits: 1)
  let mantissa = String(parts[0])
  var exponent = parts.count > 1 ? Int(parts[1])! : 0
  let pieces = mantissa.split(separator: ".", omittingEmptySubsequences: false)
  var integer = String(pieces[0])
  var fraction = pieces.count > 1 ? String(pieces[1]) : ""
  if fraction == "0" { fraction = "" }
  exponent += integer.count
  var digits = integer + fraction
  let leadingZeros = digits.prefix(while: { $0 == "0" }).count
  digits.removeFirst(leadingZeros)
  exponent -= leadingZeros
  while digits.last == "0" { digits.removeLast() }
  // Now value = 0.digits × 10^exponent, as ECMAScript's n is defined.
  let k = digits.count
  let n = exponent
  if k <= n && n <= 21 {
    return sign + digits + String(repeating: "0", count: n - k)
  }
  if 0 < n && n <= 21 {
    integer = String(digits.prefix(n))
    return sign + integer + "." + digits.dropFirst(n)
  }
  if -6 < n && n <= 0 {
    return sign + "0." + String(repeating: "0", count: -n) + digits
  }
  let power = n - 1
  let exponentText = power < 0 ? "-\(-power)" : "+\(power)"
  if k == 1 { return sign + digits + "e" + exponentText }
  return sign + digits.prefix(1) + "." + digits.dropFirst() + "e" + exponentText
}
