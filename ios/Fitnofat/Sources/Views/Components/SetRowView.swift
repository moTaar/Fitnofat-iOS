import SwiftUI

// MARK: - Set Row

struct SetRowView: View {
    @Binding var set: LoggedSet
    let index: Int
    let exerciseKind: ExerciseKind?

    @State private var weightText: String = ""
    @State private var repsText: String = ""
    @State private var durationText: String = ""
    @State private var distanceText: String = ""

    var body: some View {
        HStack(spacing: 12) {
            // Set number
            Text("\(index + 1)")
                .font(.headline)
                .foregroundColor(.secondary)
                .frame(width: 28)

            // Completed checkbox
            Button(action: { set.completed.toggle() }) {
                Image(systemName: set.completed ? "checkmark.circle.fill" : "circle")
                    .foregroundColor(set.completed ? .green : .gray)
                    .font(.title3)
            }

            // Input fields based on exercise kind
            switch exerciseKind {
            case .cardio:
                cardioFields
            case .hold:
                holdFields
            default:
                strengthFields
            }
        }
        .padding(.vertical, 4)
        .opacity(set.completed ? 0.7 : 1.0)
        .onAppear {
            weightText = set.weight > 0 ? String(format: "%.1f", set.weight) : ""
            repsText = set.reps > 0 ? "\(set.reps)" : ""
            durationText = set.durationSec.map { "\($0)" } ?? ""
            distanceText = set.distanceKm.map { String(format: "%.2f", $0) } ?? ""
        }
    }

    // MARK: - Strength Fields

    private var strengthFields: some View {
        HStack(spacing: 8) {
            TextField("Weight", text: $weightText)
                .keyboardType(.decimalPad)
                .textFieldStyle(.roundedBorder)
                .frame(width: 80)
                .onChange(of: weightText) { _, newValue in
                    set.weight = Double(newValue) ?? 0
                }

            Text("×")
                .foregroundColor(.secondary)

            TextField("Reps", text: $repsText)
                .keyboardType(.numberPad)
                .textFieldStyle(.roundedBorder)
                .frame(width: 60)
                .onChange(of: repsText) { _, newValue in
                    set.reps = Int(newValue) ?? 0
                }
        }
    }

    // MARK: - Cardio Fields

    private var cardioFields: some View {
        HStack(spacing: 8) {
            Image(systemName: "clock")
                .foregroundColor(.secondary)
            TextField("Seconds", text: $durationText)
                .keyboardType(.numberPad)
                .textFieldStyle(.roundedBorder)
                .frame(width: 80)
                .onChange(of: durationText) { _, newValue in
                    set.durationSec = Int(newValue)
                }

            Image(systemName: "map")
                .foregroundColor(.secondary)
            TextField("km", text: $distanceText)
                .keyboardType(.decimalPad)
                .textFieldStyle(.roundedBorder)
                .frame(width: 80)
                .onChange(of: distanceText) { _, newValue in
                    set.distanceKm = Double(newValue)
                }
        }
    }

    // MARK: - Hold Fields

    private var holdFields: some View {
        HStack(spacing: 8) {
            Image(systemName: "clock")
                .foregroundColor(.secondary)
            TextField("Seconds", text: $durationText)
                .keyboardType(.numberPad)
                .textFieldStyle(.roundedBorder)
                .frame(width: 100)
                .onChange(of: durationText) { _, newValue in
                    set.durationSec = Int(newValue)
                }
        }
    }
}
