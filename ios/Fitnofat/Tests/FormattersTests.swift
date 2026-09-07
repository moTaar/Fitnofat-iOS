import XCTest
@testable import Fitnofat

final class FormattersTests: XCTestCase {

    // MARK: - formatWeight

    func testFormatWeightKg() {
        XCTAssertEqual(formatWeight(0), "0 kg")
        XCTAssertEqual(formatWeight(50), "50 kg")
        XCTAssertEqual(formatWeight(100.7), "101 kg")
    }

    func testFormatWeightLb() {
        XCTAssertEqual(formatWeight(0, unit: "lb"), "0 lb")
        XCTAssertEqual(formatWeight(50, unit: "lb"), "110 lb")
        XCTAssertEqual(formatWeight(100, unit: "lb"), "220 lb")
    }

    // MARK: - formatDistance

    func testFormatDistanceKm() {
        XCTAssertEqual(formatDistance(0), "0.00 km")
        XCTAssertEqual(formatDistance(5), "5.00 km")
        XCTAssertEqual(formatDistance(10.5), "10.50 km")
    }

    func testFormatDistanceMiles() {
        XCTAssertEqual(formatDistance(0, unit: "lb"), "0.00 mi")
        XCTAssertEqual(formatDistance(1.609344, unit: "lb"), "1.00 mi")
        XCTAssertEqual(formatDistance(5, unit: "lb"), "3.11 mi")
    }

    // MARK: - formatDuration

    func testFormatDurationSecondsOnly() {
        XCTAssertEqual(formatDuration(0), "0 min")
        XCTAssertEqual(formatDuration(30), "0 min")
        XCTAssertEqual(formatDuration(45), "0 min")
    }

    func testFormatDurationMinutesOnly() {
        XCTAssertEqual(formatDuration(120), "2 min")
        XCTAssertEqual(formatDuration(3540), "59 min")
    }

    func testFormatDurationHoursOnly() {
        XCTAssertEqual(formatDuration(3600), "1h")
        XCTAssertEqual(formatDuration(7200), "2h")
    }

    func testFormatDurationHoursAndMinutes() {
        XCTAssertEqual(formatDuration(3660), "1h 1min")
        XCTAssertEqual(formatDuration(7500), "2h 5min")
    }

    // MARK: - formatPercent

    func testFormatPercent() {
        XCTAssertEqual(formatPercent(0), "0%")
        XCTAssertEqual(formatPercent(0.15), "15%")
        XCTAssertEqual(formatPercent(0.156), "15.6%")
        XCTAssertEqual(formatPercent(1), "100%")
    }

    // MARK: - formatNumber

    func testFormatNumber() {
        XCTAssertEqual(formatNumber(0), "0")
        XCTAssertEqual(formatNumber(100), "100")
        XCTAssertEqual(formatNumber(1000), "1,000")
        XCTAssertEqual(formatNumber(1000000), "1,000,000")
    }

    // MARK: - formatCalories

    func testFormatCalories() {
        XCTAssertEqual(formatCalories(0), "0 kcal")
        XCTAssertEqual(formatCalories(350), "350 kcal")
        XCTAssertEqual(formatCalories(1000), "1000 kcal")
    }

    // MARK: - formatVolume

    func testFormatVolumeKg() {
        XCTAssertEqual(formatVolume(0), "0 kg")
        XCTAssertEqual(formatVolume(500), "500 kg")
        XCTAssertEqual(formatVolume(1000), "1.0k kg")
        XCTAssertEqual(formatVolume(1500), "1.5k kg")
    }

    func testFormatVolumeLb() {
        XCTAssertEqual(formatVolume(0, unit: "lb"), "0 lb")
        XCTAssertEqual(formatVolume(500, unit: "lb"), "1.1k lb")
        XCTAssertEqual(formatVolume(453.592, unit: "lb"), "1000 lb")
    }

    // MARK: - formatDayLabel

    func testFormatDayLabelWithLabel() {
        XCTAssertEqual(formatDayLabel("Push A", index: 1), "Push A")
        XCTAssertEqual(formatDayLabel("Rest", index: 5), "Rest")
    }

    func testFormatDayLabelWithEmptyLabel() {
        XCTAssertEqual(formatDayLabel("", index: 3), "Day 3")
        XCTAssertEqual(formatDayLabel("   ", index: 3), "Day 3")
    }

    func testFormatDayLabelWithNilLabel() {
        XCTAssertEqual(formatDayLabel(nil, index: 1), "Day 1")
        XCTAssertEqual(formatDayLabel(nil, index: 7), "Day 7")
    }

    // MARK: - formatDate / formatShortDate / formatFullDate

    func testFormatDate() {
        // Use a fixed timestamp: 2025-01-15 12:00:00 UTC = 1736942400
        let result = formatDate(timestamp: 1736942400)
        // Relative formatter output depends on current date, just verify it's non-empty
        XCTAssertFalse(result.isEmpty)
    }

    func testFormatShortDate() {
        // 2025-01-15 12:00:00 UTC
        let result = formatShortDate(timestamp: 1736942400)
        XCTAssertFalse(result.isEmpty)
    }

    func testFormatFullDate() {
        // 2025-01-15 12:00:00 UTC
        let result = formatFullDate(timestamp: 1736942400)
        XCTAssertFalse(result.isEmpty)
    }
}
