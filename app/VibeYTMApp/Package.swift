// swift-tools-version: 6.2
import PackageDescription

// SPM-only scaffolding for the VibeYTMApp main target. Lets us run the
// SwiftUI shell via `swift run VibeYTMApp` while we wait for Xcode 26.
// Once the Xcode project lands at `app/VibeYTM.xcodeproj`, this Package.swift
// becomes redundant for build purposes (Xcode consumes the same sources)
// but stays useful for previews and CLI iteration.

let package = Package(
    name: "VibeYTMApp",
    platforms: [
        .macOS(.v26),
    ],
    dependencies: [
        .package(path: "../Packages/YTMBridge"),
        .package(path: "../Packages/PlayerCore"),
    ],
    targets: [
        .executableTarget(
            name: "VibeYTMApp",
            dependencies: [
                .product(name: "YTMBridge", package: "YTMBridge"),
                .product(name: "PlayerCore", package: "PlayerCore"),
            ]
        ),
    ],
    swiftLanguageModes: [.v6]
)
