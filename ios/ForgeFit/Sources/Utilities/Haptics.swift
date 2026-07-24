import Foundation
import UIKit
import AudioToolbox

// MARK: - Haptic & Sound Feedback

/// Rep counter audio/visual feedback manager.
/// - Plays a short tick sound for each rep counted
/// - Provides haptic feedback when enabled

final class RepCounterFeedback {
    static let shared = RepCounterFeedback()

    /// Sound IDs for the tick
    private let tickSoundID: SystemSoundID = 1104 // Tock sound
    private var soundEnabled = true

    private init() {}

    /// Configure whether sound is enabled.
    /// - Parameter enabled: True to play tick sound on rep
    func setSoundEnabled(_ enabled: Bool) {
        soundEnabled = enabled
    }

    /// Play the rep-counted tick.
    /// Called each time a rep is detected by the accelerometer counter.
    func playRepTick() {
        if soundEnabled {
            AudioServicesPlaySystemSound(tickSoundID)
        }
        // Light haptic for rep
        let generator = UIImpactFeedbackGenerator(style: .light)
        generator.impactOccurred()
    }

    /// Heavy haptic for set completion.
    func playSetComplete() {
        let generator = UINotificationFeedbackGenerator()
        generator.notificationOccurred(.success)
    }

    /// Medium haptic for milestone (e.g., every 10 reps).
    func playMilestone() {
        let generator = UIImpactFeedbackGenerator(style: .medium)
        generator.impactOccurred()
    }

    /// Error haptic for invalid action.
    func playError() {
        let generator = UINotificationFeedbackGenerator()
        generator.notificationOccurred(.error)
    }

    /// Selection feedback for UI interactions.
    func playSelection() {
        let generator = UISelectionFeedbackGenerator()
        generator.selectionChanged()
    }
}
