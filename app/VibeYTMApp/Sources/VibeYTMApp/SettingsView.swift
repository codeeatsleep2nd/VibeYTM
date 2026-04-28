import SwiftUI

/// User preferences surface — mirrors the Tauri/React Settings tab.
/// Currently exposes:
///   • Close to tray (#43) — when ON, red traffic-light hides the
///     window; when OFF, it quits the app.
///   • Background playback (#47) — when OFF, audio pauses on window
///     close even with close-to-tray ON.
///   • Version info (#45) — read at runtime from `Info.plist`'s
///     `CFBundleShortVersionString` so the displayed value matches the
///     bundled binary, never a build-time fallback.
struct SettingsView: View {
    @Environment(AppBootstrap.self) private var bootstrap

    var body: some View {
        @Bindable var bootstrapBindable = bootstrap
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 28) {
                Text("Settings")
                    .font(.largeTitle.weight(.bold))
                    .padding(.top, 8)

                section(
                    title: "Window behavior",
                    description: "Control what happens when you close the main window."
                ) {
                    Toggle("Close to tray", isOn: $bootstrapBindable.closeToTray)
                    Text(bootstrap.closeToTray
                        ? "Closing the window hides VibeYTM. Use Cmd-Q to quit."
                        : "Closing the window quits VibeYTM.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                section(
                    title: "Playback",
                    description: "Behavior of the hidden audio engine."
                ) {
                    Toggle("Continue playback when window is closed",
                           isOn: $bootstrapBindable.backgroundPlayback)
                        .disabled(!bootstrap.closeToTray)
                    Text(bootstrap.closeToTray
                        ? (bootstrap.backgroundPlayback
                            ? "Audio keeps playing when the window is hidden."
                            : "Audio pauses when the window is hidden.")
                        : "Enable Close to tray to control background playback.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                section(
                    title: "Keyboard shortcuts",
                    description: "Active while VibeYTM is the foreground app."
                ) {
                    shortcutRow(label: "Play / Pause", keys: "⌘⇧Space")
                    shortcutRow(label: "Next track", keys: "⌘⌥→")
                    shortcutRow(label: "Previous track", keys: "⌘⌥←")
                }

                section(
                    title: "About",
                    description: "Version info from the bundled binary."
                ) {
                    HStack {
                        Text("Version")
                        Spacer()
                        Text(versionString)
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                    }
                    HStack {
                        Text("Built with")
                        Spacer()
                        Text("SwiftUI · macOS 26 (Tahoe)")
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer(minLength: 40)
            }
            .padding(.horizontal, 32)
            .padding(.bottom, 24)
            .frame(maxWidth: 720, alignment: .leading)
        }
        .navigationTitle("Settings")
    }

    @ViewBuilder
    private func section<Content: View>(
        title: String,
        description: String,
        @ViewBuilder _ content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.title3.weight(.semibold))
                Text(description)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            VStack(alignment: .leading, spacing: 8) {
                content()
            }
            .padding(16)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
        }
    }

    private func shortcutRow(label: String, keys: String) -> some View {
        HStack {
            Text(label)
            Spacer()
            Text(keys)
                .font(.system(.callout, design: .monospaced))
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(.secondary.opacity(0.15), in: RoundedRectangle(cornerRadius: 4))
        }
    }

    private var versionString: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "—"
        let build = info?["CFBundleVersion"] as? String ?? "—"
        return "\(short) (\(build))"
    }
}
