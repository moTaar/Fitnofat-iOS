import SwiftUI
import Combine

// MARK: - Rest Timer

struct RestTimerView: View {
    @ObservedObject var timerManager: RestTimerManager

    var body: some View {
        VStack(spacing: 12) {
            if timerManager.isRunning {
                // Active timer
                VStack(spacing: 8) {
                    Text(timeString(from: timerManager.remaining))
                        .font(.system(size: 48, weight: .bold, design: .monospaced))
                        .foregroundColor(timerManager.remaining <= 10 ? .red : .primary)

                    ProgressView(value: timerManager.progress)
                        .tint(timerManager.remaining <= 10 ? .red : .blue)

                    HStack(spacing: 16) {
                        Button(action: timerManager.add30) {
                            Label("+30s", systemImage: "plus.circle")
                                .font(.subheadline)
                        }
                        .buttonStyle(.bordered)

                        Button(action: timerManager.stop) {
                            Label("Skip", systemImage: "forward.fill")
                                .font(.subheadline)
                        }
                        .buttonStyle(.bordered)
                        .tint(.orange)
                    }
                }
                .padding()
                .background(Color(.systemGray6))
                .cornerRadius(12)
            } else {
                // Start timer button
                Button(action: { timerManager.start(seconds: 90) }) {
                    Label("Rest 90s", systemImage: "timer")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                }
                .buttonStyle(.borderedProminent)
                .tint(.blue)
            }
        }
    }

    private func timeString(from seconds: Int) -> String {
        let min = seconds / 60
        let sec = seconds % 60
        return String(format: "%d:%02d", min, sec)
    }
}

// MARK: - Rest Timer Manager

final class RestTimerManager: ObservableObject {
    @Published var remaining: Int = 0
    @Published var isRunning: Bool = false
    @Published var progress: Double = 0

    private var totalSeconds: Int = 0
    private var timer: AnyCancellable?
    private var endDate: Date?

    /// Start the rest timer with a given duration.
    func start(seconds: Int) {
        stop()
        totalSeconds = seconds
        remaining = seconds
        isRunning = true
        endDate = Date().addingTimeInterval(Double(seconds))

        timer = Timer.publish(every: 0.25, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in
                self?.tick()
            }
    }

    /// Add 30 seconds to the current timer.
    func add30() {
        guard isRunning else { return }
        totalSeconds += 30
        remaining += 30
        endDate = endDate?.addingTimeInterval(30)
    }

    /// Stop the timer.
    func stop() {
        timer?.cancel()
        timer = nil
        isRunning = false
        remaining = 0
        progress = 0
        endDate = nil
    }

    private func tick() {
        guard let end = endDate else { return }
        let now = Date()
        remaining = max(0, Int(end.timeIntervalSince(now)))
        progress = totalSeconds > 0 ? 1.0 - Double(remaining) / Double(totalSeconds) : 0

        if remaining <= 0 {
            // Timer completed
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            stop()
        }
    }
}
