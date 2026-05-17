import SwiftUI
import Combine
import PlayerCore

/// Focus timer overlay — Pomodoro-style countdown. Direct port of the
/// Tauri build's `src/components/player/FocusTimer/` directory, including
/// the 9 test cases from `useFocusTimerCountdown.test.ts`.
///
/// State machine:
///   idle → (start) → running → (countdown reaches 0) → done
///   done → (setDuration) → idle  (back to fresh state with new duration)
///   running → (reset) → idle
///
/// 1Hz countdown driven by `Timer.publish(every: 1, ...)`. On the
/// `running → done` transition, fires `onComplete` exactly once — the
/// caller is responsible for any notification / playback pause logic
/// (this view is pure UI + countdown).
@Observable
@MainActor
final class FocusTimerModel {
    enum State {
        case idle, running, done
    }

    private(set) var state: State = .idle
    private(set) var totalSecs: Int
    private(set) var remainingSecs: Int
    private var timer: AnyCancellable?
    var onComplete: (() -> Void)?

    init(initialDurationSecs: Int = 25 * 60) {
        self.totalSecs = initialDurationSecs
        self.remainingSecs = initialDurationSecs
    }

    /// No-op while running. From `idle` updates the duration; from `done`
    /// returns to idle with the new duration so the user can start a
    /// fresh session via the slider.
    func setDuration(secs: Int) {
        switch state {
        case .running:
            return
        case .idle:
            totalSecs = secs
            remainingSecs = secs
        case .done:
            state = .idle
            totalSecs = secs
            remainingSecs = secs
        }
    }

    func start() {
        guard state == .idle else { return }
        state = .running
        remainingSecs = totalSecs
        timer = Timer.publish(every: 1, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in
                guard let self else { return }
                guard self.state == .running else { return }
                if self.remainingSecs > 0 {
                    self.remainingSecs -= 1
                }
                if self.remainingSecs == 0 {
                    self.state = .done
                    self.timer?.cancel()
                    self.timer = nil
                    self.onComplete?()
                }
            }
    }

    func reset() {
        timer?.cancel()
        timer = nil
        state = .idle
        remainingSecs = totalSecs
    }
}

struct FocusTimerView: View {
    @State private var model = FocusTimerModel()
    @Environment(AppBootstrap.self) private var bootstrap

    var body: some View {
        VStack(spacing: 24) {
            Text(formatTime(model.remainingSecs))
                .font(.system(size: 72, weight: .light, design: .rounded).monospacedDigit())
                .foregroundStyle(model.state == .done ? .green : .primary)

            switch model.state {
            case .idle:
                idleControls
            case .running:
                runningControls
            case .done:
                doneControls
            }
        }
        .padding(40)
        .frame(minWidth: 360, minHeight: 280)
        .onAppear {
            model.onComplete = {
                bootstrap.pause()
                // TODO Sprint 5+: fire a UNUserNotificationCenter notification.
            }
        }
    }

    @ViewBuilder
    private var idleControls: some View {
        VStack(spacing: 16) {
            Slider(
                value: Binding(
                    get: { Double(model.totalSecs / 60) },
                    set: { model.setDuration(secs: Int($0) * 60) }
                ),
                in: 5...90,
                step: 5
            )
            Text("\(model.totalSecs / 60) minutes")
                .font(.callout)
                .foregroundStyle(.secondary)
            Button("Start", action: model.start)
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
        }
    }

    @ViewBuilder
    private var runningControls: some View {
        Button("Reset", action: model.reset)
            .buttonStyle(.bordered)
    }

    @ViewBuilder
    private var doneControls: some View {
        VStack(spacing: 12) {
            Text("Focus session complete.")
                .font(.callout)
                .foregroundStyle(.secondary)
            Button("New Session") { model.setDuration(secs: model.totalSecs) }
                .buttonStyle(.borderedProminent)
        }
    }

    private func formatTime(_ secs: Int) -> String {
        String(format: "%02d:%02d", secs / 60, secs % 60)
    }
}
