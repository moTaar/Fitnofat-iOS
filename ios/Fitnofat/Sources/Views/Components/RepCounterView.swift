import SwiftUI
import CoreMotion

// MARK: - Smart Rep Counter

final class RepCounterManager: ObservableObject {
    @Published var repCount: Int = 0
    @Published var isRunning: Bool = false
    @Published var sensitivity: RepSensitivity = .medium

    private let motionManager = CMMotionManager()
    private let feedback = RepCounterFeedback.shared

    private var lastPeakTime: Date = .init()
    private var peakThreshold: Double = 1.5
    private var aboveThreshold: Bool = false
    private var minInterval: Double = 0.3

    func setSensitivity(_ s: RepSensitivity) {
        sensitivity = s
        switch s {
        case .low:
            peakThreshold = 2.0
            minInterval = 0.5
        case .medium:
            peakThreshold = 1.5
            minInterval = 0.3
        case .high:
            peakThreshold = 1.0
            minInterval = 0.2
        }
    }

    func start() {
        guard motionManager.isAccelerometerAvailable else {
            print("[RepCounter] Accelerometer not available")
            return
        }

        repCount = 0
        isRunning = true
        lastPeakTime = .init()
        aboveThreshold = false

        motionManager.accelerometerUpdateInterval = 1.0 / 60.0
        motionManager.startAccelerometerUpdates(to: .main) { [weak self] data, error in
            guard let data = data, error == nil, let self = self else { return }
            self.processAccelerometer(data: data)
        }
    }

    func stop() {
        motionManager.stopAccelerometerUpdates()
        isRunning = false
    }

    func reset() {
        repCount = 0
    }

    private func processAccelerometer(data: CMAccelerometerData) {
        let magnitude = sqrt(
            data.acceleration.x * data.acceleration.x +
            data.acceleration.y * data.acceleration.y +
            data.acceleration.z * data.acceleration.z
        )

        let now = Date()

        if magnitude > peakThreshold && !aboveThreshold && now.timeIntervalSince(lastPeakTime) > minInterval {
            // Peak detected — count a rep
            aboveThreshold = true
            lastPeakTime = now
            repCount += 1
            feedback.playRepTick()

            // Milestone haptic every 10 reps
            if repCount % 10 == 0 {
                feedback.playMilestone()
            }
        } else if magnitude < peakThreshold * 0.7 {
            aboveThreshold = false
        }
    }
}

// MARK: - Rep Counter View

struct RepCounterView: View {
    @StateObject private var counter = RepCounterManager()

    var body: some View {
        VStack(spacing: 20) {
            // Rep count display
            Text("\(counter.repCount)")
                .font(.system(size: 72, weight: .bold, design: .monospaced))
                .foregroundColor(counter.isRunning ? .blue : .secondary)

            Text("reps")
                .font(.headline)
                .foregroundColor(.secondary)

            // Sensitivity picker
            Picker("Sensitivity", selection: $counter.sensitivity) {
                ForEach(RepSensitivity.allCases, id: \.self) { s in
                    Text(s.rawValue.capitalized).tag(s)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .onChange(of: counter.sensitivity) { _, newValue in
                counter.setSensitivity(newValue)
            }

            // Controls
            HStack(spacing: 24) {
                if counter.isRunning {
                    Button(action: counter.stop) {
                        Label("Stop", systemImage: "stop.fill")
                            .font(.headline)
                            .foregroundColor(.red)
                    }

                    Button(action: counter.reset) {
                        Label("Reset", systemImage: "arrow.counterclockwise")
                            .font(.headline)
                    }
                } else {
                    Button(action: counter.start) {
                        Label("Start", systemImage: "play.fill")
                            .font(.headline)
                            .foregroundColor(.green)
                    }
                }
            }
        }
        .padding()
    }
}

extension RepSensitivity: CaseIterable {}
