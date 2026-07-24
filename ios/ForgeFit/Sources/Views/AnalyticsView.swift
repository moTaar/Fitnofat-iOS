import SwiftUI

// MARK: - Analytics View

struct AnalyticsView: View {
    @StateObject private var workoutStore = WorkoutStore.shared

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    // Streak card
                    streakCard

                    // Weekly volume chart
                    weeklyVolumeCard

                    // Personal records
                    if !records.isEmpty {
                        personalRecordsCard
                    }

                    // Exercise trends
                    if !trends.isEmpty {
                        trendsCard
                    }
                }
                .padding()
            }
            .navigationTitle("Analytics")
        }
    }

    // MARK: - Streak Card

    private var streakCard: some View {
        VStack(spacing: 8) {
            HStack {
                Image(systemName: "flame.fill")
                    .font(.title)
                    .foregroundColor(.orange)
                Text("\(currentStreak) day streak")
                    .font(.title2)
                    .bold()
            }
            Text("Keep it going!")
                .font(.subheadline)
                .foregroundColor(.secondary)

            // Mini streak dots
            HStack(spacing: 6) {
                ForEach(0..<min(currentStreak, 14), id: \.self) { _ in
                    Circle()
                        .fill(Color.orange)
                        .frame(width: 8, height: 8)
                }
            }
        }
        .padding()
        .frame(maxWidth: .infinity)
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }

    private var currentStreak: Int {
        streak(from: workoutStore.workoutSessions.map { Date(timeIntervalSince1970: $0.startedAt) })
    }

    private func streak(from dates: [Date]) -> Int {
        let sorted = Array(Set(dates.map { Calendar.current.startOfDay(for: $0) })).sorted(by: >)
        guard !sorted.isEmpty else { return 0 }

        var count = 0
        let calendar = Calendar.current
        let yesterday = calendar.startOfDay(for: Date().addingTimeInterval(-86400))

        for i in 0..<sorted.count {
            let expected = calendar.date(byAdding: .day, value: -i, to: yesterday)!
            if calendar.isDate(sorted[i], inSameDayAs: expected) {
                count += 1
            } else {
                break
            }
        }
        return count
    }

    // MARK: - Weekly Volume

    private var weeklyVolumeCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Weekly Volume")
                .font(.headline)

            let volumes = weeklyVolumes(from: workoutStore.workoutSessions, weeks: 4)
            if volumes.isEmpty {
                Text("No data yet")
                    .foregroundColor(.secondary)
            } else {
                ForEach(volumes.reversed()) { week in
                    HStack {
                        Text(formatShortDate(timestamp: week.weekStart.timeIntervalSince1970))
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .frame(width: 60, alignment: .leading)
                        GeometryReader { geo in
                            let maxVol = volumes.map(\.totalVolume).max() ?? 1
                            RoundedRectangle(cornerRadius: 4)
                                .fill(Color.blue)
                                .frame(width: max(4, geo.size.width * CGFloat(week.totalVolume / maxVol)),
                                       height: 16)
                        }
                        .frame(height: 16)
                        Text(formatVolume(week.totalVolume))
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .frame(width: 60, alignment: .trailing)
                    }
                }
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }

    // MARK: - Personal Records

    private var records: [PersonalRecord] {
        personalRecords(from: workoutStore.workoutSessions)
            .sorted { $0.estimatedOneRM > $1.estimatedOneRM }
    }

    private var personalRecordsCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Personal Records")
                .font(.headline)

            ForEach(records) { record in
                HStack {
                    Text(record.exerciseName)
                        .font(.subheadline)
                    Spacer()
                    Text(formatWeight(record.estimatedOneRM))
                        .font(.subheadline)
                        .bold()
                    Text("e1RM")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    if let date = record.date {
                        Text(formatShortDate(timestamp: date.timeIntervalSince1970))
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }

    // MARK: - Exercise Trends

    private var trends: [ExerciseTrend] {
        exerciseTrends(from: workoutStore.workoutSessions)
            .filter { $0.stalled || abs($0.deltaPct) > 5 }
            .sorted { abs($0.deltaPct) > abs($1.deltaPct) }
    }

    private var trendsCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Exercise Trends")
                .font(.headline)

            ForEach(trends) { trend in
                HStack {
                    VStack(alignment: .leading) {
                        Text(trend.exerciseName)
                            .font(.subheadline)
                            .bold()
                        Text("\(trend.current.sessionCount) sessions → \(trend.previous.sessionCount) sessions")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    Spacer()
                    if trend.stalled {
                        Label("Stalled", systemImage: "exclamationmark.triangle")
                            .font(.caption)
                            .foregroundColor(.orange)
                    } else {
                        Text(formatPercent(trend.deltaPct / 100))
                            .font(.subheadline)
                            .foregroundColor(trend.deltaPct >= 0 ? .green : .red)
                    }
                }
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }
}
