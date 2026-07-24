import SwiftUI

// MARK: - Program View

struct ProgramView: View {
    @StateObject private var programStore = ProgramStore.shared
    @StateObject private var profileStore = ProfileStore.shared
    @State private var showingGenerate = false
    @State private var showingRefresh = false
    @State private var isLoading = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Group {
                if let program = programStore.program {
                    programContent(program: program)
                } else {
                    emptyState
                }
            }
            .navigationTitle("Program")
            .toolbar { toolbarContent }
            .alert("Error", isPresented: .constant(error != nil)) {
                Button("OK") { error = nil }
            } message: {
                Text(error ?? "")
            }
            .confirmationDialog("Generate Program", isPresented: $showingGenerate) {
                Button("Generate from Profile") {
                    Task { await generateProgram() }
                }
                Button("Refresh Current") {
                    Task { await refreshProgram() }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Create a new program or refresh your current one?")
            }
        }
    }

    // MARK: - Program Content

    private func programContent(program: Program) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Program header
                VStack(alignment: .leading, spacing: 8) {
                    Text(program.name)
                        .font(.title)
                        .bold()
                    Text(program.summary)
                        .font(.body)
                        .foregroundColor(.secondary)
                    HStack {
                        Label("\(program.weeks) weeks", systemImage: "calendar")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        Label(program.goal.replacingOccurrences(of: "_", with: " ").capitalized,
                              systemImage: "target")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
                .padding(.horizontal)

                // Routines
                ForEach(Array(programStore.routines.enumerated()), id: \.element.id) { index, routine in
                    NavigationLink(destination: WorkoutSessionView(routine: routine)) {
                        RoutineCard(routine: routine)
                            .overlay(alignment: .topTrailing) {
                                if routine.favorite {
                                    Image(systemName: "star.fill")
                                        .foregroundColor(.yellow)
                                        .padding(8)
                                }
                            }
                    }
                }
                .padding(.horizontal)
            }
            .padding(.vertical)
        }
        .refreshable { await programStore.loadCached() }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "list.clipboard")
                .font(.system(size: 60))
                .foregroundColor(.secondary)
            Text("No Program Yet")
                .font(.title2)
                .bold()
            Text("Generate a personalized training program based on your goals, equipment, and experience level.")
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            if profileStore.profile.onboarded {
                Button(action: { showingGenerate = true }) {
                    Label("Generate Program", systemImage: "sparkles")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                }
                .buttonStyle(.borderedProminent)
                .padding(.horizontal)
            } else {
                NavigationLink(destination: OnboardingView()) {
                    Label("Complete Profile", systemImage: "person.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                }
                .buttonStyle(.borderedProminent)
                .padding(.horizontal)

                Text("Complete your profile first so we can tailor a program for you.")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding()
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            if isLoading {
                ProgressView()
            } else {
                Menu {
                    Button(action: { showingGenerate = true }) {
                        Label("Generate New", systemImage: "sparkles")
                    }
                    if programStore.program != nil {
                        Button(action: { showingRefresh = true }) {
                            Label("Refresh", systemImage: "arrow.clockwise")
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
    }

    // MARK: - Actions

    private func generateProgram() async {
        isLoading = true
        do {
            try await programStore.generate(profile: profileStore.profile)
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    private func refreshProgram() async {
        isLoading = true
        do {
            try await programStore.refresh()
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}

// MARK: - Workout Session View

struct WorkoutSessionView: View {
    let routine: Routine
    @StateObject private var workoutStore = WorkoutStore.shared

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Routine header
                VStack(alignment: .leading, spacing: 4) {
                    Text(routine.name)
                        .font(.title2)
                        .bold()
                    if let desc = routine.description {
                        Text(desc)
                            .font(.body)
                            .foregroundColor(.secondary)
                    }
                    Text("\(routine.exercises.count) exercises")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding(.horizontal)

                // Start button
                Button(action: startWorkout) {
                    Label("Start Workout", systemImage: "play.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)
                .padding(.horizontal)

                // Exercise list
                ForEach(routine.exercises) { exercise in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(exercise.name)
                                    .font(.headline)
                                Text("\(exercise.muscleGroup) · \(exercise.sets.count) sets")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                            Spacer()
                            if exercise.sets.contains(where: { $0.targetWeight ?? 0 > 0 }) {
                                Text(formatWeight(exercise.sets.first?.targetWeight ?? 0))
                                    .font(.subheadline)
                                    .foregroundColor(.secondary)
                            }
                        }

                        // Planned sets summary
                        ForEach(Array(exercise.sets.enumerated()), id: \.offset) { idx, set in
                            HStack {
                                Text("Set \(idx + 1):")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                if let weight = set.targetWeight, weight > 0 {
                                    Text(formatWeight(weight))
                                        .font(.caption)
                                }
                                Text("\(set.targetReps) reps")
                                    .font(.caption)
                                if let rpe = set.rpe {
                                    Text("@\(String(format: "%.1f", rpe))")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                                Spacer()
                            }
                            .padding(.leading)
                        }

                        if let notes = exercise.notes {
                            Text(notes)
                                .font(.caption)
                                .foregroundColor(.secondary)
                                .italic()
                        }
                    }
                    .padding()
                    .background(Color(.systemGray6))
                    .cornerRadius(12)
                    .padding(.horizontal)
                }
            }
            .padding(.vertical)
        }
        .navigationTitle(routine.name)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func startWorkout() {
        workoutStore.startWorkout(routine: routine)
    }
}
