import SwiftUI

/// Swift mirror of the design tokens in DESIGN.md (`## 9. Design Tokens`).
/// DESIGN.md is canonical — when a token changes there, change it here in the
/// same commit. CSS variable names map directly: `--color-surface-1` → `surface1`.
///
/// Color values are sRGB approximations of the OKLCH source values. The
/// approximation is acceptable for v2.0; a precise OKLCH→sRGB converter can
/// land in v2.1 if visible drift becomes a problem.
public enum DesignTokens {
    public enum Color {
        // === Surfaces (3-level elevation) ===
        /// Deepest background — equivalent to CSS `--color-bg` (OKLCH 10% 0.015 270).
        public static let bg = SwiftUI.Color(red: 0.05, green: 0.055, blue: 0.075)
        /// Sidebar, player bar — `--color-surface-1` (OKLCH 14% 0.015 270).
        public static let surface1 = SwiftUI.Color(red: 0.09, green: 0.095, blue: 0.11)
        /// Cards, hover states — `--color-surface-2` (OKLCH 18% 0.012 270).
        public static let surface2 = SwiftUI.Color(red: 0.13, green: 0.135, blue: 0.15)
        /// Elevated: modals, menus — `--color-surface-3` (OKLCH 22% 0.010 270).
        public static let surface3 = SwiftUI.Color(red: 0.17, green: 0.175, blue: 0.19)

        // === Text ===
        /// `--color-text-primary` (OKLCH 95%).
        public static let textPrimary = SwiftUI.Color(white: 0.95)
        /// `--color-text-secondary` (OKLCH 65%).
        public static let textSecondary = SwiftUI.Color(white: 0.65)
        /// `--color-text-tertiary` (OKLCH 45%).
        public static let textTertiary = SwiftUI.Color(white: 0.45)

        // === Accent (default — overridden by album-art-extracted color at runtime) ===
        /// `--color-accent` (OKLCH 65% chroma 0.20 hue 25 — YouTube red).
        public static let accent = SwiftUI.Color(red: 1.0, green: 0.0, blue: 0.0)
        /// `--color-accent-subtle` (OKLCH 25% chroma 0.08 hue 25).
        public static let accentSubtle = SwiftUI.Color(red: 0.30, green: 0.06, blue: 0.07)

        // === Semantic ===
        public static let border = SwiftUI.Color(white: 0.25, opacity: 0.5)
        public static let highlight = SwiftUI.Color(white: 0.30, opacity: 0.7)
        public static let danger = SwiftUI.Color(red: 0.95, green: 0.18, blue: 0.18)

        // === Glass effect overlay (when not using native .glassEffect) ===
        public static let glassBg = SwiftUI.Color(red: 0.09, green: 0.095, blue: 0.11, opacity: 0.7)
        public static let glassBorder = SwiftUI.Color(white: 0.30, opacity: 0.3)
    }

    public enum Space {
        public static let one: CGFloat = 4
        public static let two: CGFloat = 8
        public static let three: CGFloat = 12
        public static let four: CGFloat = 16
        public static let five: CGFloat = 20
        public static let six: CGFloat = 24
        public static let eight: CGFloat = 32
        public static let ten: CGFloat = 40
        public static let twelve: CGFloat = 48
        public static let sixteen: CGFloat = 64
    }

    public enum Typography {
        /// 11pt — metadata, captions.
        public static let xs = SwiftUI.Font.system(size: 11)
        /// 13pt — secondary text.
        public static let sm = SwiftUI.Font.system(size: 13)
        /// 15pt — body.
        public static let base = SwiftUI.Font.system(size: 15)
        /// 18pt semibold — section headers.
        public static let lg = SwiftUI.Font.system(size: 18, weight: .semibold)
        /// 24pt semibold — page titles.
        public static let xl = SwiftUI.Font.system(size: 24, weight: .semibold)
        /// 32pt bold — hero / Now Playing track title.
        public static let xxl = SwiftUI.Font.system(size: 32, weight: .bold)
    }

    public enum Glass {
        /// CSS `backdrop-filter: blur(20px)` equivalent.
        public static let blurRadius: CGFloat = 20
    }

    public enum Layout {
        public static let sidebarWidth: CGFloat = 240
        public static let sidebarCollapsed: CGFloat = 64
        public static let nowPlayingWidth: CGFloat = 320
    }

    public enum Motion {
        /// View transition duration — `--duration-normal`.
        public static let normal: Double = 0.2
        /// Quick state changes — `--duration-fast`.
        public static let fast: Double = 0.15
    }
}
