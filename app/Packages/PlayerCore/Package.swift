// swift-tools-version: 6.2
import PackageDescription

let cltFrameworkPath = "/Library/Developer/CommandLineTools/Library/Developer/Frameworks"

let package = Package(
    name: "PlayerCore",
    platforms: [
        .macOS(.v26),
    ],
    products: [
        .library(name: "PlayerCore", targets: ["PlayerCore"]),
    ],
    targets: [
        .target(name: "PlayerCore"),
        .executableTarget(
            name: "PlayerCoreValidator",
            dependencies: ["PlayerCore"]
        ),
        .testTarget(
            name: "PlayerCoreTests",
            dependencies: ["PlayerCore"],
            swiftSettings: [
                .unsafeFlags(["-F", cltFrameworkPath]),
            ],
            linkerSettings: [
                .unsafeFlags(["-F", cltFrameworkPath]),
            ]
        ),
    ],
    swiftLanguageModes: [.v6]
)
