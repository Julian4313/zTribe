-- 每个 Tribe 在 app.rooms 上单独配置门槛与酋长；持仓在 wallet_token_balances。

alter table app.rooms
  add column if not exists chief_address text
  check (
    chief_address is null
    or (
      chief_address ~ '^0x[0-9a-f]{40}$'
      and chief_address = lower(chief_address)
    )
  );

comment on column app.rooms.chief_address is
  '部落酋长钱包；与平台管理员一起可修改本部落 required_tokens。';

comment on column app.rooms.required_tokens is
  '本部落入群最低持币量（与 wallet_token_balances.balance 同单位）。';

-- 便于 Indexer / 后台按 token 查酋长
create index if not exists rooms_chief_address_idx
  on app.rooms (chief_address)
  where chief_address is not null;
