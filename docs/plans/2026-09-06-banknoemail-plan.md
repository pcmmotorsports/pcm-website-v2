# Plan · ⟦b4-BANKNOEMAIL⟧ 匯款單成立信

> 線【信】`-mail` · 2026-09-06 凌晨 · **規劃階段, 一行碼都沒動**
> 片型:**高風險片**(鐵則 12 **①錢** + **③DB 結構** + **⑤對外不可回收 · 寄信**)· 鐵則 8(跨 3+ 檔)
> ⇒ 本檔就是要批准的那份 plan。批准後才動碼。
> 派工來源:主視窗 `-f8` 2026-09-06 01:4x。板列 `⟦b4-BANKNOEMAIL⟧`(`docs/launch-todo.md:342`)。
>
> 🔴🔴 **狀態 = R1 FAIL → R2 FAIL → R3(opus, 換模型)FAIL → 折完, 待 `-f8` 對 C1 重裁。**
> R1 **18 條**(§9)· R2 **14 條**(§10)· R3 **18 條 = 10 must-fix + 5 consider + 3 nit**(§11)· **三輪零反駁**。
> 🛑 **R3 的 C1 會推翻一個已經裁過的東西(§8 混版信的乙案)** ⇒ **我不自己推翻, 已端回 `-f8`。**
> ⛔ ~~我全折~~ 🛑 **R2 第一條打的就是那句宣稱** —— 我說 18 條全折, 實際只有 15 個處置編號,
> **其中一條是真的掉了**。訂正與可機械化的修法在 **§10-0**。
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
  📌 ⛔ ~~這正是甲案做不到的那一格。~~ **R2 抓到這句還留著, 而 §9-A① 已經作廢它。**
  ✅ 正確講法:**這正是甲案要動到既有 view 才辦得到的那一格。**

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

訂單金額  NT$ {total}
已收      NT$ {total - balanceDue}
應付餘額  NT$ {balanceDue}

匯款資訊
銀行      {PCM_REMITTANCE_BANK_NAME}({PCM_REMITTANCE_BRANCH})
戶名      {PCM_REMITTANCE_ACCOUNT_NAME}
帳號      {PCM_REMITTANCE_ACCOUNT_NO}
{PCM_REMITTANCE_MEMO_INSTRUCTION} {displayId}

{期限句 —— 🔴 **整句**都要與畫面同一個來源, 不是只有 fallback 那半}
　主句(畫面 `OrderDetailView.tsx:699` 逐字):`請於 ${remittanceDeadlineLabel(created_at)}(含)之前完成匯款,逾期訂單將自動取消。`
　fallback(`:698`):`請於 ${PCM_REMITTANCE_EXPIRE_DAYS} 天內完成匯款,逾期訂單將自動取消。`

{siteUrl 有值時才印這兩行 —— 🔴 缺 siteUrl ⇒ **整段不印**, 不印半個連結}
訂單內容與匯款資訊也可以在這裡查看:
{siteUrl}/account/orders/{encodeURIComponent(displayId)}

{ORDER_CONTACT_LEAD} {PCM_LINE_ID}
{PCM_LINE_URL}
```

🔴🔴 **[R3 改了三處, 每一處都有既有前例]**
1. **金額改三行**(MF1/MF2, `-f8` 03:5x 裁)—— 與 `OrderDetailView.tsx:677-680` **同一組**;
   🛑 而**印不印由金額決定**:`balanceDue` 為 `null` / `≤ 0` / `> total` ⇒ **這封信不寄**(專用 skip 碼)。
   📌 **一封印公司帳號的催款信, 只在「確定還要匯正數」的世界寄。**
2. **期限句整句共用**(MF3)—— ⛔ ~~我原本只插 `remittanceDeadlineLabel` 的裸回傳值~~,
   而那只回「9 月 11 日」(**無年、無主詞**)⇒ **信上會出現孤零零一行日期, 且「(含)」那個邊界消失**
   ⇒ 客人第 5 天不敢匯。✅ **兩句抽成 domain 單一來源, 兩處共用。**
3. **`siteUrl` 缺就整段不印**(MF10)—— 既有做法逐字「缺 `siteUrl` 就只印句子, **不印半個連結**」;
   route 那側逐字「**死入口比沒入口糟**」。
⚠️ **N2**:`CheckoutSuccess.tsx:84-88` 有一段依賴這塊座標的註解 ⇒ **改本節時要一起看。**

🔴🔴 **客服入口那兩行是 R2-⑩ 逼出來的, 而它【不是文案偏好, 是這封信的功能之一】**:
匯款是最容易出疑義的一條路(匯錯金額 / 匯錯帳號 / 名字對不上 / 已逾期), 而**這封信是他唯一的觸點**
⇒ 沒有求助入口 = 他只能打去店裡或放棄。
✅ **走既有常數, 一個字都不硬編**(`packages/use-cases/src/order-email-copy.ts`):
`ORDER_CONTACT_LEAD`(`:85`)· `PCM_LINE_ID`(`:97`)· `PCM_LINE_URL`(`:94`)。
🔵 **形狀與取消信【逐字同一段】** —— `sweep-email-outbox.ts:819` 逐字
`` lines.push('', `${ORDER_CONTACT_LEAD} ${PCM_LINE_ID}`, PCM_LINE_URL); ``
⇒ 📌 **抄第二份會讓兩封信的客服句各自漂**, 而漂掉時客人拿到的是一個**過期的聯絡方式**。
⚠️ **本片不引入 email / 電話** —— 今天那三個常數裡**沒有**它們(量到的), 而發明一個新的對外聯絡方式
**不是這片能拍的**。要不要加, 進 §8。

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
| 2 | `supabase/migrations/20260906150000_…_bank_order_created_pending_view.sql` | 新 view `pcm_bank_order_created_email_pending`(述詞見 §4)+ 🔴 **「收件人至少一個非空」那一條**(R3-MF4;前例 `20260905210000:126-129` / `20260905030000:97-100`)+ REVOKE/GRANT 白名單 | 沒有掃描面 ⇒ 沒有東西被撈出來<br>**MF4**:少了信箱那條 ⇒ enqueue `noRecipient++ ; continue` **不寫 outbox 列** ⇒ anti-join 看不到 ⇒ **每輪重撈、永遠**, 佔滿 `ENQUEUE_LIMIT = 50` ⇒ 真的要寄的被擠出去, **而心跳照綠** |
| 3 | `packages/ports/` | `SUPPRESS_WHEN_ORDER_INELIGIBLE` 補一格 `bank_order_created: true` | typecheck 紅(**這是好事**);硬闖 ⇒ fail-closed 全壓掉 |
| 4 | `packages/ports/` + `packages/adapters/src/email/` | 新 scanner port + adapter(照四支既有的形狀) | — |
| 5 | `packages/use-cases/src/enqueue-bank-order-created-emails.ts` | 新 use-case(照 `enqueue-order-created-emails.ts`) | — |
| 6 | `packages/use-cases/src/sweep-email-outbox.ts` | `switch` 加 `case 'bank_order_created'` + `buildBankOrderCreatedText` | `satisfies never` 紅 |
| 7 | `apps/storefront/src/app/api/cron/email-sweep/route.ts` | 接線 + 🔴 **自己一顆 `readDeployCutoff` 形狀的 env(⛔ ~~off-by-default 布林~~, R3-MF6)** + 🔴 **自己一支 picker、輸出鍵前綴不得與既有四支相同**(R3-MF7)+ 計數進 503 條件 | **MF6**:布林翻 true 那一秒掃到**所有歷史未付款匯款單** ⇒ **一次寄一疊, 而信收不回來**<br>**MF7**:鍵相同 ⇒ 後寫的**安靜覆蓋**前一條, 而兩個數字**看起來都很合理**<br>🔴 503 條件漏我這條線, 這個 repo **已經發生三次** |
| 8 | `packages/adapters/src/email/SupabaseEmailOutboxAdapter.ts:235` `composeEvent` + enqueue input/payload 型別 + 產生型 `database.types` | 補新事件 | **codex R1-⑥**:少了它落不了新事件、或 typecheck 直接紅 |
| 9 | 🔴 **寄送前重驗**(新, 在 `sweep-email-outbox.ts` 本事件的分支裡) | 送出前重讀該單:已 `paid` / 已取消 / 管道變了 ⇒ **標 skipped 不寄** | **codex R1-②**:掃描是快照, 寄送是後來 ⇒ 否則會寄「尚未付款」給一個**已經付完**的客人 |
| 10 | 🔴 env 關閉時同時進 `claimDue` 的 `excludeEventTypes`(`SupabaseEmailOutboxAdapter.ts:417-419`, **既有機制**) | — | **codex R1-⑥**:只擋 enqueue ⇒ 關掉之後既有 pending 列**照樣被認領寄出** ⇒ §7 的 rollback 是假的 |
| 11b | 🔴 **收件人來源要寫死 + 合成信箱那一格**(R3-MF5) | `notification_email` → `customers.email` 的退化規則照既有四支;而 **LINE 登入客人的 `customers.email` 可能是不可路由的合成信箱**(`order-email-copy.ts:170-176`) | 判 `skipped_no_real_email` ⇒ **落一列** ⇒ anti-join **從此擋住** ⇒ 補上真信箱也不再排。📌 **這封信正是為「一封都收不到」而做的, 而它對這一群仍然是零** |
| 11c | 🔴 **寄送前重驗改問 `balanceDue`, 不列舉狀態**(R3-MF8) | ⛔ ~~三態~~ ⇒ `partiallyPaid` 漏了;而 enum 是四值 + 一(`20260604120000:50` + `20260725130000`) | 📌 **狀態是列舉(會長出第五個值), 而「還要不要匯正數」是一個問題** |
| 12 | 🔴 **混版信守門(`-f8` 03:0x 裁乙, 定案)** —— 讀完 context 之後複讀 `orders.version`,
與讀取當下不一致 ⇒ **不寄、重排**;**只掛在本事件**, 既有四封信一行不動 | — |
**R1 `:113` 第二條**(我 §9 掉的那一條):表頭與明細是兩次查詢 ⇒ 中間被改 ⇒ 客人拿到一封**自己加不起來**的信, 而他會照它匯錢 |
| 13 | 對應測試 | §6 | — |

🛑 **不做**:HTML 版模板(§3 待 Sean 過目後另議)· 動既有四支 view · 動 `order_created` 任何一格 ·
動 `BANK_TRANSFER_CHECKOUT_ENABLED` · 前端任何一行。

⚠️ **`-f8` 給的版本號是「view = 150000」** ⇒ 我把 CHECK 排 **140000**。
⛔ ~~因為 CHECK 一定要先於 view 與碼~~ 🔴 **R2 抓到這句與 §7 正面衝突, 而 §7 那邊才是對的**:
**view 的字串比對不依賴 CHECK** ⇒ 兩支的先後**不是**技術約束。
✅ 排 140000 的理由降級成:**貼板時一眼看得出依賴方向**(碼要兩支都在才會動), 如此而已。
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
**C. 寄信 sweep 的單元測試** ⇒ 🔴 **整串 `toBe`, 不是「含」**(R3-MF9)——
`sweep-email-outbox.ts:558-564` 逐字:`EXPECTED_ORDER_CREATED_BODY` 是整串比對, 且「它的副作用就是
**這串對外文案不得無聲改變** —— 而那正是這一族需要的那道閘」。
🛑 ⛔ ~~斷言「含」六項~~ **有人插一行 / 改標點 / 換順序 ⇒ 六個「含」全過而信變了**。**鐵則 12⑤ 不該降級, 而我降了。**
🔵 而「含」那一版的細目留著當**最低限**:餵一封 `bank_order_created` job ⇒ 內文**同時**含
`displayId` · 金額 · 🔴 **六項**(⛔ ~~四個~~;codex R1-⑬)——
**銀行 · 分行 · 戶名 · 帳號 · 備註指示 · 期限句** · `/account/orders/` 連結;
🔵 **負對照**:餵 `order_created` ⇒ 內文**不得**出現帳號常數(證明兩個模板沒有互相污染)。
**D. 鐵則 11**:`TURBO_FORCE=1` + 連跑兩發比四個數(檔數 / 測項 / 紅格 / **我餵幾條 vs 它跑幾支**)。

---

## §7 預期影響面 / rollback

| 面 | 影響 |
|---|---|
| 既有四封信 | ⛔ ~~**零改動**(§6-A⑦ 就是它的鎖)~~ 🔴 **R2 抓到這句超出 §9-B⑫ 允許的範圍。**<br>✅ 精確版:**§6-A⑦ 只鎖住「`order_created` 那一支 view 的收錄零改動」**。<br>🛑 共用的 `switch` / `claimDue` filter / route 503 條件 / eligibility 閘 **四個面各自要有格**, 而**今天 §6 沒有列出那四格** ⇒ 見 §10-A④。 |
| `email_outbox` | 加一個合法值;舊列不動 |
| flag 關著時 | 顧客站建不出匯款單 ⇒ **這條線恆空轉**(而 §5-7 那顆 env 是第二道) |
| rollback | ⛔ ~~先關 env → 退 view → **最後**退 CHECK~~ 🔴 **codex R1-⑦ 打掉最後那一步:退不動。**<br>已經有 `bank_order_created` 列時, 把 CHECK 換回不含該值的版本會 **`VALIDATE` 失敗**。<br>✅ **CHECK 那一代【不回退】** —— 多一個合法值不傷任何東西。**回退單位 = env → 碼 → view。**<br>📌 **一個做不到的 rollback 步驟, 比沒有 rollback 更糟 —— 它讓人以為退得回去。**<br>🔴 而關 env **不只是關 enqueue**:同時要進 `claimDue` 的 `excludeEventTypes`, 否則既有 pending 列照樣寄出。 |
| 資料 | 已寄出去的信**收不回來** ⇒ 📌 rollback 單位是「不再寄」, 不是「當作沒寄過」 |
| 🔴 殘餘 race | **消不掉**(codex R1-③):寄送前重驗與真正送出之間, 客人若剛好付款或取消, 信照樣出去。<br>⇒ 📌 **寫在這裡的用途不是免責, 是讓下一個人不要以為那道重驗把它關死了。** |

### 🔴 R3 對 §7 加的三句(C2 / C4 / C5)
**C2 · 正式站的正對照【恆空】** —— `BANK_TRANSFER_CHECKOUT_ENABLED` 今天**不得翻 true**
⇒ 本線上膛後第一輪掃到 **0 列**, 而「0 列」與「view 名字打錯 / GRANT 漏了 / 述詞寫反」**在 log 上印同一個 200**
⇒ 🛑 **那顆 flag 翻之前, 不得把本線寫成「已驗證會寄」。**
**C4 · 「先關 env 止血」是假的** —— Vercel env 要 redeploy 才讀得到
⇒ 📌 **止血的動作是 redeploy, 不是改 env。** 拔掉 env 到 redeploy 之間, 現行 deployment 照舊在寄。
**C5 · 退版一次的真實代價(兩半要接起來)** —— 舊碼撞 `buildEmailText` 的 `default` ⇒ `throw` ⇒ `errors++`
⇒ **503 + 心跳紅, 每 5 分鐘一次**;而燒完 `attempts` 之後那批列成終態, anti-join 只看列在不在
⇒ 🔴 **那一批客人之後再也排不進信。**

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
- 🔴🔴 **表頭與品項是兩次查詢 ⇒ 中間被改會組出【混版信】**(R1 `:113` 第二條, **這就是我 §9 掉的那一條**):
  `SupabasePaidEmailContextAdapter` 先讀 `orders` 再讀 `order_items` ⇒ 兩次之間後台若改金額或品項,
  信上會是**表頭舊版 + 明細新版**(或反過來)⇒ 🛑 **那封信自己加不起來, 而客人會照它匯錢。**
  ✅✅ **[主視窗 `-f8` 2026-09-06 03:0x 裁【乙】—— 定案, 不再是候選]**
  　**`orders.version` 不一致 ⇒ 不寄、重排;而它【只用於本事件】, 不動既有四封信。**
  　⇒ 🔴 **這一條因此【離開 §8 待答, 進入 §5 範圍】** —— 見 §5 第 12 列。
  　⚠️ **而它證不到什麼要跟著走**:版本檢查**偵測**不一致, **不防止**它 ——
  　　讀完到送出之間仍有一段時間, 那段裡改了就還是混版。**fail 方向是「不寄」= 對的那邊, 而不是「不會發生」。**
  🔵 **當初的三個候選留著**(裁示的理由要看得到被比較過什麼):
  　**甲 一致快照** —— 兩次查詢包進同一個 `REPEATABLE READ` 交易, 或改成單一 RPC 一次回。
  　　✅ 最正確 · ⚠️ 動到既有 adapter, **四封信一起受影響** ⇒ 回歸面最大。
  　**乙 版本檢查** —— 讀完再讀一次 `orders.version`(該欄存在, `20260712203000:121` 逐字
  　　`version NOT NULL DEFAULT 1`), 不一致 ⇒ **不寄、重排**。
  　　✅ 改動小、可只用在本事件 · ⚠️ 它**偵測**不一致, 不**防止**;而 fail 方向是「不寄」= 對的那邊。
  　**丙 本片不管** —— 明寫它是既有性質。⚠️ 而**本片會讓它第一次對客人可見**(這封信是唯一
  　　會被拿去照著匯錢的信)⇒ 📌 **選丙要有人簽名, 不是預設。**
  🔴 **我推薦乙**:它的失敗方向與這封信的 fail-safe 同向(**寧可不寄**), 而甲的回歸面
  　 大到會把一片變成四片。
- 🔴🔴 **逾期自動取消【不寄任何信】, 而這封信會把「第 6 天才匯」的量放大**(R3-C3):
  `20260905030000:80-85` 逐字 —— 員工取消才 INSERT `order_cancellations`, **逾時自動取消不會**
  ⇒ `pcm_unpaid_cancelled_email_pending` 的 `EXISTS` 把它篩掉 ⇒ **自動取消零信**。
  ⇒ 客人收到催款信 ⇒ **第 6 天單子無聲消失** ⇒ 他那天匯的錢走待退款那條。
  🛑 **⇒「要不要在期限前再寄一封提醒」不可以單獨端** —— 它與「**自動取消要不要寄一封**」是**同一題**。
- 🔴 **死列會永久擋住補寄**(codex R1-⑨):`attempts >= max_attempts` 是終態, 而 anti-join **只看列在不在**
  ⇒ 之後補上真信箱也不再排信。這不是本片新造的, **而本片會多一族列踩它。**
  🔴 **而 R3-MF5 指名了那一族是誰**:**LINE 登入而結帳沒填通知信箱的客人** ——
  他們的 `customers.email` 是不可路由的合成信箱(`order-email-copy.ts:170-176`)
  ⇒ 📌 **這封信正是為「一封都收不到」而做的, 而它對這一群仍然是零。**

---

# §9 🔴🔴 codex R1 對抗審查 —— ⛔ ~~**18 條 must-fix, 全部逐條處置**~~
# 　　🔴 **正確的宣稱:18 條進來, 15 個處置編號, 其中 2 個各含兩條, 1 條掉了**(R2 抓到, 見 §10-0)

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

---

# §10 🔴🔴 R2 —— **也是 FAIL(14 條)。而第一條打的是我自己的宣稱。**

## 10-0 🛑 **先訂正一句我已經對外講過的假話**

> 我在 §9 標題寫「**18 條 must-fix, 全部逐條處置**」, 並把那句**送給主視窗 `-f8`**。
> **那是假的。**

🔬 **量到的**:R1 的 finding 是 **18 條**(log 裡印兩遍 = 36 行, 去重 18);
而 §9 的處置編號只到 **⑮ = 15 條**(`grep -c` 逐條數過)。

**缺口三處, 逐一交代 —— 不含糊帶過**:
1. 🔴 **真的掉了一條**:R1 `:113` 第二條 —— **adapter 先讀表頭再讀品項, 兩次查詢之間若後台改了金額或品項,
   會組出【表頭是舊版、明細是新版】的一封信**, 而 plan 沒有一致快照或版本檢查。
   ⇒ ✅ 補進 §8 待答(它是既有 adapter 的性質, 而**這封信會讓它第一次對客人可見**)。
2. **兩處我做了合併而沒有標**:R1 `:169` + `:172` 併成 ⑥;`:200` + `:203` 併成 ⑬。
   ⇒ 合併本身不是錯, **而合併之後還宣稱「18 條」就是錯的** —— 讀的人數不出來。
3. ⇒ 📌 **正確的宣稱是:18 條進來, 15 個處置編號, 其中 2 個各含兩條, 1 條掉了。**

🎯 **這個病 memory 記過**(`feedback_i-read-their-list-instead-of-what-i-merged`):
**我讀了他的清單, 而不是我實際合進去了什麼。**
🛑 而這一次它是**在我剛剛寫完一整節「逐條處置」之後**發生的 ——
📌 **「逐條」這兩個字是我自己寫的, 而它沒有任何機械檢查在守。**
✅ **可機械化的修法(下次照做)**:處置節寫完 **`grep -c` 數自己的編號 vs 審查者的條數**, 兩個數印出來並排。
**那就是鐵則 11 的「我餵幾條 vs 它跑幾支」套在【審查處置】這一層。**

## 10-A 本文與 §9 對不起來的(四條, 已就地修)

**① 【折】`:71`「這正是甲案做不到的那一格」還留著** —— §9-A① 已作廢它。
✅ 改成「**這正是甲案要動到既有 view 才辦得到的那一格**」。
📌 **一句被作廢的理由留在本文裡, 比沒訂正更糟** —— 它會被端出去。

**② 【折】`:203`「CHECK 一定要先於 view 與碼」與 §7:254 正面衝突。**
✅ 本文改掉;排 140000 的理由**降級**成「貼板時一眼看得出依賴方向」, 不再宣稱是技術約束。

**③ 【折】`:246`(§7 表)「既有四封信零改動」超出 §9-B⑫ 允許的範圍。**
✅ 改成「**只鎖 `order_created` 那一支 view 的收錄**」。

**④ 【折】`:225` 我自己寫「四個面各自要有格」而 §6 沒有列出那四格。**
✅ 補進 §6:`switch` 窮舉 / `claimDue` filter / route 503 條件 / eligibility 閘 **各一格**。
🔴 **這一條與 ③ 是同一個病的兩半** —— 我寫下了正確的要求, **而沒有把它變成一個格子**。

## 10-B 修法本身製造的新問題(五條 ⇒ 進 §5 / §8)

**⑤ 【折】`:114` 期限句要 `created_at`, 而 `IPaidEmailContext` 沒有那一欄。**
✅ §5 要指定它**從哪一層來**(view → payload → context 三選一)。**今天 plan 沒答, 那是真的漏。**

**⑥ 【折】`:196`「寄送前重驗」寫得太抽象** —— 沒有 port/adapter、沒有精確三態、沒有專用 skip 碼。
🛑 而沿用既有 paid context **看不到 `payment_channel`**;沿用 cancelled 的 skip 碼 ⇒ **稽核上會寫錯原因**。
✅ 進 §5, 而**這一條讓本片多一支 port**。

**⑦ 【折】`:197` 新 flag 的 `excludeEventTypes` 沒定義怎麼與既有兩組合併。**
🔴 任一 flag 關閉時**覆寫**另一組 ⇒ **放出本來應該停寄的列**。
📌 `SupabaseEmailOutboxAdapter.ts:468-469` 的註解自己就記過同族的坑(片 C 讓 exclude 變成 2 個)。
✅ 合併規則要寫死:**聯集, 不是覆寫**;並要有一格測試餵「兩個 flag 都關」。

**⑧ 【折】`:249` 回退路徑仍不完整** —— 退 env 再退碼會拿掉 exclusion 與 switch,
**而既有 pending 列還在** ⇒ 舊碼重新認領、反覆失敗;退 view 也不會清掉那些列。
✅ §7 補一步:**回退前先把那些列標成終態**(或明寫「留著讓它們自然達 max_attempts」並承認會噴告警)。

**⑨ 【折】`:221` + `:222` §6 新增的世界 ⑩⑪ 放錯層。**
⑩(掃描後翻 paid)與 ⑪(0 項 / 51 項)要驗的是 **TS sweeper + 即時讀取 + CAS skip**,
**不是 PG view** ⇒ 放在「拋棄式 PG」那一組**到不了它宣稱的路徑**。
🔴 而 ⑪ 更糟:「安靜地不寄」與既有合約**相反** —— `IPaidEmailContext` 取不到是 `errors++` / 503,
⇒ 📌 **我那一格會把一個【該告警的資料異常】驗成成功。**
✅ 兩格移到 C(單元測試), 且 ⑪ 的斷言改成**它該有的那個行為**, 不是我以為的那個。

## 10-C R2 換角度問到的三件(R1 沒問過)

**⑩ 【折】`:132` 純文字草稿沒有客服入口。**
既有信有「客服 LINE」那一行, 而我的草稿**沒有**, 卻寫著「沿用既有模板」。
🔴 **匯款是最容易出疑義的一條路**(匯錯金額 / 匯錯帳號 / 逾期), 而**這封信是他唯一的觸點**
⇒ ✅ 草稿補客服入口, **並且要進 Sean 過目的那一份**。

**⑪ 【折】`:198` 客服看不到客人實際收到什麼。**
後台今天只存**事件 / 狀態 / 次數 / 時間**, **不存信件本文** ⇒ 客人打電話來說「你們給我的帳號是錯的」,
**客服無法逐字核對他當時收到什麼**。
⇒ ✅ 進 §8 待答。📌 **而這一條的價值不在本片** —— 它對**每一封信**都成立, 值得單開一列。

**⑫ 🟢 R2 對「這封信該不該存在」給的是【該存在】**:
結帳完成頁與訂單頁都不夠(要他還在、還登入著), 而 `order_created` 只處理已付款 ⇒ **加一段也碰不到 unpaid 匯款單。**
🔵 **這是本輪唯一一個【支持】本片的結論, 而它是被要求去找更便宜做法之後給的** ⇒ 比自我宣稱有力。

## 10-D 判定與下一步

🔴 **R2 = FAIL** ⇒ 照 `00-work-rules §5`:**只要每輪仍在抓到真 finding 就繼續, 而第 3 輪起必須換角度、換模型。**
🔬 **判停條件檢查(不是感覺)**:R2 的 finding **沒有**在重複 R1 —— 它打的是
「**本文與處置節對不對得起來**」與「**修法自己製造的問題**」, **那是新的一層** ⇒ **不是方向問題, 繼續。**
⏭ **R3 要換模型換角度**(不再用同一支), 角度建議:**災難當天可用性**(客人真的匯錯了怎麼辦)、
**假設審查**(這份 plan 有哪些前提從頭到尾沒有被問過)、**回歸**(它會不會弄壞今天在寄的四封信)。

🛑 **在 R3 之前不動碼**, 而 §3 草稿要**先補客服入口**再端給 Sean。

---

# §11 🔴🔴 R3(opus, 換模型換角度)—— **FAIL:must-fix 10 · consider 5 · nit 3**

> 🔬 **條數自檢(§10-0 立的那道, 第一次真的跑)**:
> **審查者條數 = 10 + 5 + 3 = 18** · **本節處置編號 = 18**(`MF1`–`MF10` · `C1`–`C5` · `N1`–`N3`)
> ⇒ **18 vs 18**。📌 **兩個數並排印出來, 而不是寫一句「逐條」。**
> ⚠️ **射程**:這道自檢只證**編號對得上**, **證不到每一條真的落進本文** —— 那正是 R2 抓到的那個病,
> 而它需要的是**逐條的落點座標**, 見每一條後面的「✅ 落在」。

> ⚠️ **N3 先講**:R3 實際開的是 `d46f11a59`(512 行那版), **不是交辦的 `0c8b77178`** ——
> 行號以它為準;而**它已經看到**我補的客服入口與三個修法候選 ⇒ **那兩處不重複計算。**

## 11-A 錢的語意(MF1 / MF2 / MF8)—— **主視窗 `-f8` 03:5x 裁, 不端 Sean**

**裁示逐字(不改寫)**:「信與訂單頁用**同一條規則**(Sean 09-05 已拍三行版 + 印不印由金額決定):
信印的是 `balanceDue`(應付餘額), **不是 `total`**;`balanceDue` 為 NULL 或 ≤ 0 ⇒ **這封 `bank_order_created` 不寄**
(專用 skip 碼, 稽核記原因), 因為頁面那格已經在講『請聯絡我們』—— **一封印公司帳號的催款信只在「確定還要匯正數」的世界寄。**」

**MF1 【折】金額來源錯** ⇒ ✅ **落在 §3 草稿**:`應付金額 {total}` **改成三行**
`訂單金額` / `已收` / `應付餘額`, 與 `OrderDetailView.tsx:677-680` **同一組**。
🔬 **我複量了 `-f8` 說「`balanceDue` 今天存在」** —— 成立:`packages/domain/src/order/types.ts:1945` 逐字 `balanceDue: Money | null`;
adapter guard 在 `SupabaseOrderAdapter.ts:886-930`;view `20260905330000_m4b_member_order_balance_v.sql` 在檔上。
(🟢 正對照同尺問 `discountTotal` ⇒ **7** 支檔 · 🔵 負對照現造欄名 ⇒ **0**)
⇒ 📌 **`⟦b4-PARTIALPAIDNOWHERE⟧` 那句「今天沒有應付餘額欄」已過期**, 而**我差點照它推論本片會變大**。

**MF2 【折】缺「可信的正數」那道閘** ⇒ ✅ **落在 §5 新增列 + §6 新世界**:
`balanceDue` 為 `null` / `≤ 0` / `> total` ⇒ **不寄**, 專用 skip 碼(稽核要記得出原因, 不可借 `cancelled` 的碼)。
🔴 **而它擋掉的具體災難逐字**:全額退款的單 `total` 沒降 ⇒ 舊 plan 會**無條件印 12 碼帳號 + 全額**
⇒ **叫一個已經退完款的客人再匯一次。**

**MF8 【折】重驗漏 `partiallyPaid`** ⇒ ✅ **落在 §5-9**:三態改**四態**
(`paid` / `cancelled` / 管道變了 / **`partiallyPaid`**), 而更根本的修法是**不列舉狀態, 改問 `balanceDue`** ——
📌 **狀態是列舉(會長出第五個值), 而「還要不要匯正數」是一個問題。**
🔬 依據:`20260604120000:50` 逐字 `('unpaid','paid','partiallyPaid','refunded')`, 而 `20260725130000` **又加了一個**。

## 11-B 寄信管線的既有契約(MF4 / MF5 / MF6 / MF7 / MF9 / MF10)—— **六條全折, 全部有既有前例可抄**

**MF4 【折】view 述詞缺「收件人至少一個非空」** ⇒ ✅ **§5 view 那列 + §6 新世界**。
🛑 **失敗形狀 = 本列自己那一族**:enqueue 對 `recipientEmail === null` 是 `noRecipient++ ; continue` **不寫 outbox 列**
⇒ anti-join 看不到列 ⇒ **每輪重撈、永遠**, 佔滿 `ENQUEUE_LIMIT = 50` ⇒ 真的要寄的信被擠出去,
**而它不報錯、不進死信、心跳照綠。** 前例:`20260905210000:126-129` · `20260905030000:97-100`(後者 COMMENT 逐字「本 view 存在的理由」)。

**MF5 【折】收件人來源沒定義 + 合成信箱** ⇒ ✅ **§5 + §8**。
🔴 LINE 登入客人的 `customers.email` 可能是**不可路由的合成信箱**(`order-email-copy.ts:170-176` 逐字 `@pcmmotorsports.local` / `line_{sub}@line.pcmmotorsports.local`)
⇒ adapter 判 `skipped_no_real_email` ⇒ **落一列** ⇒ anti-join **從此擋住**(R1-⑨ 那個機制)⇒ 補上真信箱也不再排。
📌 **這封信正是為「一封都收不到」而做的, 而它對這一群仍然是零。** ⇒ §8 要把「死列擋補寄」與**這一群**接起來。

**MF6 【折】env 必須是 cutoff 不是 on/off** ⇒ ✅ **§5-7 那列改寫 + §7**。
🛑 布林 flag 翻 true 那一秒 ⇒ view 掃到**所有歷史未付款 web 匯款單** ⇒ **一次寄一疊, 而信收不回來**(鐵則 12⑤)。
✅ 照既有形狀:`readDeployCutoff` + `created_at >= cutoff`, 自己一顆 env。
📌 **取消信那一段的註解已經逐字記過同款教訓** —— 而我寫 §5 時只寫「off-by-default env」。

**MF7 【折】計數要自己一支 picker、鍵前綴不得相同** ⇒ ✅ **§5-7 那列**。
🔴 `route.ts` 第三支 picker 上方逐字:「輸出的鍵**不能相同** … 共用會讓後寫的那條**安靜覆蓋**前一條
⇒ 而覆蓋之後兩個數字**看起來都很合理, 沒有東西會叫。**」

**MF9 【折】§6-C 的斷言強度低於既有守門** ⇒ ✅ **§6-C 改成整串比對**。
`sweep-email-outbox.ts:558-564` 逐字:`EXPECTED_ORDER_CREATED_BODY` 是**整串 `toBe`**, 且「它的副作用就是
**這串對外文案不得無聲改變**」。⇒ 🛑 我寫的「**含** 六項」= 有人插一行 / 改標點 / 換順序 **六個含全過而信變了**。
📌 **鐵則 12⑤ 這一族不該降級, 而我降了。**

**MF10 【折】`siteUrl` 缺時印出 `undefined/account/orders/...`** ⇒ ✅ **§3 草稿**。
既有做法 `paidEmailOrderUrl` + 三元(`sweep-email-outbox.ts:536-541` 逐字「缺 `siteUrl` 就只印句子, **不印半個連結**」);
route 那側逐字「**死入口比沒入口糟**」。

**MF3 【折】期限句只有 fallback 那半逐字相同** ⇒ ✅ **§3 草稿 + §5**。
`remittanceDeadlineLabel` 只回「9 月 11 日」(**無年、無主詞**), 而畫面主句是
`OrderDetailView.tsx:699` 逐字 `請於 ${…}(含)之前完成匯款,逾期訂單將自動取消。`
⇒ 🛑 照舊 plan 寫, **信上會出現孤零零一行「9 月 11 日」, 而「(含)」那個邊界消失 ⇒ 客人第 5 天不敢匯。**
✅ **兩句抽成 domain 單一來源, 兩處共用** —— 不是在信這邊再寫一次。
📌 **我 §3 宣稱「與畫面逐字同一句」, 而那只對 fallback 那半成立** —— **又一次「宣稱比事實寬」。**

## 11-C consider(五條:三條採納、一條要 `-f8` 重裁、一條端 Sean)

**C1 · 🔴 採納, 而它會推翻一個已經裁過的東西 ⇒ 要 `-f8` 重裁**
建議:**走 `job.payload` 快照, 不吃 `IPaidEmailContext`** —— 既有三封信就是這樣
(`sweep-email-outbox.ts:417-441`;`order_cancelled` 的**金額也是 payload 快照**)。
🎯 **一刀解掉三件**:§8 混版信 · §10-B⑤(`IPaidEmailContext` 沒有 `created_at`)· §3-4(名字是 `Paid…` 而我們餵 unpaid 單)。
🛑 **⇒ 而它讓 `-f8` 03:0x 裁的【乙:`orders.version` 不一致就不寄】變成【不需要】** —— 快照根本沒有兩次查詢。
⇒ 🔴 **我不自己推翻那個裁示** —— 端回去請 `-f8` 重裁, **並附「那條裁示是在 C1 出現之前做的」**。
⚠️ **C1 自己帶的約束**:**帳號常數不得進 payload**(payload 會落 DB);只放金額 + `display_id` + `created_at`。

**C2 · 【折】正式站的正對照恆空** ⇒ ✅ **§7**。`BANK_TRANSFER_CHECKOUT_ENABLED` 今天**不得翻 true**
⇒ 本線上膛後第一輪掃到 **0 列**, 而「0 列」與「view 名字打錯 / GRANT 漏了 / 述詞寫反」**在 log 上印同一個 200**。
⇒ 🛑 **在那顆 flag 翻之前, 不得把本線寫成「已驗證會寄」。**

**C3 · 【折 ⇒ 端 Sean, 而要與提醒信【同一題】端】** ⇒ ✅ **§8**。
逾期自動取消**不寄任何信**(`20260905030000:80-85` 逐字:員工取消才 INSERT `order_cancellations`, **逾時自動取消不會**)
⇒ 客人收到催款信 ⇒ **第 6 天單子無聲消失** ⇒ 他那天匯的錢走待退款那條。
📌 **⇒「要不要在期限前再寄一封提醒」不能單獨端** —— 它與「**自動取消要不要寄一封**」是同一題。

**C4 · 【折】rollback 第一步是空動作** ⇒ ✅ **§7**:Vercel env 要 redeploy 才讀得到
⇒ 🛑 **「先關 env 止血」那個心智模型是假的** —— **止血的動作是 redeploy, 不是改 env。**

**C5 · 【折】退版一次的真實代價** ⇒ ✅ **§7**:舊碼撞 `buildEmailText` 的 `default` ⇒ `throw` ⇒ `errors++`
⇒ **503 + 心跳紅, 每 5 分鐘一次**;燒完 `attempts` 後那批列成終態, 而 anti-join 只看列在不在
⇒ **那一批客人之後再也排不進信。** 📌 §10-B⑧ 只寫「反覆失敗」, **沒把這兩半接起來**。

## 11-D nit(三條)

**N1 【折】** 座標訂正:主句在 `OrderDetailView.tsx:699`, fallback 在 `:698`(整個三元 `:697-699`)。
**N2 【折】** `CheckoutSuccess.tsx:84-88` 有一段依賴那塊座標的註解 ⇒ 改 §3 時要一起看。
**N3 【折】** 審查對象是 `d46f11a59` 不是 `0c8b77178` ⇒ 已在本節開頭標明。

## 11-E R3 順手替我**擋掉**的四條(它逐條列了「已試而不成立」——**這一節比 findings 值錢**)

1. **`payment_channel` 沒有重蹈 §9-E 那個 DEFAULT 翻轉**:`20260712203000:48` 逐字 `NOT NULL DEFAULT 'tappay'`
   ⇒ `= 'bank_transfer'` 在**這一欄**上**是真的白名單**。📌 同一份 plan 裡兩欄、兩種答案 —— **不可以類推。**
2. **`manual_request_id IS NULL` 的依據為真**:`20260905360000:188` 逐字 `IF p_manual_request_id IS NULL THEN`(拒絕)。
3. **`SUPPRESS_WHEN_ORDER_INELIGIBLE[bank_order_created] = true` 標得對**, 而且順手接住一條 race:
   客人改刷卡 ⇒ `begin_charge_attempt` 就地取消未付款匯款單(`20260904050000:202-204`, `cancelled_reason='superseded_by_card'`)
   ⇒ **那道閘擋下該寄的信。**
4. **「改刷卡會多寄一封取消信」不成立**:`pcm_unpaid_cancelled_email_pending` 要 `EXISTS order_cancellations`,
   而 supersede 走的是**就地 UPDATE、不寫該表**。
5. **§2 的推薦成立** —— 它獨立找過更便宜的路, 結論相同;而**理由要用訂正後那個強度**。
6. **R2-⑫「這封信該不該存在」它獨立重跑一次, 結論相同:該存在。**

## 11-F 判定與下一步

🔴 **R3 = FAIL**, 而**沒有一條在重複 R1/R2** —— R1 打**設計**、R2 打**本文對不對得起處置節**、R3 打**信的字面與既有管線的契約**。
⇒ **不是方向問題。**
🔵 **`-f8` 裁:不跑 R4** —— 折完自審差異即可, **除非折的過程又改了結構**。
🛑 **⇒ 而 C1 就是「改了結構」的那一種** ⇒ 📌 **C1 若被採納, 那不是自審能收的, 要回去問。**
