import SwiftUI
import YTMBridge

/// YTM search surface. TextField at the top, debounced query → bridge
/// search → shelves rendered as horizontal rows (Top result / Songs /
/// Videos / Albums / Artists / Playlists / Community Playlists, however
/// YTM groups them).
///
/// The query is debounced ~400 ms so each keystroke doesn't fire an
/// API call; the actual search runs once the user stops typing.
struct SearchView: View {
    @Environment(AppBootstrap.self) private var bootstrap

    @State private var query: String = ""
    @State private var lastSubmitted: String = ""
    @State private var shelves: [Shelf] = []
    @State private var loading = false
    @State private var debounceTask: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField("Search artists, songs, albums, playlists", text: $query)
                    .textFieldStyle(.plain)
                    .font(.title3)
                    .onSubmit { commit(query) }
                    .onChange(of: query) { _, newValue in
                        scheduleDebouncedSearch(for: newValue)
                    }
                if !query.isEmpty {
                    Button {
                        query = ""
                        shelves = []
                        lastSubmitted = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.borderless)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(.thinMaterial)

            Divider()

            content
        }
    }

    @ViewBuilder
    private var content: some View {
        if loading && shelves.isEmpty {
            VStack(spacing: 8) {
                ProgressView()
                Text("Searching…")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if shelves.isEmpty {
            emptyState
        } else {
            ScrollView(.vertical) {
                LazyVStack(alignment: .leading, spacing: 28) {
                    ForEach(shelves) { shelf in
                        ShelfRow(shelf: shelf)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 16)
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 36))
                .foregroundStyle(.secondary)
            if lastSubmitted.isEmpty {
                Text("Search YouTube Music")
                    .font(.headline)
                Text("Find songs, albums, artists, and playlists.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } else {
                Text("No results")
                    .font(.headline)
                Text("Nothing found for \"\(lastSubmitted)\".")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.top, 80)
    }

    private func scheduleDebouncedSearch(for newValue: String) {
        debounceTask?.cancel()
        let trimmed = newValue.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            shelves = []
            lastSubmitted = ""
            return
        }
        debounceTask = Task {
            try? await Task.sleep(nanoseconds: 400_000_000)
            if Task.isCancelled { return }
            await commit(trimmed)
        }
    }

    private func commit(_ query: String) {
        Task { await commit(query) }
    }

    private func commit(_ query: String) async {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        guard trimmed != lastSubmitted else { return }
        lastSubmitted = trimmed
        loading = true
        let result = await bootstrap.search(query: trimmed)
        if !Task.isCancelled {
            shelves = result
            loading = false
        }
    }
}
