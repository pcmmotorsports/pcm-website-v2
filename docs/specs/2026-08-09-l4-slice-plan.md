# L4 施工 plan v3(撞窗即時對帳)— 2026-08-09,新 P 窗

> 母 plan = `2026-08-09-l4-l5-settlement-compensation-plan.md`(v2,已核准)。本檔只寫**怎麼施工**。
> 片型=**高風險**(鐵則 12①錢 ③DB 結構)⇒ 關卡1 + 關卡2 codex 皆不降級;⛔ migration apply 停點=主視窗。
> **v3 = codex 關卡1 跑滿兩輪後的版本**:R1 FAIL(7 must-fix + 1 nit)→ v2 → R2 FAIL(7 must-fix + 1 nit,**全新、非重複**)→ v3。
> 逐條處置見 §7。**核准前零 code。**
> 🔴 R2 對兩條「我拒絕採納」的判定:**「F1 判定:作者對。…找不到可重現的雙扣時序。只回 `order_id` 足以安全裁決。」**
> ⇒ 設計面已收斂;R2 的 7 條**全部是守門判別力**問題(我的守門會假綠),不是設計問題。

---

## §0 開工前已實查的四件(全部我自己量,不是轉述)

| 事實 | 我怎麼量的 |
|---|---|
| `begin_charge_attempt` live 定義 = A8c1 `20260804120000` | 該檔 `:71` `CREATE OR REPLACE`,migration 序最後一支定義它的檔 |
| live md5 = `f621a56231e20f7f0b2618b40ac1276d` | **我自己的 cluster** 實跑(`PORT=54372`、`data_directory=/tmp/p2-l4-work/pgdata` 已驗)⇒ 與交接值兩個獨立來源相符 |
| `user_in_flight` 回傳無識別碼 | `20260804120000_*.sql:181` 逐字 |
| 節流 ceiling **不是**輪詢共用的預算 | `20260621120000_*.sql:51` 逐字「輪詢窗內 count 恆=0」;`settle_attempt_count` 是 sweeper 計數器、輪詢不遞增它。**真正共用的是 `last_poll_settle_at` 時窗**(同一 order 一個窗)。v1 我把這句寫錯,codex 抓到,已實查更正。 |

---

## §1 拆片(三片;鐵則 4)

| 片 | 內容 | 估時 | 前置 |
|---|---|---|---|
| **L4a-1** | migration(begin 回在途單 order id)+ 拋棄庫行為矩陣 harness | ~45 分 | — |
| **L4a-2** | 契約層透傳:domain type / adapter parse / 兩支 use-case | ~30 分 | L4a-1(契約形狀定於 migration) |
| **L4b** | action 層即時對帳 + 洩漏守門 | ~40 分 | L4a-2 |

**L4a-1 + L4a-2 上線後、L4b 之前 = 死欄位。**
🔴 **但不得說成「逐字零行為」**(codex F7 糾正,採納):**RPC 的 payload 確實變了**(多一個 key)。
準確說法 = **app 可觀察行為不變**:唯一消費者是 `parseBeginResult`,它對多出來的 key 不讀 ⇒ 上層拿到的物件與今天全等。

🔴 **兩個方向的版本錯位都要能活(memory `feedback_app-layer-must-not-ship-before-migration-apply`,08-07 正式站壞 8 小時那條)**:
- **app 新 × DB 舊**(L4b 先上、migration 未 apply):payload 無 `in_flight_order_id` ⇒ `inFlight` 缺 ⇒ 即時對帳整段 skip、退回今天行為。
- **DB 新 × app 舊**(migration 先 apply、舊 app 還在跑):`parseBeginResult` 不讀未知 key ⇒ 無影響。
🔴 **這兩句在 L4a-1 當下是「設計」不是「已驗」**(codex 關卡2 R1 抓到字面 vs 事實):
6a/6b/6c 三格測試屬 **L4a-2 / L4b**,L4a-1 這一片**還沒有任何一格落地**。
L4a-1 已驗的只有 DB 側:9 格行為矩陣 + 8 發突變 × 兩軸(`scripts/l4a1-verify.sh`,25 條斷言)。
⇒ 在 6a/6b/6c 真的寫出來以前,不得說「兩個方向都有測試」。

---

## §2 L4a-1:migration

**檔名**:`supabase/migrations/20260809210000_m4b_lifecycle_l4a1_begin_in_flight_order_id.sql`
**做法(零漂移,照 L2 家規)**:`cp` live 檔函式本體 → **只改下列兩處** → `diff` 核對其餘逐字相同。**不手抄。**

🔴 **是兩處不是一處**(R2 抓到,採納):v2 寫「只改 `:171-182`」但 SQL 用了 `v_inflight_order_id`,
那個變數在 A8c1 的 `DECLARE`(`:77-86`)裡**不存在** ⇒ 照 v2 字面施工會編譯失敗。
- **改動 1**:`DECLARE` 區加一行 `v_inflight_order_id uuid;`
- **改動 2**:`:171-182` per-user 閘那段
⇒ 零漂移 diff 的期望值 = **恰兩處**,不是一處。(這條是「我自己的 plan 前後不一致」,不是設計問題,但照字面施工就會撞牆。)

```sql
   ORDER BY a.created_at DESC, a.id DESC        -- tie-breaker(codex nit:同 timestamp 不得任選)
   LIMIT 1;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'acquired', false, 'reason', 'user_in_flight',
      'in_flight_order_id', v_inflight_order_id
    );
```

- **述詞一字不改** ⇒ 擋/不擋判斷與今天相同;`SELECT INTO` 後的 `FOUND` ⇔ 舊 `EXISTS` 為真。
- **只回 order_id,不回 rec_trade_id**(codex F1,採納並簡化):
  `settleCharge` 本來就用 `orderId` 重查 attempt、自取 `recTradeId`/`bankTransactionId` 當強鍵(`settle-charge.ts:74,77`)⇒ hint 是多餘的。
  🔴 **但 codex 說 stale hint 會造成雙扣,這一條我實查後不採信**:`recordMatchesOrder:340` 對 stale hint 走 `hint_mismatch` → `pending` = **fail-closed**,不會誤放行。
  刪掉它的理由是**它沒有用途、且憑空多一個較舊的觀察**,不是因為它會雙扣。(字面=事實:不借用一個我查證為假的理由。)
- **不回 attempt_id + 不加 `expectedAttemptId`**(codex F1 的修法,**不採納**,理由如下,列給 R2 攻擊):
  殘餘面 = begin 交易結束到 settle 之間,那張在途單的 active attempt 被換掉。此時 settle 裁的是**當下那一張**,而那正是正確對象。
  三條出口都安全:裁 `failed` ⇒ 該 attempt 真的死了 ⇒ 重試 begin,閘重查真相 ⇒ 沒有殭屍就放行、有就照擋;裁其餘 ⇒ 照舊擋。
  ⇒ **閘的真相由重試那次的 begin 重新認定,不由我們手上的識別碼認定** ⇒ pin attempt 不增加安全性,只增加一個會過期的欄。
- **不回 display_id**:`user_in_flight` 對客不得帶單號(`charge-actions.ts:362` round3 C)。**沒帶進來的東西洩不出去。**
- 欄名用 `in_flight_*` 不用 `existing_*`:後者是 cart dedup 前綴,混用會讓守門與 grep 分不開。

**前置閘**:`md5(pg_get_functiondef(begin))` 必 = `f621a5…c1276d`(§0 實測),不符 RAISE 停下。
只釘 begin 一支:A8c1 另釘 mark 三支是為了防 #321 倒寫**它們**;本片不碰那三支 ⇒ 多釘 = 無關的假前置條件。

**結構 assert**:A8c1 五條錨(隔離閘 / FOR UPDATE / 取消守門 / dedup ORDER BY / 佔鎖 INSERT)逐字保留
+ ACL 窮舉 + SECDEF fail-open 面(整段沿用)
+ 🔴 **新增:per-user 閘完整述詞錨**(codex F2,採納)。
  v1 的「述詞一字不改」只是**施工者的承諾**,沒有任何守門看得到它 —— 刪掉 `o.payment_status <> 'paid'` 或 10 分鐘條件,migration 照樣通過。

  🔴 **但不能拆成五條 `position()`**(R2 抓到,採納 —— 這條是本輪最有價值的一條):
  cart dedup 區(A8c1 `:138,145`)裡**本來就有** `a.status IN ('pending', 'charged')` 與
  `o.payment_status = 'paid'::public.payment_status` 這些字串。用 `position()` 各搜整支函式,
  **刪掉 per-user 閘那一條,dedup 區照樣供得出同一個字串 ⇒ assert 假綠**。
  這正是 memory `feedback_negative-test-observation-supplied-by-another-mechanism`
  (「拿掉守門後,那個觀察被別的機制照樣提供」)的逐字重現。
  **修法** = 錨定 **per-user 閘整段連續字串**當**一條**錨 + occurrence 計數恰 1 次。
  🔴 **範圍必須從 `SELECT a.order_id` 一路含到 `END IF;`**(codex 關卡2 R1 抓到 —— 我原本只錨到 `LIMIT 1;`):
  把 `IF FOUND` 改成 `IF NOT FOUND`,述詞一字沒動、`in_flight_order_id` 也還在 ⇒ 舊錨全綠,**閘的行為卻整個反轉**。
  ⇒ 錨要同時涵蓋 **述詞 + 控制流 + 回傳**;少一段就有一整族突變逃得掉(harness 的 M8 就是釘這一條)。
  🔴 保留這些錨的理由不是儀式:本片 `CREATE OR REPLACE` 整支函式,**抄錯一行就會把 A8c1 的取消守門弄不見**,錨是唯一會喊的人。

**Rollback**(鐵則 8 要求,v1 漏寫;forward-only 慣例):
本片對 payload 是**純加欄**、對閘零改動 ⇒ 回頭風險低於 A8c1。
分支 1(app 尚未消費,= 正常情形):直接 `CREATE OR REPLACE` 回 A8c1 逐字(`20260804120000:71-202`)+ 還原 COMMENT,單一交易。
分支 2(L4b 已上線):🔴 **兩種順序都安全,不宣稱硬順序**(R2 nit 採納 —— 我自己在 §1 已經證明 app 新 × DB 舊會安全 skip,
卻又在這裡寫「順序不得反」,**自相矛盾**;SQL 先回只是功能暫停,不是安全破口)。
**建議**先撤 app 再回 SQL,理由僅為觀測性(否則「為什麼沒作用」查不出來)。
兩種順序各自的 read-back:撤 app 後驗撞窗回舊文案且零 `settleCharge`;回 SQL 後驗 `md5(functiondef)` 回到 `f621a5…c1276d`。

**DB 行為矩陣(拋棄庫實跑,codex F2 採納;非只有結構錨)**
| 格 | 構造 | 期望 |
|---|---|---|
| 1 | 同會員無在途 attempt | `acquired:true` |
| 2 | 同會員 1 張在途(pending、異單、10 分內、單未 paid) | `user_in_flight` + `in_flight_order_id` = 那張 |
| 3 | 在途單**已 paid** | 不擋(舊述詞 `o.payment_status <> 'paid'`) |
| 4 | attempt **超過 10 分鐘** | 不擋 |
| 5 | attempt 是**本單**(`a.order_id = p_order_id`) | 🔴 基線 = **`order_locked`**,不是籠統的「不擋」 |
| 6 | 同會員 2 張在途、**`created_at` 完全相同、uuid 不同** | 擋 + 回 **id 較大**那張 |
| 7 | attempt status = `released` | 不擋 |
| 8 | 🔴 **另一個會員**有在途 attempt | 不擋 |
| 9 | 🔴 attempt status = `failed`(與格 7 **分開成格**) | 不擋 |
| 10 | 🔴 **`charged`-未-paid**(migration 自陳的「雙扣視窗」) | 擋 + 回 `in_flight_order_id` |

**突變紀律**:逐條刪述詞 ⇒ **只紅對應那一格**。三處 R2 糾正,全採納:
- **格 5**:本單有 active attempt 時會落到佔鎖 INSERT 的 `ON CONFLICT DO NOTHING` ⇒ A8c1 `:191-192` 回 **`order_locked`**。
  寫「不擋」是錯的,而且**那個錯會讓這一格失去判別力** —— 刪掉異單條件後結果從 `order_locked` 變 `user_in_flight`,
  只有把基線釘成 `order_locked` 才看得出這個轉變。
- **格 6**:v2 沒要求兩筆 `created_at` **相同** ⇒ 拿掉 `a.id DESC` 後 `created_at DESC` 照樣選中同一筆 ⇒ **突變存活**。
  必須構造同 timestamp、不同 uuid,斷言固定回 id 較大者。
- **格 8(新增)**:v2 七格裡**沒有任何一格**在刪掉 `a.customer_user_id = …` 之後會紅 ⇒ 那條述詞當時是無守門的。
- **格 9(關卡2 R1 新增)**:原本把 `released / failed` 寫在同一格,但 fixture 只造了 `released`
  ⇒「誤把 `failed` 加進 active 集合」這個突變**沒有任何一格會紅**。拆成兩格才有判別力。

**實跑結果(`scripts/l4a1-verify.sh`,PORT=54372 自己的拋棄庫)**:**10 格矩陣 + 9 發突變 × 兩軸 = 28 條斷言全綠**。
🔴 **格 10 與 M9 是 R3 換模型審查(P-262-A F3)加的,不是我想到的**:原本 9 格 fixture **沒有任何一格是 `charged`**
—— 而 migration 自陳「charged-未-paid 也擋 = 雙扣視窗」正是本閘**最高錢面**的述詞
⇒「把 `'charged'` 從 status 集合刪掉」這個突變當時**無格可紅**。同一族的第三次:守門存在、但那條路上沒有觀察點。
八發突變:M1 paid 條件 / M2 10 分鐘 / M3 異單 / M4 status 加 released / M5 同會員 / M6 tie-breaker 反向 / M7 status 加 failed / M8 `IF FOUND`→`IF NOT FOUND`。
- **軸 A**(帶 assert 送)= 8 發**全部**被整段錨擋下。
- **軸 B**(裸裝突變)= M1-M7 各自**恰好只翻對應的一格**;M8 是控制流反轉、本來就會翻多格,只要求「矩陣看得見」。
- 🔴 **排序第一鍵 = `(a.status = 'charged') DESC`**(R3 F4,主視窗直接裁):同會員同時有 charged-未-paid 與較新 pending 時,
  回較新的 pending = 把對帳目標指向**證據弱**的那張。逐字比照 cart dedup 那段已被 codex 硬化過的前例,不發明新序。
- 🔴 **M6 改成把 tie-breaker 反向(`a.id ASC`)而不是拿掉它**(codex 關卡2 R1):拿掉第二排序鍵時 PG **可能**照樣
  回同一筆 ⇒ 翻不翻格取決於執行計畫 = 這一發綠了也證不了東西。反向則結果確定、可重現。

## §3 L4a-2:契約層(四檔,全 additive)

🔴 **discriminated union,不是 optional 掛在所有 reason 上**(codex F4,採納 —— v1 的 `inFlight?` 會容許 `order_locked + inFlight` 這種非法狀態):

```ts
export type InFlightSettleContext = { orderId: string };
// BeginChargeAttemptResult 的 acquired:false 分支:
  | { acquired: false; reason: 'user_in_flight'; inFlight?: InFlightSettleContext }
  | { acquired: false; reason: 'order_locked' | 'not_unpaid' }
```
`ConfirmPaymentOutcome` / `InitiatePaymentOutcome` 的 `locked` 同形(只有 `user_in_flight` 能帶)。

**adapter `parseBeginResult` 的 `user_in_flight` 分支**(F4 後半,採納):
- 欄**全缺** ⇒ 舊 migration ⇒ `inFlight` undefined(合法)。
- 欄在且為 **string** ⇒ 帶上。
- 欄在但**型別錯**(number/object/false/空字串)⇒ **throw**(fail-closed,逐字沿用 `needs_settle` 分支那套,不另發明)。
- 🔴 `null` 視同錯型別而非「舊 migration」:新 migration 在 `IF FOUND` 內必填此欄,`null` = 契約違反。

## §4 L4b:action 層

`mapOutcome` / `mapInitiateOutcome` 的 `user_in_flight` 分支 → `adjudicateInFlight()`:

```
inFlight 缺 → 照舊擋(in_flight)                    ← DB 舊版的安全退路
claimPollSettle(inFlight.orderId, 10) false → 照舊擋  ← 秒數現在就拍定 = 10(沿用 POLL_SETTLE_THROTTLE_SECONDS)
settleCharge({orderId: inFlight.orderId}) throw → 照舊擋(局部 catch,不落外層 generic catch)
  kind = 'failed'                    → 重試恰一次
  kind = 'paid' | 'pending' | 'no_attempt' → 照舊擋
```

🔴 **`no_attempt` 不放行**(與 cart dedup 那條路刻意不同):dedup 的 `no_attempt` 是「同 cart 兄弟單已無 active attempt」;
這裡的在途單是**剛剛才被閘認定 active** 的,`no_attempt` 代表兩次觀察不一致 ⇒ 未知不放行。母 plan 護欄 2「只放行 `failed`」逐字。

🔴 **重試的邊界寫死**(codex F3,採納 —— v1 只寫「重試整段 confirm/initiate」,施工時可能被讀成遞迴呼叫 action):
- **只重呼同一支 use-case**(`confirmPayment` 或 `initiatePayment`),參數**完全相同**:同一 `placed.orderId`、同一 `total`、同一 `cardholder`、**同一把還沒用掉的 prime**(begin 沒過 ⇒ charge 從未跑 ⇒ prime 未消耗)。
- **禁止**遞迴呼叫 `chargePaymentAction`、**禁止**重跑 `placeOrder` / preflight / `findTotal`。
- 實作形狀:把「呼 use-case + 映射」包成一個區域 closure,呼**兩次**(第二次只在 `failed` 時);用**明確的 `attempt: 1 | 2` 計數**,不用 while/遞迴。

**節流**:複用 `getPollSettleThrottle()` / `IPollSettleThrottle`,秒數 = **10**(與輪詢端點同值)。
⚠️ 誠實邊界(v1 寫錯、已依 §0 更正):與輪詢端點共用的是**同一張 order 的 `last_poll_settle_at` 時窗**,不是 ceiling。
⇒ 客人剛輪詢過那張在途單、10 秒內又撞窗 ⇒ 節流不放行 ⇒ 退回今天的行為(**不是新洞,是這一次沒改善**)。

## §5 測試設計(反恆真;每條配自己的突變)

1. **只放行 failed**:窮舉 `paid` / `failed` / `no_attempt` + `pending` 的**全部 5 個 reason**(`auth_or_pending`/`record_unverified`/`record_not_found`/`record_unreachable`/`released_failure_observed`)= 8 格(codex F6 採納:v1 寫「五種 outcome」是把 kind 與 reason 混為一談,只測一個 pending reason 會讓「放行另一個 reason」的突變全綠)。突變:讓任一非 `failed` 放行 ⇒ 只紅那一格。
2. **節流生效**:連兩次撞窗 ⇒ **數 `settleCharge` 呼叫次數**(不是數回傳值 —— 兩次回傳一樣 = 量錯東西)。分兩格:時窗 false / 無 active attempt false。
3. **重試恰一次** —— 🔴 **斷言用 `===` 不用 `<=`**(R2 抓到,採納):`begin <= 2` 且 `charge <= 1` 會被
   「**完全不重試**」(begin=1、charge=0)滿足 ⇒ 那組斷言證不了「有重試」,只證了「沒暴衝」。兩格分開:
   - **3a 第二次仍擋**:`placeOrder === 1`、`begin === 2`、`settleCharge === 1`、TapPay charge **=== 0**、回 in_flight。
   - **3b 第二次取得鎖**:`begin === 2`、TapPay charge **=== 1**、且該次 charge 收到的 **prime / orderId / total / cardholder 與第一次逐字相同**、無第三次 begin。
   突變:把重試 budget 從 1 改成 2 ⇒ 3a 紅;拿掉重試 ⇒ 3a 的 `begin === 2` 與 3b 的 `charge === 1` 同時紅。
4. **settleCharge throw** ⇒ 回 in_flight,且**不**進外層 generic catch(否則 client 釋鎖重試 = 雙扣)。
5. 🔴 **零洩漏,三層**(R2 抓到 v2 的漏洞,採納):
   v2 的「exact keys + sentinel 深掃」被一個具體突變擊破 —— `message: \`${MSG.inFlight} ${orderId.slice(0, 8)}\``:
   **keys 完全沒變**(a 綠)、**完整值找不到**(b 綠),但單號前 8 碼已經到瀏覽器了。
   (同 memory `feedback_assertion-measures-the-wrong-thing`:量的是 key 的集合,不是值的內容。)
   - (a) **exact keys** = `{ok, payment, message}`,多一個 key 就紅。
   - (b) 🔴 **exact value**:`message` 必**恆等於 `MSG.inFlight` 常數本身**(不是 `contains`、不是不含 sentinel)。
     ⇒ 截斷、改名、加後綴、轉碼**全部**紅,因為任何加工都讓它不再等於那個常數。
   - (c) sentinel 深掃(整個回傳物件遞迴)查無 orderId 全值 —— 留作第二層,不當主守門。
   突變三發各紅一條:多回一欄 ⇒ (a);`+ orderId.slice(0,8)` ⇒ (b);把 orderId 塞進新欄 ⇒ (a)+(c)。
   **不採 runtime projector**:(b) 的 exact-value 與 projector 對這個突變族判別力相同,而 projector 是多一層 prod code。
6. **版本錯位** —— 🔴 v2 說「兩方向各有測試」是**不實**(R2 抓到):6a 與 6b **都是** app 新 × DB 舊。已補第三格:
   6a **app 新 × DB 舊(adapter 層)**:raw payload **無** `in_flight_order_id` ⇒ 回 `{acquired:false, reason:'user_in_flight'}` 且無 `inFlight`。突變:把欄改必填 ⇒ 紅。
   6b **app 新 × DB 舊(action 層)**:legacy `locked` outcome ⇒ **零** `settleCharge` 呼叫 + 回今天逐字相同的 in_flight。突變:把 `inFlight` 缺當成可放行 ⇒ 紅。
   6c 🔴 **DB 新 × app 舊(characterization)**:餵**帶** `in_flight_order_id` 的新 payload 給**不讀該欄**的解析路徑 ⇒ 輸出與舊 payload 逐字相同。突變:讓 parser 對未知 key throw ⇒ 紅。

---

## §6 兩個要主視窗裁的

**Q1 — 洩漏守門的形狀**(主視窗交辦逐字 = 「做成 client bundle 掃描守門、不是註解」)。
照做前先講一件實查:`charge-actions.ts` 首行是 `'use server'` ⇒ **它整支不進 client bundle**。
所以「掃 `.next/static` 找不到 `in_flight_order_id`」這條斷言,在「我們真的把單號回傳給瀏覽器」時**照樣會綠**
—— 它擋不住這片真正的洩漏管道(server action 的**回傳值**才是下傳通道)。
那正是 memory `feedback_guard-checks-existence-not-effect` 那族:守門存在,但構造不出能紅它的情境。
codex 關卡1 獨立同意此判斷,並補一條:值層 sentinel 深掃擋得住「塞進 message」但擋不住改名/截斷 ⇒ 應加**正向 exact-keys 白名單**。

- **A(我的推薦)**:§5-5 的三層 —— exact **keys** + `message` exact **value**(恆等於 `MSG.inFlight` 常數)+ sentinel 深掃,三發突變各紅一條。
  **不做**執行期 projector:R2 給的破口(`+ orderId.slice(0,8)`)已被 exact-value 那條殺掉,判別力與 projector 相同,而 projector 是多一層 prod code。
- **B**:照交辦做 bundle 掃描,檔頭寫明「本守門對回傳值洩漏全盲」,並仍補 A。
- **C**:A + B 都做(B 當廉價腰帶,標註判別力範圍)。

**Q2 — 三片的 commit / apply 節奏?**
- **A(推薦)**:L4a-1 + L4a-2 先 commit(死欄位、app 可觀察行為不變),apply 與 L4b 之後一起排。
- **B**:三片全做完才一起交。

---

## §7 codex 關卡1 R1 逐條處置(7 must-fix + 1 nit)

| # | findings | 處置 |
|---|---|---|
| F1 | TOCTOU:回 rec_trade_id 沒釘住 attempt | **部分採納**:刪 rec_trade_id(它無用途);**不採納** attempt_id + `expectedAttemptId`——理由見 §2,並實查推翻「stale hint 會雙扣」(`:340` fail-closed) |
| F2 | 述詞無錨、無 DB 行為矩陣 | **採納**:五條述詞錨 + §2 七格矩陣 + 逐條刪述詞只紅一格 |
| F3 | 重試邊界未鎖死、可能遞迴呼 action | **採納**:§4 寫死「只重呼 use-case、同參數、禁重跑 placeOrder」+ 三個計數斷言 |
| F4 | `inFlight?` 容許非法狀態;半套 payload 未分辨 | **採納**:§3 discriminated union + null 視為契約違反 |
| F5 | 值層深掃擋不住改名 ⇒ 要正向白名單 | **採納 exact-keys**;**不採納** runtime projector(§6 Q1-A 理由) |
| F6 | 「五種 outcome」數錯;未 apply 守門殺不掉 adapter 突變 | **採納**:8 格窮舉 + 6a/6b 拆兩層 + budget 突變取代 while |
| F7 | 片過大、缺 rollback、「零行為」措辭不實 | **採納**:拆三片 + §2 rollback + 改口徑為「payload 變、app 可觀察行為不變」 |
| F8 | throttle 秒數未定;ceiling 敘述錯 | **採納**:秒數 = 10 拍定;§0 實查更正為 `last_poll_settle_at` 時窗 |
| nit | ORDER BY 無 tie-breaker | **採納**:`, a.id DESC` |

## §8 codex 關卡1 R2 逐條處置(7 must-fix + 1 nit,**全數採納**)

R2 沒有一條與 R1 重複,也沒有在同一層打轉 —— 它攻的是「**R1 的修法本身會不會假綠**」,深了一層。

| # | findings | 處置(全採納) |
|---|---|---|
| R2-1 | `v_inflight_order_id` 未宣告,「只改一處」與 SQL 自相矛盾 | §2 改為**明列兩處改動**(DECLARE + 閘段),零漂移期望值=恰兩處 |
| R2-2 | 🔴 五條 `position()` 錨會假綠 —— cart dedup 區供得出同一批字串 | §2 改為**整段連續字串當一條錨** + occurrence 恰 1 次 |
| R2-3 | 矩陣缺跨會員格;格 5 基線寫錯(實為 `order_locked`) | §2 矩陣加**格 8 跨會員**、格 5 基線改 `order_locked` |
| R2-4 | 格 6 沒要求同 timestamp ⇒ 拿掉 `a.id DESC` 突變會存活 | §2 格 6 改為**同 `created_at`、不同 uuid**,斷言回 id 較大者 |
| R2-5 | `begin<=2`/`charge<=1` 被「完全不重試」滿足 | §5-3 拆 **3a/3b** 兩格、全改 `===`、3b 釘同 prime/total/cardholder |
| R2-6 | 6a/6b **都是** app 新×DB 舊,「兩方向」不實 | §5-6 補 **6c**(DB 新×app 舊 characterization);6a/6b 標明同方向 |
| R2-7 | exact-keys + sentinel 擋不住 `+ orderId.slice(0,8)` | §5-5 加 **`message` exact-value** 恆等常數;仍不採 runtime projector(理由 §6 Q1-A) |
| R2-nit | rollback「順序不得反」與 §1 自相矛盾 | §2 改為兩序皆安全、先撤 app 僅為觀測性,各列 read-back |

**判停**:設計面 R2 明文背書(F1 作者對);剩下全是守門形狀,已逐條寫死在 §2/§5。
⇒ **不跑 R3**。真正該被攻擊的是**實作出來的 diff**(關卡2),不是再修一版 plan 字面
(memory:前代這條線曾「5 份 plan、104 條 must-fix、0 行 code」)。

— plan v3 結束,核准前零 code。
