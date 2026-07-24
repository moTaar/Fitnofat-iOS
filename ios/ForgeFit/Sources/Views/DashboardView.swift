import SwiftUI

// MARK: - Dashboard View

struct DashboardView: View {
    @StateObject private var appStore = AppStore.shared
    @StateObject private var workoutStore = WorkoutStore.shared

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    // Active workout banner
                    if workoutStore.activeWorkout != nil {
                        activeWorkoutBanner
                    }

                    // Quick Stats
                    quickStatsSection

                    // Today's Plan / Recent Workouts
                    todaySection

                    // Weekly overview
                    weeklyOverviewSection
                }
                .padding()
            }
            .navigationTitle("Dashboard")
            .refreshable { await appStore.load() }
        }
    }

    // MARK: - Active Workout Banner

    private var activeWorkoutBanner: some View {
        NavigationLink(destination: ActiveWorkoutView()) {
            HStack {
                Image(systemName: "figure.run")
                    .font(.title2)
                VStack(alignment: .leading) {
                    Text("Active Workout")
                        .font(.headline)
                    if let active = workoutStore.activeWorkout {
                        Text(active.routineName)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding()
            .background(LinearGradient(colors: [.green, .mint], startPoint: .leading, endPoint: .trailing))
            .foregroundColor(.white)
            .cornerRadius(12)
        }
    }

    // MARK: - Quick Stats

    private var quickStatsSection: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            StatCard(
                icon: "flame.fill",
                label: "This Week",
                value: "\(weeklyWorkoutCount) workouts",
                color: .orange
            )
            StatCard(
                icon: "bolt.fill",
                label: "Streak",
                value: "\(streak) days",
                color: .purple
            )
            StatCard(
                icon: "dumbbell.fill",
                label: "Total Volume",
                value: formatTotalVolume(),
                color: .blue
            )
            StatCard(
                icon: "clock.fill",
                label: "This Week",
                value: weeklyDuration,
                color: .green
            )
        }
    }

    private var weeklyWorkoutCount: Int {
        let weekAgo = Date().timeIntervalSince1970 - 7 * 86400
        return workoutStore.workoutSessions.filter { $0.startedAt >= weekAgo }.count
    }

    private var streak: Int {
        let dates = workoutStore.workoutSessions
            .map { Date(timeIntervalSince1970: $0.startedAt) }
            .sorted(by: >)
        // Deduplicate dates
        let unique = Set(Calendar.current.startOfDay(for:))
        let  uniqueDates = Array(unique).sorted(by: >)
        return currentStreak(workoutDates: uniqueDates)
    }

    private func formatTotalVolume() -> String {
        let weekAgo = Date().timeIntervalSince1970 - 7 * 86400
        let volume = workoutStore.workoutSessions
            .filter { $0.startedAt >= weekAgo }
            .reduce(0) { $0 + $1.totalVolume }
        return formatVolume(volume)
    }

    private var weeklyDuration: String {
        let weekAgo = Date().timeIntervalSince1970 - 7 * 86400
        let totalSecs = workoutStore.workoutSessions
            .filter { $0.startedAt >= weekAgo }
            .reduce(0) { $0 + $1.durationSec }
        return formatDuration(totalSecs)
    }

    // MARK: - Today Section

    private var todaySection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Today")
                .font(.title2)
                .bold()

            if let todayRoutine = todayRoutine {
                NavigationLink(destination: WorkoutSessionView(routine: todayRoutine)) {
                    RoutineCard(routine: todayRoutine)
                }
            } else {
                VStack(spacing: 12) {
                    Text("No workout scheduled today")
                        .foregroundColor(.secondary)

                    NavigationLink(destination: ProgramView()) {
                        Label("View Program", systemImage: "list.bullet")
                    }
                    .buttonStyle(.bordered)
                }
                .frame(maxWidth: .infinity)
                .padding()
                .background(Color(.systemGray6))
                .cornerRadius(12)
            }
        }
    }

    private var todayRoutine: Routine? {
        let calendar = Calendar.current
        let today = calendar.shortWeekdaySymbols[calendar.component(.weekday, from: Date()) - 1]
        return workoutStore.activeWorkout != nil
            ? nil
            : AppStore.shared.program.routines.first { $0.dayLabel?.lowercased().contains(today.lowercased()) == true }
    }

    // MARK: - Weekly Overview

    private var weeklyOverviewSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("This Week")
                .font(.title2)
                .bold()

            let volumes = weeklyVolumes(from: workoutStore.workoutSessions, weeks: 1)
            if !volumes.isEmpty {
                let volume = volumes.last!
                HStack {
                    VStack(alignment: .leading) {
                        Text("\(volume.sessionCount) sessions")
                            .font(.headline)
                        Text("\(formatVolume(volume.totalVolume)) total volume")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    Spacer()
                }
                .padding()
                .background(Color(.systemGray6))
                .cornerRadius(12)
            }
        }
    }
}

// MARK: - Stat Card

struct StatCard: View {
    let icon: String
    let label: String
    let value: String
    let color: Color

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundColor(color)
            Text(value)
                .font(.headline)
            Text(label)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }
}

// MARK: - Routine Card

struct RoutineCard: View {
    let routine: Routine

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(routine.name)
                    .font(.headline)
                    .foregroundColor(.primary)
                if let desc = routine.description {
                    Text(desc)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                Text("\(routine.exercises.count) exercises")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }
}
