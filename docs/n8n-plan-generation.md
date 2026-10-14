# 创意 → 策划案 n8n 工作流

工作流：[Frameflow · 创意生成策划案 v1](https://n8n.sligenai.cn/workflow/nZgg7mZoxrRwLxHZ)。源码构建器：scripts/plan-workflow.ts，提示词在 planInstruction 内。

创意编辑窗口“生成策划案”先在事务中保存当前草稿，检查 baseVersion 并保存产品/创意快照，建立 plan_generation Job 和 Outbox。Worker 调用受 Header Auth 保护的 n8n webhook。n8n 读取快照 → 调用平台受限文本桥接 → 校验 JSON → 返回方案。Worker 通过现有业务服务保存新策划案及不可变来源版本，关联原创意；不会修改工业分镜表。

平台私有配置：N8N_PLAN_WEBHOOK_URL、N8N_PLAN_SECRET。后者放在 n8n httpHeaderAuth 凭据中，用于 webhook 和平台专用桥接接口。模型 Key 继续由平台加密保存；工作流不持有供应商 Key、不直写业务数据库。不要将私有配置提交仓库。全局 Codex n8n MCP 使用 N8N_API_KEY 用户环境变量，不把管理 Key 发送给应用或浏览器。

人类需要 read/write/generate 权限。首版生成入口仅允许人类会话；Agent 不可通过此入口越权。文本调用沿用平台免费文本规则和供应商用量追踪。同一创意只能有一个活动生成任务。关闭编辑窗口不停止任务，再打开同一创意会恢复本标签页进度。成功后“打开策划案”进入普通编辑器。

模型请求使用 plan:{jobId}:draft 幂等调用标识。n8n 只对快照读取进行重试，不盲目重试模型；平台已保存的模型结果可供重启恢复复用。来源后续修改不会覆盖快照。重复写回使用 Job 行锁，只创建一份方案。失败保留 Job 错误，可从日志状态查看；重试创建新的任务。

工作流关闭成功/失败执行数据持久化，避免 webhook 请求头和产品资料保存在 n8n 常规执行数据中；平台 Job、调用记录和审计承担来源追溯。n8n execution ID 保存在完成结果中。

测试：类型检查、单元验证、回滚事务集成验证（草稿版本、旧版本/重复/只读/Agent 拒绝、来源追溯及一次写回）；Playwright 检查成功、失败、版本冲突。真实链路测试由 E2E_LIVE_N8N=1 显式开启，创建验收资料，验证无个人积分扣除，完成后归档验收资源。该用例不生成图片或视频。
