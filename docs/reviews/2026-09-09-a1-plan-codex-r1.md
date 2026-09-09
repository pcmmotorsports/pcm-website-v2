# codex R1 唯讀審查報告 · A1(3DS 進行中改價)

> 2026-09-09 · 窗 C · `codex exec -s read-only --disable apps -m gpt-6-astra`
> 審查對象:`docs/plans/2026-09-09-a1-price-change-during-3ds-plan.md`(R1 稿)
> ✅ **①它複核了那條鏈:成立,沒有斷。**
> 🛑 **而結論是「不可交給 Sean 做決定」** —— 3 個 must-fix,其中兩條改變了內容:
> 　· ③ 乙的價值:**現行【已經】記改價稽核**(線上基底 :168)⇒ 乙補的是「改價與 attempt 的關聯」不是「從無到有」。
> 　· ④ 丙不能整個排除:`released` **並不退出對帳**,而我把「作廢」直接等同「停止對帳」。
> 　· ⑤ 我的量測判準抓錯形狀:本案 attempt 停在 **pending** 不是 charged。重量之後仍是 0。
> 逐條怎麼修見 plan 的 §8。

---

1. **【must-fix】核心缺陷成立；「永遠未付款、沒有任何監測」的結論過頭。**

   **(a)【無問題】改價確實可能放行。** [線上基底:55](/Users/sean_1/pcm-mob/docs/evidence/2026-09-09-admin_update_order_item_amount-live-baseline.sql:55) 後面的完整守門包含版本、收款紀錄、折扣、品項歸屬、零元原因、稅別與金額上限，沒有 attempt 檢查。無折扣、含稅模式且 `tax_total=0`、版本正確、尚無收款列的訂單，1000→900 可以通過。`begin()` 是獨立查詢，結束後關閉連線（[Adapter:65](/Users/sean_1/pcm-mob/packages/adapters/src/payment/PgChargeAttemptAdapter.ts:65)、[同檔:275](/Users/sean_1/pcm-mob/packages/adapters/src/payment/PgChargeAttemptAdapter.ts:275)），列鎖不跨越銀行驗證。Plan:57「即使鎖持續也不影響」的推論不成立，但實際呼叫方式仍支持缺陷存在。

   **(b)【無問題】`orderTotal` 確實是讀取 RPC 執行時的訂單金額。** 完整核對 [20260614120000:64](/Users/sean_1/pcm-mob/supabase/migrations/20260614120000_m3_3ds_1b_get_active_charge_attempt.sql:64) 與 [20260624120007:152](/Users/sean_1/pcm-mob/supabase/migrations/20260624120007_m3_3ds_r1b3_record_released_failure_observation.sql:152)：兩者都先從 `orders` 取入區域變數 `v_order`，再回傳 `v_order.total`，不是建立 attempt 時的快照。改價先提交、對帳後讀取，就會拿900比1000。

   **(c)【must-fix】比對失敗不等於沒有後續處理。** [settle-charge.ts:136](/Users/sean_1/pcm-mob/packages/use-cases/src/settle-charge.ts:136) 會回 `pending/record_unverified`，不執行後面的 `markCharged`／付款認列。重試達8次會標 `needs_manual_review=true`（[retry RPC:287](/Users/sean_1/pcm-mob/supabase/migrations/20260810220000_m4b_lifecycle_l5b0s_supersede_sweeper_ceiling.sql:287)）；12小時後還有繞過人工旗標的再確認路徑（[孤兒 RPC:90](/Users/sean_1/pcm-mob/supabase/migrations/20260627120000_m3_3ds_b1a_claim_expired_pending_attempts.sql:90)、[use-case:96](/Users/sean_1/pcm-mob/packages/use-cases/src/reconfirm-expired-orphans.ts:96)）。

   正確結論是：**金額差異不消除，既有自動對帳就無法認列，需人工處理**。不能寫成不可恢復的「永遠」。而且人工異常統計明確涵蓋 `pending + unpaid + needs_manual_review`，推翻 [Plan:12](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-a1-price-change-during-3ds-plan.md:12)「沒有任何一道尺會叫」。這不代表已證明正式環境告警有人收到或處理。

2. **【nit】「沒有單靠逾時自動釋放 pending」成立；capture-recheck 的用途寫錯。**

   [20260624120002:53](/Users/sean_1/pcm-mob/supabase/migrations/20260624120002_m3_3ds_r1a3_mark_charge_attempt_released_for_user.sql:53) 完整本體沒有年齡條件，僅依會員、購物車、未付款與 pending 做 `released` 更新；實際 caller 在重新結帳時，先取得 `auth_or_pending` 才呼叫釋放（[preflight:123](/Users/sean_1/pcm-mob/packages/use-cases/src/preflight-release-sibling.ts:123)）。

   `capture-recheck` route 呼叫的是 `recheckCaptureState`；候選條件為 `capture_state='authorized'`，只重查並寫回請款狀態，**不釋放 attempt，也不負責未付款認列重試**（[掃描 RPC:80](/Users/sean_1/pcm-mob/supabase/migrations/20260820050000_m4b_capture_recheck_scan.sql:80)、[use-case:134](/Users/sean_1/pcm-mob/packages/use-cases/src/recheck-capture-state.ts:134)）。[Plan:94](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-a1-price-change-during-3ds-plan.md:94) 混淆了兩條排程。

   真正的 settle-sweep／孤兒再確認可以在銀行明確失敗且通過金額等檢查後，將 pending 收斂成 failed；**持續待付款或金額不符者，不會只因時間到了就解鎖**。因此方向甲的長期鎖住風險仍存在，不能因找到這些排程就翻成可直接採用。

3. **【must-fix】方向乙技術上可做，但推薦理由漏掉「現行已經記改價稽核」。**

   [線上基底:168](/Users/sean_1/pcm-mob/docs/evidence/2026-09-09-admin_update_order_item_amount-live-baseline.sql:168) 已在同交易寫入 `order.item.amount.update`，包含 actor、request_id、order_id，以及改價前後的單價、小計、總額。所以乙新增的價值只能是**當時的 attempt ID／狀態等關聯證據**，不能把它描述成原本沒有改價紀錄。

   [稽核表 schema:43](/Users/sean_1/pcm-mob/supabase/migrations/20260712210000_m4a_admin_audit_log.sql:43) 允許這類資料：`before/after` 為 JSONB、action 為非空文字、request_id 沒有唯一限制；service_role 有 INSERT。RPC 本身確實是 `SECURITY DEFINER`、`search_path=''`，新增 SQL 必須使用 `public.admin_audit_log`。

   **owner 的實際角色名稱未能確認**：提供的 `pg_get_functiondef` 基底沒有 owner／ACL 資訊，repo 也未找到該函式 owner 的固定值；不能自行回答是 postgres。函式呼叫者的 service_role 權限，也不能取代對函式 owner 權限的驗證。本次沒有重新連正式庫。

   [Plan:103](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-a1-price-change-during-3ds-plan.md:103) 應先交代既有稽核與真正缺少的資訊，再推薦「增加第二筆」或「擴充既有紀錄」。否則 Sean 會依錯估的診斷缺口決策。

4. **【must-fix】方向丙不能只憑目前理由判定整體不可行。**

   [Plan:113](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-a1-price-change-during-3ds-plan.md:113) 把「作廢」直接等同「attempt 沒了、停止對帳」，沒有定義具體狀態轉移。

   若指刪除或標 failed，確實會退出 `get_active`，也沒有任何銀行取消呼叫，這個版本不能解決問題。但**普通 `released` 並不退出對帳**：讀取 RPC 明確納入它；`superseded_at IS NULL` 的 released 還允許晚到成功轉 charged，並建立異常紀錄（[markCharged:197](/Users/sean_1/pcm-mob/supabase/migrations/20260906700000_m4b_card_success_supersedes_bank.sql:197)）。

   這不代表直接改 released 就能修好900／1000的差異；它證明作者排除整個方向的理由不充分。應分清楚刪除、failed、released、superseded 各自後果。未查銀行端取消能力，也不能宣称「查完不可行」。

5. **【must-fix】影響量測的判準抓不到主述情境，不能推出「歷史零次」。**

   [Plan:66](/Users/sean_1/pcm-mob/docs/plans/2026-09-09-a1-price-change-during-3ds-plan.md:66) 查 `attempt.status='charged' AND order.payment_status='unpaid'`，主要抓的是**已標 charged、後續認列未完成**的情境。

   本案在 `markCharged` 前就被金額閘擋住，典型資料形狀是：

   - `orders.total=900`、`payment_status='unpaid'`。
   - attempt 仍為 `pending`，保留銀行交易識別鍵。
   - 尚無這筆卡款的 `order_payments` 紀錄。
   - sweeper 寫入後可能有 `last_settle_error='record_unverified'`；達上限後 `needs_manual_review=true`。
   - 銀行 Record 顯示成功、原始金額1000；既有改價稽核記錄1000→900。

   應從這類候選交叉核對銀行紀錄與改價稽核。即使「全表只有一筆 charged、pending為零」的讀數正確，也最多支持**當下未見此類未結案單**；現況查詢不能排除曾發生、後來被人工處理的歷史事件。

不可——核心金流缺陷存在，但計畫對補救路徑、既有稽核、方向丙及歷史影響的判斷不足以讓 Sean 據此選修法。
