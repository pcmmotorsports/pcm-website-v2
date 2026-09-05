# Plan · ⟦b4-BANKNOEMAIL⟧ 匯款單成立信

> 線【信】`-mail` · 2026-09-06 凌晨 · **規劃階段, 一行碼都沒動**
> 片型:**高風險片**(鐵則 12 **①錢** + **③DB 結構** + **⑤對外不可回收 · 寄信**)· 鐵則 8(跨 3+ 檔)
> ⇒ 本檔就是要批准的那份 plan。批准後才動碼。
> 派工來源:主視窗 `-f8` 2026-09-06 01:4x。板列 `⟦b4-BANKNOEMAIL⟧`(`docs/launch-todo.md:342`)。
>
> 🔴🔴 **狀態 = R1 FAIL 已修, 待 R2** —— codex 關卡1 回 **18 條 must-fix, 我全折**(逐條處置在 **§9**)。
> **§2 / §4 / §5 / §6 / §7 / §8 的本文已依 §9 改過** ——
> 🛑 **不要只讀 §9 就以為本文還是舊的, 也不要只讀本文就以為它一次寫對**:
> 📌 **第一版在【邊界與宣稱】上普遍偏鬆, 而那個病本身是這份 plan 的一部分紀錄。**

---

## §0 這片要解的一句話

客人在顧客站選「匯款」下單之後, **一封信都收不到**。匯款資訊(銀行 / 戶名 / 帳號 / 備註填單號 / 期限)
只活在 `/account/orders/<displayId>` 那一頁, 而**沒有任何一封信把他帶回那一頁**。
關掉分頁 ⇒ 沒有第二個觸點 ⇒ 5 天後那張單自動取消, 中間零提醒。

🔴 **它痛在【沒有寄】, 而沒有寄出去的信在每一把尺上都是綠的** —— 零錯誤、零死信、心跳照常、outbox 零列。

---

## §1 §0 那三句是量到的(依據逐條)

| 宣稱 | 依據 | 正對照 | 負對照 |
|---|---|---|---|
| 寄信端沒有依付款管道分岔的碼 | `packages/use-cases/src/sweep-email-outbox.ts` 全檔 `payment_channel`/`paymentChannel`/`payment` ⇒ **0** | 同尺問 `order` ⇒ **68** | 現造字 ⇒ **0** |
| 就算跑到, 那句話對匯款客人是假的 | 同檔 `:478` 逐字 `` `您的訂單 ${displayId} 已付款成功。` `` | — | — |
| 而它根本不會跑到 | `20260905210000:121` 逐字 `WHERE o.payment_status = 'paid'`(`pcm_order_created_email_pending` 最新一代) | `latest-definition-of.sh` 列 3 代, 最後一代就是它 | — |
| 值是在的, 只是沒接到信上 | `packages/domain/src/order/remittance-info.ts` 匯出 `PCM_REMITTANCE_BANK_NAME` / `_BRANCH` / `_ACCOUNT_NAME` / `_ACCOUNT_NO` / `_MEMO_INSTRUCTION` / `_EXPIRE_DAYS` + `remittanceDeadlineLabel` | 唯一消費端 `apps/storefront/src/components/account/OrderDetailView.tsx:663-698`;同檔 `order` ⇒ **99** | 同檔現造字 ⇒ **0** |

⚠️ **全部是【讀碼】** —— 沒跑正式站、沒寄一封信來看。

---

## §2 ① 事件形狀 —— **推薦【乙:新 `event_type`】, 而理由是甲會【弄丟一封現在有在寄的信】**

### 甲案(在既有 view 加分支, 沿用 `order_created`)怎麼垮

`email_outbox` 的唯一鍵是 **`UNIQUE (event_type, dedup_key)`**(`20260717020000:377`),
而 `order_created` 的 `dedup_key` 逐字是 **`order_id::text`**(同檔 `:349` COMMENT:「一單一封」)。
四支 pending view 的 anti-join 也逐字是 `NOT EXISTS (… e.order_id = o.id AND e.event_type = 'order_created')`。

```
匯款單成立 ⇒ 甲案寄一封, 落一列 (order_created, <order_id>)
   ↓ 客人真的匯款進來, payment_status 翻 paid
pcm_order_created_email_pending 的 anti-join 找到那一列
   ⇒ 🛑 這張單【不再進掃描面】
   ⇒ 🔴 他【永遠收不到】那封「已付款成功 + 訂單明細」的信
```
📌 **甲案不是「多寄一封」, 是【用一封換掉另一封】** —— 而換掉的那封是今天真的在寄的。
⛔ ~~要救它只能讓匯款那封用不同的 `dedup_key`…**兩邊都補不起來。**~~
🔴 **2026-09-06 codex R1-① 打掉這句, 而它是對的**(§9-A①):分階段 dedup key +
**讓 anti-join 比對對應的 key** 就保得住兩封 ⇒ **甲案不是不可能。**
✅ **訂正後的理由(強度較弱, 而它才是真的)**:甲案要**動既有那支 view 的 anti-join** ——
那是一支**已在正式庫**的 view, 而它管的是一封**今天真的在寄**的信。
⇒ 📌 **推薦乙的理由是【甲要動到不該動的東西】, 不是【甲做不到】。**
🛑 端給 Sean 時要用這個強度, **不可以用作廢的那一句。**

### 乙案(新 `event_type = 'bank_order_created'`)—— 推薦

- `dedup_key` = `order_id::text`(在**新的 event_type 內**全域唯一 ⇒ 滿足 `20260717020000:350` 那條硬約束)。
- **防重排**:靠新 view 自己的 anti-join `NOT EXISTS (… AND e.event_type = 'bank_order_created')` + 唯一鍵兩道。
  ⛔ ~~防重寄~~ 🔴 **那兩道擋的是【重複排進佇列】, 擋不了【at-least-once 重送】**(codex R1-⑧, §9-B):
  送失敗會退避重試(`20260717020000:53-59`)⇒ **provider 已寄出而我們記失敗 ⇒ 客人收到第二封。**
  ⇒ 📌 這封信的語意要能承受「同一封收到兩次」—— 幸好它是**唯讀資訊**(帳號 + 期限), 不是動作指令。
- **付款後不會再寄一封匯款信**:新 view 的述詞含 `payment_status = 'unpaid'` ⇒ 翻 `paid` 就離開掃描面。
- 🟢 **而 `order_created` 那封【完全不受影響】** ⇒ 客人依序收到:匯款單成立信 → (他匯款) → 已付款成功信。
  📌 **這正是甲案做不到的那一格。**

🔵 **先例在**:`20260902120000_m4b_outbox_order_cancelled_event.sql` 就是「開第三個 `event_type`」那一片,
本片照它的形狀寫(`:184-187` `ADD … NOT VALID` → `VALIDATE` → `DROP 舊` → `RENAME`)。

### 乙案的代價(寫出來, 不藏)

1. **`event_type` 的 CHECK 要換一代** ⇒ 動 `email_outbox` 這張表 ⇒ 鐵則 12③。
2. **部署順序綁死**:`CHECK` 先貼 → 碼後上。反序 ⇒ 新碼寫入被 CHECK 擋 ⇒ 那一封進不了 outbox。
3. **兩個窮舉點要同時補, 少一個 typecheck 就紅(而那是好事)**:
   · `sweep-email-outbox.ts:414` 的 `switch (job.eventType)`(`:454` 有 `satisfies never`)
   · `SUPPRESS_WHEN_ORDER_INELIGIBLE`(`@pcm/ports`, 窮舉 `Record`;`:1059` 逐字
     `SUPPRESS_WHEN_ORDER_INELIGIBLE[job.eventType] !== false`)
   🛑 **這一格要在 plan 就決定**:匯款單成立信對「訂單不合格」要不要被壓掉 ⇒ **標 `true`(壓掉)**,
   與既有兩封同族 —— 一張不合格的單不該叫客人去匯錢。

---

## §3 ② 信的字面草稿(**Sean 的板;本節只是草稿, 不是決定**)

🛑 **不抄帳號進本檔** —— 下面全部寫**常數名**, 值由 `remittance-info.ts` 供。
理由逐字在該檔 `:10`:「**印錯 = 客人把錢匯到別的地方**」⇒ 兩份會各自漂 ⇒ 只能有一個來源。

**主旨**
```
訂單 {displayId} 已成立,請於期限內完成匯款
```

**內文(純文字版;HTML 版沿用 `renderPaidEmailHtml` 的骨架另議)**
```
您好,

您的訂單 {displayId} 已成立,目前尚未付款。
請依下列資訊完成轉帳,我們收到款項後會再通知您。

應付金額  NT$ {total}

匯款資訊
銀行      {PCM_REMITTANCE_BANK_NAME}({PCM_REMITTANCE_BRANCH})
戶名      {PCM_REMITTANCE_ACCOUNT_NAME}
帳號      {PCM_REMITTANCE_ACCOUNT_NO}
{PCM_REMITTANCE_MEMO_INSTRUCTION} {displayId}

{remittanceDeadlineLabel(created_at) ?? `請於 ${PCM_REMITTANCE_EXPIRE_DAYS} 天內完成匯款,逾期訂單將自動取消。`}

訂單內容與匯款資訊也可以在這裡查看:
{siteUrl}/account/orders/{encodeURIComponent(displayId)}
```

🔴 **四件已經決定好的形狀, 不要在實作時重新發明**:
1. **金額整數** —— 走 `formatOrderAmount`(既有), 禁 `number` 運算(Server 端鐵則)。
2. **期限句要能退回** —— `remittanceDeadlineLabel(createdAt)` 算不出來時回 `null`,
   ✅ **退回「請於 N 天內」那句**, 與 `OrderDetailView.tsx:697-698` **逐字同一句**(兩處不可各講各的)。
3. **網址段用 `displayId` 不是 UUID**, 且 `encodeURIComponent` **不可省** —— 那是既有契約
   (`OrdersTab.tsx:191` 註解逐字:displayId 兩種格式並存、是使用者可見識別碼、不保證 URL-safe)。
4. **`{total}` 從哪來** —— `IPaidEmailContext`。🔬 **它可以用在未付款的單上, 這是量到的**:
   `SupabasePaidEmailContextAdapter.ts:97-102` 逐字 `.from('orders')` + `.eq('id', input.orderId)`,
   **沒有任何 `payment_status` 過濾**。
   ⚠️ **而那個型別的【名字】會騙下一個人** —— 它叫 `Paid…` 而我們要餵一張 unpaid 的單
   ⇒ 📌 實作時要在呼叫處寫一句「**名字是 paid, 而它的查詢不看 payment_status(量過)**」, 不要改名(改名動五個面)。

⚠️ **本節【不含】的東西**:HTML 版排版、寄件人署名、客服 LINE 那一行 —— 那些沿用既有模板, 由 Sean 過目時一起看。

---

## §4 ③ 掃描面對【後台手動建的匯款/現金單】—— 🔴 **查了, 而它是本片最大的一個坑**

**量到的**:`admin_create_manual_order` 最新一代 `20260905360000`:
- `:215` 逐字 `IF p_payment_channel IS NULL OR p_payment_channel NOT IN ('bank_transfer', 'cash') THEN … RAISE`
  ⇒ 🔴 **後台手動單的 `payment_channel` 就是 `bank_transfer` 或 `cash`。**
- `:603-616` 的 `INSERT … VALUES` 欄位清單**不含 `payment_status`** ⇒ 走 DEFAULT
  ⇒ `20260604120000:99` 逐字 `payment_status payment_status NOT NULL DEFAULT 'unpaid'` ⇒ **unpaid**。

🛑 **⇒ 一條天真的述詞 `payment_channel = 'bank_transfer' AND payment_status = 'unpaid'`
會把【後台員工手動建的匯款單】一起掃進來** ——
📌 那是一個**員工已經在電話/LINE 上服務過**的客人, 而我們會寄給他一封列著公司帳號、叫他匯錢的信。

### 修法:述詞加 `order_source = 'web'`(**白名單, 不是黑名單**)

```sql
AND o.payment_channel   = 'bank_transfer'
AND o.payment_status    = 'unpaid'
AND o.cancelled_at IS NULL
AND o.order_source      = 'web'      -- 🔴 而它【不是來源證明】, 見下
AND o.manual_request_id IS NULL      -- 🔴 第二條:後台建單一定寫它
```
🔴🔴 **`order_source = 'web'` 單獨【不是白名單】**(codex R1-④, §9-A④):
`20260712203000:40` 逐字 `ADD COLUMN order_source text NOT NULL DEFAULT 'web'`
⇒ 🛑 **`'web'` 正是【忘記寫】會拿到的那個值。**
📌 而 `20260824020000:37` 逐字就寫著「吃 DEFAULT `'web'` ⇒ 手動單與客人自己下的單**分不出來**」
—— **那句話一直在 repo 裡, 而本 plan 第一版沒查它。**
✅ 兩條一起 ⇒ 把「**要同時忘記兩欄, 而且還顯式寫了 `bank_transfer`**」變成必要條件。
⚠️ **而我不宣稱這是證明** —— 兩條都是「忘記寫會通過」的方向。
⇒ 🔴 **真正的關法是【寫入端顯式標記來源】, 那不是本片, 而它要在板上有落點。**

🔴🔴 **而這一格【刻意與隔壁四支 view 相反】, 理由要寫進 migration 的註解裡**:

`20260905210000` 那四支的處理逐字是「**來源不明 ⇒ 留在掃描面上(照舊寄)**」,
因為那邊的 fail-safe 方向是「**少寄一封看不見**」。

```
既有四支的問題:「這封該不該寄給他」   fail-safe = 寧可寄  ⇒ NULL 留下
本片的問題    :「要不要叫他匯錢給我們」 fail-safe = 寧可不寄 ⇒ NULL 排除
```
⇒ 📌 **兩個問題的 fail-safe 方向相反 ⇒ 不共用同一條述詞。**
(這正是 memory `feedback_opposite-fail-safe-directions-cannot-share-one-formula` 那一條;
 而「對齊隔壁那四支」在 diff 上、在審查時都長得像**紀律**, 所以要**明文擋掉它**。)

🔵 **`cash` 也一併排除** —— 現金單沒有帳號可以匯, 而 `payment_channel = 'bank_transfer'` 那一條已經擋掉它;
本句只是把「為什麼不是 `<> 'tappay'`」寫下來:**白名單答得出未來新增的管道, 黑名單答不出。**

---

## §5 要改什麼(範圍鎖死)

| # | 檔 | 改什麼 | 不做會怎樣 |
|---|---|---|---|
| 1 | `supabase/migrations/20260906140000_…_outbox_bank_order_created_event.sql` | `email_outbox` 的 `event_type` CHECK 換一代, 加 `bank_order_created` | 新碼寫不進 outbox, 那一封永遠不存在 |
| 2 | `supabase/migrations/20260906150000_…_bank_order_created_pending_view.sql` | 新 view `pcm_bank_order_created_email_pending`(述詞見 §4)+ REVOKE/GRANT 白名單 | 沒有掃描面 ⇒ 沒有東西被撈出來 |
| 3 | `packages/ports/` | `SUPPRESS_WHEN_ORDER_INELIGIBLE` 補一格 `bank_order_created: true` | typecheck 紅(**這是好事**);硬闖 ⇒ fail-closed 全壓掉 |
| 4 | `packages/ports/` + `packages/adapters/src/email/` | 新 scanner port + adapter(照四支既有的形狀) | — |
| 5 | `packages/use-cases/src/enqueue-bank-order-created-emails.ts` | 新 use-case(照 `enqueue-order-created-emails.ts`) | — |
| 6 | `packages/use-cases/src/sweep-email-outbox.ts` | `switch` 加 `case 'bank_order_created'` + `buildBankOrderCreatedText` | `satisfies never` 紅 |
| 7 | `apps/storefront/src/app/api/cron/email-sweep/route.ts` | 接線 + **自己的 off-by-default env** + 計數進 503 條件 | 🔴 **那個 503 條件漏我這條線, 這個 repo 已經發生三次** |
| 8 | `packages/adapters/src/email/SupabaseEmailOutboxAdapter.ts:235` `composeEvent` + enqueue input/payload 型別 + 產生型 `database.types` | 補新事件 | **codex R1-⑥**:少了它落不了新事件、或 typecheck 直接紅 |
| 9 | 🔴 **寄送前重驗**(新, 在 `sweep-email-outbox.ts` 本事件的分支裡) | 送出前重讀該單:已 `paid` / 已取消 / 管道變了 ⇒ **標 skipped 不寄** | **codex R1-②**:掃描是快照, 寄送是後來 ⇒ 否則會寄「尚未付款」給一個**已經付完**的客人 |
| 10 | 🔴 env 關閉時同時進 `claimDue` 的 `excludeEventTypes`(`SupabaseEmailOutboxAdapter.ts:417-419`, **既有機制**) | — | **codex R1-⑥**:只擋 enqueue ⇒ 關掉之後既有 pending 列**照樣被認領寄出** ⇒ §7 的 rollback 是假的 |
| 11 | 對應測試 | §6 | — |

🛑 **不做**:HTML 版模板(§3 待 Sean 過目後另議)· 動既有四支 view · 動 `order_created` 任何一格 ·
動 `BANK_TRANSFER_CHECKOUT_ENABLED` · 前端任何一行。

⚠️ **`-f8` 給的版本號是「view = 150000」** ⇒ 我把 CHECK 排 **140000**, 因為**CHECK 一定要先於 view 與碼**。
差異在此明寫, 不默默改。

---

## §6 ④ 驗收(逐條可驗)

**A. 拋棄式 PG 三世界**(`docs/runbooks/throwaway-postgres-for-migration-verification.md`)
```
① 匯款 unpaid + order_source='web' + 未取消 ⇒ 🟢 進 view        (正對照:證明 view 撈得到東西)
② 刷卡 unpaid(tappay)                      ⇒ 🔵 不進
③ 匯款 unpaid 而 cancelled_at 非 NULL        ⇒ 🔵 不進
④ 🔴 後台手動匯款單(order_source='manual_phone')⇒ 🔵 不進   ← §4 那個坑的守門格
⑤ 🔴 order_source IS NULL                    ⇒ 🔵 不進       ← 與隔壁四支【相反】的那一格
⑥ 匯款單翻 paid 之後                          ⇒ 🔵 不進
⑦ 🟢 同一發裡 order_created 那支 view 對同一張單的收錄【零改動】 ← 只證這一支, 見下
⑧ 🔴 後台現金單(payment_channel='cash')                    ⇒ 🔵 不進   ← codex R1-⑬ 那個突變的落點
⑨ 🔴 order_source='web' 而 manual_request_id 非 NULL         ⇒ 🔵 不進   ← 兩條述詞的第二條
⑩ 🔴 掃描時 unpaid、寄送前已翻 paid                          ⇒ 🔵 不寄(標 skipped) ← codex R1-②
⑪ 🔴 0 項單 / 51 項單                                        ⇒ 🔵 安靜地不寄, 而【要有一格斷言它】 ← codex R1-⑤
```
🛑 **⑦ 證不到什麼(codex R1-⑫)**:它只看 `order_created` **那一支 view 的收錄**,
**證不到**共用的 `switch` / `claimDue` 的 filter / route 的 503 條件 / eligibility 閘沒被我弄壞。
⇒ 那四個面要各自有格, **不可以靠這一格代表它們。**
**B. 突變(每一發要殺【不同】的格, 且要印出紅在哪一句)**
```
拿掉 order_source='web'      ⇒ ④⑤ 紅
拿掉 payment_status='unpaid' ⇒ ⑥ 紅
拿掉 cancelled_at IS NULL    ⇒ ③ 紅
把管道改成 <> 'tappay'        ⇒ 現金單漏進來(要有一格 cash 世界抓它)
```
**C. 寄信 sweep 的單元測試**:餵一封 `bank_order_created` job ⇒ 斷言內文**同時**含
`displayId` · 金額 · 🔴 **六項**(⛔ ~~四個~~;codex R1-⑬)——
**銀行 · 分行 · 戶名 · 帳號 · 備註指示 · 期限句** · `/account/orders/` 連結;
🔵 **負對照**:餵 `order_created` ⇒ 內文**不得**出現帳號常數(證明兩個模板沒有互相污染)。
**D. 鐵則 11**:`TURBO_FORCE=1` + 連跑兩發比四個數(檔數 / 測項 / 紅格 / **我餵幾條 vs 它跑幾支**)。

---

## §7 預期影響面 / rollback

| 面 | 影響 |
|---|---|
| 既有四封信 | **零改動**(§6-A⑦ 就是它的鎖) |
| `email_outbox` | 加一個合法值;舊列不動 |
| flag 關著時 | 顧客站建不出匯款單 ⇒ **這條線恆空轉**(而 §5-7 那顆 env 是第二道) |
| rollback | ⛔ ~~先關 env → 退 view → **最後**退 CHECK~~ 🔴 **codex R1-⑦ 打掉最後那一步:退不動。**<br>已經有 `bank_order_created` 列時, 把 CHECK 換回不含該值的版本會 **`VALIDATE` 失敗**。<br>✅ **CHECK 那一代【不回退】** —— 多一個合法值不傷任何東西。**回退單位 = env → 碼 → view。**<br>📌 **一個做不到的 rollback 步驟, 比沒有 rollback 更糟 —— 它讓人以為退得回去。**<br>🔴 而關 env **不只是關 enqueue**:同時要進 `claimDue` 的 `excludeEventTypes`, 否則既有 pending 列照樣寄出。 |
| 資料 | 已寄出去的信**收不回來** ⇒ 📌 rollback 單位是「不再寄」, 不是「當作沒寄過」 |
| 🔴 殘餘 race | **消不掉**(codex R1-③):寄送前重驗與真正送出之間, 客人若剛好付款或取消, 信照樣出去。<br>⇒ 📌 **寫在這裡的用途不是免責, 是讓下一個人不要以為那道重驗把它關死了。** |

### 🔴 上線順序(codex R1-⑩⑪ 訂正)
⛔ ~~CHECK 一定要先於 view~~ —— **不成立**:view 的字串比對**不依賴** CHECK。
✅ 真正的約束是 **DB 兩支都到位 → 碼上線 → 才開 env**。反序的具體症狀:
碼在寫而 view 不在 ⇒ `42P01`;CHECK 不在 ⇒ `23514` ⇒ **整輪 sweep 回 503**。
🔴 而 **Vercel 的 env 設了不會讓既有 deployment 讀到** ⇒ **要重新部署一次**;
反過來 env 先設 ⇒ 新碼部署那一瞬間就上膛, 可能撞上 DB 還沒就緒。

---

## §8 這份 plan 沒有回答什麼

- **信的文案定稿** —— §3 是草稿, **Sean 的板**。
- **HTML 版長什麼樣** —— 沿用既有骨架, 但版面要不要放帳號區塊沒人拍過。
- **要不要在期限前再寄一封提醒信** —— 本片**不做**, 而它是個真的問題(5 天很長), 值得單開一列。
- **後台手動匯款單要不要也有一封信** —— §4 把它排除了, 而**排除不等於答了它**:
  📌 那是員工的流程題(他可能已經口頭講過帳號了), 要問 Sean, 不是我們選。
- **`BANK_TRANSFER_CHECKOUT_ENABLED` 什麼時候翻** —— 不是這片。
- 🔴 **信寄出後訂單金額被改**(codex R1-⑭)⇒ 唯一鍵擋住新版 ⇒ **客人照舊金額匯**。
  要凍結金額 / 禁改 / 還是發更正信 —— **沒有人拍過。**
- 🔴 **同一客人兩張單 ⇒ 兩封各自有效的匯款信**(codex R1-⑮)⇒ 他可能兩封各匯一次。
  ⚠️ **不可以拿 Sean 2026-09-05 `Q4 = 乙 不擋` 蓋過去** —— 他拍的是「**兩張單可以同時存在**」,
  **沒有拍「兩張單各寄一封叫他匯錢的信」** ⇒ 📌 **同一個決定的新面, 要重新問。**
- 🔴 **死列會永久擋住補寄**(codex R1-⑨):`attempts >= max_attempts` 是終態, 而 anti-join **只看列在不在**
  ⇒ 之後補上真信箱也不再排信。這不是本片新造的, **而本片會多一族列踩它。**

---

# §9 🔴🔴 codex R1 對抗審查 —— **18 條 must-fix, 全部逐條處置**

> 跑法:`codex` CLI 的 `exec` 子命令, `-s read-only` + `-C <本樹>`, stdin 導掉,
> 背景起之後下一行立刻收 PID 再 `wait`。**rc=0, 而它真的回了 18 條。**
> ⚠️ **對照**:2026-09-05 那三發也是 rc=0, 而**零 finding** —— 那時是模型空回, **不是「沒問題」**。
> 🔵 **判定 = R1 FAIL** ⇒ 修完要跑 R2。**下面每一條先標【折】或【不折】, 再寫做了什麼。**

## 9-A 我認的、而且**會改變設計**的(七條)

**① 【折】`:49`「兩邊都補不起來」講太滿。**
codex 逐字:分階段 dedup key + 讓 anti-join 比對對應 key 就保得住兩封。**他對。**
✅ 訂正:正確講法是「**不動既有那支 view 的 anti-join 就補不起來**」——
而動它 = 改一支**已在正式庫**的 view + 改一封**現在有在寄**的信的收錄條件。
⇒ 📌 **推薦乙的理由從「甲不可能」降級成「甲要動到不該動的東西」** —— 結論不變,
**而理由的強度變了, 那必須寫出來** ⇒ 端給 Sean 的選項不可以用作廢的那個強度描述。

**② 【折】`:56` 🔴 本輪最值錢的一條:掃描時 unpaid, 寄送時可能已經 paid。**
`pcm_*_pending` 那層是**掃描當下**的快照;真正寄出去是**後來**的事。
⇒ 客人入列後馬上匯款成功 ⇒ `payment_status` 翻 `paid` ⇒ **他仍會收到一封「尚未付款、請匯款」。**
🛑 而現行那道 eligibility 閘**擋不住它** —— 量到的窮舉表逐字
(`packages/ports/src/IEmailOutbox.ts:98-108`):
`order_cancelled:false · order_created:true · order_shipped:true · order_unpaid_cancelled:false · shipment_tracking_corrected:true`,
而 ineligible 那支掃的是 **refunded / cancelled**, **不含 paid**。
✅ **修法(進 §5 範圍)**:本事件要有**自己的寄送前重驗** —— 送出之前重讀該單,
條件不成立(已 paid / 已取消 / 管道變了)⇒ **標 skipped、不寄**。
⚠️ 而它**消不掉 race, 只縮小視窗** ⇒ 見 ③。

**③ 【折】`:71` 最後一次查詢與送出之間的 race 沒有揭露。**
✅ 寫進 §7:**這封信有一個不可消除的殘餘 race** —— 重驗與送出之間客人若剛好付款/取消, 信照樣出去。
📌 **寫出來的用途不是免責, 是讓下一個人不要以為 ② 那道閘把它關死了。**

**④ 【折】`:141` 🔴 `order_source = 'web'` **不是**來源證明。**
🔬 我複驗了他的依據:`20260712203000:40` 逐字 `ADD COLUMN order_source text NOT NULL DEFAULT 'web'`
⇒ 🛑 **`'web'` 正是【忘記寫】會拿到的那個值** ⇒ 我寫的「白名單」在這一欄上**根本不是白名單**。
📌 更硬的證據**就在 repo 裡**:`20260824020000:37` 逐字寫著
「吃 DEFAULT `'web'` ⇒ 手動單與客人自己下的單**分不出來**」—— **而我沒查它就寫了 §4。**
✅ **修法**:述詞改成**兩條一起**
```sql
AND o.order_source = 'web'
AND o.manual_request_id IS NULL   -- 後台建單一定寫它(20260905360000:603/616);顧客站 create_order 從不寫
```
⚠️ **而我不宣稱這是證明** —— 兩條都是「忘記寫會通過」的方向。誠實講法:
它把「**要同時忘記兩欄, 而且還顯式寫了 `bank_transfer`**」變成必要條件, **不是把漏洞關掉**。
⇒ 🔴 **真正的關法是【寫入端顯式標記來源】, 那不是本片** —— 而它要在板上有落點, 否則這句誠實揭示會取代它。

**⑤ 【折】`:113` `IPaidEmailContext` 在 unpaid 世界的其它假設。**
codex 列:未取消 / 至少一項 / 不超過 50 項 / 金額非負。⇒ **空單或 51 項單 ⇒ fail-closed ⇒ 一封都不寄。**
✅ 寫進 §6 驗收:**加兩個世界(0 項 / 51 項)並斷言【它安靜地不寄】** ——
📌 那正是本列的病(**沒寄是綠的**)在**新碼裡的複製品**;不驗它 = 把同一個坑再挖一次。

**⑥ 【折】`:169` + `:172` 範圍漏了三處, 而其中一處讓 rollback 失效。**
· `SupabaseEmailOutboxAdapter.ts:235` `composeEvent`(算 dedup_key)· enqueue input/payload 型別 · 產生型 `database.types`
· 🔴 **`claimDue` 那半**:量到它**已經有** `opts.excludeEventTypes`(`SupabaseEmailOutboxAdapter.ts:417-419`)
　⇒ env 只擋 enqueue 的話, **關掉之後既有 pending 列照樣被認領寄出** ⇒ §7 的 rollback 是**假的**。
✅ 三處全進 §5;env 關閉時**同時**把新事件放進 `excludeEventTypes`。

**⑦ 【折】`:216` 回退 CHECK 在有既存列時【跑不動】。**
`VALIDATE` 會撞到那些列 ⇒ 「最後退 CHECK」不可執行。
✅ §7 改成:**CHECK 那一代【不回退】** —— 多一個合法值不傷任何東西;回退單位是 **env → 碼 → view**。
📌 **一個做不到的 rollback 步驟, 比沒有 rollback 更糟** —— 它讓人以為退得回去。

## 9-B 我認的、而它改的是【宣稱】不是設計(六條)

**⑧ 【折】`:55`「防重寄兩道」講太滿。** 量到:送失敗 ⇒ 退避重試(`20260717020000:53-59`)
⇒ **provider 已寄出而我們記失敗 ⇒ 客人收到第二封。**
✅ 改寫成「**擋重排, 擋不了 at-least-once 重送**」。

**⑨ 【折】`:55` 死列會永久擋。** `skipped_no_real_email` 是**可翻轉態**(同檔 `:27-35`), 而
`attempts >= max_attempts` 是**終態**(`:54`), 而 anti-join **只看列在不在**
⇒ 之後補上真信箱也**永遠不再排信**。✅ 寫進 §8 待答。

**⑩ 【折】`:178`「CHECK 一定先於 view」不成立** —— view 的字串比對不依賴 CHECK。
✅ 真正的順序約束改寫成:**DB 兩支都到位 → 碼 → 才開 env**;反序的具體症狀是 `42P01` / `23514` ⇒ 整輪 503。

**⑪ 【折】`:178` Vercel env 要重新部署才讀得到。** ✅ 進 §7 步驟, 不當成「設了就生效」。

**⑫ 【折】`:193` A⑦ 證不到「四封零改動」。** ✅ 降級成「**只證 `order_created` 那一支 view 的收錄零改動**」,
並補一句它**證不到**共用 switch / claim filter / 503 條件 / eligibility gate。

**⑬ 【折】`:200` + `:203` 驗收自己有兩個洞**:突變要靠 cash 而 A 沒有 cash 世界;
「四個常數」而草稿實際用了**六項**(銀行 · 分行 · 戶名 · 帳號 · 備註 · 期限)。✅ 兩處都補。

## 9-C 我認為是【真問題而不屬本片】的(兩條 ⇒ 進 §8 待答, 不進範圍)

**⑭ `:217` 信寄出後金額被改** ⇒ 唯一鍵擋住新版 ⇒ 客人照**舊金額**匯。
**⑮ `:217` 同一客人兩張單兩封信** ⇒ 他可能兩封各匯一次。
🔵 兩條都真, 而**修法都要 Sean 拍**。
🔴 而 ⑮ 有一格要特別講:Sean 2026-09-05 `Q4 = 乙 不擋` **已經拍過一次** ——
**而他拍的是「兩張單可以同時存在」, 沒有拍「兩張單各寄一封叫他匯錢的信」**
⇒ ⚠️ **那是同一個決定的一個新面, 要重新問, 不可以拿舊拍板覆蓋它。**

## 9-D 我【不折】的:**零條**
🔵 十八條逐條看過, **沒有一條我認為它讀錯了**。
⚠️ 而「全折」本身是個訊號 —— 📌 **它代表這份 plan 的第一版在【邊界與宣稱】上普遍偏鬆,
不代表 codex 特別厲害。** 判停條件照 `00-work-rules §5`:R1 FAIL ⇒ 修完跑 R2。

## 9-E 🔴 這一輪買到的那句話

> **我寫「白名單」的時候, 沒有去查那一欄的 DEFAULT 是什麼。**
> 而 `order_source` 的 DEFAULT 就是 `'web'`
> ⇒ **我以為我在列出「誰可以進來」, 實際上我列的是「誰忘了填」。**
>
> 📌 **一個欄位的 DEFAULT 會把白名單靜靜地翻成黑名單, 而那個翻轉在述詞的字面上看不出來。**
> ⇒ 判別句:**寫任何 `= '<值>'` 的白名單之前, 先問「這一欄不寫會拿到什麼」。**
