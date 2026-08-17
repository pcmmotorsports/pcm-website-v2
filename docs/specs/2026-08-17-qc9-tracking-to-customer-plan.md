# `Q-C9` · 追蹤碼怎麼到客人手上 · **PLAN(未批准,等 Sean)**

> **窗** C · **2026-08-17** · 座標實測自 worktree `/Users/sean_1/pcm-print` @ `a8d1ce85`
> ⚠️ **出處一律用 grep 錨點文字,不用行號**(行號會漂)。
>
> 🔴 **這份 plan 為什麼現在才必要**:`Q-C5`=丙 之後**紙上沒有追蹤碼了**
> ⇒ 「客人訂單頁 + 出貨通知信」從**兩個備援**變成**唯二載體**。
> **在這片落地之前,客人拿不到追蹤碼 —— 這不是退步,是丙的已知代價,而它現在到期了。**
>
> **鐵則判定(逐條過硬清單,不憑自評)**
> - **鐵則 8** ✅ 命中:跨 3+ 檔、動 API 與共用讀模型 ⇒ **要 Sean 批准才動工**。
> - **鐵則 12⑤** ✅ 命中:**寄信 = 對外不可回收** ⇒ commit 前必過 codex,不降級。
> - **鐵則 12②** ⚠️ **可能命中,到那一步再判**:客人訂單頁要吐 `tracking_number` 給 client
>   ⇒ 那是一條**新的 server→client 資料流**。⇒ 動到讀模型投影時**當它命中處理**。
> - **鐵則 9 分級**:信件文案 = **L1**(年 0-1 次改);追蹤碼**值**本身是資料、不是內容。

---

## §0 先講一件會改變讀法的事:**這片有一半是【已經被設計好、只差接線】的**

`order_shipped` 這個事件**不是新東西** —— 它在 2026-07 的 M-4a 通知線就設計完了,
而且**已經進了資料庫的白名單**。它缺的是「誰來按下去」與「信裡寫什麼」。

**當場量的(可重跑)**:
```
git grep -c 'order_shipped' -- apps packages supabase
  supabase/migrations/20260717020000_m4a_email_outbox.sql   8
  supabase/migrations/20260805170000_m4b_e10_b2_s1a1_shipments.sql  2
  packages/ports/src/IEmailOutbox.ts                        2
  packages/use-cases/src/sweep-email-outbox.ts              5
  packages/use-cases/src/sweep-email-outbox.test.ts         2
  apps/storefront/src/app/api/cron/email-sweep/route.ts     1
```
🔴 **這張表最重要的是它【沒有】誰**:
`packages/adapters/src/email/order-email-assembly.ts` **零命中** ——
該檔只有 `orderCreatedSubject` / `buildOrderCreatedPayload` / `ORDER_CREATED_EVENT_VERSION`
(數法 `grep -n '^export ' <該檔>` ⇒ 3 個 export,全是 `orderCreated*`)。
⇒ **事件型別存在、DB CHECK 放行、sweep 認得它,而【沒有任何地方 enqueue 它、也沒有模板】。**

**已經替我們決定好的三件(不要重新討論)**:
| 已定 | 依據 |
|---|---|
| **每出一批寄一封**(部分出貨也通知,接受客人收多封) | Sean 拍 `S2=B`(`docs/specs/2026-07-16-m4a-email-notify-plan.md` 錨點 `S2=B`) |
| 去重鍵改 `dedup_key`、不是 `UNIQUE(event_type, order_id)` | 同上連鎖;migration COMMENT 逐字(錨點 `去重鍵(Sean S2=B`) |
| 模板**必須依「有沒有單號」分流** | `20260805170000` COLUMN COMMENT 逐字:「**E4 的 order_shipped 模板必須依此分流,不得寄出「已出貨但無單號」的通用信**」 |

🔴 **最後那一條與 `Q-C5`=丙 那片對上了,而那不是巧合**:
我在丙那片**刻意保留** `trackingDisplay`(三種 `null`:還沒出貨 / 缺漏 / `other` 免碼),
理由寫的是「`Q-C9` 很可能需要同一組判斷」。
**現在資料庫的 COMMENT 用它自己的話要求了同一件事。** ⇒ 兩個獨立來源吻合 ⇒ **那份知識直接可用。**

---

## §1 拆片 —— **兩個載體是兩片,不要合併**

> 🔴 **合併的具體壞處**:信會寄出去、頁面不會。把它們綁在一起,
> 任何一半卡住,**另一半也到不了客人手上**,而客人現在手上一個碼都沒有。

| 片 | 內容 | 風險 | 前置 |
|---|---|---|---|
| **C9-a** 客人訂單頁顯示追蹤碼 | 會員中心看得到自己那張單的貨到哪 | 中(新 server→client 資料流) | 有一題要 Sean 拍(§3 Q1) |
| **C9-b** 出貨通知信(`order_shipped` / M-4a E4) | 出一批寄一封 | **高(對外不可回收)** | 兩題要答(§3 Q2、Q3) |

**建議順序 = C9-a 先。** 理由:**它可回收。** 頁面顯示錯了改一行就好;信寄出去收不回來。
而且 C9-a 會逼我們先把「這張單的貨到哪」這個讀模型定下來,**C9-b 的信要印的是同一組東西**。

---

## §2 現況盤點(這一節全部是當場 grep 出來的,不是回憶)

### 2-a 客人那一側:**有訂單清單,沒有訂單明細頁,而且清單裡沒有任何出貨欄位**

```
apps/storefront/src/app/account/page.tsx        會員中心（唯一有訂單的頁）
apps/storefront/src/components/account/tabs/OrdersTab.tsx   「訂單記錄」分頁
資料來源：getOrderRepo().listSummariesByCustomer(user.id) → OrderListItem[]
```
`OrderListItem`(`packages/domain/src/order/types.ts` 錨點 `export type OrderListItem`)的欄位是:
`id / displayId / createdAt / paymentStatus / fulfillmentStatus / total / itemCount / itemCountTruncated`
🔴 **沒有任何出貨/包裹/追蹤碼欄位。**
🔴 **而且沒有訂單明細頁** —— `find apps/storefront/src/app -type d` 之下沒有 `orders/[id]` 這種路由
(有的是 `app/api/orders/[orderId]/payment-status/route.ts`,那是 API 不是頁面)。
⇒ **「客人訂單頁顯示追蹤碼」這句話裡的那個「頁」,現在要嘛是清單、要嘛還不存在。** 那是 §3 Q1。

`git grep -c 'trackingNumber\|tracking_number' -- apps/storefront` ⇒ **0 命中**
⚠️ 這個 0 的分母:整個 storefront app。正向對照:同一支 grep 換 `-- apps/admin` ⇒ 有命中。

### 2-b 信那一側:**管線是活的,只差 E4 那一段**

已經在跑的:`order_created` 走 outbox 表 → cron sweep → Resend。
```
supabase/migrations/20260717020000_m4a_email_outbox.sql   email_outbox 表（含 order_shipped 白名單）
packages/ports/src/IEmailOutbox.ts                        EmailOutboxEventType = 'order_created' | 'order_shipped'
packages/use-cases/src/sweep-email-outbox.ts              背景寄送（order_shipped 目前 fail-closed throw）
apps/storefront/src/app/api/cron/email-sweep/route.ts     cron 入口
packages/adapters/src/email/order-email-assembly.ts       ← 🔴 只有 orderCreated*，沒有 shipped
```
🔴🔴 **`sweep-email-outbox.ts` 現在對 `order_shipped` 是 fail-closed throw** ——
shipments migration 自己寫了這句的意思:
> 「寄送端今日仍 fail-closed throw ⇒ **今天寄不出去,風險窗從 E4 落地那一刻開始**。」
⇒ **今天不會誤寄。開工那天就會。** 這是本片最重要的一句話。

### 2-c 觸發點:**`#336` 說要重定,而現在【它存在了】**

backlog `#336` 逐字:E4 原本掛在 `updateOrderItemWorkflowAction`,該 action 已於 A9w4a 拆除;
修法方向逐字「候選 = **出貨線 B2 的 `shipped_at` 寫入路徑(S2 之後才存在)**」。
⇒ **那條路徑現在存在了**(`mark_shipped` / `shipment-actions.ts` 的標記出貨鏈)。
⇒ **`#336` 的前置已解除,可以在這片一併收掉。**

---

## §3 要 Sean 拍的三題(**其他的我自己判,不拿去問他**)

> 判準:「這個功能換一個後台/前台也會有嗎?會 ⇒ 自己補。」
> 下面三題不是「基本功能」,是**業務語意**或**他看得到的東西**。

```
Q1 客人在哪裡看到追蹤碼？
   甲  加在會員中心「訂單記錄」那張清單上（每張單一行，直接顯示碼）
       —— 最快、不用新頁面；缺點：一張單多個包裹時一行塞不下
   乙  做一個訂單明細頁（點進去看這張單的每個包裹與各自的碼）
       —— 一單多包才講得清楚；缺點：這是一個新頁面，要 design
   （C 窗推薦：甲先上、乙排後面。理由：客人現在【一個碼都拿不到】，
     先讓他拿得到；而「一單多包」在甲之下可以先印「共 N 箱」+ 逐箱列碼。）

Q2 出貨通知信裡要不要放「這一箱裝了什麼」？
   甲  只放單號 + 貨運商 + 追蹤碼（信短、資訊少）
   乙  連品項清單一起放（客人一眼知道這箱是哪幾樣，部分出貨時特別有用）
   （C 窗推薦：乙。理由是 S2=B —— 他已經決定「每出一批寄一封」，
     那客人會收到多封；不寫清楚哪一箱裝什麼，多封信之間分不出來。）

Q3 「這家不給碼」（自取／自送）的那封信要怎麼寫？
   甲  照寄，信裡寫「本批為自取／自送，無追蹤碼」
   乙  這種批次不寄信
   （C 窗推薦：甲。理由：不寄 = 客人不知道東西已經出了；
     而 DB COMMENT 已經明文要求模板依「有沒有單號」分流，甲就是那個分流。）
```

⚠️ **我沒有把「dedup_key 用什麼」拿去問他** —— 那是技術題,我自己判:
**`shipment_reference`**(包裹編號,6 碼、`永不重用`、migration COMMENT 逐字寫著這個保證)。
它正是 e10 v2 plan 點名的候選(錨點 `order_shipped` 去重鍵的候選)。
🔴 **而這個判斷有一個前提要驗**:S2=B 的「一批」= 一個包裹,**還是**一次「標記出貨」動作
(一次可能標多個包裹)?**兩者的 dedup_key 不同,而寄幾封信也不同。**
⇒ 這條列進 §5 的偵察項,**不是拿去問 Sean 的題**(他已經答過「每出一批一封」,
我要做的是把「批」對到 code 裡的哪個東西,那是我的工作)。

---

## §4 預期影響面與 rollback(鐵則 8 要求)

| 片 | 會動什麼 | rollback |
|---|---|---|
| C9-a | `OrderListItem` 或新讀模型 + `OrdersTab` + 一支查詢 | 讀模型加欄是**加法**;回退 = revert 該 commit,舊欄位不受影響 |
| C9-b | `order-email-assembly.ts` 新增 shipped 組裝 + 一處 enqueue + sweep 放行 | 🔴 **回退不對稱**:code 可以 revert,**已經寄出去的信收不回來** ⇒ 見下 |

🔴 **C9-b 的 rollback 只有一半,這一點要寫在臉上:**
- **落地前**可以完全回退(今天 sweep 對 `order_shipped` fail-closed throw ⇒ 寄不出去)。
- **落地後**,rollback 只能停止「未來的信」。**已寄出的收不回。**
- ⇒ 因此 C9-b 的驗收必須包含一個**真的 render 出來的預覽**(不是文字描述的模板),
  而且**在寄第一封真信之前**要有人看過那個 render。⚠️ **這一條我還沒有做法**,列在 §5。

---

## §5-DONE ✅ **2026-08-17 晚 · 第 1、2、4 條偵察完成(下面 §5 原文保留,不要當成還沒做)**

> 三條都是**開檔讀出來的**,附 `檔案:行號`,不是回憶。**第 3、5 條仍未做。**

### ✅ 第 1 條:「一批」= **恰好一個 `shipment`,而且是【機制強制】的**

```
① RPC 只吃一個：
   admin_mark_shipment_shipped(p_idempotency_key text, p_shipment_id uuid, p_tracking_number text)
   live 定義 = supabase/migrations/20260808100000_..._w7d1_ship_deadlock_retry.sql:177
   🔴 不是 20260807190000 那支 —— 那是舊的一層。
      照 memory feedback_migration-file-is-a-layer-not-the-live-object 取【定義出現次序的最後一個】。

② DB 層【禁止一句改多列】：
   20260807230000_..._no_batch.sql:319  CREATE FUNCTION pcm_b2_shipments_no_batch_update()
                                  :333  IF v_n > 1 THEN RAISE ... ERRCODE 'P2B30'
                              :361-364  CREATE TRIGGER shipments_no_batch_update_as AFTER UPDATE
                                        REFERENCING NEW TABLE AS changed FOR EACH STATEMENT
                                  :367  ALTER TABLE shipments ENABLE ALWAYS TRIGGER
   break-glass = txn-local GUC pcm_b2.batch_shipments='1'（:329）
```
⇒ **一次標記出貨 = 一個 `shipment`,DB 保證,不是慣例。** `dedup_key` 因此掛在 **shipment 層**。

### 🔴 第 4 條:偵察順手答了一半,而**剩下那一半是真的岔路,要 Sean 拍**

```
shipments【沒有 order_id】——箱掛的是【客人】不是訂單
  （Sean 08-05 Q1=B 併箱同客人；明寫在畫面上 shipment-section.tsx:6 與 :158）
⇒ 一箱可以裝同一位客人的【兩張訂單】。
```
而**紙**的單位是 `(箱, 訂單)` 一對一張(Sean 08-15 逐字「兩張出貨單,一個訂單一張」)。
⇒ **信要跟紙一樣,還是跟箱一樣?**

| | 做法 | `dedup_key` | 客人收到 |
|---|---|---|---|
| 甲 | 一箱一封(照 `S2=B`「每出一批寄一封」的**字面**) | `shipment_id` | 1 封,信裡講兩張訂單的品項 |
| 乙 | 一箱兩單就兩封(跟紙一致) | `shipment_id` + `order_id` | 2 封,各講一張單 |

🔴 **這題不由本窗判**:`S2=B` 那句「一批」他講的時候,**很可能還沒有「一箱可含兩張單」這個前提**
—— 與 `Q-E` 那次同型。⇒ **要連前例一起端給他問**([[feedback_ask-sean-with-the-precedent-attached]])。

### ✅ 第 2 條:fail-closed **擋在哪一層** —— 前一任自標的未確認已關掉

**前一任誠實邊界原文**:「我沒有讀 `sweep-email-outbox.ts` 全文,只讀了 `git grep 'order_shipped'` 的 5 行命中」。
**已讀全文(240 行)。結果**:

```
擋的位置 = buildEmailText() 的 switch，packages/use-cases/src/sweep-email-outbox.ts:108-117
  case 'order_shipped':
    throw new Error('sweepEmailOutbox:order_shipped 模板未定義(E4 未落地)、fail-closed 不寄');
  default:
    return job.eventType satisfies never;
```
⇒ **擋在「寄送前組內文」那一步**,不是 claim、不是 sender、不是 DB。
⇒ **開的方法** = 把那個 `case` 換成真的模板函式。`satisfies never` 窮舉 ⇒ union 加成員時 **typecheck 必紅**。

🔴 **「開錯層會把別的保護一起開掉」—— 實查:不會。** 這一層只判「這個 `eventType` 有沒有模板」;
上游 claim / lease 與下游 per-job catch 各自獨立。**那個擔心可以撤掉。**

### 🔴🔴 但實查換到一個**別的**坑,而它與「開哪一層」無關

`sweep-email-outbox.ts:231-235` 的 per-job catch 對 throw 的處置逐字是
「**不補標不重試:列留 sending、lease 到期由下輪 ① 回收**」。
而既有 `buildOrderCreatedText` 的約定**相反**(`:120-124` 逐字):
> 「payload 形狀異常 → 退回不含編號的通用文案,**不因文案缺欄位就不寄**(付款成功通知的存在比編號重要)」

⇒ **E4 的出貨模板要照【同一個約定】寫:缺欄退回通用文案,不 throw。**
**照 fail-closed 的直覺把它寫成 throw,出貨信會卡在 `sending` 直到 attempts 耗盡,而客人什麼都沒收到。**
📌 這條要寫進 C9-b 的驗收條件。

### 🔴🔴 第 3 條偵察途中撞到的:**§2-b「管線是活的」只對了一半,而另一半會改變 C9-b 的工期**

`§2-b` 原文寫「信那一側:**管線是活的**,只差 E4 那一段」。
**消費端(claim → send → mark → 回收)確實是活的。而生產端【一個呼叫端都沒有】。**

```
數法（可重跑，附正向對照與分母）：
  git grep -n 'enqueue(' -- apps packages | grep -v '\.test\.' \
    | grep -v 'IEmailOutbox.ts' | grep -v 'SupabaseEmailOutboxAdapter.ts'   ⇒ 0
  正向對照：同一支 grep 改找 claimDue(                                       ⇒ 4
  第三個角度：git grep -n 'SupabaseEmailOutboxAdapter' -- apps packages（排定義與測試）⇒ 11 行，
    全部在 composition / re-export（apps/storefront/src/lib/email/composition.ts:47 有 new），
    【沒有一行是 .enqueue(...)】
```
⇒ **`order_created` 也一樣沒有人 enqueue。** 那個 0 是量出來的,不是我沒找到。
📎 這與 memory `project_0815-evening-seven-rulings` 對得上:Sean 08-15 拍「訂單信=要做」時,
   已經記著「**缺 E3 enqueue**」。⇒ **這不是新發現的缺口,是【本 plan 的 §2-b 把它讀窄了】。**

🔴 **對 C9-b 的實際影響**:
1. C9-b 不是「照 `order_created` 的樣子再做一個」—— **沒有那個樣子可以照。**
   ⇒ 交辦範本 T2 的「先讀相鄰實作對齊風格」那一步,**在這裡沒有鄰居。**
2. ⇒ 工期要往上修,而**修多少我沒有估**(未估,不是估了很小)。
3. ⚠️ **這不代表 C9-b 要順便把 E3 做掉。** 兩者共用 adapter,但觸發點不同(付款成功 vs 標記出貨)。
   **順手做 = 範圍擴張,鐵則 8。** 要做要另外提。

### ✅ 一個原本要提的風險,**實查之後撤掉**

我本來要提「`Q-D`=乙 要連品項一起寫 ⇒ payload allowlist 只有三欄,要擴,而那是 PII 邊界」。
**不必。** `packages/adapters/src/email/order-email-assembly.ts:12` 逐字:
> 「品項/金額/地址等渲染資料**寄信時即時查主表**(E2a/E3),**不進 payload**(可後台改的欄存了會過期)」

⇒ 品項、追蹤碼(`shipments` 欄)都走**寄信時查**,不進 payload。
payload 只需要帶得到 **shipment 身分**(id,不是 PII)。**PII 那道防線不必動。**

⚠️ **仍然要動 `SupabaseEmailOutboxAdapter`**:`:195` 逐字「`dedup_key` = orderId…**呼叫端無寫入口**」,
`:227-245` 的 23505 處理也寫死 `.eq('dedup_key', input.orderId)`。
**那是刻意鎖死的安全設計(呼叫端不能偷渡字串)** ⇒ 支援 `order_shipped` **一定要動那支**,
不是「多傳一個參數」。而那支 = 信件管線 = **鐵則 12⑤ 對外不可回收 ⇒ codex 不降級。**

---

## §5 動工前要先偵察的(**這些沒答之前我不會寫 code**)

1. 🔴 **S2=B 的「一批」在 code 裡是誰?** 一個 `shipment` 還是一次標記動作?
   ⇒ 決定 `dedup_key` 與「客人會收到幾封」。**答錯的症狀是客人收到重複的信,而那收不回來。**
2. 🔴 **`sweep-email-outbox.ts` 對 `order_shipped` 的 fail-closed 要怎麼開?**
   要看它現在**擋在哪一層、擋的判準是什麼** —— 開錯層 = 把別的保護一起開掉。
3. **信件寄給誰?** 訂單的 email、還是會員帳號的 email?兩者可能不同(而且訂單快照是當時的)。
4. **一箱含多張訂單時寄幾封?**(併箱是允許的,見 `shipments` 表 COMMENT「本表刻意沒有 order_id」)
   ⇒ 一箱兩單 = 兩位客人?不,併箱只准同一位客人 —— 但**同一位客人的兩張單**併一箱時,
   是寄一封(講這箱)還是兩封(各講一張單)?**這會影響 dedup_key 的組成。**
5. **預覽怎麼做**(§4 那條缺口)。

---

## §6 誠實邊界

- 🔴 **本 plan 沒有動任何 code**:`git status --porcelain | grep -cv '\.md$'` ⇒ 落筆時 **0**。
- 🔴 **§2 全部是 grep 出來的,而我【沒有跑過任何一封信】** —— 沒有 DB、沒有 Resend 金鑰,
  施工窗做不到端到端。⇒ 「管線是活的」是**讀 code 讀出來的**,不是量到的。
- ⚠️ **我沒有讀 `sweep-email-outbox.ts` 全文**,只讀了 `git grep 'order_shipped'` 的 5 行命中。
  §5-2 那條就是為此而列。**「fail-closed throw」是引 migration 註解的轉述,不是我親眼看到那行 code。**
- ⚠️ **§2-a 說「沒有訂單明細頁」的分母**是 `apps/storefront/src/app` 之下的目錄結構;
  若有人用別的路由形狀(例如 catch-all)做了明細頁,這個結論會漏掉。**未逐檔開檔確認。**
- ⚠️ `#336` 的「前置已解除」是我對照 backlog 修法方向與現行出貨線得到的**推論**,
  **沒有回頭問 `#336` 的立案人**(I 窗)。
