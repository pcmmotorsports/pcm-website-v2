-- LINE 追單對話狀態表
-- 追蹤客戶詢價後的沉默狀態，用於自動發送追單訊息

create table line_conversations (
  id                   uuid        primary key default gen_random_uuid(),
  line_user_id         text        not null unique,
  display_name         text,
  picture_url          text,
  -- 最後一次偵測到詢價訊息的時間
  last_inquiry_at      timestamptz,
  -- 預定追單時間（由 webhook 寫入，cron 對照此欄位）
  follow_up_1_at       timestamptz,   -- last_inquiry_at + 24hr
  follow_up_2_at       timestamptz,   -- last_inquiry_at + 72hr
  -- 實際發出時間（發出後由 cron 寫入）
  follow_up_1_sent_at  timestamptz,
  follow_up_2_sent_at  timestamptz,
  -- 客戶主動回覆後取消（寫入時間 = 客戶回覆時間）
  cancelled_at         timestamptz,
  -- 預留：手動標記已成交
  converted_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- 只有 service_role 能讀寫，anon 完全禁止
alter table line_conversations enable row level security;

-- 加速 cron 查詢：找出到期且未發出的追單
create index line_conversations_follow_up_1_idx
  on line_conversations (follow_up_1_at)
  where follow_up_1_sent_at is null and cancelled_at is null;

create index line_conversations_follow_up_2_idx
  on line_conversations (follow_up_2_at)
  where follow_up_2_sent_at is null and cancelled_at is null;
