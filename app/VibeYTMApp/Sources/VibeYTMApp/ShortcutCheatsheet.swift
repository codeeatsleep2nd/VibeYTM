import SwiftUI

/// Keyboard-shortcut reference sheet triggered by ⌘/.
///
/// Mirrors the Tauri build's `ShortcutCheatsheet.tsx`. Lists every
/// app-scoped shortcut wired through `CommandGroup` in `VibeYTMApp.swift`
/// plus the discoverable in-app gestures (right-click → ContextMenu).
///
/// Listed shortcuts should reflect what's actually registered — if you
/// add a new keyboard shortcut anywhere in the app, add it here too.
struct ShortcutCheatsheet: View {
    let onDismiss: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Keyboard Shortcuts")
                    .font(.title2.weight(.semibold))
                Spacer()
                Button("Done", action: onDismiss)
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.plain)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 6)
                    .glassEffect(in: .capsule)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 14)
            .background(.thinMaterial)

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    section(
                        title: "Playback",
                        items: [
                            ("Play / Pause", "⌘⇧Space"),
                            ("Next Track",   "⌘⌥→"),
                            ("Previous Track", "⌘⌥←"),
                            ("Like Current Track", "⌘L"),
                        ]
                    )

                    section(
                        title: "Navigation",
                        items: [
                            ("Toggle Sidebar", "⌘B"),
                            ("Focus Search",   "⌘F"),
                            ("Show Cheatsheet", "⌘/"),
                            ("Quit VibeYTM",    "⌘Q"),
                        ]
                    )

                    section(
                        title: "AI",
                        items: [
                            ("Open Vibe (DJ Copilot)", "⌘⇧V"),
                        ]
                    )

                    section(
                        title: "Mouse",
                        items: [
                            ("Right-click any card", "Context menu"),
                            ("Click cover thumb",    "Open Now Playing"),
                            ("Click backdrop in Now Playing", "Dismiss"),
                            ("Drag scrubber",        "Seek + auto-play"),
                        ]
                    )
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 20)
            }
        }
        .frame(minWidth: 520, idealWidth: 560, minHeight: 540)
    }

    @ViewBuilder
    private func section(title: String, items: [(String, String)]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.headline)
                .foregroundStyle(.secondary)
            VStack(spacing: 6) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, pair in
                    HStack {
                        Text(pair.0)
                            .font(.body)
                        Spacer(minLength: 24)
                        Text(pair.1)
                            .font(.system(.callout, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 3)
                            .background(.quaternary, in: RoundedRectangle(cornerRadius: 5))
                    }
                }
            }
        }
    }
}
