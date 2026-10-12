# 创意助手 1.3：实现与验收

## 已实现

- DeepSeek 使用 `stream: true`；正文分片、工具状态、附件状态持久化到 PostgreSQL。Redis 唤醒 SSE，断连按游标补发，事件幂等；内部推理不进入网页。
- 附件归属会话，不需要产品。上传与分析分离，发送后才解析；消息可只包含附件。文件确认采用临时磁盘、流式哈希、独立不可变 OSS 对象，保留 512 MB 上限。
- TXT、Markdown、CSV、PDF、DOCX、XLSX、PPTX 保留内容及定位；工作表公式只读缓存结果。扫描 PDF 和空内容明确失败。图片和音频复用现有识图/ASR。
- 豆包固定 `doubao-seed-2-1-pro-260628`。小视频使用新签名 URL，大于 50 MB 使用 Ark Files API；有音轨才调用 ASR。结果记录原文、结构化时间轴、来源哈希、模型、提示词版本和用量。
- 公网 HTTPS 直链由 Worker 下载并转存。逐次验证 DNS 和重定向，连接固定解析地址，拒绝私网、保留地址、分享网页和超限文件。
- 博查 `web_search` 作为 Agent 工具，保存并显示实际来源，默认每次回答最多 5 次；渠道可配置超时、并发、启停及凭据。
- `waiting_inputs` 释放 Agent 执行占用；停止保留正文，继续等待未完成附件，检查点和请求幂等防止重复执行已完成的写入。已落库的供应商结果可在重启后本地恢复；不明提交不自动重投。
- 右侧固定覆盖面板，520px 默认宽度、380–960px 桌面边界、左边缘鼠标/触摸/键盘调宽，手机全屏；跨页面保留草稿、附件和连接。向上阅读时显示新内容提示。
- 保留已上线的产品洞察工作台；“保存到产品”新增独立文件引用并追加结构化 materials，保留原会话附件和 baseVersion 冲突检查。
- OpenAPI、Skill 安装包及使用例同步为 1.3.0，公开文件不包含业务数据或凭据。

## 本地验证（2026-10-12）

| 验证                 | 结果                                                              |
| -------------------- | ----------------------------------------------------------------- |
| 生产构建、TypeScript | 通过                                                              |
| Playwright / Edge    | 26/26：原有流程、产品洞察及 4 个新助手用例                        |
| Node 单元测试        | 34/34：文档、PDF 空内容、Office、SSRF、视频正常/故障恢复等        |
| Python Agent         | 6/6：分片拼接、工具 JSON、推理隔离、断流和停止                    |
| 原有 API 集成        | 38/38                                                             |
| 助手 API 集成        | 17/17：并发事件去重、游标、停止继续、附件权限、保存产品和版本冲突 |
| 产品洞察 API         | 17/17                                                             |
| 原有恢复测试         | 5/5                                                               |
| Skill 安装和只读鉴权 | 通过；不创建生成任务                                              |

真实链路已验证：DeepSeek 在完成前产生多次可见正文增量，刷新保留完整回答；仅附件发送先解析再回复；博查返回来源且幂等重放不再搜索；豆包识别自制六秒红蓝静音视频，保存原始响应、用量及时间轴。分别测试小文件签名 URL 和大于 50 MB 的 Files API 输入。大文件样本在同一六秒 MP4 后追加合法 free atom，验证大小分支，不等于长视频质量或最大负载压测。HTTPS 直链导入完成后仍为 deferred，没有提前购买识别。

ASR 失败/成功、HTTP 429、提交后断线、落库后重启、私网重定向和过期链接以确定性故障注入验证；未声称已经完成真实长音轨、512 MB 极限负载或全部文档格式的浏览器上传压测。文档解析覆盖七种格式，浏览器附件链路覆盖 TXT 和视频，图片/音频沿用现有渠道。

## 复现

常规验证使用隔离测试数据库和 Redis，禁止把直接写库的集成脚本指向生产库：

```sh
npm run build
npm test
python -m pytest agent -q
npm run test:integration
npx tsx --env-file=.env tests/assistant-integration.ts
npx tsx --env-file=.env tests/product-insights-integration.ts
npm run test:recovery
npx tsx --env-file=.env tests/skill-install.ts
```

浏览器 `PLAYWRIGHT_CHANNEL=msedge`，`E2E_LIVE_AGENT=1` 显式开启文本模型测试；`npx playwright test`。付费供应商验收独立运行：`LIVE_ASSISTANT=1 npx tsx --env-file=.env tests/live-assistant.ts`；增加 `LIVE_LARGE_VIDEO=1` 验证 Files API 路径。每次会产生少量搜索/识别费用，费用不推断为免费。

## 发布与回退

新增兼容迁移 `20261012050000_creative_assistant`，四个独立开关为 `ASSISTANT_STREAM_ENABLED`、`ASSISTANT_ATTACHMENTS_ENABLED`、`ASSISTANT_VIDEO_ENABLED`、`ASSISTANT_SEARCH_ENABLED`。关闭流式开关后保留查询回退；关闭新附件/搜索/视频识别开关后 API 拒绝相应新请求。

通过私有环境配置 `ARK_API_KEY` 和 `BOCHA_API_KEY`，seed 仅首次导入渠道并加密保存；已有渠道更新通过管理员页面完成。固定模型不自动替换。

发布前备份 PostgreSQL 和私有配置，保留旧镜像。Nginx 保留 `proxy_buffering off`、300 秒读超时；SSE 返回 `X-Accel-Buffering: no`、no-store 和心跳。外网拒绝 `/api/v1/internal/`。确认 HTTPS 流式、权限与文件播放后才标记生产验收完成。

不要直接回退不认识会话附件的旧 Worker：新增文件 productId 可为空。先关闭新功能、停止新任务接收并排空/暂停新任务，再使用兼容代码回退；恢复数据库需单独评估发布后写入，不能丢弃新业务数据。

本轮生产备份：`backups/aivideo-20261012-133806.dump`。构建期间发现另一工作树同时发布多团队权限并覆盖共享源码及 RELEASE_TAG，因此生产切换待发布顺序确认；本地测试通过不等同于生产已上线。

独立目录 `/opt/ai-video-platform-releases/assistant-911cd67` 构建成功；应用与 Agent 镜像标签均为 `v1.2-assistant-911cd67`。在 Linux 镜像中再次运行 Node 34/34 和 Python 6/6 测试通过。共享部署目录内属于本任务的源码残留已按哈希核对后备份撤回，其他任务修改未覆盖。构建源改为独立发布目录，避免并行任务覆盖构建上下文。服务器 Python 构建可用阿里云 PyPI 镜像，默认 Dockerfile 仍使用官方源；依赖版本锁定。依赖审计仍存在上游告警（包括既有图像处理依赖），本轮未执行破坏性大版本升级；运行时不开放开发测试服务器。

## 官方接口依据

- [DeepSeek 流式接口](https://api-docs.deepseek.com/api/create-chat-completion/)
- [方舟视频理解](https://docs.volcengine.com/docs/ark/video-understanding?lang=zh)
- [方舟 Files API](https://docs.volcengine.com/docs/ark/file-api?lang=zh)
- [博查 API 与响应字段](https://github.com/Bocha-Labs/bocha-skills/blob/main/bocha-web-search/SKILL.md)


## 合并审查与主分支兼容（2026-10-12）

本轮合入主分支 `7d8b933` 的手机号账号、多团队和积分计费，版本统一为 1.3.0。保留产品洞察与现有人工视频审批。修复了幂等响应在权限收紧后仍可能返回旧会话/文件结果、新建会话草稿被初始化覆盖、上海数据库时区导致 UTC 租约提前失效，以及 SSE 非法游标错误未正确返回的问题。

任务领取改为先锁会话、再复核并锁运行，与停止和事件写入保持一致。新增 `20261012070000_assistant_team_scope` 兼容迁移，为附件分析、搜索和流事件补齐团队归属。会话/文件访问显式校验团队，面板与草稿按用户和团队分别保存。

流式模型调用经服务端计量代理，返回增量的同时保存调用记录，完成后结算；已完成调用重放不再购买，提交结果不明时保留冻结并等待对账。搜索、视频理解和其音轨转写也进入现有计费规则。采购价后台支持 search/video_understanding，方舟 input_tokens/output_tokens 用量可结算。没有采购价时禁止调用；未向生产写入猜测价格。

合并验证：生产构建与类型检查通过；Node 34/34、Python 6/6；完整 Playwright 26/26（包含真实 DeepSeek 流、只带附件发送、报价后提交审批、邮箱登录、角色和跨页面草稿）；原业务接口 38/38；助手接口 19/19；产品洞察 17/17；恢复 5/5；权限收紧重放四组回归、37 项团队 HTTP 检查、既有计量集成和新增流式计量/团队附件隔离集成均通过；Skill 1.3 安装与只读身份验证通过。

复现补充：`node --import tsx --env-file=.env tests/idempotency-integration.ts` 和 `tests/assistant-billing-integration.ts`。团队脚本原有隔离环境继续可用；本地 `127.0.0.1:3000` / `127.0.0.1:55432/aivideo` 测试库需显式设置 `ALLOW_LOCAL_REVIEW_TESTS=1` 才允许运行团队脚本。真实文本浏览器用例需要先在隔离测试库配置明确标记为测试数据的采购价，不能将测试价复制到生产。视频、搜索供应商真实连通性沿用前述验收，合并后的计费故障路径使用模拟响应验证。

本次交付为代码审查和仓库合并，未切换生产。前述 911cd67 Linux 镜像是助手合并前的构建，不能当作 1.3.0 最终镜像上线。部署合并版本需重新构建应用和 Agent，备份数据库并应用缺少的迁移，配置实际采购价后验证 HTTPS 流式、团队权限和钱包。
