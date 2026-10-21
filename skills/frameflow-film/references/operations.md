# 运维手册

## 七条工作流

全部以 `Frameflow Film · ` 开头，部署脚本按名字**原地更新**（ID 不变，n8n 每次生成新 versionId）。

| 名称 | 作用 | 当前 ID |
|---|---|---|
| 下单 | 校验参数、建任务行、触发编排器 | `eCRXrC3jz16gi0zW` |
| 编排器 | 出分镜、分组、派发单元、推进状态 | `tgXgZ6J0GkCTFUgt` |
| 单元生成 | 一段 = 一次视频请求，轮询到出片并写回 | `EQcEl47fXrGjXnXI` |
| 合成成片 | 调平台 `internal/film-assemble` | `O3rL8vWOoXzt4Kgm` |
| 审批门 | 验签、写回批准/驳回、唤醒编排器 | `ldnnROQ2jc8P6Cvu` |
| 查状态 | 只读聚合任务与单元进度 | `3govhTSldSVvuGPx` |
| 定时认领 | 每 2 分钟扫活动任务交给编排器 | `Fljmw4NrummzLsK7` |

ID 会写进 `film-deploy-ids.json`；改完重新部署后以该文件为准。

## 部署

```bash
N8N_API_KEY=... \
FILM_JOBS_TABLE=tJe6uFcUL86pJQge \
FILM_UNITS_TABLE=wcaSSN5CjdfwPniO \
FILM_HEARTBEAT_TABLE=PvwSYBQ1dTcBpTJS \
FILM_CRED_AICENTRE=... FILM_CRED_DEEPSEEK=... FILM_CRED_ORDER=... \
FILM_PLATFORM_SECRET=... \
npx tsx scripts/deploy-film.ts
```

`FILM_PLATFORM_SECRET` 就是平台服务器上的 `INTERNAL_SERVICE_SECRET`。脚本先用 `FILM_CRED_PLATFORM`；没给就按名字 «Frameflow Film · 平台合成» 找；再没有就用这个 secret 现场建一个 `httpHeaderAuth` 凭据（header 名 `x-service-secret`）。

可选覆盖：`FILM_PLATFORM_BASE`（默认 `https://aivideo.sligenai.cn`）、`FILM_UNIT_CONCURRENCY`（3）、`FILM_ASPECT_RATIO`（16:9）、`FILM_TARGET_SECONDS`（40）、`FILM_TARGET_LUFS`（-16）、`FILM_LIMIT_DBTP`（-1.5）、`FILM_FADE_OUT_SEC`（2.5）。

部署会先把线上定义整份备份到 `film-workflow-backup.json` —— **该文件含签名密钥，不要提交到仓库或发给别人**。

Windows 下必须用脚本里的 `curl --data-binary @file` 方式传中文，直接 `-d '{...}'` 会把中文变成 U+FFFD 导致节点重名被拒。

## 平台侧前置条件

`aivideo.sligenai.cn`（`118.178.137.15:/opt/ai-video-platform`）需要：

- `src/lib/film-media.ts` + `src/app/api/v1/[...path]/route.ts` 里的 `film-assemble` 分支；
- 环境变量 `INTERNAL_SERVICE_SECRET`（compose 通过 `env_file: .env` 注入）；
- 镜像自带 `ffmpeg`（Dockerfile 已装）；
- Nginx 放行内部路径。默认整段 `/api/v1/internal/` 是 `return 404`，**必须**加一条更早匹配的 location：

```nginx
location ^~ /api/v1/internal/film-assemble {
    proxy_pass http://127.0.0.1:3210;
    proxy_read_timeout 900s;
    proxy_send_timeout 900s;
    client_max_body_size 1m;
}
```

`proxy_read_timeout` 要 ≥ n8n 合成节点超时（900 秒）——长片 + 慢盘会超过默认 300 秒。

## 心跳

心跳表 `PvwSYBQ1dTcBpTJS`：

- `key = cron`：定时认领每次触发都刷新 `at`（正常是 2 分钟一跳）。
- `key = last_error`：编排器抛错时由 cron 的错误出口写入。

`cron` 行不动 = 定时器没跑（工作流未激活或 n8n 实例异常），**不是**业务错误。手动跑一次「定时认领」再确认行有没有更新。

## 排障对照

| 现象 | 先查 |
|---|---|
| 下单 422 | `details` 数组；最常见是缺 `reference_image_urls` 或不是 https |
| 下单 401/403 | `X-Film-Token` 与 n8n 里 «开单令牌» 凭据不一致 |
| 停在 `planning` 超过 10 分钟 | 编排器执行记录（DeepSeek 报错会写 `error`） |
| 停在 `awaiting_approval` | 正常 —— 等人批；不要当故障重试 |
| `generating` 单元卡住 | units 表该行 `error`；视频模型超时或内容审核 |
| 合成失败 HTTP 404 | Nginx 挡住了 `/api/v1/internal/`，或平台还没部署 film-media |
| 合成失败 HTTP 401/403 | n8n «平台合成» 凭据里的 `x-service-secret` ≠ 平台 `INTERNAL_SERVICE_SECRET` |
| 合成失败 HTTP 422 | 段数 0 / >20，或响度参数越界 |
| 合成失败 HTTP 502 | 素材 URL 取不到、首段无视频流、拼接后时长为 0 |
| `delivered` 但 `result_url` 为空 | 查任务行 `error` 与合成工作流最后一次执行 |

## n8n 实例约束（改工作流前必读）

1. **没有 `executeCommand`** —— 任何 shell/ffmpeg 都不可能在 n8n 里跑，合成必须外置。
2. **Code 节点禁用 `require()`** —— 签名用 crypto 节点，不要 import。
3. **HTTP / dataTable 节点会用响应体替换 item 的 `json`** —— 后续表达式要用 `$('节点名').first().json` 取回上游。
4. **dataTable 查询无命中输出 0 个 item**，整条支路不执行 —— 「查不到也要继续」的读节点必须 `alwaysOutputData: true`。
5. **节点名必须唯一** —— 中文名在编码损坏时会退化成 U+FFFD 并重名被拒。

## 已知悬空项

- 平台服务器源码可能比本地仓库新（例如 `storyboards/convert-act`）。**改服务器上的 `route.ts` 时只做增量合并，不要整文件覆盖。**
- `film-workflow-backup.json`、`.env` 属于私密产物，不进交付物。
