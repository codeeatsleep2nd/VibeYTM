// swift-tools-version: 6.2
import PackageDescription

// On-device DJ Copilot — Foundation Models powered playlist / queue
// generation. Sprint 4 of the VibeYTM 2.0 rewrite.
//
// Architecture:
//   - @Generable schemas (QueuePlan, SessionPlan, TrackSuggestion)
//     describe the structured output the model produces.
//   - Tool conformances wrap the host's BridgeHost + Innertube + library
//     access surface. The model can search YTM, play a track, enqueue,
//     like, and read the currently-playing track.
//   - SystemLanguageModel.default is the on-device model entry point;
//     LanguageModelSession.prewarm() is invoked lazily on first user
//     invocation of the Vibe sheet, NOT at app launch (per design D11).
//
// Entitlement caveat: Foundation Models on shipping apps may be gated
// by entitlement and/or rate-limited. The design doc Sprint 4 notes
// degrade-to-Innertube-search behavior when the model is unavailable;
// this package surfaces availability checks for the host to consume.

let package = Package(
    name: "DJCopilot",
    platforms: [
        .macOS(.v26),
    ],
    products: [
        .library(name: "DJCopilot", targets: ["DJCopilot"]),
    ],
    dependencies: [
        .package(path: "../PlayerCore"),
        .package(path: "../YTMBridge"),
    ],
    targets: [
        .target(
            name: "DJCopilot",
            dependencies: [
                .product(name: "PlayerCore", package: "PlayerCore"),
                .product(name: "YTMBridge", package: "YTMBridge"),
            ]
        ),
    ],
    swiftLanguageModes: [.v6]
)
