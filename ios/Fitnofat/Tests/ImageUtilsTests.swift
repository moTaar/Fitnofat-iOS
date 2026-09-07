import XCTest
@testable import Fitnofat

final class ImageUtilsTests: XCTestCase {

    // MARK: - validateCoachImages

    func testValidateEmptyArray() {
        let result = ImageUtils.validateCoachImages([])
        XCTAssertEqual(result, "At least one image is required")
    }

    func testValidateExceedsMaxCount() {
        let images = Array(repeating: "abcd", count: 5)
        let result = ImageUtils.validateCoachImages(images)
        XCTAssertEqual(result, "Maximum 4 images allowed")
    }

    func testValidateInvalidBase64() {
        let images = ["not-valid-base64!!!"]
        let result = ImageUtils.validateCoachImages(images)
        XCTAssertEqual(result, "Image 1 could not be decoded")
    }

    func testValidateOversizeImage() {
        // Create a base64 string that decodes to > 8MB
        // 9 MB of raw data → ~12 MB base64
        let largeData = Data(repeating: 0, count: 9 * 1024 * 1024)
        let base64 = largeData.base64EncodedString()
        let images = [base64]
        let result = ImageUtils.validateCoachImages(images)
        XCTAssertEqual(result, "Image 1 exceeds 8 MB limit")
    }

    func testValidateValidImage() {
        // Create a small valid base64 string (1 byte → valid base64)
        let data = Data([0x00])
        let base64 = data.base64EncodedString()
        let images = [base64]
        let result = ImageUtils.validateCoachImages(images)
        XCTAssertNil(result)
    }

    func testValidateMultipleValidImages() {
        let data1 = Data([0x00])
        let data2 = Data([0x01, 0x02])
        let images = [
            data1.base64EncodedString(),
            data2.base64EncodedString(),
        ]
        let result = ImageUtils.validateCoachImages(images)
        XCTAssertNil(result)
    }

    func testValidateSecondImageInvalid() {
        let validData = Data([0x00])
        let images = [
            validData.base64EncodedString(),
            "!!!invalid",
        ]
        let result = ImageUtils.validateCoachImages(images)
        XCTAssertEqual(result, "Image 2 could not be decoded")
    }
}
