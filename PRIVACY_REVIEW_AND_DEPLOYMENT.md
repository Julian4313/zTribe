# Freetribe 隐私改造 Review 与部署步骤

## 改造后的数据边界

- `app.messages` 不再保存 `user_address`，普通消息改用 `author_id`（UUID）。
- `app.wallet_identities` 保存 `author_id -> wallet_address` 映射；只允许服务端 `service_role` 访问。
- `app.profiles` 的钱包地址主键不再允许 `anon` / `authenticated` 直接读取；个人资料通过 `/api/profile` 读取当前登录者自己的记录。
- 聊天历史和发消息统一经过 `/api/messages`。响应只包含昵称、是否本人、消息内容和签名媒体 URL，不包含钱包地址、作者 UUID、原始 Storage 路径、`event_key` 或 `system_payload`。
- 系统消息的 `event_key`、JSON payload 和历史 `content` 中出现的钱包地址均会在迁移时脱敏。
- `app.messages` 从 `supabase_realtime` 移除。Realtime 改订阅 `app.message_events`，该表只包含消息 UUID、房间 ID、序号和创建时间；浏览器收到事件后再请求安全消息 API。
- `reactions`、`pins`、`moderation`、`facade_submissions`、`task_drafts`、`invite_codes`、`bot_settings` 不再向普通客户端开放直接读取；`room_access` 仍通过原有 RLS 限制为本人记录。
- 图片/语音对象从调试阶段起统一使用随机 UUID 路径，不包含钱包地址；服务端只为这些新路径签发短期 URL。由于项目尚未上线，不增加历史媒体迁移逻辑。

## 部署前检查

1. 先备份 Supabase 数据库和 `chat-images` / `chat-voice` 两个 Storage bucket。
2. 确认服务端配置 `SUPABASE_SECRET_KEY`（或 `SUPABASE_SERVICE_ROLE_KEY`），不得使用 `NEXT_PUBLIC_` 前缀。
3. 确认 `app` 已加入 Supabase Exposed schemas，且 `supabase_realtime` 是显式表列表。若 publication 配置为 `FOR ALL TABLES`，本 migration 会主动报错停止；必须先改成显式表列表，确保 `app.messages` 不在其中。
4. 如果项目有仓库之外的机器人、Edge Function、SQL job 或链上事件写入器，先检查它们是否直接向 `app.messages` 写入 `user_address`。迁移后普通消息写入必须提供 `author_id`，系统消息不提供作者 ID；不能继续写 `user_address`。

## 建议执行顺序

这是一次破坏旧客户端兼容性的数据库变更，建议安排短暂维护窗口：

1. 暂停旧版应用写入（或进入维护模式），避免迁移过程中旧客户端继续读取/写入旧字段。
2. 在 Supabase Dashboard → SQL Editor 执行 `supabase/migrations/20261030190000_private_wallet_identity_boundary.sql` 全部内容。不要拆分执行。
3. 检查 SQL 执行结果无错误，再部署本 ZIP 中的新代码。
4. 确认应用服务端环境变量存在，重启部署实例。
5. 完成下方双钱包和媒体验收后再开放流量。

不要先部署新代码再执行 SQL：新代码依赖 `wallet_identities`、`messages.author_id` 和 `message_events`。也不要执行 SQL 后继续运行旧版前端：旧版会直接读取已撤销权限的表和已删除的 `messages.user_address` 字段。

## 验收清单

- 钱包 A 登录后自动创建默认昵称；刷新或另开标签页不覆盖已有昵称。
- 钱包 A 修改昵称后，其他用户看到昵称，不会看到地址或地址末六位。
- 钱包 B 读取自己的 `/api/profile` 只能得到 B 的资料；不能通过 Supabase Data API 直接查询 A 的 `profiles` 行。
- 钱包 A/B 在同一开放频道发消息，双方都看到正确昵称；消息 API JSON 中不包含 `user_address`、`author_id`、`wallet_address`、`event_key`、`system_payload`。
- `app.messages` 不在 `supabase_realtime` publication；`app.message_events` 在 publication，Realtime payload 不包含消息内容和身份字段。
- 非成员无法读取 Tribe 消息；有权限成员可以读取；禁言、冻结、持仓门槛仍按原逻辑执行。
- 图片和语音新消息可发送、显示、播放；新对象路径及签名 URL 均不包含钱包地址。
- Emoji、连续发送、自动滚动、历史消息加载、失败提示和重试仍正常。

## 未完成的验证与风险

- 本地没有用户 Supabase 项目的凭据，未执行真实 migration，也未对真实数据库做 RLS、publication、Storage 或历史数据回填测试。
- `npm ci` 在当前环境两次超时；因此无法完成完整 `tsc --noEmit`、ESLint 和 Next.js production build。已对 20 个 TS/TSX 文件执行 TypeScript 转译语法检查，0 项语法诊断；这不等同于完整类型检查或生产构建。
- 本轮没有在浏览器中进行双钱包、图片、语音、频道权限和断线重连的端到端测试。
