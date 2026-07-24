// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "ForgeFit",
    platforms: [
        .iOS(.v17),
    ],
    dependencies: [
        .package(url: "https://github.com/AudioKit/AudioKit.git", from: "5.6.0"),
    ],
    targets: [
        .executableTarget(
            name: "ForgeFit",
            dependencies: [
                .product(name: "AudioKit", package: "AudioKit"),
            ],
            path: "Sources",
            resources: [
                .process("../Resources"),
            ]
        ),
        .testTarget(
            name: "ForgeFitTests",
            dependencies: ["ForgeFit"]
        ),
    ]
)
