// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "Fitnofat",
    platforms: [
        .iOS(.v17),
    ],
    dependencies: [
        .package(url: "https://github.com/AudioKit/AudioKit.git", from: "5.6.0"),
    ],
    targets: [
        .executableTarget(
            name: "Fitnofat",
            dependencies: [
                .product(name: "AudioKit", package: "AudioKit"),
            ],
            path: "Sources",
            resources: [
                .process("../Resources"),
            ]
        ),
        .testTarget(
            name: "FitnofatTests",
            dependencies: ["Fitnofat"]
        ),
    ]
)
