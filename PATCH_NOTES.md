# 本次代码修改说明

本次修改包括三项：部落发言权限验证优化、moderation 定向查询，以及消息发送即时展示。

## 1. 部落持仓校验缓存

文件：`app/lib/room-post.ts`

- 发言前仍然检查全站禁言、房间冻结和房间禁言。
- 对部落房间，先查 `app.room_access` 是否存在未过期的授权。
- 授权有效期内不重复调用 BSC RPC 的 `balanceOf` 和 `AUTO_DELEGATE_MIN`。
- 缓存有效期仍是 15 分钟；命中缓存时不延长过期时间，避免用户持续发言导致链上余额永远不再复核。
- 缓存过期后重新查链；余额不足会删除旧授权。

安全取舍：用户转出代币后，最多可能在当前 15 分钟授权窗口内继续发言/读取部落内容。这是用短时缓存换取减少 RPC 请求的明确取舍。

## 2. moderation 定向查询

文件：`app/lib/room-post.ts`

- 不再读取所有未撤销 moderation 记录再由 JavaScript 过滤。
- 改为只查询当前钱包的全站禁言、当前房间冻结、当前钱包在当前房间的禁言。
- 三个小查询并行执行，只选择 `id`，减少返回数据量。

## 3. 数据库索引迁移

新增：`supabase/migrations/20261030130000_optimize_moderation_lookup.sql`

为当前房间 moderation 和全站禁言的定向查询增加部分索引。

部署前请在 Supabase SQL Editor 执行该迁移文件中的 SQL，或使用项目原有的 Supabase migration 流程应用新迁移。

## 验证状态

- `room-post.ts` 和 `home-client.tsx` 的 TypeScript/TSX 语法转译检查通过。
- 完整 `tsc` / ESLint / Next.js build 未能完成：当前工作副本没有完整 `node_modules`，之前依赖安装在执行环境中超时。请在本地安装依赖后继续验证。

## 建议手动验收

1. 使用持仓达标的钱包首次在部落发言：应执行链上校验并创建 15 分钟 `room_access`。
2. 15 分钟内连续发言：应复用授权，不应每条消息都触发两次 `eth_call`。
3. 等授权过期后再次发言：应重新执行链上校验并刷新授权。
4. 将测试钱包余额降到门槛以下，等待当前授权过期后发言：应返回“持仓没有达到入群门槛”。
5. 设置全站禁言、房间禁言或房间冻结：应继续按原规则阻止发言。

## 2026-10-30：发送消息即时展示（Optimistic UI）

- 修改 `app/home-client.tsx`：点击发送后，先在本地消息列表插入一条临时消息，不再等待 `/api/messages`、权限检查和 Supabase 写入完成后才显示。
- 清空输入框并显示“发送中…”，服务端确认后用正式数据库消息替换临时消息。
- 如果 Realtime 事件先于 POST 响应到达，会优先用 Realtime 正式消息替换本地临时消息，避免短暂重复显示。
- 如果服务端返回失败或网络异常，保留该条临时消息并标记“发送失败（消息未确认保存）”，同时显示错误信息；401 时移除临时消息并跳转登录。
- 本次只优化前端感知速度，不缩短服务端验证流程、不绕过身份/房间/禁言检查，也不代表消息已提前写入数据库。

## 3. 发送按钮不再等待上一条消息的 API 请求

- 移除全局 `isSending` 锁；每条消息仍然先乐观显示，再独立等待自己的 API 请求。
- 输入框和发送按钮不再因为上一条消息处于网络请求中而禁用，用户可以连续发送多条消息。
- 每条消息仍通过独立的 optimistic ID 处理成功替换或失败标记；Realtime 收到当前用户同内容消息时，优先替换最早的对应发送中消息。
- 这不会降低单条消息的 API 实际耗时，只是避免上一条请求阻塞下一条消息的输入和发送。多条消息并发请求时，若发送相同内容，Realtime 与 POST 响应的先后顺序仍需真实环境验收。


## 2026-10-30：Emoji 与图片消息

- `app/home-client.tsx` 增加 Emoji 选择面板；选择表情会插入当前文本输入框。
- 增加图片选择入口，支持 JPG、PNG、GIF、WebP，单张最大 10 MB。
- 图片先显示本地预览，再上传并写入 `app.messages`（`kind = image`、`media_url` 保存对象路径）；发送失败时保留失败预览。
- `app/api/messages/route.ts` 继续复用 `requireWallet` 和 `authorizeRoomPost`，服务端校验 MIME/大小，使用服务端 Supabase 密钥上传图片；数据库写入失败时尝试清理已上传文件。
- 新增 `supabase/migrations/20261030150000_chat_image_storage.sql`：创建私有 `chat-images` bucket，限制 10 MB 和允许的图片 MIME；Storage 读取策略通过 `app.can_read_room()` 检查用户是否仍有权读取对应房间。
- 图片对象路径保存在 `media_url`，前端通过 Storage RLS 获取 1 小时有效的签名 URL；没有将 Tribe 图片设为公开桶，避免任何持有公开 URL 的人都能直接访问。页面重新加载消息时会重新签发 URL。

### 部署要求

在 Supabase SQL Editor 执行新增 migration：`supabase/migrations/20261030150000_chat_image_storage.sql`。之前的 moderation 索引 migration 如果已执行，无需重复执行。服务端必须已有 `SUPABASE_SECRET_KEY`（或旧变量 `SUPABASE_SERVICE_ROLE_KEY`），否则图片上传接口无法工作。

### 验收

1. 打开聊天输入框的 😊，选择表情后应插入输入框，发送后作为普通文字消息保存。
2. 点击图片图标，选择小于 10 MB 的 JPG/PNG/GIF/WebP，聊天区应立即显示本地预览，随后显示已上传图片。
3. 刷新页面后，图片仍应显示；重新进入 Tribe 房间时，非授权钱包不应通过 Storage 签名 URL 读取该房间图片。
4. 尝试大于 10 MB 或不支持格式的文件，应在前端和服务端均被拒绝。

### 验证状态

本次完成代码修改与静态检查；尚未连接用户的 Supabase 项目执行 migration，也未完成真实上传、Storage RLS、Realtime 和浏览器验收。


## 2026-10-30：语音消息

- 输入区增加麦克风录音入口；用户主动点击后才请求浏览器麦克风权限，点击停止后自动上传并发送。
- 使用浏览器 MediaRecorder 录音，优先选择 Opus/WebM，按浏览器能力回退到 MP4 或 OGG。
- 单条录音最长 2 分钟、最大 10 MB；支持 WebM、MP4、OGG、MP3、WAV MIME。浏览器实际录制主要为 WebM/MP4/OGG。
- `app/api/messages/route.ts` 对语音类型、MIME 和文件大小进行服务端校验；复用现有钱包身份验证和房间发言权限检查。
- 音频写入独立私有 Storage bucket `chat-voice`，消息表写入 `kind = voice` 和私有对象路径；前端重新签发 1 小时 URL，并使用原生 audio 播放控件。
- 新增 `supabase/migrations/20261030160000_chat_voice_storage.sql`，创建私有 bucket，并通过 `app.can_read_room()` 限制房间音频读取权限。

### 部署要求

在 Supabase SQL Editor 执行 `supabase/migrations/20261030160000_chat_voice_storage.sql`。之前的图片 Storage migration 仍需执行；如果尚未执行，请先执行 `20261030150000_chat_image_storage.sql`，再执行本次语音 migration。

### 验收

1. 使用 HTTPS 部署地址或 localhost 打开项目，点击麦克风并允许浏览器访问麦克风。
2. 录制几秒后点击停止，应出现一条带播放控件的语音消息。
3. 刷新页面，历史语音仍可播放。
4. 拒绝麦克风权限时应显示错误，不影响文字和图片消息。
5. 录音达到 2 分钟自动结束；超过 10 MB 的文件应被拒绝。

### 限制与验证状态

- 这是录制后发送的语音消息，不是实时语音通话或按住说话的流式传输。
- 录音依赖浏览器 MediaRecorder 和安全上下文（HTTPS 或 localhost）；不同浏览器支持的音频编码不同。
- 完成代码修改和静态检查；尚未连接用户的 Supabase 项目执行 migration，也未完成真实麦克风、音频上传、Storage RLS、浏览器播放及完整 Next.js build 联调。

## 第六轮：发送消息后自动滚动到底部
- 聊天消息列表增加滚动容器引用；发送文本、图片或语音时，在乐观消息插入后自动平滑滚动到底部。
- 为聊天主区域和消息列表补充 `min-h-0`，避免 Flex 布局下滚动区域被内容撑开，导致无法正确滚动。
- 本轮只调整前端滚动行为，不涉及数据库或 SQL migration。
- 验证：`home-client.tsx` TypeScript/JSX 语法转译通过，ZIP 完整性检查通过；尚未在用户浏览器中做真实交互验收。


## 本轮整合：频道缓存、失败消息处理与昵称隐私

- 以 `project-core-emoji-image-voice-autoscroll.zip` 为基础，整合后续提供的 `home-client-improved.tsx`，保留频道消息缓存、向上加载历史消息、非底部时新消息提示、发送失败重试等后续改进。
- 频道消息缓存限制为最近 10 个频道，避免持续切换频道造成内存无限增长。
- 切换频道时立即关闭发言权限，等待新频道权限检查完成，避免短暂沿用上一个频道的权限。
- 对 400/403/422 等明确拒绝的发送结果，立即移除未保存的乐观消息；网络等不确定错误仍保留失败状态并允许重试。
- 新用户首次进入聊天或个人资料页时，按 Supabase 用户 UUID 末 6 位生成稳定昵称，例如 `User_A82F91`，不再从钱包地址截取字符，并保存到 `app.profiles`。初始化接口采用只创建、不覆盖的方式；如果多个标签页同时初始化，保留先写入的昵称。
- 用户主动修改昵称时仍通过 `/api/profile` 更新。
- 聊天消息及公开显示名称不再回退显示钱包地址或其末六位；缺少昵称时统一显示 `新用户`。钱包地址只在本人侧栏/个人资料页显示。

### 本轮验证

- 所有 `.ts` / `.tsx` 文件通过 TypeScript 转译语法检查（0 项诊断）。
- `npm ci` 在当前执行环境中超时，因此未能完成完整 `tsc`、ESLint 和 Next.js production build。
- 未连接用户的 Supabase 项目，尚未执行数据库 migration 或真实浏览器/多钱包验收。


## 本轮深度整合：钱包身份隔离、消息 API 与 Realtime 边界

本轮以用户确认的「Freetribe 默认昵称即时创建修复版」为基准，不以此前 UX 优化包覆盖当前工程。

### 架构改动

- 新增 `app.wallet_identities` 私有身份映射表：内部 UUID 对应钱包地址，仅服务端 `service_role` 可读写。
- `app.messages` 新增 `author_id` UUID 并回填历史消息作者，随后移除 `user_address` 列。普通消息仅保留不含钱包地址的作者 UUID；系统消息作者为空。
- 新增 `app/lib/wallet-identity.ts`，服务端按钱包地址获取或并发安全地创建内部作者 UUID。
- `/api/messages` 成为聊天历史、增量更新和发送响应的唯一数据通道。API 在服务端将作者 UUID 映射为昵称，并只返回 `author_name`、`is_mine` 等安全 DTO，不返回钱包地址、作者 UUID、原始媒体路径或系统事件键。
- 停止浏览器订阅 `app.messages` 的 Postgres Changes。新增 `app.message_events` 安全事件表和触发器，Realtime 只广播消息 UUID、房间 ID、序号和时间；浏览器收到事件后再调用经过身份验证的增量消息 API。另保留每 15 秒一次的兜底轮询以恢复断线期间遗漏的事件。
- 图片/语音签名 URL 改由服务端签发；新媒体对象路径使用随机 UUID，不包含钱包地址。项目尚未上线且处于调试阶段，因此不加入历史对象迁移逻辑；撤销浏览器直接列出聊天 Storage 对象的旧策略。
- `/api/profile` 现在只返回当前登录者自己的资料；浏览器不再直接查询含钱包地址主键的 `app.profiles`。
- 对 `profiles`、`messages`、`reactions`、`pins`、`moderation`、`facade_submissions`、`task_drafts`、`invite_codes` 撤销匿名/普通登录用户的直接读取权限。`room_access` 仍按现有 RLS 仅允许本人读取。
- 新系统加入消息不再把钱包地址写入 `system_payload`，`event_key` 使用 SHA-256 摘要；迁移会清理历史系统事件键和 `system_payload.user_address`。
- 整合频道缓存 50 分钟过期、HTTP 413 确定失败清理、失败消息重试等现有 UX 修复。

### 数据库迁移顺序

确认此前基础 schema、moderation、图片和语音 migration 已经执行后，再在 Supabase Dashboard → SQL Editor 执行：

1. `supabase/migrations/20261030190000_private_wallet_identity_boundary.sql`

这条迁移会回填历史消息作者 UUID、移除 `app.messages.user_address`、撤销浏览器对钱包身份数据的直接读取，并从 Realtime publication 移除原始 `app.messages` 表。迁移前建议先备份数据库。不要只执行代码部署而跳过此 SQL，否则新 API 会因为 `author_id` / `wallet_identities` 尚不存在而失败。

### 尚需真实环境验收

- 本地无法连接用户的 Supabase 项目，因此本次没有替用户执行 SQL，也没有验证项目当前 publication、RLS、Storage policies 与数据量下的迁移结果。
- `npm ci` 在当前执行环境两次超时；因此完整 `tsc --noEmit`、ESLint、Next.js production build 未能完成。所有 19 个 TS/TSX 文件通过 TypeScript 转译语法检查（0 项语法诊断）。
- 需要在 Supabase staging/备份环境先执行 migration，验证历史消息作者映射无遗漏、消息/图片/语音正常、两个钱包互相无法读取对方身份资料，并确认 Realtime 不再包含原始消息行。


### 调试阶段简化：不迁移历史媒体

项目尚未上线，当前处于调试阶段。图片和语音从现在起直接写入不含钱包地址的随机 UUID 路径；不再为旧路径增加首次读取复制、更新消息记录和删除旧对象的兼容逻辑。若未来确有已上线的旧媒体数据，再单独设计一次性迁移脚本。


### Review 补充修复

- 登录成功后默认昵称统一使用 Supabase 用户 UUID 末六位，不再使用钱包地址末六位；个人资料页和聊天侧栏的兜底昵称也统一采用用户 UUID。
- 数据库隐私迁移增加系统消息 `content` 脱敏，避免旧系统消息正文中意外包含的钱包地址通过安全消息 API 返回。


### 默认兜底昵称长度调整

- 登录初始化、聊天侧栏兜底和个人资料页初始化统一使用 Supabase 用户 UUID 最后 6 个十六进制字符，格式为 `User_XXXXXX`（共 11 个字符）。
- 不从钱包地址生成或展示兜底昵称；已有用户自定义昵称不受影响。

## 2026-10-30 UX and reliability optimization

- Removed the `force-dynamic` route segment flag that conflicts with `cacheComponents`; authenticated message responses explicitly use private no-store cache headers.
- Profile GET/POST success responses now explicitly disable shared/browser caching.
- Profile loading and saving now handle network exceptions without leaving the page stuck in a loading state.
- Saving a nickname shows a blocking progress state, disables the in-page return control, shows a brief success state, then returns to chat.
- The confirmed nickname is passed back to chat once and applied immediately to the sidebar before the transient URL parameter is removed.
- Leaving the chat while a voice recording is active now discards the recording instead of implicitly sending it. Explicit stop and the two-minute limit still send.

Validation: ZIP integrity checked. Full Next.js build, TypeScript type-check, ESLint, and live Supabase/browser tests were not run because dependencies are not installed in this working copy.
