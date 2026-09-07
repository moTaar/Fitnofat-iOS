import XCTest
@testable import Fitnofat

final class EntitlementServiceTests: XCTestCase {
    let service = EntitlementService.shared

    // MARK: - effectivePlan

    func testEffectivePlanActivePro() {
        let sub = Subscription(plan: .pro, status: .active)
        XCTAssertEqual(service.effectivePlan(from: sub), .pro)
    }

    func testEffectivePlanTrialingPro() {
        let sub = Subscription(plan: .pro, status: .trialing)
        XCTAssertEqual(service.effectivePlan(from: sub), .pro)
    }

    func testEffectivePlanPastDuePro() {
        let sub = Subscription(plan: .pro, status: .pastDue)
        XCTAssertEqual(service.effectivePlan(from: sub), .pro)
    }

    func testEffectivePlanCanceledPro() {
        let sub = Subscription(plan: .pro, status: .canceled)
        XCTAssertEqual(service.effectivePlan(from: sub), .free)
    }

    func testEffectivePlanExpiredPro() {
        let sub = Subscription(plan: .pro, status: .expired)
        XCTAssertEqual(service.effectivePlan(from: sub), .free)
    }

    func testEffectivePlanNilSubscription() {
        XCTAssertEqual(service.effectivePlan(from: nil), .free)
    }

    func testEffectivePlanFreeActive() {
        let sub = Subscription(plan: .free, status: .active)
        XCTAssertEqual(service.effectivePlan(from: sub), .free)
    }

    // MARK: - isEntitled

    func testIsEntitledProToAllFeatures() {
        let sub = Subscription(plan: .pro, status: .active)
        XCTAssertTrue(service.isEntitled(to: .aiCoach, subscription: sub))
        XCTAssertTrue(service.isEntitled(to: .aiNutrition, subscription: sub))
        XCTAssertTrue(service.isEntitled(to: .programRefresh, subscription: sub))
        XCTAssertTrue(service.isEntitled(to: .aiExercise, subscription: sub))
    }

    func testIsEntitledFreeToNothing() {
        let sub = Subscription(plan: .free, status: .active)
        XCTAssertFalse(service.isEntitled(to: .aiCoach, subscription: sub))
        XCTAssertFalse(service.isEntitled(to: .aiNutrition, subscription: sub))
        XCTAssertFalse(service.isEntitled(to: .programRefresh, subscription: sub))
        XCTAssertFalse(service.isEntitled(to: .aiExercise, subscription: sub))
    }

    func testIsEntitledNilSubscription() {
        XCTAssertFalse(service.isEntitled(to: .aiCoach, subscription: nil))
    }

    func testIsEntitledExpiredPro() {
        let sub = Subscription(plan: .pro, status: .expired)
        XCTAssertFalse(service.isEntitled(to: .aiCoach, subscription: sub))
    }

    // MARK: - requiresProUpgrade

    func testRequiresProUpgradeFree() {
        let sub = Subscription(plan: .free, status: .active)
        XCTAssertTrue(service.requiresProUpgrade(for: .aiCoach, subscription: sub))
    }

    func testRequiresProUpgradePro() {
        let sub = Subscription(plan: .pro, status: .active)
        XCTAssertFalse(service.requiresProUpgrade(for: .aiCoach, subscription: sub))
    }
}
