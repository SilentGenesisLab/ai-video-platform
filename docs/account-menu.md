# 账号菜单、个人设置与反馈

左下角账号按钮打开向上展开的菜单，提供浅色/深色显示、个人设置、帮助与反馈、官网、产品用户协议、隐私政策和退出登录。菜单支持方向键、Escape 与点击外部关闭；弹窗使用原生 dialog 焦点约束，适配手机屏幕。

个人设置支持头像、昵称、脱敏手机号和邮箱展示、手机号短信绑定、校验当前密码后修改密码。改密撤销该用户其他登录会话，当前会话保留；密码验证失败限流。头像限制 PNG/JPEG/WebP、512KB，经服务端解码和重编码为 256px PNG 后存入 OSS。

反馈支持四类反馈、5–2000 字内容、最多 3 个附件，单个最多 5MB（PNG/JPEG/WebP/PDF/TXT）。记录与附件归属当前团队及提交用户。提交者查看自己的反馈；平台管理员可查看当前团队反馈。附件通过鉴权后生成十分钟下载签名，使用 attachment 响应。Agent Key 无法修改人类个人资料或提交/读取反馈。反馈提交不发送邮件或第三方消息。

新增迁移 `20261012080000_account_feedback`，仅添加 User.avatarKey 和 Feedback 表，兼容既有记录。发布前备份 PostgreSQL，执行 migrate deploy，再更新 web；worker 与 agent 的任务处理代码无需变更。

接口契约见 `/api/v1/openapi.json`。本地验证：`node --env-file=.env --import tsx tests/account-integration.ts`，只允许 3002/frameflow_teams 隔离环境；28 项检查覆盖上传、限额、反馈/团队隔离、Agent 拒绝、改密及会话撤销。浏览器覆盖账号菜单、资料保存、密码眼睛、反馈弹窗、菜单链接、键盘及 390px/1440px 布局。
