# V1 验收记录

验证日期：2026-10-12。环境为 Windows + WSL PostgreSQL 16 / Redis 7，Next.js 生产构建，FastAPI 本地进程。Linux Compose 配置已提供，尚未在目标服务器执行。

## 已通过

- TypeScript 类型检查与 Next.js production build。
- 7 项安全单元测试、1 项 Python 工具路由边界测试。
- 38 项 HTTP + PostgreSQL 集成检查：身份、产品范围、幂等并发、409 版本冲突、分镜唯一性、不可变历史、人工审批边界、审批摘要、Key 轮换/禁用/过期/撤销、权限收紧、委托运行凭据失效，以及 Skill/审计无密钥泄漏。
- 5 项恢复检查：跨 Worker 渠道并发锁、重复审批仅创建一条任务、批次部分成功、事务回滚不投递、保留签名结果 URL 并剔除供应商请求凭据。
- OSS 真实签名上传、签名续期、过期拒绝、SHA-256 校验、原始文本解析。上传确认后继续使用原暂存 URL 覆写，不影响已确认文件。
- Redis 消息丢失模拟：PostgreSQL 自动补发总览任务，10 个乱序镜头形成两页带编号与缺图占位的总览，结果转存到正式 OSS 路径。
- Skill ZIP 下载并安装至隔离目录、读取版本、保存私有配置、使用所选 Key 验证身份，未创建生成任务；验收 Key 随后撤销。Skill 官方结构验证器通过。
- Playwright / Edge：人类登录、产品编辑、Key 创建、创意分镜导航、聊天面板、390px 移动布局，无页面脚本错误和横向溢出。
- 修复快速切换页面时旧列表按新类型渲染的问题，最终生产构建上的浏览器回归通过。
- 三个应用进程重启后，内置 Agent 再次通过业务工具读取产品，并持久化完成结果。
- PostgreSQL 备份恢复至新建隔离数据库，核对 Resource、Revision、Job、FileObject、ApiKey、Conversation 数量一致，4 张 Agent checkpoint 表存在。

## 真实模型接口

| 能力                    | 结果                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------ |
| DeepSeek Flash 工具调用 | 在指定产品下创建创意批次与 2 条创意，业务对象与对话结果留存                          |
| DeepSeek Flash 识图     | 识别已生成桌面灯图片，返回产品与颜色描述                                             |
| gpt-image-2.5           | 成功生成一张产品图并转存 OSS；第一次上游失败记录保留，新尝试为独立批次               |
| suno-v6                 | 一次请求返回两首音乐，全部保存为可播放文件；域名白名单修复后仅重试转存，没有再次购买 |
| 工业分镜总览            | 已选图片按镜号拼接，生成可追溯的总览文件                                             |
| seedance-2.5            | 已准备 1 条 4 秒、480p、16:9、无音轨的真实测试批次，等待人类审批，未自动提交         |

视频待审批批次：`3eb5a615-9b96-45f6-85c0-630a9a38731f`。审批仅对该快照有效，改动参数或新增尝试需要新批次。

## 尚未完成的环境验收

1. 上述真实视频批次的人类批准、实际生成与输出核验。
2. Suno 音效型号 `suno-sound` 已实现适配，但本次付费验收只执行 `suno-v6` 音乐。

## 生产部署验收（2026-10-12）

- 服务器 `118.178.137.15`，网站 `https://aivideo.sligenai.cn`；独立生产数据库，不导入本地测试数据。
- Next.js 在 Linux Docker 中构建通过，数据库迁移与渠道初始化完成，网站与媒体 Worker 正常启动。
- Let's Encrypt 证书申请成功，有效期至 2027-01-09；`certbot.timer` 已启用，针对本域名的模拟续期及 Nginx reload hook 验证通过。
- 公网 17 项检查通过：HTTPS 健康检查、HTTP 跳转、安全 Cookie、管理员身份、渠道初始化、内部接口拒绝公网访问、OpenAPI 生产地址、Key 创建与撤销、私密接入指令不缓存、公开 Skill 无所选 Key、Agent 权限隔离及撤销立即生效。
- Edge 浏览器在生产域名下通过登录、产品创建、Key 接入、工业分镜归属、聊天面板与移动布局验证；验收产品已归档，测试 Key 已撤销。
- 从生产容器验证 DeepSeek `/models` 返回 200、AI Centre 鉴权查询通过、OSS Bucket 可读取。本轮部署不产生付费媒体任务。
- FastAPI/LangGraph 容器启动成功，内部健康检查正常；独立 `agent_checkpoints` schema 的 4 张表已初始化。
- 生产备份恢复到临时隔离数据库成功，User/Resource/Revision/ApiKey/Job 数量及 4 张检查点表与源库一致；临时库核验后删除。生产 Job 数为 0，证明本轮接入验证未创建生成任务。
- 已设置每日 03:40（服务器 CST）备份；配置和备份文件权限为 `600`、备份目录 `700`。完整备份保存在服务器，未上传公开仓库。

费用未收到供应商明确账单，因此标记未知，不推断免费或退款。测试数据不会影响真实业务；所有失败与恢复过程保留审计。

## 接口实现依据

- [AI Centre API 文档](https://aicentre2.sligenai.cn:8443/api-docs.md)
- [DeepSeek 识图接口](https://api-docs.deepseek.com/guides/vision/)
- [DeepSeek Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)
