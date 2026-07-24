import Foundation

// MARK: - Entitlement Service

final class EntitlementService {
    static let shared = EntitlementService()

    private let planFeatures: [Plan: Set<Feature>] = [
        .free: [],
        .pro: [.aiCoach, .aiNutrition, .programRefresh, .aiExercise],
    ]

    private let liveStatuses: Set<SubscriptionStatus> = [.active, .trialing, .pastDue]

    func effectivePlan(from subscription: Subscription?) -> Plan {
        guard let sub = subscription, liveStatuses.contains(sub.status) else { return .free }
        return sub.plan
    }

    func isEntitled(to feature: Feature, subscription: Subscription?) -> Bool {
        let plan = effectivePlan(from: subscription)
        return planFeatures[plan]?.contains(feature) ?? false
    }

    func requiresProUpgrade(for feature: Feature, subscription: Subscription?) -> Bool {
        !isEntitled(to: feature, subscription: subscription)
    }
}
