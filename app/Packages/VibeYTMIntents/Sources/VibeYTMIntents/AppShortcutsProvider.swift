import AppIntents

/// AppShortcuts surface. Apple's App Shortcuts framework reads this
/// provider at app launch and registers the listed shortcuts with
/// Spotlight + Siri so users can say "Hey Siri, play/pause in VibeYTM"
/// or hit ⌘Space and type the phrase.
///
/// Phrase rules (Apple):
/// - Must include `\(.applicationName)` in every phrase variant
/// - First phrase is the canonical one shown in Spotlight suggestions
/// - All variants should be natural ways someone would speak the action
public struct VibeYTMShortcuts: AppShortcutsProvider {
    public static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: PlayPauseIntent(),
            phrases: [
                "Play \(.applicationName)",
                "Pause \(.applicationName)",
                "Toggle play in \(.applicationName)",
            ],
            shortTitle: "Play / Pause",
            systemImageName: "playpause.fill"
        )
        AppShortcut(
            intent: NextTrackIntent(),
            phrases: [
                "Skip in \(.applicationName)",
                "Next track in \(.applicationName)",
                "Next song in \(.applicationName)",
            ],
            shortTitle: "Next Track",
            systemImageName: "forward.fill"
        )
        AppShortcut(
            intent: PreviousTrackIntent(),
            phrases: [
                "Previous track in \(.applicationName)",
                "Go back in \(.applicationName)",
                "Last song in \(.applicationName)",
            ],
            shortTitle: "Previous Track",
            systemImageName: "backward.fill"
        )
        AppShortcut(
            intent: LikeCurrentTrackIntent(),
            phrases: [
                "Like in \(.applicationName)",
                "Like this song in \(.applicationName)",
            ],
            shortTitle: "Like Current Track",
            systemImageName: "heart.fill"
        )
    }
}
