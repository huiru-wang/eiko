# Task 3: 前端工程（复刻交互 Demo）

> 依赖：[01-monorepo-init.md](./01-monorepo-init.md)
> 参考：`docs/frontend/product-interactive-demo.html`（完整交互原型）
> 架构：`docs/frontend-architecture.md`

## 目标

在 `apps/frontend/` 中创建完整的 Taro + React 微信小程序工程，**完全遵守复刻** `product-interactive-demo.html` 的视觉、交互和页面结构。

## 复刻原则

交互 Demo（`docs/frontend/product-interactive-demo.html`）是前端实现的唯一视觉基准：

- **色彩**：严格使用 Demo 中的 CSS 变量（--bg, --paper, --ink, --body, --muted, --faint, --line, --accent, --accent-soft, --warm, --warm-soft）
- **动效**：页面切换 180ms 透明度+位移、Sheet 240ms 从底部、Toast 200ms、录音按压 160ms、波形 1100ms
- **布局**：手机壳 410px/860px、状态栏 42px、底部导航 69px、Sheet 88% 高度
- **交互**：录音模拟（计时+波形+标记）、快速文字输入、记录 Timeline、话题卡片、话题详情滚动、对话 Sheet 弹出/收起、流式文字渲染
- **MVP 范围**：录音、ASR、附件渲染标记为 P1，MVP 仅实现文字输入，但 UI 布局和交互链路需与 Demo 一致

## 步骤

### 3.1 包配置与工程配置

**`apps/frontend/package.json`**
```jsonc
{
  "name": "@eiko/frontend",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev:weapp": "taro build --type weapp --watch",
    "build:weapp": "taro build --type weapp",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@eiko/shared": "workspace:*",
    "@tarojs/components": "4.x",
    "@tarojs/runtime": "4.x",
    "@tarojs/taro": "4.x",
    "@tarojs/plugin-framework-react": "4.x",
    "@tarojs/plugin-platform-weapp": "4.x",
    "react": "^18.x",
    "react-dom": "^18.x",
    "zustand": "^5.x",
    "@tanstack/react-query": "^5.x"
  },
  "devDependencies": {
    "@tarojs/cli": "4.x",
    "@tarojs/webpack5-runner": "4.x",
    "@types/react": "^18.x",
    "sass": "^1.x",
    "typescript": "^7.x"
  }
}
```

**`apps/frontend/tsconfig.json`** -- extends base, `jsx: react-jsx`

**`apps/frontend/project.config.json`** -- 微信小程序项目配置（appid 占位）

**`apps/frontend/babel.config.js`** -- Taro Babel 配置

**`apps/frontend/config/`** -- Taro 构建配置（index.ts, dev.ts, prod.ts）

### 3.2 Design Tokens (`src/theme/`)

从 Demo CSS 变量转换为 TypeScript 常量：

- **`colors.ts`** -- canvas, paper, surface, ink, body, muted, faint, divider, accent, accent-soft, warm, warm-soft
- **`motion.ts`** -- pageTransition (180ms), sheetTransition (240ms), mask (200ms), toast (200ms), recordPress (160ms), waveform (1100ms)
- **`spacing.ts`** -- 基于 Demo 的 padding/margin 值
- **`typography.ts`** -- font sizes, weights, line heights

### 3.3 App 入口

- **`src/app.config.ts`** -- pages 路由（inbox, records, topics, topic-detail）、tabBar（三个导航）
- **`src/app.tsx`** -- App 壳，QueryClient 初始化
- **`src/app.scss`** -- 全局样式（从 Demo 提取）

### 3.4 页面（复刻 Demo 五个视图）

**`src/pages/inbox/`** -- 复刻 Demo capture-view
- Inbox 头部（"Inbox" + 日期）
- 中央捕获区（"有什么值得留下？" + 文字输入区）
- 底部快速文字输入（quick-compose）
- 底部导航

**`src/pages/records/`** -- 复刻 Demo records-view
- "记录" 标题
- Record 列表（文字/录音卡片、时间、关联 Topic）
- 底部导航

**`src/pages/topics/`** -- 复刻 Demo discover-view（"回声"）
- "回声" 标题
- Topic 卡片列表（标题、摘要、时间、未读标识）
- 底部导航

**`src/pages/topic-detail/`** -- 复刻 Demo finding-view + chat-sheet
- 顶部导航（返回 + 标题）
- 相关记忆区（默认展开，约两条高度，可收起）
- Topic Markdown 正文（标题、结论、想法、引用、历史时间线）
- 底部对话入口
- 对话 Sheet（88% 高度，从底部弹出）
- 消息列表（用户消息 + AI 流式回复）
- 输入框 + 发送按钮

### 3.5 业务组件 (`src/features/`)

- **`capture/`** -- QuickTextComposer（快速文字输入框 + 发送）、capture.store
- **`record/`** -- RecordList、RecordRow（文字卡片 + 录音卡片样式）
- **`topic/`** -- TopicList、RelatedMemoryViewport（可折叠记忆区）、TopicBody（Markdown 渲染）
- **`chat/`** -- ConversationSheet（底部 Sheet）、MessageList、ChatComposer

### 3.6 共享 UI (`src/components/`)

- **`markdown/MarkdownRenderer.tsx`** -- MDAST 子集渲染（标题、段落、列表、引用、表格、链接）
- **`ui/BottomSheet.tsx`** -- 通用底部 Sheet（88% 高度，grabber，关闭按钮）
- **`ui/IconButton.tsx`** -- 图标按钮
- **`ui/Toast.tsx`** -- 轻量 Toast（200ms 动画）

### 3.7 服务层 (`src/services/`)

- **`api-client.ts`** -- 封装 Taro.request，统一 ApiResponse<T> 解包
- **`agent-stream-client.ts`** -- SSE 事件解析（替代原 NDJSON），输出 ClientAgentEvent
- **`query-keys.ts`** -- TanStack Query key 定义

### 3.8 状态管理 (`src/stores/`)

- **`auth.store.ts`** -- 用户身份信息
- **`draft.store.ts`** -- 未发送草稿、Sheet 状态、流式文本

### 3.9 Mock 数据

从 Demo 提取测试数据，创建 `src/mock/` 或使用 `docs/records-test-data.json`：
- 记录列表（文字 + 录音类型）
- 话题列表（含完整 finding 结构：标题、结论、想法、引用、历史、research）
- 对话消息

### 3.10 验证

```bash
pnpm typecheck              # 类型检查通过
pnpm dev:weapp              # Taro 编译成功
# 微信开发者工具预览 -- 页面切换、交互、样式与 Demo 一致
```
