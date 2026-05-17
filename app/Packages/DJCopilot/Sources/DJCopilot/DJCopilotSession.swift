import Foundation
import OSLog
import FoundationModels

private let djLog = Logger(subsystem: "com.vibeytm.dev", category: "Copilot")

/// Lazily-initialized Foundation Models session for the DJ Copilot.
/// Prewarm is INTENTIONALLY deferred to first use (per design D11) so
/// users who never invoke the Vibe sheet don't pay the startup cost.
///
/// Availability handling: `SystemLanguageModel.default.availability` is
/// the runtime gate. When `.unavailable`, the host falls back to a
/// plain Innertube text search (per design D4 — "AI unavailable.
/// Search YTM for your prompt instead?"). The Vibe sheet UI consumes
/// `availability` to pick its empty-state copy.
@MainActor
public final class DJCopilotSession {
    private var session: LanguageModelSession?
    public private(set) var prewarmed = false

    public init() {}

    /// Reads the system model's availability snapshot. Cheap (no
    /// network, no model load). Call this from the Vibe sheet's
    /// onAppear to decide whether to show the AI surface or the
    /// degraded "search instead" surface.
    public var availability: SystemLanguageModel.Availability {
        SystemLanguageModel.default.availability
    }

    /// One-shot prewarm. Safe to call multiple times — subsequent calls
    /// are no-ops. Fire from the Vibe sheet's `onAppear` so first-key-
    /// stroke latency is hidden behind the sheet's slide-in animation.
    public func prewarm() {
        guard !prewarmed else { return }
        guard case .available = availability else {
            djLog.notice("DJCopilot prewarm skipped — model unavailable")
            return
        }
        if session == nil {
            session = LanguageModelSession()
        }
        session?.prewarm()
        prewarmed = true
        djLog.debug("DJCopilot prewarmed")
    }

    /// Generate a QueuePlan from a free-form user prompt. Streams under
    /// the hood — the caller can observe partial results via the
    /// returned response stream rather than awaiting the full plan.
    ///
    /// Returns nil when the model is unavailable; the host should
    /// degrade to Innertube search (design D4).
    public func generateQueuePlan(prompt: String) async throws -> QueuePlan? {
        guard case .available = availability else {
            return nil
        }
        if session == nil {
            session = LanguageModelSession()
        }
        guard let session else { return nil }

        let instructions = """
        You are the user's DJ copilot inside the VibeYTM music app. The
        user just typed: "\(prompt)".

        Build a QueuePlan that matches the vibe they described. Prefer
        well-known tracks the YouTube Music catalog will have. Include
        10-20 tracks unless the user explicitly asked for a different
        length. For each track, write one short sentence in `reason`
        explaining why it fits the vibe. Leave `videoId` empty unless
        you're confident in the exact ID — the app will search for the
        track by title + artist if no ID is provided.
        """

        let response = try await session.respond(
            to: instructions,
            generating: QueuePlan.self
        )
        return response.content
    }
}
