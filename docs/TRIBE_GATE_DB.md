# Tribe 入群门槛（DB）

Indexer 在独立仓库，见 [INDEXER_REPO.md](./INDEXER_REPO.md)。

## 数据库

在 Supabase SQL Editor 依次执行：

1. `supabase/migrations/20261101210000_token_gate_from_db.sql`
2. `supabase/migrations/20261101213000_tribe_chief_and_gate.sql`

## 环境变量

- `SUPABASE_SECRET_KEY` — 已有
- `INDEXER_API_KEY` — 供 Indexer 调用 internal API

## Indexer 同步（推荐）

`POST /api/internal/tribes/sync`

Header: `x-indexer-key: <INDEXER_API_KEY>`

```json
{
  "tokenAddress": "0x...",
  "requiredTokens": "1000",
  "chiefAddress": "0x...",
  "balances": [
    { "tokenAddress": "0x...", "walletAddress": "0x...", "balance": "5000" }
  ]
}
```

仅批量持仓：`POST /api/internal/token-balances`，body `{ "balances": [...] }`。

## 酋长改门槛

`PATCH /api/tribes/0x.../settings`  
Header: `Authorization: Bearer <supabase access token>`

```json
{ "requiredTokens": "1000" }
```

## 查询当前用户是否达标

`GET /api/tribes/0x.../gate`（可选 Bearer）
