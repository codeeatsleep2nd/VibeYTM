// swift-tools-version: 6.2
import PackageDescription

// AppIntents + AppEntity scaffolding for VibeYTM (Sprint 3).
//
// Lives as its own SPM package so it can be consumed by:
//   1. The main app target (registers AppShortcuts at launch via the
//      `.appIntents(VibeYTMIntents.self)` modifier on the WindowGroup).
//   2. Future widget / Control Center / AppIntents extension targets
//      (Sprint 4) — extensions live in the Xcode project but link this
//      package as a shared dependency.
//
// Depends on PlayerCore for the canonical `Track` type. AppEntity
// conformances are added here as extensions, keeping PlayerCore
// platform-agnostic (it doesn't itself import AppIntents).
//
// NOTE: Full Spotlight donation + extension hosting requires Xcode 26
// installed AND a paid Apple Developer Program account (for the
// entitlements to be honored). Until then, the AppIntent code compiles
// and registers in-process when the app launches; widgets / Control
// Center buttons that POST intents from extensions won't reach the
// host until extensions can be hosted.

let cltFrameworkPath = "/Library/Developer/CommandLineTools/Library/Developer/Frameworks"

let package = Package(
    name: "VibeYTMIntents",
    platforms: [
        .macOS(.v26),
    ],
    products: [
        .library(name: "VibeYTMIntents", targets: ["VibeYTMIntents"]),
    ],
    dependencies: [
        .package(path: "../PlayerCore"),
    ],
    targets: [
        .target(
            name: "VibeYTMIntents",
            dependencies: [
                .product(name: "PlayerCore", package: "PlayerCore"),
            ]
        ),
        .testTarget(
            name: "VibeYTMIntentsTests",
            dependencies: ["VibeYTMIntents"],
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
