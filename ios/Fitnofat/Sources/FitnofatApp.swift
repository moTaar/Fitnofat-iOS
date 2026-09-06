import SwiftUI

// MARK: - App Entry Point

@main
struct ForgeFitApp: App {
    @StateObject private var appStore = AppStore.shared
    @StateObject private var authService = AuthService.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(appStore)
                .environmentObject(authService)
        }
    }
}

// MARK: - Content View (Root Router)

struct ContentView: View {
    @EnvironmentObject var appStore: AppStore
    @EnvironmentObject var authService: AuthService
    @State private var isLoading = true

    var body: some View {
        Group {
            if isLoading {
                loadingView
            } else if authService.session == nil {
                AuthView()
            } else {
                mainTabView
            }
        }
        .onAppear { bootstrap() }
    }

    private var loadingView: some View {
        VStack(spacing: 16) {
            Image(systemName: "dumbbell.fill")
                .font(.system(size: 60))
                .foregroundColor(.blue)
            ProgressView()
                .padding(.top)
        }
    }

    private var mainTabView: some View {
        TabView {
            DashboardView()
                .tabItem {
                    Label("Home", systemImage: "house.fill")
                }

            ProgramView()
                .tabItem {
                    Label("Program", systemImage: "list.clipboard.fill")
                }

            AICoachView()
                .tabItem {
                    Label("Coach", systemImage: "brain.head.profile")
                }

            NutritionView()
                .tabItem {
                    Label("Nutrition", systemImage: "fork.knife")
                }

            moreTab
                .tabItem {
                    Label("More", systemImage: "ellipsis.circle")
                }
        }
        .tint(.blue)
    }

    private var moreTab: some View {
        NavigationStack {
            List {
                NavigationLink(destination: HistoryView()) {
                    Label("History", systemImage: "clock.arrow.circlepath")
                }
                NavigationLink(destination: AnalyticsView()) {
                    Label("Analytics", systemImage: "chart.bar.fill")
                }
                NavigationLink(destination: ExerciseLibraryView()) {
                    Label("Exercises", systemImage: "dumbbell.fill")
                }
                NavigationLink(destination: SettingsView()) {
                    Label("Settings", systemImage: "gearshape.fill")
                }
                NavigationLink(destination: BillingView()) {
                    Label("Billing", systemImage: "crown.fill")
                }
            }
            .navigationTitle("More")
        }
    }

    private func bootstrap() {
        Task {
            do {
                try await appStore.load()
            } catch {
                print("[App] Bootstrap error: \(error)")
            }
            isLoading = false
        }
    }
}

// MARK: - Exercise Library View

struct ExerciseLibraryView: View {
    @StateObject private var exerciseStore = ExerciseStore.shared
    @State private var searchText = ""
    @State private var selectedMuscleGroup: MuscleGroup?
    @State private var selectedExercise: Exercise?

    var body: some View {
        NavigationStack {
            List {
                // Muscle group filter
                Section {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            Button(action: { selectedMuscleGroup = nil }) {
                                Text("All")
                                    .font(.subheadline)
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 6)
                                    .background(selectedMuscleGroup == nil ? Color.blue : Color(.systemGray5))
                                    .foregroundColor(selectedMuscleGroup == nil ? .white : .primary)
                                    .cornerRadius(16)
                            }

                            ForEach(MuscleGroup.allCases, id: \.self) { group in
                                Button(action: { selectedMuscleGroup = group }) {
                                    Text(group.rawValue.replacingOccurrences(of: "_", with: " ").capitalized)
                                        .font(.subheadline)
                                        .padding(.horizontal, 12)
                                        .padding(.vertical, 6)
                                        .background(selectedMuscleGroup == group ? Color.blue : Color(.systemGray5))
                                        .foregroundColor(selectedMuscleGroup == group ? .white : .primary)
                                        .cornerRadius(16)
                                }
                            }
                        }
                        .padding(.horizontal, 4)
                    }
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                }

                // Exercise list
                ForEach(filteredExercises) { exercise in
                    NavigationLink(destination: ExerciseDetailView(exercise: exercise)) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(exercise.name)
                                .font(.headline)
                            HStack {
                                Text(exercise.muscleGroup.replacingOccurrences(of: "_", with: " ").capitalized)
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                if let equip = exercise.equipment {
                                    Text(equip.replacingOccurrences(of: "_", with: " ").capitalized)
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Exercises")
            .searchable(text: $searchText, prompt: "Search exercises...")
        }
        .onAppear { exerciseStore.loadCached() }
    }

    private var filteredExercises: [Exercise] {
        var exercises = exerciseStore.exercises

        if let muscleGroup = selectedMuscleGroup {
            exercises = exercises.filter { $0.muscleGroup == muscleGroup.rawValue }
        }

        if !searchText.isEmpty {
            exercises = exercises.filter { $0.name.localizedCaseInsensitiveContains(searchText) }
        }

        return exercises.sorted { $0.name < $1.name }
    }
}
