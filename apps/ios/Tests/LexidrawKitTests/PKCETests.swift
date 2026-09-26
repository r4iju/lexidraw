import Testing

@testable import LexidrawKit

@Suite struct PKCETests {
  /// The worked example in RFC 7636, appendix B.
  @Test func theChallengeIsTheBase64URLOfTheVerifiersSHA256() {
    let pkce = PKCE(verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")

    #expect(pkce.challenge == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
  }

  @Test func aNewVerifierIsOneTheServerAcceptsAndNeverRepeats() {
    let first = PKCE()
    let second = PKCE()

    #expect(first.verifier.wholeMatch(of: /[A-Za-z0-9._~-]{43,128}/) != nil)
    #expect(first.verifier != second.verifier)
  }
}
