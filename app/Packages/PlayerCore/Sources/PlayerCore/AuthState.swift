import Foundation

/// Three-state authentication signal. Replaces the previous
/// `loggedIn: Bool?` + `account: Account?` pair on `PlayerState` and
/// `BridgePollSnapshot`, which permitted illegal combinations
/// (loggedIn=true with no account, signedOut with stale account, etc.)
/// that were impossible to express through the type system.
///
/// Decoding-tolerant: legacy `PlayerState.loggedIn`/`account` JSON
/// (encoded before this enum existed) is reassembled back into the
/// right case in `PlayerState.init(from:)`.
public enum AuthState: Sendable, Equatable {
    /// Bridge hasn't reported yet — initial state on cold launch.
    case unknown
    /// Bridge confirms the user is not signed in (or has signed out).
    case signedOut
    /// Bridge confirms the user is signed in. The associated `Account`
    /// may be partially populated (avatar present, name pending) until
    /// the bridge's deferred `fetchAccountFromApi` resolves.
    case signedIn(Account)
}

extension AuthState {
    /// Convenience for views that just need to decide between
    /// "show main UI", "show sign-in flow", or "show booting splash".
    public var isSignedIn: Bool {
        if case .signedIn = self { return true }
        return false
    }

    public var account: Account? {
        if case .signedIn(let a) = self { return a }
        return nil
    }

    /// Tri-state Bool the legacy code used. `nil` = unknown,
    /// `true` = signedIn, `false` = signedOut. Kept for migration of
    /// callsites that still expect the old representation.
    public var legacyLoggedIn: Bool? {
        switch self {
        case .unknown: nil
        case .signedOut: false
        case .signedIn: true
        }
    }
}
