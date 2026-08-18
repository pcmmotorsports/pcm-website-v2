# Plan — 人工複核佇列**沒有出口**:一筆卡住的 attempt 會讓告警永遠響(2026-08-18 G4)

> ⚠️ **未批。零 code、零 SQL、零正式庫動作。** 動它命中 **鐵則 12①(錢)**⇒ Sean 批 + 對抗審查才可施工。
> **不是為 `2SQH2P` 這一筆寫的** —— 這一筆碰巧是 Sean 自己的測試單,而**下一筆可能是真客人**,
> 處置流程**不得依賴「我們碰巧知道這筆是誰的」**。
> **量測環境**:主樹 `dev`,2026-08-18 15:4x CST(當場 `date`)。

---

## 1. 現況(每條附量法)

**告警的述詞(不是「事件」是「盤點」)**
```
supabase/migrations/20260701120000_*.sql:23-25 逐字：
  attempt_manual_review_count：payment_charge_attempts.needs_manual_review=true 且 status='pending'
  且 order unpaid（sweeper 8x 放棄的人工 queue；🔴 限 pending 排除 terminal failed
  —— markFailed 不清 needs_manual_review、否則收斂成 failed 後仍永遠假告警）
```
🔴 **沒有任何時間條件** ⇒ **cron 每跑一次就把同一筆重報一次**,直到那筆離開述詞為止。

**這個佇列【有入口、沒有出口】**(我當場量的)
```
入口:20260615120000_*.sql:53 `SET needs_manual_review = true`（達 ceiling 8 次後）
出口:grep -rn "needs_manual_review\|releasedManualReview" --include='*.ts' apps packages | grep -v '\.test\.'
     ⇒ 14 命中，全部是【讀】或【型別】或【設定】—— 查無任何一處【清除】或【結案】的路徑
⇒ 一筆進了這個佇列，repo 內沒有任何 code 能讓它出來。
```

**今天卡在裡面那一筆(事實已由 Sean 本人跑 triage 取得,我沒有連過正式庫)**
```
甲類 pending 孤兒、卡 8 天、last_settle_error = auth_or_pending
Sean 逐字：「是我測試的…只是用不同帳號，而且也沒有收錢成功」⇒ 沒有客人的錢卡著
```
⚠️ **上面這段是轉述**(主視窗轉),**我沒有自己量過** —— 而本 plan 的設計**不依賴它是不是測試單**。

## 2. 為什麼要現在做(它已經在誤報,不是未來風險)

**一個天天誤報的告警等於沒有告警,而真的出事那筆會混在裡面。**
📎 這正是 `#641` 那條寫的病的**現行版**:那條講的是未來(手動建單上線後),**這條是今天正在發生**。
🔴 而它比 `#641` 更急一格:`#641` 的誤報要等手動建單那片做出來,**這一筆現在每天都在響**。

## 3. 🔴 出口要長什麼樣(三案,我推薦甲)

| | 甲(推薦)**用既有 terminal + 既有稽核表** | 乙 新增「已處理」欄 | 丙 直接清 `needs_manual_review` |
|---|---|---|---|
| 做法 | 🔴 **一支新的窄 RPC,在【同一個交易】裡做兩件事**(收斂 + 寫稽核;理由見 §4.0):人看過 ⇒ 呼 `mark_charge_attempt_failed(attempt, order)`(`PgChargeAttemptAdapter.ts:84`)⇒ status 離開 `pending` ⇒ **自然掉出述詞**;**同一個動作寫一列 `admin_audit_log`** | 加 `manual_review_resolved_at` / `resolved_by` / `reason` + 改告警述詞 | `UPDATE … SET needs_manual_review=false` |
| migration | 🔴 **要**(見 §4;我原本寫「零」,查完是錯的) | 要(鐵則 12③) | 零 |
| 留痕(三個月後查得到「誰決定的、為什麼」) | ✅ `admin_audit_log`(**append-only**、`service_role` 只有 INSERT:`20260712210000:89,113-115`) | ✅ 欄位裡 | ❌ **零痕跡** —— 那一列就這樣消失 |
| 語意對不對 | ✅ 那筆**確實沒有收到錢** ⇒ `failed` 是真的 | ✅ | ⚠️ flag 清掉而 attempt 仍 `pending` ⇒ **狀態機裡多一個沒人管的活列** |
| 🔴 與前例的關係 | 順著既有設計走(那條註解**刻意**讓 terminal 掉出計數) | 新增第二套結案語意 | **正是那條註解在防的東西** |

🔴 **丙 的致命處(也是主視窗點名的那一格)**:三個月後有人查「這筆為什麼消失」——**查不到**。

## 4. 甲案要答的三件(實作時要有答案,現在先寫清楚)

### 4.0 🔴 查完了:後台**現在沒有路,而且那道牆是【刻意】立的**(2026-08-18 G4 實查,純讀)

```
GRANT（20260612150000_m3_s2d_charge_attempts.sql:429,432）
  REVOKE ALL ON FUNCTION public.mark_charge_attempt_failed(uuid,uuid)
  GRANT EXECUTE … TO payment_confirmer          ← 只有這個角色
apply 期 fail-closed 斷言（同檔 :451-453 逐字）
  has_function_privilege('anon', …) OR has_function_privilege('authenticated', …)
  OR has_function_privilege('service_role', 'public.mark_charge_attempt_failed(uuid,uuid)','EXECUTE')
  ⇒ 任一為真就整支 migration RAISE
呼叫端（grep -rn "markFailed|mark_charge_attempt_failed" --include='*.ts' apps packages | grep -v '\.test\.'）
  ⇒ 全部在 storefront 側（settle-charge / confirm-payment / PgChargeAttemptAdapter）
  ⇒ apps/admin 零命中
```
🔴 **後台跑在 `service_role` 上,而那道斷言【明文禁止 `service_role` 拿到這支的 EXECUTE】**
⇒ **不是「還沒接」,是「接上去會讓 migration 當場紅」** —— 那是設計,不是疏漏。

**⇒ 所以甲案的真實成本是:一支新的窄 RPC(要 migration,鐵則 12③),不是我原本寫的「零 migration」。**
形狀有現成前例(後台的寫入一律走這個形狀,不直接動表):
```
grep -rn "GRANT EXECUTE ON FUNCTION public.admin_" supabase/migrations/*.sql ⇒ 6+ 支
  admin_update_order_workflow / admin_adjust_wallet / admin_set_customer_tier / admin_append_order_note …
⇒ 新增 admin_close_manual_review(attempt_id, order_id, actor, reason)
   SECURITY DEFINER、owner=postgres、search_path=''、GRANT EXECUTE TO service_role
   內部：①把 attempt 收斂成 terminal（讓它離開告警述詞）②同一個交易寫一列 admin_audit_log
🔴 ②要在【同一個交易】裡:**分開寫 = 有一個「關掉了但沒有紀錄」的中間態**
   ⇒ **那正是丙案的病,只是換成分散在兩個語句之間** —— 不寫這句的話,
     下一個實作的人會覺得「先關再記」也一樣(它在正常路徑上確實一樣;**它們只在出錯那一刻不一樣**,
     而出錯那一刻正是三個月後有人來查的那一刻)
```
⚠️ **仍要 Sean 批**(鐵則 12①錢 + 12③ schema)。**查到有路 ≠ 可以接上去。**

```
① 誰按那個鈕 ⇒ 見 §4.0：現在沒有路，要新增一支窄 RPC（有前例形狀可抄）
② 按之前要看到什麼
   至少：attempt_id / order display_id / 卡多久 / last_settle_error / 有沒有真的扣到錢
   ⇒ 那正是 scripts/triage-manual-review-alert.sh 印的東西 ⇒ 後台那一頁照它的欄位長
③ 稽核那一列寫什麼
   action='payment.manual_review.close'、target='attempt:<id>'、reason=人打的字（必填）
   🔴 reason 必填不是禮貌：沒有它，三個月後那一列只證明「有人按過」，不證明「為什麼」
```

## 5. 🔴 下一筆真的卡住時,我們怎麼知道它是新的

```
甲案之下：已處理的會【離開述詞】⇒ 計數回到 0
⇒ 之後任何非零都是【新的】—— 這就是答案，而它不需要任何時間條件
🔴 而這件事現在做不到，正因為佇列沒有出口：計數永遠 ≥1 ⇒ 新的那一筆看起來跟舊的一樣
```
⚠️ **不要用「加一個年齡門檻」當解**(例如只報 24 小時內的)——
那會讓**卡最久的那一筆消失在告警裡**,而卡最久的通常最嚴重。**出口才是解,不是濾網。**

## 6. 驗收(每格配一發突變)

| # | 斷言 | 突變(必須紅) |
|---|---|---|
| 1 | 關掉一筆 ⇒ `attempt_manual_review_count` **從 1 變 0** | 把關閉動作拿掉 |
| 2 | 關掉一筆 ⇒ `admin_audit_log` **多一列**,且 `reason` 非空 | 讓 reason 可空 |
| 3 | 🔴 **關掉之後再進來一筆新的 ⇒ 計數變 1**(證明它還報得出新事件) | 把述詞改成永遠 0 |
| 4 | 沒有權限的角色**按不動** | 放寬權限 ⇒ 這格必紅 |
| 5 | **零金流副作用**:關閉動作不得觸發任何退款/請款 | 在關閉路徑塞一個 refund 呼叫 ⇒ 必紅 |

🔴 **#3 是這片真正的守門** —— 它證的是「我們把告警修好了」而不是「我們把告警關掉了」。
**只有 #1 的話,兩個世界(修好 vs 永遠 0)印同一個東西。**

## 7. 誠實揭示

```
· 我沒有連過正式庫；那筆的狀態是【轉述】（Sean 跑 triage、主視窗轉）
· ①「後台有沒有一條路能呼那支 RPC」我【沒有查】⇒ 那是本片成本的最大變數
· 本 plan 不處理「為什麼會卡 8 天沒人發現」——那是【有沒有人在看告警】的題，另一條線
· 這一筆是已知的測試單，而本 plan 刻意寫成通則：下一筆可能是真客人
· 🔴 在本片落地之前，那個告警【每天都會響】—— 而它現在的響法是「一個永遠亮著的燈」
```
