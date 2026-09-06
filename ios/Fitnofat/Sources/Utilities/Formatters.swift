import Foundation

// MARK: - Unit Formatters

/// Format weight for display, converting to lbs if the user's unit is "lb".
/// - Parameters:
///   - kg: Weight in kilograms
///   - unit: User's preferred unit ("kg" or "lb")
/// - Returns: Formatted string with unit suffix
func formatWeight(_ kg: Double, unit: String = "kg") -> String {
    if unit == "lb" {
        let lbs = kg * 2.20462
        return "\(Int(round(lbs))) lb"
    }
    return "\(Int(round(kg))) kg"
}

/// Format distance for display, converting to miles if the user's unit is "lb".
/// - Parameters:
///   - km: Distance in kilometers
///   - unit: User's preferred unit ("kg" or "lb")
/// - Returns: Formatted string with unit suffix
func formatDistance(_ km: Double, unit: String = "kg") -> String {
    if unit == "lb" {
        let miles = km / KM_PER_MILE
        return String(format: "%.2f mi", miles)
    }
    return String(format: "%.2f km", km)
}

/// Format a duration in seconds to a human-readable string.
/// - Parameter seconds: Duration in seconds
/// - Returns: Formatted string (e.g., "45 min", "1h 15min")
func formatDuration(_ seconds: Int) -> String {
    let hours = seconds / 3600
    let minutes = (seconds % 3600) / 60

    if hours > 0 {
        return minutes > 0 ? "\(hours)h \(minutes)min" : "\(hours)h"
    }
    return "\(minutes) min"
}

/// Format a date timestamp to a relative or absolute string.
/// - Parameter timestamp: Unix timestamp in seconds
/// - Returns: Formatted date string
func formatDate(timestamp: Int) -> String {
    let date = Date(timeIntervalSince1970: timestamp)
    let formatter = RelativeDateTimeFormatter()
    formatter.unitsStyle = .abbreviated
    return formatter.localizedString(for: date, relativeTo: Date())
}

/// Format date as a short readable string (e.g., "Jan 15").
/// - Parameter timestamp: Unix timestamp in seconds
/// - Returns: Short date string
func formatShortDate(timestamp: Int) -> String {
    let date = Date(timeIntervalSince1970: timestamp)
    let formatter = DateFormatter()
    formatter.dateFormat = "MMM d"
    return formatter.string(from: date)
}

/// Format a date as a full readable string (e.g., "January 15, 2025").
/// - Parameter timestamp: Unix timestamp in seconds
/// - Returns: Full date string
func formatFullDate(timestamp: Int) -> String {
    let date = Date(timeIntervalSince1970: timestamp)
    let formatter = DateFormatter()
    formatter.dateStyle = .long
    return formatter.string(from: date)
}

// MARK: - Number Formatters

/// Format a number as a percentage string.
/// - Parameter value: Decimal value (e.g., 0.15 for 15%)
/// - Returns: Formatted percentage string
func formatPercent(_ value: Double) -> String {
    let formatter = NumberFormatter()
    formatter.numberStyle = .percent
    formatter.minimumFractionDigits = 0
    formatter.maximumFractionDigits = 1
    return formatter.string(from: NSNumber(value: value)) ?? "\(Int(value * 100))%"
}

/// Format a large number with comma separators.
/// - Parameter value: The number to format
/// - Returns: Formatted string
func formatNumber(_ value: Int) -> String {
    let formatter = NumberFormatter()
    formatter.numberStyle = .decimal
    return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
}

/// Format calories as a compact string.
/// - Parameter calories: Calorie value
/// - Returns: Formatted string (e.g., "350 kcal")
func formatCalories(_ calories: Int) -> String {
    "\(calories) kcal"
}

// MARK: - Volume Formatting

/// Format total volume with appropriate unit.
/// - Parameters:
///   - kg: Volume in kg (weight × reps)
///   - unit: User's preferred unit ("kg" or "lb")
/// - Returns: Formatted string
func formatVolume(_ kg: Double, unit: String = "kg") -> String {
    if unit == "lb" {
        let lbs = kg * 2.20462
        if lbs > 1000 {
            return "\(String(format: "%.1f", lbs / 1000))k lb"
        }
        return "\(Int(round(lbs))) lb"
    }
    if kg > 1000 {
        return "\(String(format: "%.1f", kg / 1000))k kg"
    }
    return "\(Int(round(kg))) kg"
}

// MARK: - Day Label

/// Format a day label for display (e.g., "Day 1", "Push A").
/// - Parameters:
///   - label: Raw day label from the routine
///   - index: 1-based index fallback
/// - Returns: Formatted day label
func formatDayLabel(_ label: String?, index: Int) -> String {
    if let label, !label.trimmingCharacters(in: .whitespaces).isEmpty {
        return label
    }
    return "Day \(index)"
}
