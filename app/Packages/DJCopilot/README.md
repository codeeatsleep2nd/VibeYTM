# DJCopilot

On-device Foundation Models scaffold for the VibeYTM 2.0 DJ Copilot feature
(Sprint 4 of the SwiftUI rewrite).

## Status

**Toolchain-blocked from `swift build` until Xcode 26 is installed.**

This package depends on the `@Generable` and `@Guide` macros from Apple's
FoundationModels framework. The macro plugin (`FoundationModelsMacros`)
only ships with the full Xcode 26 toolchain — `/Library/Developer/CommandLineTools/`
has the framework's `.swiftmodule` but not the macro plugin binary, so
`swift build` from CLT fails with:

```
error: external macro implementation type 'FoundationModelsMacros.GenerableMacro'
       could not be found for macro 'Generable(description:)';
       plugin for module 'FoundationModelsMacros' not found
```

The code is structurally correct. It will compile once Xcode 26 is on disk
and the project's build is driven through `xcodebuild` (or `swift build`
with the full toolchain selected via `sudo xcode-select`).

## Why this package isn't a VibeYTMApp dependency yet

`app/VibeYTMApp/Package.swift` does NOT list this package. Adding it would
break `swift build` of the main app on any machine without Xcode 26. When
Xcode 26 is installed, add the dependency:

```swift
.package(path: "../Packages/DJCopilot"),
// And in the executableTarget's dependencies:
.product(name: "DJCopilot", package: "DJCopilot"),
```

Then the Vibe sheet UI (lives in `app/VibeYTMApp/Sources/VibeYTMApp/`,
Sprint 4 follow-up) can instantiate `DJCopilotSession` and stream
`QueuePlan`s into the queue.

## What's here

- `QueuePlan.swift` — `@Generable` schemas for the structured model output.
- `DJCopilotSession.swift` — Lazily-prewarmed `LanguageModelSession`
  wrapper. Exposes availability check + `generateQueuePlan(prompt:)`.

## What's NOT here yet

- **Tool conformances** (SearchYTMTool, PlayTrackTool, etc.) — design D6
  spec'd these as Swift code with implicit `@MainActor` async hops. They
  need the host's `BridgeHost` reference, so they live in the
  `VibeYTMApp` target (or a thin shim package between DJCopilot and
  YTMBridge) rather than here.
- **Vibe sheet UI** — lives in `app/VibeYTMApp/Sources/VibeYTMApp/` once
  this package is consumable.
- **Streaming partial-output handling** — `LanguageModelSession.respond(...)`
  returns a full QueuePlan today. For the streaming UX (design D3), use
  `streamResponse(to:generating:)` and bind partial results to the queue
  panel via `@Observable` state.
