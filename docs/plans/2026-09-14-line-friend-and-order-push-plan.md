# plan · LINE 登入順便加好友 + 訂單通知推播 —— 2026-09-14

> Sean 2026-09-14 13:2x 逐字「我們 LINE 登入可以做到順便加官方帳號為好友,然後就可以記錄在我們系統裡面,這樣我們可以發送訊息給客人?我希望之後可以做到訂單確認發送通知」+「不用擔心 line 訊息,我有買」(方案已買, 配額不是題)。
> 盤查:主視窗派 Plan subagent(opus)唯讀盤查, 主視窗謄寫。數字附檔:行。

## 0. 現況(比想像的近)
- **LINE Login 已經有**:自寫 OAuth(非 LIFF)`apps/storefront/src/lib/auth/line.ts`(start / callback 在 `apps/storefront/src/app/api/auth/line/`);authorize URL `line.ts:92-105` **沒有 `bot_prompt`**, scope 只有 `openid profile`(`:26`)。
- **userId 已經拿到**:`sub` 寫進 `auth.users.app_metadata.pcm_line_user_id`(`apps/storefront/src/lib/auth/line-admin.ts:36-46`)。
- **customers 沒有 line 欄位**(`20260523034911_init_customers_and_subtables.sql:14-26`)。
- **推播管線已經有**:`packages/adapters/src/payment/LineAlertNotifierAdapter.ts:35` 打 `api.line.me/v2/bot/message/push`(老闆告警用, env `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_ALERT_TO`)⇒ 零新依賴。
- **通知信**:`email_outbox`(`20260717020000_m4a_email_outbox.sql:297`, 6 態 / `UNIQUE(event_type,dedup_key)` / 退避 / lease)+ sweeper `packages/use-cases/src/sweep-email-outbox.ts` + Resend。
- 🔴 **真正的洞**:LINE 註冊的客人 email 是合成信箱 ⇒ outbox 直接落 `skipped_no_real_email`(`packages/adapters/src/email/SupabaseEmailOutboxAdapter.ts:641`)⇒ **他們今天一封訂單信都收不到**。這件不是加值, 是補漏。
- `agent/line-account*` 那族分支與 LINE 無關(命名巧合)。

## 1. 改什麼
1. `buildAuthorizeUrl` 加 `bot_prompt`(1 行)⇒ 登入畫面順便「加入好友」。
2. `customers` 加 `line_user_id text UNIQUE`(可空)+ `line_friend_at timestamptz`;callback 寫入(sub 已有, 零新查詢);webhook `follow` 寫 `line_friend_at`、`unfollow` 清空;GRANT 照既有 customers(client 不讀這兩欄)。
3. `email_outbox` 加 `channel text NOT NULL DEFAULT 'email'`(**不開新表**);sweeper 在「合成信箱」那一支改成:有 `line_user_id` 且 `line_friend_at` 非空 ⇒ 走 push、標 `sent` + `channel='line'`;否則維持今天的 skip。歷史 `skipped_no_real_email` 列原地翻回 pending(該態設計上可翻轉)。
4. 內容用既有模板純文字版(`packages/use-cases/src/order-email-copy.ts`), 不做 Flex。事件:訂單確認 + 出貨(共用同一條分支)。
5. 新 route `/api/line/webhook`:驗 `x-line-signature`(HMAC-SHA256;不驗 = 任何人可竄改好友狀態)。

**前提(Sean 在 LINE Developers 做)**:Login channel 與 Messaging API channel **同一個 provider**, Login channel → 「Linked LINE Official Account」指到 OA。不同 provider ⇒ userId 不通, 整案作廢。

## 2. 兩案
- **A 重用 `email_outbox` + `channel` 欄(推薦)**:冪等鍵 / 退避 / 死信 / lease / dead-man / 老闆 digest 全繼承;一封訂單確認只會有一列。
- B 開 `line_outbox`:要複製 1400 行 sweeper 與整套告警視圖, 雙發去重再寫一次 ⇒ 否決。
- 配額 429 ⇒ 走既有 failed + 退避(Sean 已買方案, 低機率);**誠實邊界**:LINE 客人沒真 email, 「落回 email」對他們不存在, 只能重試 + 讓 Sean 看見。

## 3. 影響 / rollback
- 影響:登入流程多一個同意選項;customers 兩欄;sweeper 一支分支;錢的路徑零觸碰。
- rollback:拿掉 `bot_prompt` 1 行;sweeper 分支用 `LINE_PUSH_ENABLED` 包, 關 flag = 今天行為;兩個欄留著(可空無人讀 = 無害)。不需要 down migration 就能退。

## 4. 切片(≤45 分)
| 片 | 窗 | 內容 |
|---|---|---|
| S0 | Sean + 主視窗 | LINE Developers 連結 OA;env 名:`LINE_CHANNEL_ACCESS_TOKEN`(已有)、`LINE_WEBHOOK_CHANNEL_SECRET`、`LINE_PUSH_ENABLED`(本機 `.env.local` + Vercel storefront 專案)|
| S1 | B 窗 | migration `20260914040000`:customers 兩欄 + email_outbox `channel` + GRANT/RLS 斷言 + rollback |
| S2 | A 窗 | `line.ts` 加 `bot_prompt`;callback 寫 `line_user_id` |
| S3 | B 窗 | `/api/line/webhook`(簽章驗證 / follow / unfollow)|
| S4 | 施工窗 | sweeper LINE 分支(flag 包)+ 歷史 skipped 列翻 pending |

## 5. 要 Sean 答的
1. `bot_prompt`:甲 `aggressive`(預設勾「加好友」, 客人可取消;推薦 —— 不加好友就推不了)/ 乙 `normal`(選擇性)。
2. 先做哪些事件:甲 訂單確認 + 出貨(推薦, 同一條分支零成本)/ 乙 只訂單確認。
3. 後台客戶明細顯示「LINE 好友」狀態:甲 之後再說(推薦)/ 乙 這批做。
