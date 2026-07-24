import Foundation
import UIKit

// MARK: - Image Utilities

enum ImageUtils {
    /// Maximum image size in bytes (8 MB)
    static let maxImageSize: Int = 8 * 1024 * 1024

    /// Maximum number of images per AI coach message
    static let maxImageCount: Int = 4

    /// Target dimension for resizing (1280px on the longest side)
    static let targetDimension: CGFloat = 1280

    /// Resize and compress a UIImage for AI coach photo attachment.
    /// The image is resized so the longest side is at most `targetDimension` pixels,
    /// then compressed as JPEG at 80% quality.
    /// - Parameter image: The original UIImage
    /// - Returns: Base64-encoded JPEG string, or nil if processing fails
    static func prepareCoachImage(_ image: UIImage) -> String? {
        let resized = resizeImage(image, maxDimension: targetDimension)
        guard let data = resized.jpegData(compressionQuality: 0.8) else { return nil }
        return data.base64EncodedString()
    }

    /// Resize an image so the longest side does not exceed `maxDimension`.
    /// - Parameters:
    ///   - image: Input image
    ///   - maxDimension: Maximum dimension for the longest side
    /// - Returns: Resized UIImage
    static func resizeImage(_ image: UIImage, maxDimension: CGFloat) -> UIImage {
        let size = image.size
        if size.width <= maxDimension && size.height <= maxDimension {
            return image
        }

        let ratio: CGFloat
        if size.width > size.height {
            ratio = maxDimension / size.width
        } else {
            ratio = maxDimension / size.height
        }

        let newSize = CGSize(width: size.width * ratio, height: size.height * ratio)
        let renderer = UIGraphicsImageRenderer(size: newSize)
        return renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: newSize))
        }
    }

    /// Validate that images are within size and count limits.
    /// - Parameter images: Array of base64-encoded image strings
    /// - Returns: Error string if validation fails, nil otherwise
    static func validateCoachImages(_ images: [String]) -> String? {
        if images.isEmpty { return "At least one image is required" }
        if images.count > maxImageCount { return "Maximum \(maxImageCount) images allowed" }
        for (index, img) in images.enumerated() {
            guard let data = Data(base64Encoded: img) else {
                return "Image \(index + 1) could not be decoded"
            }
            if data.count > maxImageSize {
                return "Image \(index + 1) exceeds 8 MB limit"
            }
        }
        return nil
    }
}
