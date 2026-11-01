# Indexer 独立仓库

Indexer 已从本仓库拆出，单独维护与发布。

| 项目 | 路径 / 地址 |
|------|-------------|
| **Web（本仓库）** | [Julian4313/zTribe](https://github.com/Julian4313/zTribe) |
| **Indexer** | [Julian4313/zTribe-indexer](https://github.com/Julian4313/zTribe-indexer) |

本地 clone：`git clone git@github.com:Julian4313/zTribe-indexer.git`

## Web 与 Indexer 如何协作

- Web 提供：`POST /api/internal/token-balances`、`POST /api/internal/tribes/sync`（见 [TRIBE_GATE_DB.md](./TRIBE_GATE_DB.md)）
- 两边配置**相同**的 `INDEXER_API_KEY`
- Indexer 配置 `APP_BASE_URL` 指向 Web（生产建议内网 URL）

## 克隆后开发

```bash
git clone git@github.com:Julian4313/zTribe.git discord-web
git clone git@github.com:Julian4313/zTribe-indexer.git zTribe-indexer

# 终端 1
cd discord-web && npm run dev

# 终端 2
cd zTribe-indexer && cp .env.example .env && npm install && npm run dev
```
