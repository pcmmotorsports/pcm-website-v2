# plan · 刷卡全額退款成功 ⇒ 訂單自動標「已取消」—— 2026-09-14

> Sean 09-12 拍要有(memory `project_0912-admin-order-ux-redesign`「刷卡全退自動取消」);`docs/handoff/CURRENT.md` 0913 節與 `方向稿說明-v10.md` §7 記為「已知缺口:系統至今沒做」。主視窗 09-14 派 B 窗;碰錢 ⇒ 鐵則 8 plan(本檔)+ 鐵則 12 codex 兩輪內。
> 數字附檔:行(B 窗 09-14 讀碼 + 唯讀 catalog 實查)。

## 0. 現況(落點在哪)
- **「全額退款成功」的唯一匯流點** = `public.pcm_sync_order_refund_payment_status(p_order_id)`(第 8 代 `20260911170000:137-240`,貼板 129 已貼):算 `pcm_order_money_moved` ⇒ `v_target` = `refunded / partiallyRefunded / paid`,寫 `orders.payment_status`,然後 `PERFORM public.coupon_revert_on_full_refund(p_order_id)`。卡片結案 / 非卡登記 / TapPay backfill / 作廢 全部 PERFORM 它(8 支呼叫端,`20260912040000:8` 逐字「它被兩支不同的 RPC 呼叫」)⇒ **掛在這裡 = 掛路口不掛門口**(券退回 `20260910210000` 就是這樣接的)。它**沒有 actor 參數**。
- **「標已取消」既有 RPC** = `public.admin_mark_order_cancelled(p_order_id, p_idempotency_key, p_actor, p_reason_code, p_reason_detail)`(`20260903093000:604-820`):只收 `payment_method = 'tappay'` + `payment_status = 'refunded'` + `cancelled_at IS NULL` + 零 `order_cancellation_items` + actor 是啟用中 staff;寫 `cancelled_at / cancelled_reason / cancel_items_untouched = true` + audit `order.mark_cancelled`(source_app admin)。今天由後台一顆鈕呼叫(`cancel-actions.ts:355 markOrderCancelledAction`)—— **就是「全退之後要人手動按」那一步**。
- **不能走 `admin_cancel_order`**:它的步 7 閘明文擋刷卡單(`20260903093000:411-424`「刷卡單照樣被它擋住」)且要 `order_cancellation_items`。
- **客人通知**:`pcm_cancelled_email_pending` view 的第一支 = `cancelled_at IS NOT NULL AND payment_method='tappay' AND payment_status IN (refunded, partiallyRefunded) AND 無人工退款` ⇒ 標了之後 scanner 自動排 `order_cancelled` 信(0903 拍甲要寄)。**零新接線。**
- **券**:`coupon_revert_on_full_refund` 已掛在同一路口,與取消無關(它看 money moved)。
- **稽核**:`admin_mark_order_cancelled` 自己落 `order.mark_cancelled` 一列(request_id = 冪等鍵)。
- **小事故表** `pcm_incident.kind` 是封閉集 CHECK(`pcm_incident_kind_check`:`pending_refund_open_failed` / `refund_over_total`);加一種要改 CHECK。

## 1. 改什麼(migration `20260914060000_m4b_auto_cancel_on_full_card_refund.sql`)
1. 新函式 `public.pcm_auto_cancel_on_full_card_refund(p_order_id uuid) RETURNS text`(SECURITY DEFINER、search_path ''、只 owner 執行,零 GRANT):
   - 前提(逐條 = mark RPC 的閘,先判、不讓它 RAISE):`payment_method = 'tappay'` ∧ `payment_status = 'refunded'` ∧ `cancelled_at IS NULL` ∧ 無 `order_cancellation_items` ∧ **無未作廢的人工退款(純卡片路)**。不符 ⇒ `'skipped:<why>'`(非卡 / 已取消 / 部分取消過 / 混合軌 ⇒ 都不是錯)。
     混合軌不自動(codex R1):取消信 view 對「有人工退款」的單不寄、逐筆退款信又要求先有取消信 ⇒ 自動取消會讓客人兩封都收不到;混合軌本來就走人工寄信 SOP。
   - actor = **最後一筆算進 money_moved 的卡片退款的經手人**(confirmed 的 `order_refunds.actor`,或被有效更正成 money_moved 的那筆的更正人),**先挑最後那筆、再驗 `staff.is_active`**(不可跳過停用的拿更早的人 = 冒名);不合 ⇒ `pcm_incident_log('auto_cancel_skipped', …)`(同單未解決只記一列)+ `'skipped:no_actor'`(後台「標記已取消」那顆鈕仍在,人可補按)。
   - 冪等鍵 = `md5('pcm-auto-cancel:' || order_id)::uuid`(決定性)。成功之後重跑 sync 先被 `cancelled_at IS NOT NULL` 擋下(走不到 mark RPC);這把鍵擋的是「mark RPC 寫了一半 / 同交易重入」那種世界。⚠️ 它是雜湊輸入,查稽核要重算 md5,不能搜前綴。
   - `PERFORM public.admin_mark_order_cancelled(p_order_id, key, actor, 'other', '刷卡已全額退款,系統自動取消')`;包 `EXCEPTION WHEN query_canceled THEN RAISE; WHEN OTHERS ⇒ pcm_incident_log('auto_cancel_failed', SQLSTATE || ' ' || 前 200 字) + 'skipped:error'`。
     **為什麼吞**:退款本身在 TapPay 已經成立,讓「標取消」失敗把整個結案交易退掉 = 帳面狀態不更新、比沒自動取消更糟;吞掉但留痕在 Sean 的日報看得到(pcm_incident 進 shouldAlert)。
2. `pcm_sync_order_refund_payment_status` 第 9 代:本體 = 第 8 代逐字 + 在 `PERFORM coupon_revert…` 之後加 `IF v_ps = 'refunded' THEN PERFORM public.pcm_auto_cancel_on_full_card_refund(p_order_id); END IF;`。前置閘 md5 = 第 8 代 `6ce1d4e2d1eead06c61a9b6726ea6f9e` + `proconfig = {search_path=""}`(CREATE OR REPLACE 會把 SET 整組換掉 ⇒ header 逐字重貼);後置閘新 md5 + 字面 + ACL 只斷言 anon / authenticated 零 EXECUTE(第 8 代明訂 proacl = 只有 owner,不要求 service_role)。
3. `pcm_incident_kind_check` 加 `auto_cancel_skipped` / `auto_cancel_failed`。
4. rollback:第 8 代逐字貼回 + DROP 新函式 + CHECK 縮回(先確認表裡沒有新 kind 的列;有 ⇒ 拒退)。

## 2. 影響 / 不做
- 只影響 **刷卡 + 全額退款** 的單;非卡(匯款 / 現金)不動 —— Sean 拍的字面是「刷卡全退」。
- 部分退款不動;已取消過 / 部分取消過的單不動。
- `cancelled_reason` 客人會在訂單頁與取消信看到「刷卡已全額退款,系統自動取消」。
- 既有單:**不回填**(今天已 refunded 未取消的舊單維持手動按鈕)。
- 後台「標記已取消」鈕留著(自動失敗時的補救 + 舊單)。
- 顧客站零改。app 端零改(掛在 DB 路口)。

## 3. 驗收(拋棄式 PG 從零重播 + 套本檔)
- 正:刷卡單 paid → 全額退款結案(呼叫 sync)⇒ `cancelled_at` 非空、`cancelled_reason` = 那句、audit `order.mark_cancelled` 恰 1 列、`pcm_cancelled_email_pending` 看得到它;再跑一次 sync ⇒ 不多一列、不炸。
- 負:部分退款 ⇒ 不取消;非卡單全退 ⇒ 不取消;已取消的單再 sync ⇒ skipped 不炸;actor 停用 ⇒ 不取消 + incident 一列;mark RPC RAISE ⇒ incident 一列而 payment_status 仍更新為 refunded。
- 「按下去會動」的證據 = 上面正向那一發的 SQL 輸出(不是 grep)。

## 4. 版本 / 貼板
`20260914060000`(050000 留給 ⟦b4-PARTPAIDNOCANCEL1⟧ 重寫版)。寫好不貼;rollback 檔同批。
