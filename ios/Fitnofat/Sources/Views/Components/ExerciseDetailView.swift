import SwiftUI

// MARK: - Exercise Detail View

struct ExerciseDetailView: View {
    let exercise: Exercise

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Header
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(exercise.name)
                            .font(.title2)
                            .bold()
                        Label(exercise.muscleGroup, systemImage: "figure.strengthtraining.traditional")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                        Label(exercise.equipment, systemImage: "dumbbell.fill")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    Spacer()
                }
                .padding(.horizontal)

                // MET info
                if let met = exercise.met {
                    HStack {
                        Image(systemName: "flame.fill")
                            .foregroundColor(.orange)
                        Text("MET: \(String(format: "%.1f", met))")
                            .font(.subheadline)
                        Spacer()
                    }
                    .padding(.horizontal)
                }

                // Guide
                if let guide = exercise.guide {
                    GuideSection(guide: guide)
                }

                Spacer()
            }
            .padding(.vertical)
        }
        .navigationTitle(exercise.name)
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - Guide Section

struct GuideSection: View {
    let guide: ExerciseGuide

    var body: some View {
        Group {
            if !guide.steps.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Steps")
                        .font(.headline)
                    ForEach(Array(guide.steps.enumerated()), id: \.offset) { index, step in
                        HStack(alignment: .top, spacing: 8) {
                            Text("\(index + 1).")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                            Text(step)
                                .font(.subheadline)
                        }
                    }
                }
                .padding(.horizontal)
            }

            if !guide.cues.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Cues")
                        .font(.headline)
                    ForEach(guide.cues, id: \.self) { cue in
                        Label(cue, systemImage: "checkmark.circle")
                            .font(.subheadline)
                            .foregroundColor(.green)
                    }
                }
                .padding(.horizontal)
            }

            if !guide.mistakes.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Common Mistakes")
                        .font(.headline)
                    ForEach(guide.mistakes, id: \.self) { mistake in
                        Label(mistake, systemImage: "xmark.circle")
                            .font(.subheadline)
                            .foregroundColor(.red)
                    }
                }
                .padding(.horizontal)
            }

            if let breathing = guide.breathing {
                DetailRow(label: "Breathing", value: breathing)
            }
            if let pattern = guide.pattern {
                DetailRow(label: "Pattern", value: pattern)
            }
            if let load = guide.load {
                DetailRow(label: "Load", value: load)
            }
            if let prop = guide.prop {
                DetailRow(label: "Propping", value: prop)
            }
        }
    }
}

// MARK: - Detail Row

struct DetailRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .top) {
            Text(label)
                .font(.subheadline)
                .foregroundColor(.secondary)
                .frame(width: 80, alignment: .leading)
            Text(value)
                .font(.subheadline)
            Spacer()
        }
        .padding(.horizontal)
    }
}
