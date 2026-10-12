# Linux 部署与恢复

## 首次部署

1. 准备 Linux 主机，安装 Docker Engine 和 Compose 插件，将域名解析至主机，开放 80/443。
2. 复制源码和 `.env.example`，将副本保存为 `.env`。填写 DOMAIN、管理员、OSS、DeepSeek 与 AI Centre 配置；生成独立的数据库、Redis、服务鉴权和加密主密钥。
3. 数据库与 Redis 密码使用随机字母数字或十六进制，避免连接 URL 中未转义的特殊字符。`KEY_ENCRYPTION_SECRET` 必须为 64 位十六进制。
4. `chmod 600 .env`，执行 `docker compose config --quiet`，再执行 `docker compose up -d --build`。
5. 查看 `docker compose ps`、`docker compose logs --tail=100 migrate web worker agent`，访问 `https://你的域名/login`。

Compose 会等待 PostgreSQL 就绪，先应用迁移和 seed，再启动网站、Worker、Agent 与 Caddy。Caddy 自动申请 HTTPS。数据库、Redis、FastAPI 不发布到公网；内部业务服务路由被公网反向代理拒绝。

### 与现有 Nginx 共用服务器

目标站点为 `https://aivideo.sligenai.cn`，服务器 `118.178.137.15`，目录 `/opt/ai-video-platform`。使用独立 Compose 项目 `ai-video-platform`，生产库从空库初始化，不导入本地验收数据。

```sh
docker compose -f compose.yaml -f compose.server.yaml config --quiet
docker compose -f compose.yaml -f compose.server.yaml build web
docker compose -f compose.yaml -f compose.server.yaml build agent
docker compose -f compose.yaml -f compose.server.yaml up -d --no-build web worker agent
```

`web`、`worker`、`migrate` 共用 `ai-video-platform-app:${RELEASE_TAG}` 镜像；部署前设置唯一 `RELEASE_TAG`。覆盖文件只将网站发布到 `127.0.0.1:3210`，不启动 Caddy，数据库、Redis 和 Agent 仅容器网络可达。内存上限分别为网站 1 GiB、Worker 768 MiB、Agent/数据库各 512 MiB、Redis 256 MiB。生产媒体并发初始设为 2。

服务器覆盖文件为网站镜像设置阿里云 Debian 镜像源，仅影响本项目构建；默认 Dockerfile 仍使用 Debian 官方源。镜像导出后同一标签供 Worker 与迁移复用，不需要重复构建。

首次申请证书时，先为该域名配置仅 HTTP 的 ACME webroot `/var/www/aivideo-acme`，再运行 Certbot：

```sh
certbot certonly --non-interactive --agree-tos --register-unsafely-without-email \
  --webroot -w /var/www/aivideo-acme -d aivideo.sligenai.cn
```

取得证书后将 `deploy/nginx.conf` 安装为 `/etc/nginx/conf.d/aivideo.sligenai.cn.conf`，执行 `nginx -t && systemctl reload nginx`。保留 HTTP challenge 路径，其他 HTTP 请求跳转 HTTPS。系统 `certbot.timer` 负责续期，为本域名安装独立 deploy hook，在续期后校验并 reload Nginx；不要覆盖其他站点的配置或续期钩子。

日常状态使用上面的两个 `-f` 参数执行 `ps` 和 `logs --tail=100 migrate web worker agent`。更新前备份数据库与当前镜像标签；若涉及数据库迁移，应确认旧代码兼容后才能回退镜像，不能仅凭应用回退假定数据库已恢复。`.env` 仅留服务器私有配置，权限为 `600`；管理员凭据由部署者单独交付，不写入仓库。

## OSS

- 现有配置使用北京区域 Bucket `chorify-imgai`，应用默认前缀 `aivideo`。原先临时文件目录不用于正式资产。
- 服务端凭据仅需本 Bucket 目标前缀的读取、写入与签名能力；应用不执行对象删除。
- 浏览器默认通过受鉴权上传代理传输，避免依赖共享 Bucket 的 CORS 配置。外部 Agent 可直接使用签名 PUT URL。
- 上传 URL 过期时调用 `POST /api/v1/files/{id}/upload-url` 更新；不必重新创建文件记录。
- 对正式前缀不要配置自动过期规则。建议 Bucket 启用版本控制/异地复制；这些属于存储管理员配置，本项目不擅自改动共享 Bucket。

## 备份

```sh
mkdir -p backups
chmod 700 backups
docker compose exec -T postgres pg_dump -U aivideo -d aivideo -Fc > backups/aivideo-$(date +%Y%m%d-%H%M%S).dump
```

此备份包含业务 schema 和 `agent_checkpoints`。另外在独立、受控的密钥库备份 `.env` 中加密主密钥与连接配置；丢失主密钥将无法解密平台 API Key 和模型凭据。不要把 `.env` 与数据库包公开放在一起。OSS 正式文件长期保留，数据库备份只保存对象 Key 和内容哈希，不包含媒体二进制。

服务器已通过 `/etc/cron.d/ai-video-platform` 设置每日 03:40（服务器时区）调用 `scripts/backup.sh`，备份写入 `/opt/ai-video-platform/backups`，目录权限 `700`、备份权限 `600`。脚本使用临时文件加原子重命名，仅在 pg_dump 成功后发布备份。当前不自动删除备份；建议至少保留 30 天，并按业务要求复制到另一故障域。脚本本身不会安装定时任务。

## 恢复演练

在隔离的 PostgreSQL 数据库恢复，先验证表数、Revision 数、Job 状态和 OSS 对象可读性。恢复过程不要同时启动生产 Worker，以免处理历史队列。

```sh
# 在空的目标数据库中恢复；不自动覆盖现有数据库。
docker compose exec -T postgres createdb -U aivideo aivideo_restore
docker compose exec -T postgres pg_restore -U aivideo -d aivideo_restore --no-owner --exit-on-error < backups/选定备份.dump
docker compose exec -T postgres psql -U aivideo -d aivideo_restore -c 'SELECT count(*) FROM "Revision";'
```

生产切换时先停止 web/worker/agent，将数据库连接指向确认后的恢复库，使用原加密主密钥，应用迁移后启动。不要直接重用含旧 BullMQ 状态的队列命名空间；空 Redis 可由 PostgreSQL Outbox 与过期任务状态重建。所有 `submission_unknown` 须逐条核对供应商，不可手动改为 queued。

## 监控与故障处理

`GET /api/v1/health` 检查业务数据库连接。内部 `GET /api/v1/internal/metrics` 使用 `X-Service-Secret`，返回各任务状态数量、未投递事件数、最早积压时间与 Agent 状态，可接入现有监控系统。必须从容器网络访问，公网入口会返回 404。

建议告警：积压超过 10 分钟、`submission_unknown` 大于 0、转存失败持续 15 分钟、连续任务失败、数据库/磁盘空间不足，以及备份超过 26 小时未成功。日志不输出鉴权头或 Key；监控系统也应避免记录请求头和完整请求体。

| 状态                        | 处理                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| queued 长时间不动           | 检查 Redis、Worker、Outbox 和渠道并发上限                                                                      |
| submission_unknown          | 查询供应商后台的 external_ref；人类审核者用 `/jobs/{id}/reconcile` 提供供应商任务 ID，服务端验证归属后恢复查询 |
| running 查询报错            | 保留上游 ID，恢复网络后继续查询，不重新提交                                                                    |
| transfer_failed             | 检查 OSS、网络、结果域名白名单；使用“重试转存”                                                                 |
| failed                      | 查看具体错误。新生成是独立记录，视频须重新审批                                                                 |
| cancel_requested            | 等待供应商确认；取消请求不等于取消成功或退款                                                                   |
| 文件解析失败                | 原文件保留；检查解析渠道后 `/files/{id}/retry-parse`                                                           |
| Agent failed/stopped/paused | 检查渠道、权限和运行记录，再点击“继续”；会从检查点恢复                                                         |

供应商无法提供 external_ref 或无法证明尚未接单时，保留待确认状态并人工对账，不提供盲目重投按钮。

## 产品洞察版本发布

此版本沿用 `Resource.content`、`Revision` 和 `FileObject.metadata`，没有新建数据库表或批量改写历史。旧格式仅在读取时适配，主动保存后才写入结构化资料。发布前执行 `scripts/backup.sh`，保存旧镜像标签、提交号与私有配置，镜像构建成功后更新 web/worker；Agent 服务代码未变。

新增 `remark-gfm` 已写入 lockfile。公开 Skill 与接入指令版本均为 1.1.0，下载包包含产品洞察参考文档。升级后确认 `GET /api/v1/openapi.json`、Skill ZIP 和生产只读产品上下文可访问。

回退时先暂停业务写入，再使用上一个应用镜像及对应配置。旧版本不理解新字段，不应让旧客户端覆盖已补充的洞察；必要时从备份恢复到隔离库核对后切换，不直接覆盖在线数据库。素材解除关联不删除 OSS 文件，历史引用仍可追溯。

## 助手 1.2 发布

新增迁移、四个功能开关、方舟/博查私有配置、SSE 代理要求和回退限制见 [助手升级](assistant-upgrade.md)。构建必须使用独立发布目录，完成验证后再切换共享部署目录；多个工作树不能同时解压到 `/opt/ai-video-platform`。

## 助手 1.3.0 已上线（2026-10-12）

线上 https://aivideo.sligenai.cn 已返回 1.3.0。最终应用构建 `2ded4b1`，Agent 错误体读取修复 `af15818`；完整备份、迁移、镜像来源及生产验收记录见 [助手升级](assistant-upgrade.md#生产部署验收2026-10-12)。此前助手 1.2 发布段落是历史记录，已由本次合并版本替代。

生产采购价尚未配置，模型调用会暂停并提示配置采购价；管理员需按实际供应商计价录入，不能使用测试报价。回退先停新任务并处理会话附件，再恢复备份中的源码/配置与旧镜像；旧 Worker 不支持没有 productId 的会话附件。数据库迁移为兼容新增，正常镜像回退不覆盖在线数据库，数据库灾难恢复须另行核对备份时点后的业务数据。

## 管理后台 1.4.0

缺价阻断由默认估算计费替代。个人钱包、平台后台、官方价格和迁移约束见 [管理后台升级](admin-upgrade.md)。上面的 1.3.0 缺价说明仅描述旧版本行为。
