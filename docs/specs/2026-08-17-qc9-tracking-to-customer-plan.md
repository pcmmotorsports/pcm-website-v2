# `Q-C9` · 追蹤碼怎麼到客人手上 · **PLAN(✅ 已批准,2026-08-17)**

> ## ✅ 批准狀態(2026-08-17 晚更新;**檔頭原本寫「未批准,等 Sean」,那已經過期**)
>
> **Sean 2026-08-17 拍 `Q4`=甲「批,開工」。**
> 出處兩個獨立來源:`~/pcm-mailbox/C-219-STOP-20260817.md:180`(`Q-C9` plan 那一列)、
> `~/pcm-mailbox/MAIN-009-主視窗交接與開窗提示詞-20260817夜.md:101`。
> 🔴 **他批的是「開工」,不是「每一條都對」** —— 下面 §3 的 `Q2` / `Q3` **仍然沒有答案**,
> 見本檔 §5-DONE-d 的「還在等他的」那一格。
>
> 📎 **為什麼要把這一格寫進檔頭**:已批的 plan 檔頭還寫著「未批准」,
> 下一個接手的人會**停下來等一個已經拍過的板**,而那一停沒有任何東西會提醒他。
> (同型復發紀錄:memory `project_0816-window-fleet-rulings` —— 當天兩份已批 plan 檔頭都還寫著尚未批准。)
>
> ---
>
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

> ## ✅ 三題的現況(2026-08-17 晚;**先讀這一格,下面的選項表是原文留痕**)
>
> | 題 | 答案 | 誰擋著 |
> |---|---|---|
> | `Q1` 客人在哪裡看到追蹤碼 | **未答** | 屬 `C9-a`,**不擋 `C9-b`** |
> | `Q2` 信裡放不放品項清單 | ✅ **乙 = 放** | — |
> | `Q3` 自取 / 自送那封信 | ✅ **甲 = 照寄,信裡寫「本批為自取/自送,無追蹤碼」** | — |
>
> ⇒ **`C9-b` 已解鎖,可以開工。**
>
> 🔴 **`Q2`=乙 的存在理由是【辨識】不是【對帳】**:他先前拍過「一箱兩單就寄兩封」
> ⇒ 客人會收到多封,**而多封之間分不分得出來,是那個決定的後果**。
> ⇒ **收信人要能一眼看出「這封講的是哪一箱」** —— 這決定放幾欄、怎麼排,
> **不是要他拿這封信去對帳**(對帳等式在紙上都刻意不印了,見 `…qc5-…-list.md` §4b-3 E2)。
>
> 🔴 **`Q3`=甲 的文案要寫「所以你要做什麼」,不是只寫狀態。**
> 「本批為自取,無追蹤碼」講完了**狀態**,而自取的人接著要知道**去哪裡拿、什麼時候可以拿**。
> **兩件都有既成真值,不必問 Sean**:
>
> ```text
> 地址      apps/storefront/src/lib/site-config.ts:26-34  新北市新莊區化成路736巷18號1樓
> 可取時間  apps/storefront/src/lib/site-config.ts:37-42  OPENING_HOURS
>           = 週一–六 10:00–19:00（檔內逐字註解：Sean 2026-07-04 全站 20:00→19:00）
> 數法（含正向對照）：
>   grep -rl '營業時間\|營業時段\|取貨時間\|可取貨' --include='*.ts' --include='*.tsx' \
>     --include='*.md' --include='*.sql' apps packages docs supabase   ⇒ 21 檔
>   正向對照 同範圍找 '自取'（僅 ts/tsx）                              ⇒ 27 檔
> ```
>
> 🔴 **我第一版在這裡寫「全 repo 我沒有找到 ⇒ 待問 Sean」,而那是【假的查無】** ——
> 我當時**一次都沒跑那支 grep**。跑了就是 21 檔,而 SSoT 就在其中。
> **留著這句**:一個沒跑過的 grep 與一個跑過回 0 的 grep,**寫出來的句子一模一樣**。
>
> ⚠️ **仍有一件要處理,而它不是「值不見了」是「值在別的 app」**:
> `site-config.ts` 在 **storefront**,而信件模板在 `packages/use-cases` / `packages/adapters`。
> ⇒ 與抬頭七值同一個病(`shipping-doc.tsx` 那段註解逐字寫過)⇒ **不要在信件端再造第三份常數**,
> 落地時把取值方式一起寫進 `C9-b` 的實作決定,收斂點是 backlog `#248`。

> 判準:「這個功能換一個後台/前台也會有嗎?會 ⇒ 自己補。」
> 下面三題不是「基本功能」,是**業務語意**或**他看得到的東西**。
> ⚠️ **下面這個選項表是原文,`Q2` / `Q3` 已經有答案了**(見正上方那一格)。

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

> ### 🔴🔴 這一段已被 Sean 推翻(2026-08-17 晚)—— **原文留痕在下面,不要照它做**
>
> **現行答案:`dedup_key` = `shipment_id` + `order_id`。**
> 依據:Sean 拍**乙 =「一箱兩單就兩封,一封講一張訂單」**
> (`~/pcm-mailbox/C-219-STOP-20260817.md:181`)。
> ⇒ 下面那段判 `shipment_reference`(**箱層**、一箱一封)**與他的答案不一致**,**作廢**。
>
> 🔴 **這一段為什麼特別危險**:本檔 §5-DONE-c 末尾**已經**寫著新答案
> (「E4 定案 dedup_key 算法後」那個前提 08-17 晚到齊 ⇒ `shipment_id + order_id`)
> ⇒ **同一份檔裡兩個答案並存**,而讀 §3 的人不會往下讀到 §5-DONE-c。
> 📎 判別句:**這段描述的是「本檔的內容」還是「世界的狀態」?**
> (memory `feedback_status-file-fixed-fields-hide-stale-claims`)

~~⚠️ **我沒有把「dedup_key 用什麼」拿去問他** —— 那是技術題,我自己判:
**`shipment_reference`**(包裹編號,6 碼、`永不重用`、migration COMMENT 逐字寫著這個保證)。
它正是 e10 v2 plan 點名的候選(錨點 `order_shipped` 去重鍵的候選)。
🔴 **而這個判斷有一個前提要驗**:S2=B 的「一批」= 一個包裹,**還是**一次「標記出貨」動作
(一次可能標多個包裹)?**兩者的 dedup_key 不同,而寄幾封信也不同。**
⇒ 這條列進 §5 的偵察項,**不是拿去問 Sean 的題**(他已經答過「每出一批一封」,
我要做的是把「批」對到 code 裡的哪個東西,那是我的工作)。~~

📎 **那個「前提要驗」的判斷本身是對的** —— 它問對了問題(箱層還是單層),
只是**答案不是它猜的那個**,而且**不是技術題**:一箱含同一位客人兩張訂單時要寄幾封,
是 Sean 看得到的東西。⇒ 端給他之後他選了單層。**留著這句,是因為下一個人會想知道
「為什麼當初判成技術題」——那一步錯在【誰該決定】,不在【怎麼算】。**

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

### ✅ 第 4 條:**已答 = 乙**(2026-08-17 晚;原本標「要 Sean 拍」,那已經過期)

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

> #### ✅ 他答了:**乙**(逐字「一箱兩單就兩封,一封講一張訂單」)
>
> 出處 `~/pcm-mailbox/C-219-STOP-20260817.md:181`。
> ⇒ **`dedup_key` = `shipment_id` + `order_id`**(上表乙那一列)。
> ⇒ §3 那段判 `shipment_reference` 的**已作廢**,見該節新加的作廢框。
> 📎 「連前例一起端給他問」這個做法**這一次真的有用**:他選的是**乙**,
> 也就是**上表那個「跟紙一致」的**,而不是他自己先前那句話的**字面**(甲)。
> ⇒ 只端字面去問,會拿到甲。

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

### ✅ 第 5 條:**預覽怎麼做 —— 答案是「一格快照測試,快照檔本身就是預覽」**

`§4` 提的要求是硬的:**C9-b 的 rollback 不對稱(已寄的信收不回)⇒ 寄第一封真信之前要有人看過真的 render。**

**現況盤點**:`git grep -ln 'preview\|預覽' -- apps/admin/src packages/adapters/src/email packages/use-cases/src`
⇒ **3 個檔命中,而沒有一個是信件預覽**(一個是我的列印 CSS、兩個是退款/取消畫面)。**零機制。**

**為什麼這件事其實很便宜 —— 因為內文是【純函式】**:
`sweep-email-outbox.ts:108` 的 `buildEmailText(job)` 回傳 `string`、**零 I/O、零 DB**,
而 `buildOrderCreatedText`(`:125-144`)產的是**純文字**(`[...].join('\n')`),不是 HTML。
⇒ **要看它長什麼樣,只要呼叫它。不需要寄、不需要 DB、不需要 Resend 金鑰。**

**做法(最小):一格 `toMatchFileSnapshot`,快照檔進 git。**
```
expect(buildOrderShippedText(fixtureJob)).toMatchFileSnapshot('__previews__/order-shipped.txt')
```
- **零新依賴** —— vitest 內建(本 repo 已裝,版本 4.1.5)。
- **快照檔是純文字、進 git ⇒ 人打開就看得懂**,而且可以在 commit / 交接信裡直接指路給 Sean。
- **模板一改快照就變 ⇒ 不會靜默過期**。這正是「預覽」與「一次性截圖」的差別。

⚠️ **一個要在 commit body 講清楚的代價**:本 repo **目前零 snapshot 用法** ——
`git grep -ln 'toMatchFileSnapshot\|toMatchSnapshot\|toMatchInlineSnapshot' -- apps packages scripts` ⇒ **0**
(正向對照:同範圍 `git grep -l 'expect(' -- apps packages` ⇒ **489**)⇒ 那個 0 是量出來的。
⇒ **這是引入一個新模式**,不是沿用既有慣例。理由 = 一般斷言只證「字串裡有某幾個字」,
**證不了「整封信讀起來對不對」**,而後者正是這裡要人看的東西。

**被我否決的替代做法**:寫一支 script 手動跑印出來。
🔴 **沒有守門** —— 模板改了不會有人想到要重跑它,而那時預覽就是一份過期的紙。

### 🔴🔴 §5-DONE-b · **兩條規則看起來打架,而它們在講不同的軸**(動手寫模板前必讀)

**這一節寫的是【正確解與錯誤解兩個都寫】** —— 只寫正確解擋不住下一個人,
因為**他會自己推出錯誤解那個方向**,而那個方向「看起來安全」。

```
DB COMMENT（20260805170000 的 COLUMN COMMENT，逐字）
  「E4 的 order_shipped 模板必須依此分流，不得寄出【已出貨但無單號】的通用信」
  ⇒ 它講的是【內容分流】

sweep 既有約定（sweep-email-outbox.ts:120-124，逐字）
  「payload 形狀異常 → 退回不含編號的通用文案，【不因文案缺欄位就不寄】
    （付款成功通知的存在比編號重要）」
  ⇒ 它講的是【送不送】
```

| | 做法 | 滿足 COMMENT? | 滿足 sweep 約定? |
|---|---|---|---|
| ✅ **正確解** | 有單號走 A 模板、無單號走 **B 模板**(B 也是**真模板**,不是通用信) | ✅ 分流了 | ✅ 照樣寄 |
| 🔴 **錯誤解** | 無單號時 **throw / 不寄** | ❌ **沒有** | ❌ 違反 |

🔴 **為什麼錯誤解【看起來】是對的**:它長得像 fail-closed,而本 repo 到處都是 fail-closed。
🔴 **為什麼它其實是錯的**:`COMMENT` 要的是「**不要寄錯的信**」,**不是「不要寄」**。
把「內容不對」處置成「不送」,是**把兩個軸壓成一個**。

🔴 **錯誤解的實際後果(而它不會有人發現)**:
`sweep-email-outbox.ts:231-235` 的 per-job catch 對 throw 的處置逐字是
「**不補標不重試:列留 `sending`**,lease 到期由下輪回收」
⇒ **出貨信會卡在 `sending` 直到 attempts 耗盡,而客人什麼都沒收到。**
⇒ 症狀是「客人說沒收到出貨通知」,而 code 這邊**每一格測試都是綠的**。

📎 **B 模板的內容有現成的知識可用**:`trackingDisplay` 的**三種 `null`**
(還沒出貨 / 缺漏 / `other` 免碼)—— 那正是 `Q-C5`=丙 時**刻意保留它**的理由,
而 **DB COMMENT 用它自己的話要求了同一件事**。
⇒ **兩個沒有互相參照的來源指向同一個設計**,那比任何一方單獨的論證都強。

**那一格守門的驗收(三種都要分得出來)**:
```
無單號 ⇒ 走 B 模板      → 該綠
無單號 ⇒ 走通用模板     → 該紅
🔴 無單號 ⇒ throw / 不寄 → 【也該紅】
   這一格最容易漏，因為它「看起來安全」
```
🔴 而**拿掉分流時它必須紅** —— 拿掉之後 A 與 B 會產出同一串,那一格就抓得到。

### ✅ §5-DONE-c · `SupabaseEmailOutboxAdapter` **全文讀過**(不是只讀 grep 命中)

📎 **為什麼要特別聲明**:前一任在**同一支檔**上踩過「只讀 `git grep` 的 5 行命中、
把 migration 註解的轉述當成讀過 code」。

```
檔長 419 行（wc -l），已讀全文。
dedup_key 的【寫入路徑】= 1 條，只有 :201-204 那個 .insert()
  數法：grep -n '\.insert(\|\.update(' ⇒ 4 處
        :201 insert  ← 唯一寫 dedup_key 的
        :306 update  → status / claimed_at / attempts        （tryClaim）
        :375 update  → status / claimed_at / last_error_code / next_retry_at（reclaimStaleLeases）
        :409 update  → { ...values, claimed_at: null }        （leaveSending）
```
🔴 **`:409` 那個 `...values` 是唯一的展開,我特別查了它**:
型別是 `Database['public']['Tables']['email_outbox']['Update']`
⇒ **型別上【允許】帶 `dedup_key`**,但三個呼叫端(`:324` / `:340` / `:349`)
實際傳的只有 `status` / `sent_at` / `last_error_code` / `next_retry_at`。
⇒ **今天沒有第二條寫入路徑;而型別沒有擋住將來出現一條。** 兩件分開講。

**要動的四處(不是一處)**:
```
:196  payload  = buildOrderCreatedPayload(...)   ← 寫死 order_created
:197  dedupKey = input.orderId                    ← 寫死 order 層
:206  subject  = orderCreatedSubject(...)         ← 寫死模板
:235  resolveUniqueViolation 的 .eq('dedup_key', input.orderId)
      🔴 這一處最容易漏 —— 它【自己又算了一次 dedup_key】而不是用 :197 那個。
         改了 :197 沒改 :235 ⇒ 撞鍵回查查【錯的鍵】⇒ 查無 ⇒ throw
         「撞唯一鍵但查無同事件列」。症狀出現在【第二次寄同一批】，離改動很遠。
```
⇒ **修法不是兩處各改一次,是把 `dedupKey` 算出來之後【傳給】`resolveUniqueViolation`**
—— 一個來源、兩個消費端。

### 📌 做法**不用發明** —— `IEmailOutbox.ts:145-152` 已經寫死了

逐字:
> 「目前只開放 `order_created`(codex 關卡2 R1:過早開放 `order_shipped` 會讓
> 「出貨事件+付款 payload」在型別上合法、且**錯占唯一鍵** → E4 正確事件被當 duplicate 吞掉)。
> E4 定案 payload 與 dedup_key 算法後,**以 discriminated union 增員**(事件⇔payload 綁定、不共用自由欄)。」

⇒ `eventType: 'order_created'` 是**字面型別**,今天連傳 `'order_shipped'` 都編不過。
⚠️ 我原本以為「呼叫端可以標錯 `event_type` 卻塞付款 payload」是個潛在 bug —— **型別已經擋住了。**
📌 而「E4 定案 dedup_key 算法後」那個前提**2026-08-17 晚到齊**(Sean 拍乙 ⇒ `shipment_id + order_id`)。

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

### 🔴🔴 §5-DONE-d · 第 3 條「信件寄給誰」—— **不是讀模型的選擇題,是呼叫端要填的一個欄**

前一任把它寫成「訂單的 email 還是會員帳號的 email?」的二選一。**實查之後那個框架不對。**

```
收件人是【enqueue 的入參】,不是 outbox 自己去查的:
  packages/ports/src/IEmailOutbox.ts:158   recipientEmail: string   ← EnqueueEmailInput 的必填欄
  packages/ports/src/IEmailOutbox.ts:180   recipientEmail: string   ← ClaimedEmailJob 原樣帶出
⇒ 「寄給誰」由【我要寫的那個 enqueue 呼叫端】決定,今天 code 裡沒有任何既成答案可以照抄
   (呼叫端數 = 0,數法與正向對照見本檔 §5-DONE 第 3 條那一格)。
```

**而訂單這一側有欄可用,它可以是 `null`**:

```
packages/domain/src/order/types.ts:1156
  customer: { name: string | null; email: string | null; phone: string | null };
```

### 🔴🔴 而實查撞到一個**沒有人登記過**的洞:LINE 客人收不到這封信

```
packages/adapters/src/email/SupabaseEmailOutboxAdapter.ts:198  isSyntheticEmail(...) 判合成假信箱
                                                        :208  status = 'skipped_no_real_email'
                                                        :222  回 { kind: 'skipped_no_real_email' }
packages/ports/src/IEmailOutbox.ts:166 逐字「落表佔位但不進 due、不呼 Resend」
```

⇒ **LINE cohort(合成假信箱)的客人,這封出貨通知信【永遠不會寄出】。**
⇒ 而 `Q-C5`=丙 已經把**紙上的追蹤碼拿掉了** ⇒ **對這群客人,兩個載體同時是空的。**

🔴 **這不是本片的 bug,是丙的代價在這群人身上的具體形狀** ——
丙的原話是「追蹤碼走**簡訊/Email**」,而**簡訊那一半在本 plan 的範圍外,我沒有查它做了沒**(未查)。
⇒ **要端給 Sean**:這群人有多少、要不要在客人訂單頁(C9-a)上補、或簡訊那半到底有沒有。
⚠️ **這群人的人數我沒有量**(要 DB;施工窗沒有)。**「有這個洞」是讀 code 讀出來的,
「有幾個人掉進去」未量。** 兩件分開講。

### 📌 還在等 Sean 的兩題

**數法(可重跑,分母寫出來)**:本檔要 Sean 拍的題共 3 條(§3 `Q1` / `Q2` / `Q3`,
`grep -cE '^Q[123] ' <本檔>` ⇒ 3,命中在 `:132` / `:140` / `:146`);要偵察的共 5 條(§5 那張編號清單 1–5)。
⚠️ 我第一版把那條 pattern 寫成 `'^   Q[123] '`(以為有三格縮排)⇒ **回 0**。
**留著這句**:0 命中與「這些題不存在」在畫面上長得一樣,而**錯的是我的 pattern 不是世界**。
逐條狀態:`Q1` 未答(屬 C9-a,本片不擋)、`Q2` 未答、`Q3` 未答;
偵察 1/2/4/5 已完成(§5-DONE 各有一格)、3 本節剛完成。
⇒ **擋住 C9-b 動工的只有 `Q2` 與 `Q3` 這兩條。**

| 題 | 內容 | 為什麼不由本窗判 |
| --- | --- | --- |
| §3 `Q2` | 出貨通知信裡要不要放「這一箱裝了什麼」(品項清單) | 客人看得到的東西 |
| §3 `Q3` | 「自取 / 自送」那種沒有碼的批次,信要照寄還是不寄 | 業務語意 |

🔴 **`Q2` 的推薦理由在他拍乙之後【變強了】**:他選的是「一封講一張訂單」⇒ 客人會收到多封,
**不寫清楚哪一封講哪一箱哪一單,多封信之間分不出來**。⇒ 端題時要把「他已經拍了乙」一起帶上。

---

### 🔴🔴 §5-DONE-e · **`Q2`=乙 落不進現在這個 sweeper** —— 它手上沒有可以查主表的東西

**這一節是動手寫 code 的第一分鐘撞到的,不是推的。**

設計意圖寫得很清楚(`packages/adapters/src/email/order-email-assembly.ts:12` 逐字):
> 「品項/金額/地址等渲染資料**寄信時即時查主表**(E2a/E3),不進 payload(可後台改的欄存了會過期)」

**而那個能力不存在**:

```text
packages/use-cases/src/sweep-email-outbox.ts:42-44
  export type SweepEmailOutboxDeps = {
    outbox: IEmailOutbox;
    sender: IEmailSender;
  };                       <= 就這兩個，沒有任何可以讀 orders / shipments 的東西

同檔 :108-117  buildEmailText(job) 是【純函式】，只拿得到 job
同檔 :125-143  buildOrderCreatedText 只從 payload 取 display_id 一欄
```

⇒ **要在信裡放品項清單(`Q2`=乙),現在無處可查。**
🔴 **而這不只是 `Q2` 的問題**:**追蹤碼本身也在 `shipments` 表、不在 payload**
⇒ **就算 `Q2` 選甲(只放單號/貨運商/追蹤碼),一樣查不到。**
**這條卡的是整個 `C9-b`,不是只卡品項那一段。**

#### 兩條路(這是**架構取捨**,不是文案題)

| | 做法 | 代價 |
|---|---|---|
| **甲** | `SweepEmailOutboxDeps` 加**第三個依賴** = 一個寄送時讀取用的 port(讀這箱這單的品項與追蹤碼) | 動**共用 use-case 的依賴契約** + composition root(`apps/storefront/src/app/api/cron/email-sweep/route.ts:140`,**production 呼叫端數 = 1**,數法 `grep -rn 'sweepEmailOutbox(' apps packages --include='*.ts' \| grep -v '\.test\.'` ⇒ 2 行,其中 1 行是定義) |
| **乙** | 把品項清單與追蹤碼**放進 payload** | 🔴 **直接違反 payload allowlist 那道防線**(`order-email-assembly.ts:4-11`:那層逐字寫著它是「PII 不落表的**真防線**」、「禁 spread、禁整包轉存」);而且**追蹤碼後台可改** ⇒ 存了會過期,信寄出去帶的是舊碼 |

**本窗推薦 = 甲。** 理由:乙省下的是一次契約改動,付出的是**那份 code 裡唯一一道真防線**,
而且它會製造一種**寄出去才看得到、且收不回來**的錯(舊追蹤碼)。

🔴 **這一條【超出已批准的 plan 範圍】** —— 批准時這份檔寫的是「管線是活的,只差 E4 那一段」,
而**那句話再一次讀窄了**(§5-DONE 第 3 條已經修過一次:生產端零呼叫端;**這是第二處**)。
⇒ **依 R3「範圍擴張必停問 Sean」,本窗不自行開工甲,先端出去。**

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
- ~~⚠️ **我沒有讀 `sweep-email-outbox.ts` 全文**,只讀了 `git grep 'order_shipped'` 的 5 行命中。
  §5-2 那條就是為此而列。**「fail-closed throw」是引 migration 註解的轉述,不是我親眼看到那行 code。**~~
  ✅ **已關(2026-08-17 晚)**:全文 240 行已讀,擋的位置逐字在
  `packages/use-cases/src/sweep-email-outbox.ts:108-117`(見本檔 §5-DONE 第 2 條)。
  🔴 **這一條為什麼不是刪掉而是劃掉**:它記著「當時只讀了 5 行命中就下了結論」這件事本身,
  而那正是本條要防的病。刪掉的話,下一個人看不到那個誤差長什麼樣。
- ⚠️ **§2-a 說「沒有訂單明細頁」的分母**是 `apps/storefront/src/app` 之下的目錄結構;
  若有人用別的路由形狀(例如 catch-all)做了明細頁,這個結論會漏掉。**未逐檔開檔確認。**
- ⚠️ `#336` 的「前置已解除」是我對照 backlog 修法方向與現行出貨線得到的**推論**,
  **沒有回頭問 `#336` 的立案人**(I 窗)。
