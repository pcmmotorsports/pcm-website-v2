# #16 今日對帳 — 片級 plan(A 窗夜跑產出,零行 code)

> **狀態:等 Sean 批(命中鐵則 8)。** 事實親查於 worktree `pcm-void-readers` @ `0e8c086b`;引用一律附 `檔案:行號`。
> CP 值排第 1 的理由:唯讀、零 migration、零金流寫入,而它換掉的是**員工每天第一眼看到的那一頁**。

## §1 現況(親查)

- 首頁 `/` 仍是骨架:`apps/admin/src/app/page.tsx:5-6` 註解逐字「M0-S1 骨架占位頁」、`:15-21` 是一張「骨架建置完成(M-4a M0-S1)」說明卡。頁上唯一活的功能是 `:34-60` 的具名身分選單。
- 側欄「總覽」已指向 `/`:`apps/admin/src/components/layout/app-sidebar.tsx:24` ⇒ 員工進後台第一眼就是這頁。
- 錢的真相**已經在 DB**,本片不必新建任何東西:
  - `order_payments`:`supabase/migrations/20260810100000_m4b_e10_op1_order_payments_m.sql:199` `CHECK (amount <> 0)`、`:197` 逐字「已收 = `SUM(amount)`」且**鏈式沖銷也成立**(`:82` 舉 500-500+500=500)。
  - `order_refunds`:欄位見 `packages/adapters/src/supabase/database.types.ts:1444-1461`;狀態值域 4 個(`processing`/`confirmed`/`deferred`/`failed`),字面與語意在 `apps/admin/src/lib/payment/refund-ledger-view.ts:11-24`。
- 「台北曆面 → 絕對時刻」已有單一真相、**不要自己再算一次**:`packages/domain/src/order/date-range.ts:50`(`taipeiDayStartIso`)與 `:68`(`taipeiDayEndExclusiveIso`),半開區間 `[from, to)` 理由寫在該檔 `:12-16`。
- 跨訂單唯讀的既有形狀可直接抄:`apps/admin/src/lib/payment/refund-read.ts:1-2`(`server-only` + `createSupabaseServiceClient` + 直接 `.from()`)。

## §2 範圍(刻意窄;片界寫死)

**做**:首頁換成「今天的錢動了多少 / 哪裡卡住」四格 + 兩張短清單,**全部唯讀**。

| 格 | 定義 |
|---|---|
| 今日實收(淨) | `SUM(order_payments.amount)`,`received_at ∈ [今日台北 00:00, 明日台北 00:00)` |
| 今日退款完成 | `SUM(order_refunds.refund_amount)`,`status='confirmed'` 且 `created_at ∈` 同區間 |
| 今日新單 | `COUNT(orders)`,`created_at ∈` 同區間 |
| 待處理退款異常 | 直接呼叫既有 `listRefundExceptions`(`refund-read.ts`)取筆數,**不另寫述詞** |

清單兩張:今日收款明細(≤20 列)、今日新單(≤20 列),各附「看全部」連到既有列表頁帶日期篩選。

🔴 **不做**(明寫,避免片界漂移):
- 待辦檢視 / 每單負責人 / 下次跟進日 = master plan v2 `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:661` 的 `order_internal`。
  數法與結果(2026-08-14 於本 worktree 實跑):`grep -rn "order_internal" supabase/migrations packages apps docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md` ⇒ **共 3 行,全部落在那份 plan 檔內**(`:223` / `:327` / `:661`),`supabase/migrations`、`packages`、`apps` 三個分母各 0 行 ⇒ **這張表只存在於規劃文字裡、沒有實體**。⇒ **不在本片**,本片也不假裝第 1 項「看今天要處理什麼」因此變綠。
- 任何寫入。本片零 server action、零新 RPC、零 migration。

## §3 要改哪些檔(我自己數 = 5)

| # | 檔 | 動作 |
|---|---|---|
| 1 | `apps/admin/src/app/page.tsx` | 改:換掉 `:15-21` 骨架卡,**保留 `:34-60` 身分選單一字不動** |
| 2 | `apps/admin/src/lib/dashboard/today-read.ts` | 新增:三個唯讀查詢 + 台北日界換算 |
| 3 | `apps/admin/src/components/dashboard/today-summary.tsx` | 新增:四格 + 兩清單的純顯示元件 |
| 4 | `apps/admin/src/lib/dashboard/today-read.test.ts` | 新增 |
| 5 | `apps/admin/src/components/dashboard/today-summary.test.tsx` | 新增(前台元件 smoke) |

## §4 片型與鐵則判定

- **內容分級 L1**(這頁的內容是查出來的,不是人維護的文案)。
- **鐵則 8:命中**(5 檔 > 3)⇒ 本檔即 plan,**Sean 批准前不動任何 code**。
- **鐵則 12:逐條過六類 → 全不命中**。①錢:只讀不寫,零 RPC、零 UPDATE ②權限:用既有 `createSupabaseServiceClient`,零新 GRANT/RLS/policy ③schema:零 migration ④平台設定:不動 `next.config`/`vercel.json`/CI/env ⑤對外:不寄信不發布 ⑥`packages/ui`:不碰。
- 但**顯示的是錢的數字、算錯會讓員工對錯帳** ⇒ 片型仍判**標準片**(9 步全跑、code-reviewer 必跑),**不因「唯讀」降級**。
- 估時 35-45 分。超過 45 分就當場拆:先交「四格」,兩張清單另開一片。

## §5 驗收條件(逐條 yes/no)

1. `grep -n '骨架建置完成' apps/admin/src/app/page.tsx` 零命中,且 grep 分母(該檔行數)一併回報。
2. 身分選單仍可用:`ACTOR_ID_FIELD` 字面未變,`selectActorAction` 仍是唯一 form action。
3. 四格各有單元測試,測資**必含台北日界兩筆**:`23:59:59+08:00` 算今天、`00:00:00+08:00`(隔日)不算今天。
4. **沖銷格**:同一單三列 `+500 / -500 / +500` ⇒「今日實收」顯示 `500`,釘住 `20260810100000:197` 的不變式。負向對照 = 把 `SUM` 改成 `COUNT` 或濾掉負列,該格必須紅。
5. 退款格只算 `status='confirmed'`;負向對照 = 塞一筆 `failed` 進測資,金額不得被計入。
6. 零資料時顯示空狀態文案,不出現 `NaN` / `undefined` / `-`。
7. 三綠(動 `.tsx` ⇒ 含 build)。
8. Sean 肉眼驗:進後台第一眼看得到「今天收了多少」。

## §6 誠實缺口(不假裝已驗)

1. **`order_refunds.status` 的值域我是從 repo 檔案讀的**(`refund-ledger-view.ts:11-24` 的 4 個 key),**沒有對正式庫跑查詢**。今天的教訓第 4 條逐字「判 DB 的事實只有對 DB 跑查詢算數」⇒ 開工第一動要對 `20260801120000_m4b_e10_a7c_refund_ledger_guards.sql` 的 allowlist 讀原文,或對 DB 查 distinct;**不得憑顯示 label 反推**。
2. **`order_refund_effective_verdict` view(`#473b-1`,08-14 夜已 apply 正式庫)不在本片的計算裡。** 它會改「這筆退款到底算不算退成功」的**顯示與可退額**,但 Sean 拍板 `Q-473-1=A` 明說**不改帳上金額、`order_refunds` 那列永遠留著**。本片算的是帳上金額 ⇒ 我判定不受影響 —— 但這是**我的推論、沒有實查那支 view 的定義**(它也還不在 `database.types.ts` 裡)。開工前要開檔確認。
3. ~~**「今日」用 `received_at` 還是 `created_at` 是我選的、不是拍板。**~~ 🏁 **已銷案(2026-08-14 夜)**:這題不是選擇題,**既有契約已經寫死**,我親自開檔驗過三處字面:
   - `20260810100000_m4b_e10_op1_order_payments_m.sql:217-218` 逐字「`received_at` = **實際收到錢的時點**,不是登錄時間(登錄時間是 `created_at`)…**分兩欄是為了讓「今日對帳」問得出正確的問題**」;
   - `:427` `COMMENT ON COLUMN … received_at` 逐字「**對帳看這欄**」;
   - `:394-395` 已為該欄建 `order_payments_received_at_idx`,上一行註解逐字「今日對帳」。
   ⇒ 用 `received_at`,依據是這三處契約,不是我的偏好、也不是誰裁的。
4. **未量:首頁加兩張清單後的查詢耗時。** layout 因 `cookies()` 已是動態渲染(`app/layout.tsx:27-30`),首頁每次進站都會跑這幾查。走 service_role ⇒ 不吃 anon 的 3s 門,但**我沒有量過**,不寫「很快」。
5. 本片**零 CSS 尺寸/顯示/位置改動** ⇒ 不觸發「真瀏覽器兩檔量測」條款。實作時若動了任何尺寸,該條款立刻回歸、交件必附兩檔實測。
