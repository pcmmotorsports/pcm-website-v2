# LINE Bot 已搬離本專案的 Supabase(2026-05-19)

> 給未來進 `pcm-website-v2` 的 Claude Code session / 開發者:這份說明 LINE bot
> 與本專案 Supabase 的關係變動,**重點是「本專案的 Supabase 沒有被動到」**。

## 背景

LINE 追單機器人(原 `pcm-line-bot` 專案)過去**與本官網專案共用同一個 Supabase**
(專案 `pcm-website-v2`,ref `bmpnplmnldofgaohnaok`),它在裡面用 `line_*` 5 張表:
`line_conversations` / `line_messages` / `line_faq` / `line_settings` / `line_pending_reply`。

## 變動內容

2026-05-19,LINE bot 已整個合併進報價系統 `pcm-quote-v2`
(repo `pcmmotorsports/pcm-quote-v2`)。連帶:

- `line_*` 5 張表的結構與資料,已**複製**到 `pcm-quote-v2` 自己的 Supabase 專案
  (ref `dllwkkfanaebrsuyuedy`)。LINE bot 從此讀寫那邊,不再用本專案的 Supabase。
- 搬移走 `pg_dump` → `psql` 連線管道,**只讀取**本專案 Supabase、未做任何寫入或刪除。

## 對 `pcm-website-v2` 的影響:無

- 本專案 Supabase 的官網自有表(`brands` / `categories` / `products` 等)**完全未被動到**。
- `line_*` 表目前仍**保留**在本專案 Supabase 中,當作合併的回復點。
- 後續(LINE bot 合併穩定數天後)可能會把本專案 Supabase 內這 5 張 `line_*` 表刪除清理;
  **刪除只影響那 5 張 line 表,不影響官網任何表**。若看到那次清理,屬預期內。

## 一句話

> LINE bot 與它的 `line_*` 表已搬去 `pcm-quote-v2` 的 Supabase。本專案 Supabase
> 維持原樣,官網開發不受影響。
