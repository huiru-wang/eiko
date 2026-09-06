# 前端设计与运行

## 独立 H5：apps/h5

当前 H5 工程使用 Vite + React + TypeScript。后续可在 apps/weapp、apps/android、apps/ios 建设原生客户端，共享内容仅为 @eiko/shared 中的接口契约。

### 页面和视觉

遵循 [产品原型](product-interactive-demo.html) 的纸白底色、深绿色点缀、细分隔线与「捕获 / 记录 / 回声」底部导航。手机满宽，桌面居中阅读；不模拟手机外壳和状态栏。

- 捕获：文字输入、本地草稿、防重复保存。保存后等待整理，不伪造即时 Topic；请求期间新输入的草稿仍保留。
- 记录：分页展示原文和 pending、processing、organized、skipped、updated 状态，关联 Topic 可点击跳转，包括已归档话题。
- 记录详情与编辑：原文、当前关联和上次整理说明；编辑后展示 updated，processing 时禁用编辑，服务端 409 仍作为最终保护。
- 回声：Topic 摘要、最近整理变化、本设备未读状态、手动整理入口。
- Topic 详情：浅色摘要卡片、可展开的相关原始记录；关联区固定约两条记录高度并在内部滚动，按 topicId 分页读取。多轮对话、录音、反馈、Record tag 不实现。

使用浏览器 Hash 路由，详情地址如 `/#/topic-detail?id=...`，可刷新和直接打开，支持浏览器前进后退。未知路由和缺少编号有返回入口。

### 数据边界

使用 fetch 和相对 `/api` 路径，TanStack Query 管理服务端缓存；localStorage 保存按开发用户隔离的草稿与已读标记。开发身份仍为 `x-user-id: default-user`，不是正式认证。

写操作不自动重试。网络异常保留草稿并提示结果待确认；整理请求超时不表示后端任务已经停止。分页仅使用 hasMore 与 nextCursor，不使用占位 total。Markdown 禁止原始 HTML，并经 DOMPurify 清洗。

### 启动与构建

```bash
pnpm install
pnpm dev         # 单独终端：后端
pnpm dev:h5      # 单独终端：Vite H5，http://localhost:5174
pnpm build:h5   # apps/h5/dist
```

可在 apps/h5/.env.local 配置 H5_PORT 和 BACKEND_URL，或通过进程环境变量传入。只有 /api 请求由开发服务器代理到后端；不要把模型密钥放进前端。生产部署需静态托管 apps/h5/dist，并将同源 /api 反向代理至后端。

根目录 `pnpm dev:frontend` 同样指向独立 H5。

### 验证

```bash
pnpm --filter @eiko/h5 typecheck
pnpm --filter @eiko/h5 test
pnpm --filter @eiko/h5 test:e2e
```

浏览器测试自动启动 5184 端口的独立 Vite 服务，并拦截全部 /api 请求，覆盖桌面和手机尺寸的捕获、分页、状态、关联跳转、编辑、失败恢复与 Markdown 安全渲染。需要本机 Chrome。测试不连接用户数据库、不调用真实模型。
