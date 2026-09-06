import SwiftUI

// MARK: - History View

struct HistoryView: View {
    @StateObject private var workoutStore = WorkoutStore.shared

    var body: some View {
        NavigationStack {
            Group {
                if workoutStore.workoutSessions.isEmpty {
                    emptyState
                } else {
                    historyList
                }
            }
            .navigationTitle("History")
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "clock.arrow.circlepath")
                .font(.system(size: 60))
                .foregroundColor(.secondary)
            Text("No Workouts Yet")
                .font(.title2)
                .bold()
            Text("Complete your first workout to see it here.")
                .foregroundColor(.secondary)
        }
        .padding()
    }

    // MARK: - History List

    private var historyList: some View {
        List {
            // Summary stats
            Section {
                HStack {
                    StatCard(icon: "flame.fill", label: "Total", value: "\(workoutStore.workoutSessions.count)", color: .orange)
                    StatCard(icon: "dumbbell.fill", label: "This Month", value: monthCount, color: .blue)
                }
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
            }

            // Sessions by month
            ForEach(groupedSessions.keys.sorted(by: >), id: \.self) { month in
                Section(month) {
                    ForEach(groupedSessions[month]!, id: \.id) { session in
                        NavigationLink(destination: WorkoutDetailView(session: session)) {
                            sessionRow(session)
                        }
                    }
                    .onDelete { offsets in
                        Task {
                            for idx in offsets {
                                let session = groupedSessions[month]![idx]
                                try? await workoutStore.deleteWorkout(id: session.id)
                            }
                        }
                    }
                }
            }
        }
    }

    private var monthCount: String {
        let monthAgo = Date().timeIntervalSince1970 - 30 * 86400
        let count = workoutStore.workoutSessions.filter { $0.startedAt >= monthAgo }.count
        return "\(count)"
    }

    private var groupedSessions: [String: [WorkoutSession]] {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMMM yyyy"
        var grouped: [String: [WorkoutSession]] = [:]
        for session in workoutStore.workoutSessions.sorted(by: { $0.startedAt > $1.startedAt }) {
            let month = formatter.string(from: Date(timeIntervalSince1970: session.startedAt))
            grouped[month, default: []].append(session)
        }
        return grouped
    }

    // MARK: - Session Row

    private func sessionRow(_ session: WorkoutSession) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(session.routineName)
                    .font(.headline)
                Text(formatDate(timestamp: session.startedAt))
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text(formatDuration(session.durationSec))
                    .font(.subheadline)
                Text(formatVolume(session.totalVolume))
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Workout Detail View

struct WorkoutDetailView: View {
    let session: WorkoutSession

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Header
                VStack(alignment: .leading, spacing: 4) {
                    Text(session.routineName)
                        .font(.title2)
                        .bold()
                    HStack {
                        Label(formatFullDate(timestamp: session.startedAt), systemImage: "calendar")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        Label(formatDuration(session.durationSec), systemImage: "clock")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    Label(formatVolume(session.totalVolume) + " total volume", systemImage: "dumbbell.fill")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    if let cals = session.calories {
                        Label("\(cals) kcal", systemImage: "flame.fill")
                            .font(.caption)
                            .foregroundColor(.orange)
                    }
                }
                .padding(.horizontal)

                // Exercises
                ForEach(session.exercises) { exercise in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(exercise.name)
                            .font(.headline)

                        ForEach(Array(exercise.sets.enumerated()), id: \.offset) { idx, set in
                            HStack {
                                Text("Set \(idx + 1)")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                    .frame(width: 40, alignment: .leading)

                                if set.weight > 0 {
                                    Text(formatWeight(set.weight))
                                        .font(.subheadline)
                                }

                                if set.reps > 0 {
                                    Text("\(set.reps) reps")
                                        .font(.subheadline)
                                }

                                if let dur = set.durationSec {
                                    Text(formatDuration(dur))
                                        .font(.subheadline)
                                }

                                if let dist = set.distanceKm {
                                    Text(formatDistance(dist))
                                        .font(.subheadline)
                                }

                                if let rpe = set.rpe {
                                    Text("@\(String(format: "%.1f", rpe))")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }

                                if set.completed {
                                    Image(systemName: "checkmark")
                                        .foregroundColor(.green)
                                        .font(.caption)
                                }

                                Spacer()
                            }
                        }
                    }
                    .padding()
                    .background(Color(.systemGray6))
                    .cornerRadius(12)
                    .padding(.horizontal)
                }

                if let notes = session.notes {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Notes")
                            .font(.headline)
                        Text(notes)
                            .font(.body)
                            .foregroundColor(.secondary)
                    }
                    .padding(.horizontal)
                }
            }
            .padding(.vertical)
        }
        .navigationTitle(session.routineName)
        .navigationBarTitleDisplayMode(.inline)
    }
}
