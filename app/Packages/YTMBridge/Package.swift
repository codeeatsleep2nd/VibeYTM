// swift-tools-version: 6.2
import PackageDescription

// CLT 6.2 ships `Testing.framework` and `_Testing_Foundation.framework` but
// the latter is missing its swiftmodule/swiftinterface — `import Testing`
// fails under Command Line Tools alone. Until Xcode 26 is installed,
// `swift run SeekFilterValidator` is the toolchain proof; `swift test`
// will start passing automatically once the full toolchain is present.
let cltFrameworkPath = "/Library/Developer/CommandLineTools/Library/Developer/Frameworks"

let package = Package(
    name: "YTMBridge",
    platforms: [
        .macOS(.v26),
    ],
    products: [
        .library(name: "YTMBridge", targets: ["YTMBridge"]),
    ],
    dependencies: [
        .package(path: "../PlayerCore"),
    ],
    targets: [
        .target(
            name: "YTMBridge",
            dependencies: [
                .product(name: "PlayerCore", package: "PlayerCore"),
            ],
            resources: [
                // The JS bridge payload that runs inside YTM's hidden
                // WebView. Source-of-truth still lives at
                // `scripts/inject/*.js` until the React tree is deleted —
                // the copies here must be kept in sync until then.
                .copy("InjectedScripts"),
            ]
        ),
        .executableTarget(
            name: "SeekFilterValidator",
            dependencies: [
                "YTMBridge",
                .product(name: "PlayerCore", package: "PlayerCore"),
            ]
        ),
        .executableTarget(
            name: "VolumeSettleValidator",
            dependencies: ["YTMBridge"]
        ),
        .executableTarget(
            name: "TrackChangeGuardValidator",
            dependencies: ["YTMBridge"]
        ),
        .executableTarget(
            name: "BridgeReducerValidator",
            dependencies: [
                "YTMBridge",
                .product(name: "PlayerCore", package: "PlayerCore"),
            ]
        ),
        .testTarget(
            name: "YTMBridgeTests",
            dependencies: ["YTMBridge"],
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
