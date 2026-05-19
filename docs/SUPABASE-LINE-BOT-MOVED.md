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
- **2026-05-19 清理完成:** `line_*` 5 張表已從本專案 Supabase 移除
  (migration `20260519152353_drop_orphan_line_tables`、DROP 5 表 + 清 7 筆孤兒 migration ledger 紀錄)。
- 移除前已驗證 `pcm-quote-v2` 為完整副本(conv 21/21、msg 108/108、faq 13、settings 4),
  並把 split-brain 期間分岔的 1 對話 + 10 訊息補進 `pcm-quote-v2`(見下「補述」)。
- **此清理只影響那 5 張 line 表** —— 官網 `brands` / `categories` / `products` 全程未動;
  清掉孤兒 ledger 紀錄後,官網 `supabase db push` 已恢復正常。

## 補述:split-brain 分岔修復(2026-05-19)

搬遷用 `pg_dump` 複製後、到舊 pcm-line-bot Vercel 部署下線前,A 庫仍短暫收到 LINE
流量,與 `pcm-quote-v2` 分岔。清理前已偵測並修復:A 庫獨有的 1 筆對話(`柏緯`)
+ 10 則訊息已補進 `pcm-quote-v2`,確認 `pcm-quote-v2` 為 A 庫完整超集後才執行 DROP。

## 一句話

> LINE bot 與它的 `line_*` 表已搬去 `pcm-quote-v2` 的 Supabase、A 庫殘留的 5 張
> `line_*` 表已清除。本專案 Supabase 的官網資料全程維持原樣,官網開發不受影響。
