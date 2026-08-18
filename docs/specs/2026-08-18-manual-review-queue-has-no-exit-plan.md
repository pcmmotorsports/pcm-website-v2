# Plan — 人工複核佇列**沒有出口**:一筆卡住的 attempt 會讓告警永遠響(2026-08-18 G4)

> ✅ **2026-08-18 16:3x Sean 批准**(逐字「那就依照建議就好」,對應主視窗送的**甲=四份全批**;主視窗轉,我未直接聽到)。
> 🔴 **批准的射程(照抄,免得下一個人讀成別的)**:**批的是「可以開始做」**;
> **動 schema / 權限的部分仍要各自過對抗審查**,而 **migration 由主視窗 apply**(CLI 走 keychain,今日已證)。
> ⇒ **「已批」不等於「可以直接 apply」。**
> ~~⚠️ **未批。**~~ **零 code、零 SQL、零正式庫動作(仍然成立,尚未開工)。** 動它命中 **鐵則 12①(錢)**⇒ Sean 批 + 對抗審查才可施工。
> **不是為 `2SQH2P` 這一筆寫的** —— 這一筆碰巧是 Sean 自己的測試單,而**下一筆可能是真客人**,
> 處置流程**不得依賴「我們碰巧知道這筆是誰的」**。
> **量測環境**:主樹 `dev`,2026-08-18 15:4x CST(當場 `date`)。

---

## 0. 🔻🔻 2026-08-19:**本檔的實作範圍已被取代**

> **實作看 `docs/specs/2026-08-19-manual-review-queue-full-scope-plan.md`。**
> 本檔的**病理分析仍然有效**(告警述詞、旗子的兩個身分、per-order 佔鎖無時衰、三種對帳結果),
> **而它導出的做法已經兩次被推翻**:
> ```
> 第一版「標成失敗」   ⇒ 會釋鎖 + 允許重扣（GR 打掉）
> 第二版「人宣告 enum」⇒ 三個選項兩個噴錯一個通過 = 阻力最小的路（codex 兩輪 + GR 打掉）
> 🔴 正解：那台會查 TapPay 的機器（settleCharge）【早就存在且是那條線的唯一權威】
>    （settle-charge.ts:15 逐字「以 Record API 為唯一權威」）
>    ⇒ 鈕不是讓人宣告，是【讓人再查一次、繞過 8 次上限】
> ```
> 🔴 **另更正本檔一句全稱句**(GR `GR-040` 抓到):
> ~~「全樹只有一處把 `needs_manual_review` 設回 false」~~ —— **漏了**
> `20260624120010_m3_3ds_r1c3_close_released_attempt.sql`(owner-only 人工結案 RPC),
> **而那支正是甲/丙該長的形狀,不要重新發明。**

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

## 3. 🔴 出口要長什麼樣(三案)

> 🔻🔻 **2026-08-19 推薦【換了】:~~甲~~ ⇒ **乙**。下面整張表留痕不改,因為理由比結論有用。**
> ```
> 甲（原推薦：呼 mark_charge_attempt_failed 讓 status 離開 pending）⇒ 🔴 已被推翻
>    它會【釋放鎖 + 允許重扣】，而【沒有任何一步強制先對帳】
>    ⇒ 佇列裡每一筆定義上就是「不知道錢扣到沒」⇒ 若其實扣成功了 ⇒ 重複扣款
>    📌 而下面那一列「語意對不對 ✅ 那筆確實沒有收到錢」—— 🔴【那句是我當時假設的，不是查到的】
> 乙（新增「已處理」欄 + 改告警述詞）⇒ ✅ 現行推薦
>    status 與 needs_manual_review 都不動 ⇒ 鎖不釋放、自動重試不被喚醒，而計數回到 0
> 丙（直接清 needs_manual_review）⇒ 仍然不行，而且理由比原本寫的多一條：
>    那面旗子同時是「停止自動 retry」的 durable 旗標（20260621120000:49）⇒ 清它會把自動重試打開
> ```
> **完整論證見 `4.0-d`。**

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
### 4.0-b ✅ 那一格查掉了:**新 RPC 要【呼叫】它,不是抄它**(2026-08-18 G4 實查,純讀)

> 🔻 **2026-08-19:本節的【查證】仍有效,但它導出的【實作形狀】已被 `4.0-d` 取代。**
> 照本節字面去做會做出一支「標成失敗」的 RPC ——**那支會釋放鎖、允許重扣**。**先讀 `4.0-d`。**

我原本標未確認的是:**新 RPC 直接呼 `mark_charge_attempt_failed`,還是複製它的內部邏輯?**
開檔讀了它的本體(`20260624120006_m3_3ds_r1b2_markfailed_order_paid_guard.sql:59` 起)之後,答案不再是偏好:
```
它本身就是 SECURITY DEFINER + SET search_path=''，而且裡面有四道東西：
  ① 雙鍵驗（attempt_id + order_id）+ FOR UPDATE 序列化
  ② 冪等：failed→failed no-op
  🔴 ③ order-paid guard（fail-closed）：同交易鎖 orders，payment_status <> 'unpaid' ⇒ RAISE
  ④ UPDATE 只打 status='pending'，並用 ROW_COUNT 驗恰好一列
```
🔴 **③ 是不能抄的那一道**:它擋的是「**把一張已經付款的單的 attempt 標成失敗**」。
**抄第二份 = 這道 guard 有兩個版本,而它們會漂**;漂掉的那一天,症狀是**已付款的單被動到**,
而**那正是本 repo 抓過的病**(同一個判定式的第二份實作)。
⇒ **所以:新 RPC 是一層【薄殼】** —— 它自己只做「稽核 + 授權邊界」,狀態轉換**整段委給既有那支**。

**為什麼呼得動**(機制,非量測):新 RPC 若是 `SECURITY DEFINER` 且 **owner = postgres**,
它執行時的身分是 owner;而那支函式的 owner 也是 postgres(migration 以 postgres 身分建)
⇒ **owner 對自己的函式有隱含 EXECUTE**,不需要額外 GRANT、也不必動既有那道窄權設計。
⚠️ **未量**:正式庫上那兩支的 owner 我沒查(repo 側量不到)⇒ **實作時第一步就要驗這個前提**。

🔴 **而這條路仍然【擴大了面】,那件要進審查、不要被這段話蓋過去**:
```
擴大的是什麼：service_role（＝後台）從此可以【經由這支新 RPC】把 pending attempt 收斂成 failed
擋著它的是什麼：callee 的 order-paid guard（已付款的單碰不到）＋ 新 RPC 自己的稽核必填
🔴 沒被回答的是什麼：一個被盜的 service_role 金鑰，能不能靠「把 attempt 標成失敗」做出壞事？
   （它會釋放那張單的 attempt 鎖 —— 那對重複扣款的防線有沒有影響，我【沒有查】）
⇒ 這一條是【對抗審查的第一個題目】，不是實作時順手判的事
```

### 4.0-c 🔴 park 的那題往前推了一格(2026-08-18 18:0x G4 實查,純讀;**不是結論,是把題目問對**)

> 🔻 **2026-08-19:本節的【查證】仍有效,但它導出的【實作形狀】已被 `4.0-d` 取代。**
> 照本節字面去做會做出一支「標成失敗」的 RPC ——**那支會釋放鎖、允許重扣**。**先讀 `4.0-d`。**

**① 量到的兩件(可重跑)**
```
grep -rn "mark_charge_attempt_failed" supabase/migrations/*.sql | grep -iE "grant|revoke"
  20260612150000_m3_s2d_charge_attempts.sql:429  REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated, service_role
  20260612150000_m3_s2d_charge_attempts.sql:432  GRANT EXECUTE ON FUNCTION … TO payment_confirmer
```
⇒ **今天,一把被盜的 `service_role` 金鑰【打不到】那支函式** —— 那道 REVOKE 是明文的、逐個角色點名的。

```
begin_charge_attempt(20260612150000:168 起)的 per-user 閘述詞(:202-211):
  a.status IN ('pending','charged') AND a.created_at > now() - interval '10 minutes'
  AND o.payment_status <> 'paid'
```

**② 由這兩件【推出來】的(標明:推論,不是量測)**
```
把一筆 pending 標成 failed ⇒ 它離開上面那個述詞 ⇒ per-user 10 分鐘閘不再擋這位客人
⇒ 同一個人可以【立刻再開一次 charge】
而 mark_charge_attempt_failed 的 order-paid guard 只擋 orders.payment_status <> 'unpaid'
⇒ 🔴 人工待確認佇列裡的每一筆，【定義上】就是「我們不知道錢有沒有扣到」那一種
   ⇒ 它們的 orders.payment_status 仍然是 unpaid ⇒ **那道 guard 對它們一律放行**
```
🔴 **所以危險的形狀不是「動到已付款的單」**(那道 guard 擋得住,而那正是它被寫出來的理由),
**是「動到我們不知道有沒有付款的單」** —— 若那一筆其實在 TapPay 端成功了(late success),
標 failed ⇒ 釋鎖 ⇒ 第二次扣款 ⇒ **重複扣款**。
⚠️ **這一段每一句都是從 SQL 讀出來推的,我沒有跑過任何一次真實序列。** 不得升級措辭。

**③ 而權限那一面比 park 時寫的更重(這條是新的)**
`§4.0-b` 的「為什麼呼得動」寫得像便利性 —— 它其實是**權限提升**:
```
新 RPC = SECURITY DEFINER + owner=postgres + GRANT EXECUTE TO service_role
⇒ 它執行時是 owner 身分 ⇒ 內層那道「明文 REVOKE FROM service_role」對它不生效
⇒ 🔴 這支薄殼把一道【逐個角色點名的 REVOKE】洗成一個【有效的 EXECUTE】
```
**這不是反對做它** —— 窄門本來就是這樣蓋的。**但它必須被當成「刻意開的權限」寫進審查與稽核,
不能被 `§4.0-b` 那段「不需要額外 GRANT」的說法蓋過去。**

**④ 審查前一定要先量的三件(我沒有 DB access,量不到)**
```
甲 正式庫上 mark_charge_attempt_failed 與新 RPC 的 owner 是不是同一個（§4.0-b 已標未確認）
乙 「標 failed 之前必須先對帳過一次」有沒有被強制？
   —— 若沒有，那個鈕就是「把不確定變成確定失敗」，而它沒有權力做這個決定
丙 釋鎖之後，同一張單/同一個人真的能重開 charge 嗎？
   —— begin 對【同一張單】有 not_unpaid 擋，對【同一個人的下一張單】沒有。這兩條路要分開量
```
⇒ **在甲乙丙量到之前,這支 RPC 不該被實作成「標失敗」。** 更可能正確的形狀是
**「標成已人工處理/已對帳」而不釋放任何鎖** —— 但那要看乙的答案,現在下不了。

⚠️ **仍要過審查才可落地**(鐵則 12①錢 + 12②權限 + 12③ schema)。**查到有路 ≠ 可以接上去。**

```
① 誰按那個鈕 ⇒ 見 §4.0：現在沒有路，要新增一支窄 RPC（有前例形狀可抄）
② 按之前要看到什麼
   至少：attempt_id / order display_id / 卡多久 / last_settle_error / 有沒有真的扣到錢
   ⇒ 那正是 scripts/triage-manual-review-alert.sh 印的東西 ⇒ 後台那一頁照它的欄位長
③ 稽核那一列寫什麼
   action='payment.manual_review.close'、target='attempt:<id>'、reason=人打的字（必填）
   🔴 reason 必填不是禮貌：沒有它，三個月後那一列只證明「有人按過」，不證明「為什麼」
```

### 4.0-d 🔴🔴 **形狀換了:出口是「離開【告警述詞】」,不是「離開【狀態機】」**(2026-08-19 G4;主視窗確認)

> 🔻 **2026-08-19 GR 審出:本節的【單一出口】是錯的 —— 它把「告警永遠響」換成「訂單永遠鎖」,而連燈都不亮。**
> 本節的**查證**(告警述詞逐字、旗子的兩個身分、清除路徑不能抄)**仍然成立**;**形狀請看 `4.0-e`。**

> **本節取代 `4.0-b` / `4.0-c` 的實作結論。**
> ~~那兩節~~ 的**查證仍然有效、留痕不刪**(它們是這個結論的來源),
> 但它們導出的實作形狀(「薄殼呼叫 `mark_charge_attempt_failed`」)**被下面三件推翻了**。

#### ① 三件我原本標「要 DB 才答得出」的,**全部在 repo 讀得出來**
🔴 **而我不該把它們送上去** —— 主視窗問了一句「那幾支函式在 `supabase/migrations/` 有定義嗎」,
三件當場全解。**乙和丙的答案就在我當天早上已經開過的那兩支檔裡。**
```
甲 owner 是否同一 ⇒ 同一個（契約層）
   grep "OWNER TO" 掃兩支 ⇒ 都【沒有】明寫 ⇒ owner = 跑 migration 的角色 = 新 migration 也是同一個
   📌 repo 裡另有一句正好講這件事：「owner 名字【跨環境不同】，寫死等於在別的環境靜默改 owner」
      ⇒ 斷言要用 current_user，不要寫死 'postgres'

乙 標 failed 前有沒有強制先對帳 ⇒ 🔴 沒有
   20260624120006_…:59 起 函式本體只有四道（雙鍵驗+FOR UPDATE / 冪等 / order-paid guard / ROW_COUNT）
   掃 settle|reconcil|tappay|Record ⇒ 函式本體零命中

丙 釋鎖後同一人能不能重開 ⇒ 🔴 能
   begin_charge_attempt:193 對【同一張單】只擋 payment_status <> 'unpaid'
     而佇列裡的單【定義上就是 unpaid】（我們不知道錢扣到沒）⇒ 擋不住
   per-user 閘 :202-211 述詞 status IN ('pending','charged')
     ⇒ 標成 failed 就離開它 ⇒ 同一個人也不再被擋
```
⚠️ **這是【repo 契約】,不是【正式庫現值】** —— 正式庫可能有不在 repo 的手寫物件。**引用本節要帶這一句。**

#### ② ⇒ 「標成失敗」這個形狀**沒有權力做它要做的事**
```
標 failed = 把【不知道有沒有扣到錢】變成【確定失敗】+ 釋放鎖 + 允許重扣
而【沒有任何一步強制先對帳】
⇒ 若那一筆其實在 TapPay 端成功了 ⇒ 第二次扣款 = 🔴 重複扣款
```

#### ③ 出口的正確定義:**離開告警的述詞**
告警述詞逐字(`20260701120000_m3_250_anomaly_alert_summary.sql:23` + `scripts/triage-manual-review-alert.sh:14-17`):
```
attempt_manual_review_count = needs_manual_review=true AND status='pending' AND unpaid
```
⇒ **只要讓那一列不再符合這個述詞就好,不必動 `status`。**
⇒ **新形狀:新增一個「已人工檢視」時戳(+ 稽核),告警述詞排除它;`status` 與 `needs_manual_review` 都不動。**
```
計數回到 0        ⇒ 原始問題（有入口沒出口）解了，新的一筆看得見
鎖不釋放          ⇒ 不可能重扣
自動重試不被喚醒  ⇒ 見下面 ④
```

#### ④ 🔴 為什麼**不能**直接把 `needs_manual_review` 設回 `false`(那是我原本想的捷徑)
```
20260621120000_m3_3ds_s2b_poll_settle_throttle.sql:49 逐字：
  「needs_manual_review=false —— 4a-2 把它當【停止自動 retry】durable 旗標；
    否則會員可用輪詢繞過 ceiling/manual」
⇒ 清掉它 = 同時把【自動重試】重新打開
⇒ 而那正是「我們還不知道錢扣到沒」的那批單，最不該被自動重試的
```
📌 **與 `#651` 同族**:一個欄位承擔兩個**要求不同**的角色。⇒ 新增獨立時戳,**不動那面旗子**。

#### ⑤ 既有的唯一清除路徑**不能抄**
`20260624120002_m3_3ds_r1a3_mark_charge_attempt_released_for_user.sql:53-58` 會清 `needs_manual_review`,
**但它同時把 `status` 改成 `released`** —— 那是「**確定沒扣到、放客人走**」的路。
🔴 **抄它就是把不確定當成確定。**

#### ⑥ ⚠️ 這一節的證據裡有一次量錯,寫下來
查 ⑤ 的時候我下了 `grep … | head` 然後**無條件** `echo "(空 = 零命中)"`
⇒ **grep 命中 10 筆,而那行「(空 = 零命中)」照樣印在命中的正下方。**
差一點把「零命中」寫進結論 —— **而真相正好相反:那筆清除路徑存在,且它是本節的關鍵證據之一。**
📌 `CLAUDE.md` 逐字寫著「**輸出的標籤要由【結果】決定,不能無條件印**」。**知道規則 ≠ 執行規則。**

### 4.0-e 🔴🔴 **`4.0-d` 把「告警永遠響」換成了「訂單永遠鎖」—— 而連燈都不亮**(2026-08-19 GR 審 `e130dec9` 抓到,採納)

> **本節修正 `4.0-d` 的形狀。** `4.0-d` 的**查證仍然成立**(告警述詞、旗子的兩個身分、清除路徑不能抄),
> 而它的**單一出口**是錯的。

#### ① GR 抓到的:人工對帳的結果有**三種**,而 `4.0-d` 把第三種當成全部
```
確定沒扣到 ⇒ 該讓客人【能重新付款】
確定扣到了 ⇒ 該補入帳
真不確定   ⇒ 才是「已人工檢視」時戳（鎖留著）
```
🔴 **而 `4.0-d` 對三種都只給那一個時戳** ⇒ **「確定沒扣到」的單,鎖永遠佔著。**

**佔鎖是怎麼佔的**(我自己開檔複核,`20260612150000_m3_s2d_charge_attempts.sql:214-223`):
```sql
INSERT INTO public.payment_charge_attempts (order_id, …)
ON CONFLICT (order_id) WHERE status IN ('pending', 'charged') DO NOTHING
RETURNING id INTO v_attempt_id;
IF v_attempt_id IS NULL THEN
  RETURN … 'reason', 'order_locked';
```
🔴 **那是一個 partial unique index,【沒有任何時衰】** —— 只要那一列還是 `pending`,
**那張單永遠開不出新的 attempt** ⇒ `order_locked` ⇒ **客人永遠付不了那張單**。
🔴 **而我們剛剛把它從告警裡拿掉了** ⇒ **連燈都不亮。**
⇒ **問題從「告警永遠響」搬進「訂單永遠鎖」** —— 那不是解決,是換一個更安靜的地方壞。

#### ② 修法:close RPC **必填「對帳結果」**,分流三條路
```
p_outcome = 'not_charged'  ⇒ 走【釋鎖】那條：pending → released，客人可重新付款
                              既有形狀 mark_charge_attempt_released_for_user
                              (20260624120002:39-42、四閘 CAS、GRANT TO payment_confirmer:82)
                              ⚠️ 但它的簽章是 (attempt, user, cart_session) = 為【客人自己的動作】設計的
                                 ⇒ 後台按鈕要用它，得另開一支【給後台用的】對應窄 RPC，不是直接呼它
                                 （否則後台要湊出 cart_session_id，那是把客人的參數塞進管理動作）
p_outcome = 'charged'      ⇒ 走【補入帳】那條（本 plan 不設計它；它動錢，要獨立一片 + 鐵則 12①）
p_outcome = 'unknown'      ⇒ 才是 4.0-d 那個「已人工檢視」時戳：鎖留著、告警清掉
```
🔴 **必填的意義不是欄位驗證,是【強迫按鈕的人講出他到底查到了什麼】** ——
`4.0-c` 的「乙」問的是「標 failed 前有沒有強制先對帳」,答案是**函式裡沒有**;
⇒ **那道強制只能立在 RPC 的契約上**。**沒有這一格,那個鈕仍然沒有權力做它要做的事。**

#### ③ 🔴 `unknown` 那條路仍然把單鎖著 —— **這件要明寫,不要藏**
```
選 unknown ⇒ 告警清掉、鎖留著 ⇒ 那張單客人仍然付不了
⇒ 它是【誠實的中間態】：我們還不知道，所以不敢放行、也不敢入帳
🔴 而它需要一個【自己的可見性】——否則我們只是把「響的告警」換成「安靜的鎖」
⇒ 建議：unknown 的那些列要有自己的清單（不是告警），讓人回頭看
   ⚠️ 本 plan 不設計那份清單，但【不做它】要寫進誠實揭示，不能當作沒有
```

#### ④ 另外三條(GR `GR-035`,一併折)
```
· 🔴 佔鎖（:214-223）是新形狀的安全核心，而 4.0-d 全文【零引用】它
  ⇒ 已於本節補上原始檔行號。📌 形狀：【結論對、依據缺】——
     結論對的時候最不會有人去要依據，而依據缺的結論搬到別的脈絡就會錯
· 4.0-d 的丙段把「同單防線」引成 not_unpaid ⇒ 🔴 引錯了：
  同單真正的防線是上面那個 partial unique index，not_unpaid 是另一道（且對 unpaid 的佇列成員無效）
· 驗收 #7 後半（「同一個人也擋得住」）零判別力：
  per-user 閘是【異單 + 10 分鐘】（:202-211），而佇列成員卡了 8 天
  ⇒ 兩個世界它都不在射程內 ⇒ 那半刪掉，改成盯【per-order 佔鎖】
```

#### ⑤ ⚠️ 本節全部是 **repo 契約**,不是**正式庫現值**
正式庫可能有不在 repo 的手寫物件。**引用本節要帶這一句。**

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
| 🔴 6 | **`status` 與 `needs_manual_review` 關閉前後【逐欄相同】**(新形狀的核心) | 讓關閉動作改動其中任一欄 ⇒ 必紅 |
| 🔴 7 | `outcome='unknown'` 關閉之後,`begin_charge_attempt` 對**同一張單**仍然回 `order_locked` | 讓關閉動作改動 `status` ⇒ 佔鎖那個 partial unique index 就不再命中 ⇒ 這格必紅 |
| 🔴 8 | `outcome='not_charged'` 關閉之後,同一張單**開得出新的 attempt**(客人付得了錢) | 讓 `not_charged` 也走 `unknown` 那條(= `4.0-d` 的原形狀)⇒ 這格必紅 |
| 🔴 9 | **`p_outcome` 必填**:不給或給不在 enum 內的值 ⇒ RAISE,**不得預設成任何一條** | 給它一個預設值 ⇒ 這格必紅 |

⚠️ ~~原 `#7` 後半「同一個人也擋得住」~~ **已刪:零判別力** ——
per-user 閘是**異單 + 10 分鐘**(`20260612150000:202-211`),而佇列成員卡了 8 天
⇒ **兩個世界它都不在射程內**。守同單的是**per-order 佔鎖**(`:214-223`),不是那道閘。

🔴 **`#6`/`#7` 是 2026-08-19 換形狀之後才有的,而它們守的是【重複扣款】** ——
`#1`(計數變 0)在**兩個世界都成立**:正確的實作與「標成失敗」的實作**都會讓計數歸零**,
而後者會釋放鎖。**只有 #6/#7 分得開它們。**

🔴 **#3 是這片真正的守門** —— 它證的是「我們把告警修好了」而不是「我們把告警關掉了」。
**只有 #1 的話,兩個世界(修好 vs 永遠 0)印同一個東西。**

## 7. 誠實揭示

🔴 **`unknown` 那條路把單鎖著,而本 plan 不做那份清單**(2026-08-19 補;GR 審之後才看清楚):
```
選 unknown ⇒ 告警清掉、鎖留著 ⇒ 那張單客人【仍然付不了】
⇒ 我們把「響的告警」換成「安靜的鎖」，而【安靜】正是這一整條線最初的病
⇒ 那些列需要一份【自己的清單】（不是告警）讓人回頭看
🔴 本 plan【不設計它】—— 寫在這裡是因為「不做」與「沒想到」在檔案上長得一樣
```

```
· 我沒有連過正式庫；那筆的狀態是【轉述】（Sean 跑 triage、主視窗轉）
· ①「後台有沒有一條路能呼那支 RPC」我【沒有查】⇒ 那是本片成本的最大變數
· 本 plan 不處理「為什麼會卡 8 天沒人發現」——那是【有沒有人在看告警】的題，另一條線
· 這一筆是已知的測試單，而本 plan 刻意寫成通則：下一筆可能是真客人
· 🔴 在本片落地之前，那個告警【每天都會響】—— 而它現在的響法是「一個永遠亮著的燈」
```
