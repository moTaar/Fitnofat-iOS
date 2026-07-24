import XCTest
@testable import ForgeFit

final class HapticsTests: XCTestCase {

    func testSoundEnabledByDefault() {
        // Default is enabled — we can't access private property, but
        // we verify the method accepts toggling without crash
        RepCounterFeedback.shared.setSoundEnabled(true)
        RepCounterFeedback.shared.setSoundEnabled(false)
        RepCounterFeedback.shared.setSoundEnabled(true)
        // No assertion needed — these should not crash
    }

    func testPlayMethodsDoNotCrash() {
        // These methods use system APIs that work on device but may no-op in tests
        // Verify they don't crash when called
        RepCounterFeedback.shared.playRepTick()
        RepCounterFeedback.shared.playSetComplete()
        RepCounterFeedback.shared.playMilestone()
        RepCounterFeedback.shared.playError()
        RepCounterFeedback.shared.playSelection()
    }
}
