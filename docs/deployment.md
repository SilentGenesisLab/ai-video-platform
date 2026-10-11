# Linux 部署与恢复

## 首次部署

1. 准备 Linux 主机，安装 Docker Engine 和 Compose 插件，将域名解析至主机，开放 80/443。
2. 复制源码和 `.env.example`，将副本保存为 `.env`。填写 DOMAIN、管理员、OSS、DeepSeek 与 AI Centre 配置；生成独立的数据库、Redis、服务鉴权和加密主密钥。
3. 数据库与 Redis 密码使用随机字母数字或十六进制，避免连接 URL 中未转义的特殊字符。`KEY_ENCRYPTION_SECRET` 必须为 64 位十六进制。
4. `chmod 600 .env`，执行 `docker compose config --quiet`，再执行 `docker compose up -d --build`。
5. 查看 `docker compose ps`、`docker compose logs --tail=100 migrate web worker agent`，访问 `https://你的域名/login`。

Compose 会等待 PostgreSQL 就绪，先应用迁移和 seed，再启动网站、Worker、Agent 与 Caddy。Caddy 自动申请 HTTPS。数据库、Redis、FastAPI 不发布到公网；内部业务服务路由被公网反向代理拒绝。

当前交付包含部署配置；没有在未知远程主机上实际部署。首次上线需在目标 Linux 环境运行以上检查。

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

建议每日备份、至少保留 30 天，并按业务要求复制到另一故障域。使用系统调度器调用项目中的 `scripts/backup.sh`；脚本本身不会安装定时任务。

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
