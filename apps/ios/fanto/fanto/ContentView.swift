import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            RecordsScreen()
                .tabItem { Label("记录", systemImage: "square.stack.3d.up") }

            TopicsScreen()
                .tabItem { Label("回声", systemImage: "waveform") }
        }
        .tint(.indigo)
    }
}

private struct RecordsScreen: View {
    @StateObject private var model = RecordsModel()

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ScreenHeader(title: "记录", subtitle: "按时间收拢每一根线")
                    if model.isLoading && model.records.isEmpty {
                        ProgressView("正在读取记录…").frame(maxWidth: .infinity).padding(.top, 56)
                    } else if let error = model.errorMessage, model.records.isEmpty {
                        LoadFailure(message: error) { await model.load(reset: true) }
                    } else if model.records.isEmpty {
                        EmptyContent(title: "还没有记录", detail: "记录会在这里按时间出现。")
                    } else {
                        ForEach(Array(model.records.enumerated()), id: \.element.id) { index, record in
                            NavigationLink { RecordDetailScreen(recordID: record.id) } label: {
                                TimelineRecordRow(record: record, connectsDown: index < model.records.count - 1)
                            }
                            .buttonStyle(.plain)
                        }
                        LoadMoreButton(isLoading: model.isLoading, hasMore: model.hasMore) { await model.load() }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 28)
            }
            .background(Color(uiColor: .systemBackground))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .navigationBar)
            .refreshable { await model.load(reset: true) }
            .task { await model.load(reset: true) }
        }
    }
}

private struct TopicsScreen: View {
    @StateObject private var model = TopicsModel()

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    ScreenHeader(title: "回声", subtitle: "整理后留下的主题与脉络")
                    if model.isLoading && model.topics.isEmpty {
                        ProgressView("正在读取回声…").frame(maxWidth: .infinity).padding(.top, 56)
                    } else if let error = model.errorMessage, model.topics.isEmpty {
                        LoadFailure(message: error) { await model.load(reset: true) }
                    } else if model.topics.isEmpty {
                        EmptyContent(title: "还没有回声", detail: "整理完成后，主题会在这里出现。")
                    } else {
                        ForEach(model.topics) { topic in
                            NavigationLink { TopicDetailScreen(topicID: topic.id) } label: { TopicCard(topic: topic) }
                                .buttonStyle(.plain)
                        }
                        LoadMoreButton(isLoading: model.isLoading, hasMore: model.hasMore) { await model.load() }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 28)
            }
            .background(Color(uiColor: .systemBackground))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .navigationBar)
            .refreshable { await model.load(reset: true) }
            .task { await model.load(reset: true) }
        }
    }
}

private struct RecordDetailScreen: View {
    let recordID: String
    @StateObject private var model = RecordDetailModel()

    var body: some View {
        ScrollView {
            Group {
                if model.isLoading {
                    ProgressView().padding(.top, 56)
                } else if let record = model.record {
                    VStack(alignment: .leading, spacing: 18) {
                        Text(record.content).font(.body).foregroundStyle(.primary)
                        DetailMetadata(date: record.createdAt, status: record.status)
                        if !record.topics.isEmpty {
                            VStack(alignment: .leading, spacing: 10) {
                                Text("关联回声").font(.headline)
                                ForEach(record.topics) { topic in
                                    NavigationLink(topic.title) { TopicDetailScreen(topicID: topic.id) }.foregroundStyle(.indigo)
                                }
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                } else if let error = model.errorMessage {
                    LoadFailure(message: error) { await model.load(id: recordID) }
                }
            }
            .padding(20)
        }
        .navigationTitle("记录")
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.load(id: recordID) }
    }
}

private struct TopicDetailScreen: View {
    let topicID: String
    @StateObject private var model = TopicDetailModel()

    var body: some View {
        ScrollView {
            Group {
                if model.isLoading {
                    ProgressView().padding(.top, 56)
                } else if let topic = model.topic {
                    VStack(alignment: .leading, spacing: 18) {
                        Text(topic.title).font(.title2.weight(.bold))
                        DetailMetadata(date: topic.updatedAt, status: topic.status, prefix: "更新于")
                        if !topic.tags.isEmpty { FlowTags(tags: topic.tags) }
                        MarkdownBody(markdown: topic.content)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                } else if let error = model.errorMessage {
                    LoadFailure(message: error) { await model.load(id: topicID) }
                }
            }
            .padding(20)
        }
        .navigationTitle("回声")
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.load(id: topicID) }
    }
}

private struct ScreenHeader: View {
    let title: String
    let subtitle: String
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.largeTitle.weight(.bold))
            Text(subtitle).font(.subheadline).foregroundStyle(.secondary)
        }
        .padding(.top, 20).padding(.bottom, 28)
    }
}

private struct TimelineRecordRow: View {
    let record: RecordDTO
    let connectsDown: Bool
    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(spacing: 0) {
                Circle().fill(.indigo).frame(width: 10, height: 10)
                if connectsDown { Rectangle().fill(Color.secondary.opacity(0.22)).frame(width: 1).frame(maxHeight: .infinity).padding(.top, 7) }
            }
            .frame(width: 10)
            VStack(alignment: .leading, spacing: 8) {
                Text(record.content).font(.body).foregroundStyle(.primary).lineLimit(2).multilineTextAlignment(.leading)
                DetailMetadata(date: record.createdAt, status: record.status)
                if let topic = record.topics.first { Text(topic.title).font(.footnote).foregroundStyle(.indigo).lineLimit(1) }
            }
            .padding(.bottom, 26)
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
    }
}

private struct TopicCard: View {
    let topic: TopicDTO
    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text("更新于 \(DisplayDate.text(topic.updatedAt))").font(.caption).foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline) {
                Text(topic.title).font(.headline).foregroundStyle(.primary)
                Spacer()
                Image(systemName: "arrow.up.right").foregroundStyle(.indigo)
            }
            Text(topic.summary).font(.subheadline).foregroundStyle(.secondary).lineLimit(3).multilineTextAlignment(.leading)
            if !topic.tags.isEmpty { Text(topic.tags.prefix(4).map { "#\($0)" }.joined(separator: "  ")).font(.caption).foregroundStyle(.indigo).lineLimit(1) }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

private struct DetailMetadata: View {
    let date: String
    let status: String
    var prefix = "记录于"
    var body: some View {
        HStack(spacing: 8) {
            Text("\(prefix) \(DisplayDate.text(date))")
            Text(statusText).padding(.horizontal, 7).padding(.vertical, 3).background(Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
        .font(.caption).foregroundStyle(.secondary)
    }
    private var statusText: String {
        switch status {
        case "pending", "updated": "待整理"
        case "processing": "整理中"
        case "organized": "已整理"
        case "skipped": "已略过"
        default: status
        }
    }
}

private struct FlowTags: View {
    let tags: [String]
    var body: some View { Text(tags.map { "#\($0)" }.joined(separator: "  ")).font(.footnote.weight(.medium)).foregroundStyle(.indigo) }
}

private struct MarkdownBody: View {
    let markdown: String
    var body: some View {
        if let value = try? AttributedString(markdown: markdown, options: .init(interpretedSyntax: .full, failurePolicy: .returnPartiallyParsedIfPossible)) {
            Text(value).font(.body).foregroundStyle(.primary)
        } else {
            Text(markdown).font(.body).foregroundStyle(.primary)
        }
    }
}

private struct LoadMoreButton: View {
    let isLoading: Bool
    let hasMore: Bool
    let action: () async -> Void
    var body: some View {
        if hasMore {
            Button(isLoading ? "加载中…" : "加载更多") { Task { await action() } }
                .disabled(isLoading).frame(maxWidth: .infinity).padding(.vertical, 18)
        }
    }
}

private struct LoadFailure: View {
    let message: String
    let retry: () async -> Void
    var body: some View {
        VStack(spacing: 12) {
            Text(message).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
            Button("重新尝试") { Task { await retry() } }.buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity).padding(.top, 56)
    }
}

private struct EmptyContent: View {
    let title: String
    let detail: String
    var body: some View {
        VStack(spacing: 8) {
            Text(title).font(.headline)
            Text(detail).font(.subheadline).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity).padding(.top, 56)
    }
}
