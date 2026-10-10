import Foundation
import Testing
@testable import LexidrawKit

@Suite("Shared Pro allowance")
struct ProAllowanceTests {
  @Test func allowanceUsesTheAuthenticatedAccountAndIntegerSubcredits() async throws {
    let server = FakeServer { request in
      #expect(request.url.path == "/api/trpc/pro.status")
      return (200, #"{"result":{"data":{"json":{"eligible":true,"entitled":true,"availableSubcredits":999998475,"reservedSubcredits":1792000,"renewalAt":1791590400000,"history":[{"id":"op","feature":"text","state":"settled","quote":1792000,"charged":1525,"created_at":1791504000000}],"policy":{"version":"private-cancellation-v1","disclosure":"Uncertain outcomes stay reserved."}}}}}"#)
    }
    let session = try TestServer.session(server)
    let allowance = try await session.proAllowance()
    #expect(allowance.availableSubcredits == 999_998_475)
    #expect(allowance.reservedSubcredits == 1_792_000)
    #expect(allowance.history.first?.charged == 1525)
    #expect(server.requests.first?.authorization == "Bearer lxd_kept")
  }
}
