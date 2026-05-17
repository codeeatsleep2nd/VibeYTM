// swift-tools-version: 6.2
import PackageDescription

// SPM-only scaffolding for the VibeYTMApp main target. Lets us run the
// SwiftUI shell via `swift run VibeYTMApp` while we wait for Xcode 26.
// Once the Xcode project lands at `app/VibeYTM.xcodeproj`, this Package.swift
// becomes redundant for build purposes (Xcode consumes the same sources)
// but stays useful for previews and CLI iteration.

// Swift Testing framework lives in CommandLineTools when running tests
// via `swift test` (vs. Xcode's bundled toolchain). Add the search path
// so `import Testing` resolves. Same pattern as
// app/Packages/PlayerCore/Package.swift.
let cltFrameworkPath = "/Library/Developer/CommandLineTools/Library/Developer/Frameworks"

let package = Package(
    name: "VibeYTMApp",
    platforms: [
        .macOS(.v26),
    ],
    dependencies: [
        .package(path: "../Packages/YTMBridge"),
        .package(path: "../Packages/PlayerCore"),
        .package(path: "../Packages/VibeYTMIntents"),
    ],
    targets: [
        .executableTarget(
            name: "VibeYTMApp",
            dependencies: [
                .product(name: "YTMBridge", package: "YTMBridge"),
                .product(name: "PlayerCore", package: "PlayerCore"),
                .product(name: "VibeYTMIntents", package: "VibeYTMIntents"),
            ],
            // SPM_DEV_HARNESS is set ONLY when building via `swift run` /
            // `swift build`. The Xcode project (lands in Sprint 0 Task 1)
            // does NOT define this flag, so the dev-launch hack in
            // `VibeYTMApp.swift` (manual NSApp activation policy) only
            // fires under SPM, not in real `.app` bundles produced by
            // Xcode. Keeps Xcode-built builds clean while preserving the
            // SPM dev iteration path.
            swiftSettings: [
                .define("SPM_DEV_HARNESS", .when(configuration: .debug))
            ]
        ),
        .testTarget(
            name: "VibeYTMAppTests",
            dependencies: ["VibeYTMApp"],
            path: "Tests/VibeYTMAppTests",
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
