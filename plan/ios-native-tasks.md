# Eiko 原生 iOS 实施任务

关联方案：[iOS 原生工程方案](ios-native-plan.md)。任务按依赖顺序排列；完成每项后更新状态与验收证据。

## P0：工程与契约

- [ ] 1. 创建 `apps/ios/Eiko.xcodeproj`，配置 iOS 17 部署目标、Debug/Staging/Release schemes 与 `.xcconfig`。
  - 验收：模拟器能启动空壳 App；三套配置不包含生产密钥。
- [ ] 2. 建立 APIClient、Codable DTO、错误模型和 Mock APIClient，逐项映射 [HTTP API](../docs/api/http-api.md)。
  - 验收：Record、Topic、游标和错误响应的单元测试通过。
- [ ] 3. 建立 DesignSystem：颜色、字体、间距、标签、摘要卡片、状态与 Topic 标签组件。
  - 验收：颜色和尺寸与 [跨端 UI 指南](../docs/frontend/cross-platform-ui-guide.md) 一致，支持动态字体。

## P1：核心体验

- [ ] 4. 实现 Capture：本地草稿、创建 Record、保存中、成功、失败保留和网络异常提示。
  - 验收：断网或超时后草稿不会丢失。
- [ ] 5. 实现 Record 列表、分页与空态；原文两行截断，时间、状态、关联 Topic 按规定顺序展示。
  - 验收：状态与 Topic 标签底色不同，分页不依赖 total。
- [ ] 6. 实现 Record 详情和编辑，处理 processing 禁止编辑、相同内容不改变状态等服务端规则。
  - 验收：详情显示完整原文，PATCH 异常能正确反馈。
- [ ] 7. 实现 Topic 列表和详情，包括摘要卡片、170pt 关联原始记录滚动区、最近变化与受控 Markdown。
  - 验收：Topic 详情没有固定页头或额外横线；关联记录不展示状态和 Topic。

## P2：系统适配与质量

- [ ] 8. 实现 iOS 17–25 的纸白主题与 iOS 26+ 的条件式 Liquid Glass 增强。
  - 验收：Glass 只出现在系统导航或经批准的操作控件；降低透明度和减少动态效果的回退正确。
- [ ] 9. 补齐单元测试、UI 测试与真机验收：动态字体、VoiceOver、iPhone/iPad、安全区、网络错误和深浅模式。
  - 验收：iOS 17、iOS 26+ 模拟器及至少一台真机均完成核心路径。

## P3：服务与发布

- [ ] 10. 建立 Staging 云端 server：HTTPS、持久化 SQLite 卷、备份、日志、健康检查与受管模型密钥。
  - 验收：真机可通过 HTTPS 使用独立测试数据；服务重启后数据和向量索引可恢复。
- [ ] 11. 收紧生产 CORS、实现正式认证与用户隔离，移除发布版本对固定 `x-user-id` 的依赖。
  - 验收：不同账号无法读取对方 Record 或 Topic；模型密钥不出现在客户端。
- [ ] 12. 配置签名、版本号、隐私信息、图标、TestFlight 和发布检查表。
  - 验收：内测包可安装、提交反馈、查看崩溃报告；满足 App Store 提交资料要求。
