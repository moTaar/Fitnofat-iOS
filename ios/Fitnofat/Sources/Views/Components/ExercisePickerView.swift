import SwiftUI

// MARK: - Exercise Picker

struct ExercisePickerView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var searchText = ""
    @State private var selectedMuscleGroup: String?

    let onSelect: (Exercise) -> Void

    private let exercises = SeedExercises.all.map {
        Exercise(id: $0.id, name: $0.name, muscleGroup: $0.muscleGroup, equipment: $0.equipment, met: $0.met, guide: $0.guide)
    }
    private let muscleGroups = SeedExercises.muscleGroups

    var filteredExercises: [Exercise] {
        var result = exercises
        if let group = selectedMuscleGroup {
            result = result.filter { $0.muscleGroup == group }
        }
        if !searchText.isEmpty {
            result = result.filter { $0.name.localizedCaseInsensitiveContains(searchText) }
        }
        return result.sorted { $0.name < $1.name }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Muscle group filter
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(muscleGroups, id: \.self) { group in
                            Button(action: {
                                if selectedMuscleGroup == group {
                                    selectedMuscleGroup = nil
                                } else {
                                    selectedMuscleGroup = group
                                }
                            }) {
                                Text(group)
                                    .font(.caption)
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 6)
                                    .background(selectedMuscleGroup == group ? Color.blue : Color(.systemGray5))
                                    .foregroundColor(selectedMuscleGroup == group ? .white : .primary)
                                    .clipShape(Capsule())
                            }
                        }
                    }
                    .padding(.horizontal)
                    .padding(.vertical, 8)
                }

                // Exercise list
                List(filteredExercises) { exercise in
                    Button(action: { onSelect(exercise); dismiss() }) {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(exercise.name)
                                    .font(.body)
                                    .foregroundColor(.primary)
                                Text("\(exercise.muscleGroup) · \(exercise.equipment)")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                }
                .listStyle(.plain)
            }
            .searchable(text: $searchText, prompt: "Search exercises")
            .navigationTitle("Exercises")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}
