-- 入群持币门槛与持仓改由 DB 提供，应用请求路径不再 eth_call。
-- required_tokens：酋长/后台在 app.rooms 配置。
-- balance：Indexer 或后台 worker 写入 app.wallet_token_balances。

create table if not exists app.wallet_token_balances (
  token_address text not null
    check (token_address ~ '^0x[0-9a-f]{40}$' and token_address = lower(token_address)),
  wallet_address text not null
    check (wallet_address ~ '^0x[0-9a-f]{40}$' and wallet_address = lower(wallet_address)),
  balance numeric not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now(),
  primary key (token_address, wallet_address)
);

create index if not exists wallet_token_balances_wallet_idx
  on app.wallet_token_balances (wallet_address);

alter table app.wallet_token_balances enable row level security;

revoke all on app.wallet_token_balances from anon, authenticated;
grant all on app.wallet_token_balances to service_role;

comment on table app.wallet_token_balances is
  'Indexer 同步的链上持仓快照；authorizeRoomPost 只读此表与 rooms.required_tokens。';

comment on column app.rooms.required_tokens is
  '进入该 Tribe 所需最低持币量（与 wallet_token_balances.balance 同单位）；由后台/Settings 写入。';
