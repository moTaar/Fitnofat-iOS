import XCTest
@testable import ForgeFit

final class AuthServiceTests: XCTestCase {
    let service = AuthService.shared

    override func setUp() {
        // Start with no session for each test
        service.clearSession()
    }

    // MARK: - Session lifecycle

    func testInitialStateNoSession() {
        XCTAssertNil(service.session)
        XCTAssertFalse(service.isAuthenticated)
        XCTAssertNil(service.accessToken)
        XCTAssertNil(service.refreshToken)
        XCTAssertNil(service.userId)
    }

    func testSetSession() {
        let session = Session(
            accessToken: "abc123",
            refreshToken: "def456",
            expiresAt: 9999999999,
            user: Session.UserInfo(id: "user1", email: "test@example.com")
        )
        service.setSession(session)

        XCTAssertNotNil(service.session)
        XCTAssertTrue(service.isAuthenticated)
        XCTAssertEqual(service.accessToken, "abc123")
        XCTAssertEqual(service.refreshToken, "def456")
        XCTAssertEqual(service.userId, "user1")
    }

    func testClearSession() {
        let session = Session(
            accessToken: "abc123",
            refreshToken: "def456",
            expiresAt: 9999999999,
            user: Session.UserInfo(id: "user1", email: "test@example.com")
        )
        service.setSession(session)
        XCTAssertTrue(service.isAuthenticated)

        service.clearSession()
        XCTAssertNil(service.session)
        XCTAssertFalse(service.isAuthenticated)
    }

    // MARK: - onChange listener

    func testOnChangeFiresWhenSessionSet() {
        let expectation = XCTestExpectation(description: "onChange callback")
        let cancel = service.onChange { session in
            if session != nil {
                expectation.fulfill()
            }
        }

        let session = Session(
            accessToken: "abc",
            refreshToken: "def",
            expiresAt: 9999999999,
            user: Session.UserInfo(id: "u1", email: "e@e.com")
        )
        service.setSession(session)
        wait(for: [expectation], timeout: 1.0)
        cancel()
    }

    func testOnChangeFiresWhenSessionCleared() {
        // Set session first
        let session = Session(
            accessToken: "abc",
            refreshToken: "def",
            expiresAt: 9999999999,
            user: Session.UserInfo(id: "u1", email: "e@e.com")
        )
        service.setSession(session)

        let expectation = XCTestExpectation(description: "onChange clear callback")
        let cancel = service.onChange { session in
            if session == nil {
                expectation.fulfill()
            }
        }

        service.clearSession()
        wait(for: [expectation], timeout: 1.0)
        cancel()
    }

    func testOnChangeCancelStopsCallbacks() {
        let expectation = XCTestExpectation(description: "cancel should not fire")
        expectation.isInverted = true

        let cancel = service.onChange { _ in
            expectation.fulfill()
        }
        cancel()

        let session = Session(
            accessToken: "abc",
            refreshToken: "def",
            expiresAt: 9999999999,
            user: Session.UserInfo(id: "u1", email: "e@e.com")
        )
        service.setSession(session)
        wait(for: [expectation], timeout: 0.5)
    }
}
