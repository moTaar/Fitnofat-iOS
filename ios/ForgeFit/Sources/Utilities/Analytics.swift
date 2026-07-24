import Foundation

// MARK: - Analytics

/// Calculate current streak of consecutive workout days.
/// Counts backwards from yesterday (today is not counted as a streak day
/// because the day isn't over).
/// - Parameter workoutDates: Sorted array of unique workout dates (most recent first)
/// - Returns: Number of consecutive days with workouts
func currentStreak(workoutDates: [Date]) -> Int {
    guard !workoutDates.isEmpty else { return 0 }

    let calendar = Calendar.current
    let today = calendar.startOfDay(for: Date())
    let yesterday = calendar.date(byAdding: .day, value: -1, to: today)!

    // Find the index of the first date <= yesterday
    guard let startIdx = workoutDates.firstIndex(where: { calendar.startOfDay(for: $0) <= yesterday }) else {
        return 0
    }

    var streak = 0
    var expected = calendar.startOfDay(for: workoutDates[startIdx])

    for i in startIdx..<workoutDates.count {
        let day = calendar.startOfDay(for: workoutDates[i])
        if day == expected {
            streak += 1
            expected = calendar.date(byAdding: .day, value: -1, to: expected)!
        } else if day < expected {
            // Gap found — streak broken
            break
        }
    }

    return streak
}

// MARK: - Exercise Trends

struct ExerciseTrend {
    let name: String
    let current: WorkoutSummary
    let previous: WorkoutSummary
    let deltaPct: Double
    let stalled: Bool
}

struct WorkoutSummary {
    let totalVolume: Double
    let avgWeight: Double
    let maxWeight: Double
    let sessionCount: Int
}

/// Calculate per-exercise trends by comparing the most recent 4 weeks to the 4 weeks before that.
/// - Parameter sessions: All workout sessions, sorted by date ascending
/// - Returns: Array of exercise trends sorted by most improved
func exerciseTrends(from sessions: [WorkoutSession]) -> [ExerciseTrend] {
    let sorted = sessions.sorted { $0.startedAt < $1.startedAt }
    guard sorted.count >= 2 else { return [] }

    let now = Date().timeIntervalSince1970
    let fourWeeksAgo = now - 28 * 86400
    let eightWeeksAgo = now - 56 * 86400

    let currentPeriod = sorted.filter { $0.startedAt >= fourWeeksAgo && $0.startedAt <= now }
    let previousPeriod = sorted.filter { $0.startedAt >= eightWeeksAgo && $0.startedAt < fourWeeksAgo }

    guard !currentPeriod.isEmpty, !previousPeriod.isEmpty else { return [] }

    // Group exercises by name across both periods
    let currentExercises = currentPeriod.flatMap(\.exercises)
    let previousExercises = previousPeriod.flatMap(\.exercises)

    let currentNames = Set(currentExercises.map(\.name))
    let previousNames = Set(previousExercises.map(\.name))
    let commonNames = currentNames.intersection(previousNames)

    var trends: [ExerciseTrend] = []

    for name in commonNames {
        let cur = currentExercises.filter { $0.name == name }
        let prev = previousExercises.filter { $0.name == name }

        let curVolume = cur.reduce(0.0) { total, ex in
            total + ex.sets.reduce(0.0) { $0 + $1.weight * Double($1.reps) }
        }
        let prevVolume = prev.reduce(0.0) { total, ex in
            total + ex.sets.reduce(0.0) { $0 + $1.weight * Double($1.reps) }
        }

        let curWeights = cur.flatMap(\.sets).map(\.weight).filter { $0 > 0 }
        let prevWeights = prev.flatMap(\.sets).map(\.weight).filter { $0 > 0 }

        let curAvgWeight = curWeights.isEmpty ? 0 : curWeights.reduce(0, +) / Double(curWeights.count)
        let prevAvgWeight = prevWeights.isEmpty ? 0 : prevWeights.reduce(0, +) / Double(prevWeights.count)
        let curMaxWeight = curWeights.max() ?? 0
        let prevMaxWeight = prevWeights.max() ?? 0

        let curCount = cur.count
        let prevCount = prev.count

        let deltaPct: Double = prevVolume > 0 ? ((curVolume - prevVolume) / prevVolume) * 100 : 0
        let stalled = abs(deltaPct) < 5.0

        trends.append(ExerciseTrend(
            name: name,
            current: WorkoutSummary(totalVolume: curVolume, avgWeight: curAvgWeight, maxWeight: curMaxWeight, sessionCount: curCount),
            previous: WorkoutSummary(totalVolume: prevVolume, avgWeight: prevAvgWeight, maxWeight: prevMaxWeight, sessionCount: prevCount),
            deltaPct: deltaPct,
            stalled: stalled
        ))
    }

    return trends.sorted { abs($1.deltaPct) < abs($0.deltaPct) }
}

// MARK: - 1RM Estimation

/// Estimate 1-rep max using the Epley formula.
/// Formula: 1RM = weight × (1 + reps / 30)
/// - Parameters:
///   - weight: Weight lifted
///   - reps: Repetitions performed
/// - Returns: Estimated 1RM (rounded to nearest 0.5)
func estimateOneRM(weight: Double, reps: Int) -> Double {
    guard reps > 0, weight > 0 else { return 0 }
    guard reps > 1 else { return weight }
    let estimated = weight * (1.0 + Double(reps) / 30.0)
    return round(estimated * 2) / 2
}

// MARK: - Personal Records

struct PersonalRecord {
    let exerciseName: String
    let weight: Double
    let reps: Int
    let estimatedOneRM: Double
    let date: Date
}

/// Find personal records from workout history.
/// - Parameter sessions: All workout sessions
/// - Returns: Dictionary mapping exercise name to its best estimated 1RM record
func personalRecords(from sessions: [WorkoutSession]) -> [String: PersonalRecord] {
    var records: [String: PersonalRecord] = [:]

    for session in sessions {
        let date = Date(timeIntervalSince1970: session.startedAt)
        for exercise in session.exercises {
            let name = exercise.name
            var best: (weight: Double, reps: Int, estimated: Double) = (0, 0, 0)

            for set in exercise.sets {
                guard set.weight > 0, set.reps > 0 else { continue }
                let est = estimateOneRM(weight: set.weight, reps: set.reps)
                if est > best.estimated {
                    best = (set.weight, set.reps, est)
                }
            }

            if best.estimated > 0 {
                if let existing = records[name], existing.estimatedOneRM >= best.estimated {
                    continue
                }
                records[name] = PersonalRecord(
                    exerciseName: name,
                    weight: best.weight,
                    reps: best.reps,
                    estimatedOneRM: best.estimated,
                    date: date
                )
            }
        }
    }

    return records
}

// MARK: - Weekly Volume

struct WeeklyVolume {
    let weekStart: Date
    let totalVolume: Double
    let sessionCount: Int
}

/// Calculate weekly training volume.
/// - Parameters:
///   - sessions: Workout sessions
///   - weeks: Number of weeks to look back
/// - Returns: Array of weekly volume summaries
func weeklyVolumes(from sessions: [WorkoutSession], weeks: Int = 12) -> [WeeklyVolume] {
    let calendar = Calendar.current
    let now = Date()

    var volumes: [WeeklyVolume] = []

    for weekOffset in 0..<weeks {
        guard let weekStart = calendar.date(from: calendar.dateComponents([.yearForWeekOfYear, .weekOfYear],
            from: calendar.date(byAdding: .day, value: -weekOffset * 7, to: now)!)) else { continue }

        let weekEnd = calendar.date(byAdding: .day, value: 7, to: weekStart)!.timeIntervalSince1970
        let weekStartTS = weekStart.timeIntervalSince1970

        let weekSessions = sessions.filter { $0.startedAt >= weekStartTS && $0.startedAt < weekEnd }
        let volume = weekSessions.reduce(0.0) { total, s in
            total + s.totalVolume
        }

        volumes.append(WeeklyVolume(weekStart: weekStart, totalVolume: volume, sessionCount: weekSessions.count))
    }

    return volumes.reversed()
}
