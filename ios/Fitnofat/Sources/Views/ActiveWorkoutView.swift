import SwiftUI

// MARK: - Active Workout View

struct ActiveWorkoutView: View {
    @StateObject private var workoutStore = WorkoutStore.shared
    @StateObject private var restTimer = RestTimerManager()
    @State private var showingFinishConfirm = false
    @State private var showingDiscardConfirm = false
    @State private var showingExercisePicker = false
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Group {
            if let active = workoutStore.activeWorkout {
                workoutContent(active: active)
            } else {
                noActiveWorkout
            }
        }
        .navigationTitle("Workout")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            toolbarButtons
        }
        .alert("Finish Workout?", isPresented: $showingFinishConfirm) {
            Button("Finish") { finishWorkout() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Save this workout to your history?")
        }
        .alert("Discard Workout?", isPresented: $showingDiscardConfirm) {
            Button("Discard", role: .destructive) { discardWorkout() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This workout will be permanently lost.")
        }
        .sheet(isPresented: $showingExercisePicker) {
            ExercisePickerView { exercise in
                addExercise(exercise)
            }
        }
    }

    // MARK: - Workout Content

    private func workoutContent(active: ActiveWorkout) -> some View {
        ScrollView {
            VStack(spacing: 16) {
                // Header info
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(active.routineName)
                            .font(.title2)
                            .bold()
                        Text("Started \(formatDate(timestamp: active.startedAt))")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        Text("Elapsed: \(elapsedString(from: active.startedAt))")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    Spacer()
                }
                .padding(.horizontal)

                // Rest Timer
                RestTimerView(timerManager: restTimer)
                    .padding(.horizontal)

                // Exercises
                ForEach(Array(active.exercises.enumerated()), id: \.element.id) { index, exercise in
                    exerciseCard(exercise: exercise, at: index)
                }

                // Add exercise button
                Button(action: { showingExercisePicker = true }) {
                    Label("Add Exercise", systemImage: "plus.circle")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                }
                .buttonStyle(.bordered)
                .padding(.horizontal)
            }
            .padding(.vertical)
        }
    }

    private var noActiveWorkout: some View {
        VStack(spacing: 16) {
            Image(systemName: "dumbbell")
                .font(.system(size: 60))
                .foregroundColor(.secondary)
            Text("No Active Workout")
                .font(.title2)
                .bold()
            Text("Start a workout from your program or create a free-form session.")
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
    }

    // MARK: - Exercise Card

    private func exerciseCard(exercise loggedEx: LoggedExercise, at index: Int) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                VStack(alignment: .leading) {
                    Text(loggedEx.name)
                        .font(.headline)
                    Text(loggedEx.muscleGroup)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                Spacer()
                Button(action: { removeExercise(at: index) }) {
                    Image(systemName: "trash")
                        .foregroundColor(.red)
                        .font(.caption)
                }
            }

            // Sets
            ForEach(Array(loggedEx.sets.enumerated()), id: \.offset) { setIdx in
                SetRowView(
                    set: bindingForSet(exerciseIndex: index, setIndex: setIdx),
                    index: setIdx,
                    exerciseKind: loggedEx.kind
                )
            }

            // Add set button
            Button(action: { addSet(to: index) }) {
                Label("Add Set", systemImage: "plus")
                    .font(.caption)
            }

            // Start rest timer
            if !loggedEx.sets.isEmpty && loggedEx.sets.last?.completed == true {
                Button(action: { restTimer.start(seconds: loggedEx.restSeconds) }) {
                    Label("Rest \(loggedEx.restSeconds)s", systemImage: "timer")
                        .font(.caption)
                }
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
        .padding(.horizontal)
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbarButtons: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            Button("Finish") { showingFinishConfirm = true }
                .disabled(workoutStore.activeWorkout == nil)
        }
        ToolbarItem(placement: .cancellationAction) {
            Button("Discard") { showingDiscardConfirm = true }
                .disabled(workoutStore.activeWorkout == nil)
        }
    }

    // MARK: - Actions

    private func addExercise(_ exercise: Exercise) {
        guard workoutStore.activeWorkout != nil else { return }
        let newEx = LoggedExercise(
            exerciseId: exercise.id,
            name: exercise.name,
            muscleGroup: exercise.muscleGroup,
            restSeconds: 90,
            kind: exercise.muscleGroup == "Cardio" ? .cardio : .strength,
            sets: [LoggedSet(weight: 0, reps: 0, completed: false)]
        )
        workoutStore.activeWorkout?.exercises.append(newEx)
    }

    private func removeExercise(at index: Int) {
        guard workoutStore.activeWorkout != nil, index < workoutStore.activeWorkout!.exercises.count else { return }
        workoutStore.activeWorkout?.exercises.remove(at: index)
    }

    private func addSet(to exerciseIndex: Int) {
        guard workoutStore.activeWorkout != nil,
              exerciseIndex < workoutStore.activeWorkout!.exercises.count else { return }
        workoutStore.activeWorkout?.exercises[exerciseIndex].sets.append(
            LoggedSet(weight: 0, reps: 0, completed: false)
        )
    }

    private func bindingForSet(exerciseIndex: Int, setIndex: Int) -> Binding<LoggedSet> {
        Binding {
            guard let active = workoutStore.activeWorkout,
                  exerciseIndex < active.exercises.count,
                  setIndex < active.exercises[exerciseIndex].sets.count else {
                return LoggedSet()
            }
            return active.exercises[exerciseIndex].sets[setIndex]
        } set: { newValue in
            workoutStore.activeWorkout?.exercises[exerciseIndex].sets[setIndex] = newValue
        }
    }

    private func finishWorkout() {
        if let session = workoutStore.finishWorkout() {
            Task {
                do {
                    try await workoutStore.saveWorkouts([session])
                } catch {
                    self.error = error.localizedDescription
                }
            }
        }
        dismiss()
    }

    private func discardWorkout() {
        workoutStore.discardWorkout()
        dismiss()
    }

    private func elapsedString(from timestamp: Int) -> String {
        let elapsed = Int(Date().timeIntervalSince1970) - timestamp
        return formatDuration(elapsed)
    }
}
