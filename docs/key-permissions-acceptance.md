# API Key 权限与范围 · 1.5.0 验收

日期：2026-10-13。上线地址：https://aivideo.sligenai.cn/studio/keys 。应用镜像：`v1.5.0-keys-92d84b6`；应用源码提交：`92d84b6bbdf80f67c729f2ea44fe81bc145425f7`。

## 完成内容

创建、编辑共用权限选择器；20 项权限按模块分组，可逐项、分组或全选、清空、恢复推荐，部分选择显示中间状态。推荐 18 项生产权限（排除日志与积分查询）。范围明确为全部或指定产品，独立分页搜索及跨页全选，指定模式至少选一个产品。详情可展开授权，保存固定在弹窗底部，手机列表横向滚动。

服务端对业务资源、上下文、文件、报价、批次、任务和聊天工具检查细分授权；混合任务列表过滤无权模块。原始 Key/运行范围与当前成员/Key 权限交集约束执行。人工审批、成员/Key 管理、采购价修改、渠道凭据永不授予 Agent。旧 Key 延续三类 scopes 兼容映射；旧客户端隐式扩大细分 Key 授权返回 409。Skill、ZIP 与 OpenAPI 为 1.5.0。

## 验证记录

| 验证 | 结果 |
| --- | --- |
| TypeScript 类型检查 | 通过 |
| Vitest 回归 | 10 个文件，49 项通过 |
| 隔离库 API 验收 | 63 个接口断言通过 |
| Playwright 桌面／手机 | 通过；126 个产品的分页搜索、跨页全选、保存与再次编辑 |
| 本地生产构建 | Next.js webpack 构建通过；本地依赖使用隔离 Prisma 目录 |
| Linux 生产镜像 | 标准 Docker 构建（Turbopack），Web 与 Agent 均通过 |
| 生产 HTTPS 验收 | 21 个接口检查；产品读取、模块拒绝、人工审批拒绝、权限收紧、轮换、撤销、公开 Skill/ZIP/OpenAPI 通过 |
| 付费媒体调用 | 0；隔离验收仅免费报价与视频待审批提交，未创建对应视频 Job |

API 验收包含指定范围／跨团队拒绝、依赖校验、旧客户端 409、metadata 更新保留细分权限、只读成员不能越权授予、未来产品纳入全部范围、收紧权限后幂等重放拒绝、运行凭据取当前 Key 权限交集、禁用与过期、成员降权、混合列表过滤。

生产验收只创建临时访问 Key，结束后撤销，关联审计保留。隔离测试资源归档、团队停用、Key 撤销；没有删除正式产品或媒体。浏览器截图与验证 JSON 归档在服务器备份目录，不包含完整 Key 或登录凭据。

## 备份与部署

生产备份：`/opt/ai-video-platform/backups/pre-key-permissions-20261013-012505/aivideo-20261013-012505.dump`。该目录另存更新前环境、Compose 文件和镜像标识（仅服务端私有权限）。先备份，再执行增量迁移 `20261013010000_key_permissions`，然后更新 Web、Worker、Agent；PostgreSQL 与 Redis 服务保持运行。

迁移给 ApiKey、AgentRun 增加 permissions 和显式范围；旧非空 productIds 标记 selected、空数组标记 all，原始 scopes 与历史修订保持原样。旧版应用不识别细分授权，若回退到旧版，必须先禁用细分 Key 和关联运行凭据，避免按粗粒度 scopes 扩大权限。回退应恢复备份中的环境与镜像配置；数据库新增字段可以保留。

复验：`npm run typecheck`、`npm test`、`npx tsx --env-file=.env tests/key-permissions-integration.ts`、`npx playwright test tests/key-permissions.browser.spec.ts`。集成与浏览器大批量产品 fixture 仅允许隔离测试数据库。
