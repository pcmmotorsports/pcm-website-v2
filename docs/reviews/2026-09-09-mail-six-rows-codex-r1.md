# codex R1 唯讀審查報告 · 信件六列判定

> 2026-09-09 · 窗 C · `codex exec -s read-only --disable apps -m gpt-6-astra`
> 審查對象:`docs/plans/2026-09-09-mail-six-rows-plan.md`(R1 稿)
> 🛑 **結論是「不可拿去建議改板」。5 個 must-fix 全修,而其中兩條【改變了結論】**:
> 　· ⑤ 從「可翻 done」降成「只改標題」—— 我把「追蹤位置補上了」推成「追蹤事項完成了」。
> 　· ⑥ 從「1 筆」變成「完整判準 0 筆」—— 我漏了板列指定的「有 confirmed 退款」那個條件。
> 　· 另撤回「沒有空窗」:commit 時間不是部署生效時間,而且我還比錯了 commit(首次是 99306a306)。
> 逐條怎麼修見 plan 的 §9。主視窗 2026-09-09 定:純 .md 只跑 R1,不跑 R2。

---

1(b). **【無問題】通用比對在寄送共同路徑；只看注入本身則不足。**  
主迴圈始於 [sweep-email-outbox.ts:1440](/Users/sean_1/pcm-mob/packages/use-cases/src/sweep-email-outbox.ts:1440)，比對位於 [2081](/Users/sean_1/pcm-mob/packages/use-cases/src/sweep-email-outbox.ts:2081)，沒有 event type 排除；唯一實際 `sender.send` 在其後的 [2192](/Users/sean_1/pcm-mob/packages/use-cases/src/sweep-email-outbox.ts:2192)。前面的 `continue` 確實會讓部分工作到不了比對，但那些分支也不寄信，沒有繞過比對直接寄出的路。

既有[測試:3202](/Users/sean_1/pcm-mob/packages/use-cases/src/sweep-email-outbox.test.ts:3202) 另補齊出貨、更正單號、匯款三族的相依項目，分別斷言地址改變不寄、地址相同才寄。這支持 **repo 實作已涵蓋**；本次未重跑測試，也不代表正式站已部署。

1(c). **【must-fix】「早約 23 小時，所以沒有上線空窗」不成立。**  
[計畫:109](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-mail-six-rows-plan.md:109) 比的是 commit 時間，沒有比正式部署生效時間。後台與 storefront 是不同部署，完全可能後台先上、寄信服務後上。

而且 `92f4d31a9` 是「放寬成任何登入員工」的後續修改；首次加入改信箱功能的是 `99306a306`。必須核寄信服務與後台各自的部署版本、生效時間及 GRANT 生效時間，否則撤掉「沒有空窗」。同理，[計畫:105](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-mail-six-rows-plan.md:105) 的「我今天才發現」不能證明「沒有東西提醒任何人」；板列本身早已有協調比對先行的紀錄。

2. **【must-fix】⑤ 不能因錨存在就翻 `done`。**  
[計畫:162](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-mail-six-rows-plan.md:162) 把「追蹤位置已補上」推成「追蹤事項已完成」。

[板列全文:1638](/Users/sean_1/pcm-mob/docs/launch-todo.md:1638) 確實自稱「指標落地」，但也明確保留：本列管「救法夠不夠」，另一列管問題本身；**不要合併，否則「救法是人工的」會消失**。列尾仍寫沒量人工重排是否存在、誰按得動、是否真的重排。標題的「不存在，直到現在」描述的正是開列時補上指標，並非今日被推翻的現況宣稱。

因此只能說「引用已可定位」，不能關掉尚未驗證的救援事項。

3. **【must-fix】`created_at` 查零不能推出「這段時間零封寄出、沒有觀察機會」。**  
[計畫:48](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-mail-six-rows-plan.md:48) 查的是入列時間；實際成功標記另寫 [sent_at](/Users/sean_1/pcm-mob/packages/adapters/src/email/SupabaseEmailOutboxAdapter.ts:786)。**早已入列、這兩天才重試成功的信會漏掉**。至少補量同期間的 `sent_at`，再限定結論為 outbox 記錄所能證明的範圍。

repo 搜尋未見一般已寄信定期清理或另一條訂單信直寄路徑；找到的刪除是人工通知登錄撤銷，不能拿來宣稱系統寄信紀錄會定期消失。正式庫另設清理工作則尚未核實。

另外，[板列③:934](/Users/sean_1/pcm-mob/docs/launch-todo.md:934) 已記 Sean 回答過一個環境「版面對」，剩下信件身分確認與另一個環境。不能把它概括成「沒有新信就沒有驗證材料」；合併觀察也必須指定**付款成功 HTML 信**，任意交易信不足以驗付款模板。

4. **【must-fix】⑥ 的 1 筆不是完整判準的複量。**  
[計畫:175](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-mail-six-rows-plan.md:175) 只數手動單及空的 `notification_email`；[板列:2481](/Users/sean_1/pcm-mob/docs/launch-todo.md:2481) 的指定量測還有 **`customers.email` 非空白，而且該單有 confirmed 退款**。中段雖曾收窄摘要，不能因此略過這個退款條件。

`NOT NULL` 也不等於非空白。若要證明「目前真的佔用部分退款掃描名額」，還須套用[實際 view:138](/Users/sean_1/pcm-mob/supabase/migrations/20260908080000_m4b_partial_refund_email_pending_view.sql:138) 的付款方式、部分退款狀態、未取消、非補登、outbox 排除及 scanner cutoff。

若那張手動單沒有 confirmed 退款，計畫仍報 1，真正目標卻可能是 0。只能保留「查詢連線可用」，不能說完整量測已完成、只剩選邊。

5. **【must-fix】缺了可以唯讀查的「人工救援是否具備執行條件」。**  
作者已有正式庫唯讀管道，卻沒查 `admin_requeue_dead_email(uuid)` 是否存在、實際定義與角色有效 EXECUTE 權限。這正是⑤列尾自己列出的缺格。

repo 已能核到：[後台 action:46](/Users/sean_1/pcm-mob/apps/admin/src/lib/mail/dead-letter-actions.ts:46) 要求 manager 授權；[RPC:136](/Users/sean_1/pcm-mob/supabase/migrations/20260831040000_m4b_maildead_requeue_rpc.sql:136) 原地重設 `pending`、attempts 與重試時間；EXECUTE 給 `service_role`。正式庫可用 catalog 唯讀核對，無須真的重排或寄信。查到也只能證明執行前提，不能冒充操作成功驗收。

另須補核 `20260907230000` 的實際 pending view 定義：接線註解[明說缺它會把「寄錯人」變成「安靜不寄」](/Users/sean_1/pcm-mob/apps/storefront/src/lib/email/composition.ts:193)，計畫卻未核這個必要前置。本次未修改檔案、未寄信，亦未取得正式庫與部署的獨立實測。

**不可：⑤ 把錨落地當救援完成，② 用 commit 代替部署時序，①與⑥的量測口徑不足以支持改板判定。**
