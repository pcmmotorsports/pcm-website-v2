# plan — 付款信的金額凍結快照(Q7 / `auth-PAIDAMOUNTNOTFROZEN`,板列 2476)

> 2026-09-11 · `b4` 寫 · **唯讀量測完成,零改動。**
> 🛑 **碰錢 + 碰寄信 ⇒ 鐵則 8(先 plan 等 Sean 批)+ 鐵則 12(codex 唯讀審)。兩條都標,見 §7。**
> ✅ **2026-09-11 窗 B:兩個角度的唯讀審查已跑完(Sean 拍的形式「乙」),結論與怎麼收在 §10;
> 給 Sean 的題在 §11。** 下面各節凡被審查改動的地方都標了 ⟦審A⟧ / ⟦審B⟧。

---

## 0. 這是哪一題,與一句被斷錯過的話

```
題目  付款信金額是寄出當下重查的, 比不了        docs/evidence/2026-09-11-db與auth17列-要Sean的12列.md:19
選項  甲 上線後再做(今天真客人 0)· 乙 現在凍結金額快照(碰錢+寄信)
Sean  🔴 乙, 逐字「做完整做好, 授予權限用多重對抗審查」   docs/handoff/CURRENT.md:424
```

🎯 **「授予權限」是【動詞】,不是 DB 的 `GRANT`。** 斷句是
`做完整做好, / 授予權限, / 用多重對抗審查` ——他在**准**,並且加了一個條件。

📌 這一格記著,因為它害過一次派工:有人把那四個字讀成名詞,跑去找「重複的權限程式碼」。
佐證最硬的一個:**同一份 memory 裡同一個動詞用了兩次(Q7 與 Q8),而只有 Q7 那次被讀成名詞。**

---

## 1. 已經量到的(不要重量)

**① 信上的金額今天從哪來** —— `packages/adapters/src/email/SupabasePaidEmailContextAdapter.ts`

```
:101-109  .from('orders').select('display_id, subtotal, shipping_fee, discount_total,
                                  total, tax_total, cancelled_at')
:154-157  .from('order_items').select('variant_sku, quantity, line_total, product_snapshot')
⇒ 六個金額欄 + 每列小計, 全部是【寄送當下】現查
```

**② payload 今天有什麼** —— `packages/ports/src/IEmailOutbox.ts:328-333`

```
OrderCreatedEmailPayload = { event_version: 1; display_id; paid_at }
⇒ 零金額。而那是設計:同檔 :337-339 逐字「可後台改的欄存了會過期」
```

**③ 已經寄出去的舊信** —— 🔴 **救不回來。**
`email_outbox` 十六欄(`20260717020000:297-315`)**沒有任何一欄存內文或金額**。
⇒ **這一版救不了已經寄出去的信,寫在這裡不藏。** 好消息是今天真客人 0。

**④ 那個窗有多長** —— 順利 5 分鐘(`pcm-email-sweep` 每 5 分一輪);
而撞限流/額度時退避是 `≥24h × 最多 4 次 ≈ 4 天`(`email-backoff.ts:88-97`)
⇒ 📌 **今天客人四天後收到的信,印的是四天後的金額。**

---

## 2. 🎯 不要從零設計 —— 這個 repo 已經有一個做過、審過的前例

**匯款單成立信(`bank_order_created`,⟦b4-BANKNOEMAIL⟧,2026-09-06)早就把金額凍進 payload 了**,
就在同一支檔的隔壁 case:`packages/adapters/src/email/order-email-assembly.ts:363-390`

```ts
buildBankOrderCreatedPayload(src) → {
  display_id, created_at,
  total: src.total,          // 🔴 金額原樣帶
  balance_due: src.balanceDue,
  event_version: 1,
}
```

它的檔頭逐字,四句話全部可以直接搬到 Q7:

```
:355  🔴🔴 payload 是【下單當下的快照】(R3-C1, 主視窗 2026-09-06 裁採納)
      —— 而它一刀解掉「表頭與明細兩次查詢之間被改」那個混版問題:
      📌 不是「被解掉了」, 是那個問題【不存在】—— 只有一次讀。
:383  🔴 金額**原樣帶**:它在 view 那一層就與 order_balance_base_v 同源, 這裡不重算。
      📌 重算 = 第二個來源 ⇒ 兩份會漂, 而漂掉的症狀是「信上的數字與訂單頁對不起來」。
:361  ⚠️ 而快照有它自己的問題:客人隔天匯了一半 ⇒ 快照仍是舊的
      ⇒ 🔴 寄送前那道 balanceDue 重驗非留不可。
:364  🛑🛑 帳號常數【不得】進 payload —— payload 會落 DB。
      ⇒ 📌 換銀行那天, 佇列裡還沒寄出的信會印【新帳號】而不是舊的。
```

⇒ 🎯 **⇒ 這個 repo 對「哪些凍、哪些活」已經有立場了:
【當時是多少】凍進 payload;【現在是什麼】留在寄送當下讀。**

---

## 2b. 🔴 而上面那句「照前例做」講得太輕了 —— 訂正

> ⛔ ~~Q7 只是把同一條線套到付款信上,plan 全文照它做,不另外發明。~~
> **2026-09-11 `a2` 用庚的角度打回來,它對。改成下面這樣。**

### ① 這不是「有前例可循」,是【在一條寫死的防線上開第二個例外】

`packages/adapters/src/email/order-email-assembly.ts:5-13` 逐字:

```
🔴 這層是 PII 不落表的**真防線**(migration 20260717020000 §⑤:DB 只約束 payload 為 jsonb object、
無 key allowlist;subject/dedup_key 皆自由 text → 一次 DTO spread 就能把 email/電話/地址永久複製進表):
1. payload **顯式逐欄 allowlist 組裝** + runtime 型別檢查 —— 只收
   `display_id`/`paid_at`/`event_version` … **禁 spread、禁整包轉存。**
…
品項/**金額**/地址等渲染資料**寄信時即時查主表**,不進 payload(可後台改的欄存了會過期)。
```

🛑 **那句話點名了「金額」。而匯款信是【後來的、審過的例外】。**
⇒ 📌 **⇒ 乙 要做的是【第二個例外】,不是「照著既有做法做」。這件事要明講,不能藏在「有前例」三個字後面。**

### ② 匯款信那個例外當初走過什麼程序 —— 查了,而答案值得看

```
做法(payload = 快照)  🔴 **主視窗 `-f8` 2026-09-06 裁 R3-C1「採納」**
                        出處逐字:order-email-assembly.ts:355 ·
                        IEmailOutbox.ts:564 · sweep-email-outbox.ts:526
                        ⇒ 那是**審查輪次裡的一個 consider 被採納**, 不是端給 Sean 的一題

文案                    ✅ **Sean 2026-09-06 03:2x 逐字答「甲 = 可以」**
                        出處 docs/specs/2026-09-06-bank-order-created-email-copy.md:1-5
```

🔴 **⇒ Sean 核可的是【那封信長什麼樣】,不是【金額要不要落表】。**
⇒ 🛑 **⇒ 所以「匯款信有走過開例外的程序」這句話【不成立】** —— 它是主視窗在審查裡裁的。
⇒ ⇒ 📌 **那不是說當初錯了。是說:Q7 如果要開第二個例外,
不能拿「前例走過程序」當依據 —— 因為前例沒走過。要走就是 Q7 第一次走。**

### ③ ⚠️ 順帶撿到一個過期字面(不是本 plan 的事,但就在旁邊)

```
IEmailOutbox.ts:564 逐字  🛑 `dedupKey = orderId`(一單一封)
SupabaseEmailOutboxAdapter.ts:313-325 實際  bankOrderCreatedDedupKey(帶指紋)
⇒ 🔴 port 的 docstring 停在舊做法, 而 codex R1-#4 後來把它改成帶指紋的
```
**交給主視窗判要不要開一列,本 plan 不處理。**

---

## 3. 🔴 而前例同時警告了一個坑,而 Q7 正好站在坑邊

`bank_order_created` 的 `dedup_key` **不是**單純的 `orderId`,是**帶指紋的**
(`order-email-assembly.ts:318-349`),理由逐字:

```
🔴🔴 為什麼不是單純的 orderId:
  寄送當下發現快照過期 ⇒ 標 bank_order_snapshot_stale ⇒ 那張單重新進得了掃描面,
  而 UNIQUE (event_type, dedup_key) 會讓第二次 INSERT 撞唯一鍵
  ⇒ 📌 那張單【永遠停在那裡】。
🛑 而指紋要涵蓋【會讓那封信變得不一樣】的每一個值 —— 今天是三個:
  total / balanceDue / recipientEmail
  ⚠️ 少涵蓋一個的後果很具體:那個值變了而指紋沒變 ⇒ 撞唯一鍵 ⇒ 那張單從此排不進來
  (不是「寄了舊的」—— 寄送前重驗會擋下, 而擋下之後就再也補不回來)
```

🔴 **而 `order_created` 今天的 dedup_key 是【單純的 orderId】**
(`SupabaseEmailOutboxAdapter.ts:318` 逐字 `dedupKey: input.orderId`)。

⇒ 🛑 **所以 Q7 有一題必須先答:加了金額快照之後,會不會出現「快照過期 ⇒ 重新入列」那條路?**

```
會   ⇒ dedup_key 必須跟著改成帶指紋, 否則症狀是【永久漏信】, 而那比「金額不準」嚴重
不會 ⇒ dedup_key 維持 orderId, 而 plan 裡要寫明「為什麼這一支不需要」
```

🔵 **我的讀數傾向「不會」,而它是推論不是量測**:`order_created` 的入列走
**掃描 + 差集**(`20260822010000:4` 逐字),有列就不再撈;而本 plan 不打算加
「快照過期就重來」那條路。**但這一格要 codex 在審查時當成第一題打。**

---

## 4. 做法(兩個選項,含「什麼都不做」)

### 甲 · 什麼都不做(上線後再說)

| | |
|---|---|
| 客人感覺得到什麼 | 沒有差別 —— 直到有人拿信來對帳 |
| 壞掉的形狀 | 客人拿信說「我付的不是這個數字」,而我們證不出當時是多少 |
| **它會不會叫** | 🔴 **不會。** 而且**永遠不會** —— 沒存的東西不會有人發現它沒存 |
| 代價的分母 | 今天真客人 **0** ⇒ 今天損失 0;**而它每天長大,且不可回填** |
| rollback | 不適用 |

🛑 **Sean 2026-09-11 已經看過這個選項並否決(他拍乙)。留著只是為了讓下一個人看到分母。**

### 乙 · 金額凍進 payload,照匯款信那條線做 ✅ **Sean 拍板**

| | |
|---|---|
| 做什麼 | `OrderCreatedEmailPayload` 從三欄加上金額快照;寄送時**優先用 payload**,payload 沒有(舊列)才走現查 |
| 客人感覺得到什麼 | ⛔ ~~信上金額 = **他付款那一刻**的金額~~ ⟦審A⟧ 字面不準:快照是 **cron 入列當下**取的(≤5 分)。它**等於**付款後那份,依據是收款閘 —— 有 `order_payments` 就拒改價(`20260909080000:181-188`),而 repo 裡改金額欄的寫入只有那一支 ⇒ 付款後金額不會再變。✅ 改寫:**信上金額 = 入列當下、也就是付款後已不可再改的那一份** |
| 資料來源 | 🔴 **原樣帶,不重算**(照前例 :383)。重算 = 第二個來源 ⇒ 兩份會漂 |
| 快照從哪讀 | ⟦審A MF1 / 審B MF3⟧ 🔴 **原 plan 沒寫,而掃描 view `pcm_order_created_email_pending` 零金額零品項**(`20260907230000:70-79`)。✅ **入列時呼叫【同一支】`SupabasePaidEmailContextAdapter.loadPaidContext(orderId)`** 取快照 —— 零新查詢、零新 select(經銷價那條正面白名單 `:7-11` 不會被第二份 select 繞過)。它回 `unavailable` / 品項被截斷 / 0 項 ⇒ **照今天入列 v1(不帶快照)**,寄送端既有的 fail-closed 與死信告警照舊 |
| 碰 schema | 🔵 **不用 migration** —— `email_outbox.payload` 是 `jsonb NOT NULL`,塞得進去。⟦審B⟧ 實查:DB 對 payload 只有 `email_outbox_payload_is_object`,沒有 trigger / view 讀 `event_version`;而上一格讓「快照從哪讀」也不需要改 view ⇒ **這一格成立** |
| 碰什麼 | `IEmailOutbox.ts` 型別 · `order-email-assembly.ts` builder · `SupabaseEmailOutboxAdapter.ts` 的 switch · **入列端(enqueue 前呼叫 `loadPaidContext`)** · `sweep-email-outbox.ts` 的讀取端 · `SupabasePaidEmailContextAdapter.ts`(寄送端退成 v1 的 fallback) |
| HTML / 純文字 / PDF | ⟦審A MF2⟧ 🔴 v2 路徑要先把 payload **物化成【一個】`PaidEmailContext`**,再同時餵 HTML(`sweep-email-outbox.ts:2031-2036`)與純文字(`:2145`)—— 只接 HTML 的話兩份各有來源。PDF:今天信**從來沒附 PDF**(`hasPdfAttachment` 未曾傳 true)⇒ §8b ⑥ 今天 N/A,接 PDF 那天只准吃同一個物件 |
| 取消的單還寄不寄 | ⟦審B MF4⟧ 原 plan 沒寫。✅ 實查:寄送前的逐封閘對 `order_created` **不經過讀金額那支**,自己問 `cancelled_at IS NOT NULL` 或已退款(`sweep-email-outbox.ts:1522-1524`、`SupabaseIneligibleOrderEmailScannerAdapter.ts:15`)⇒ **v2 跳過現查也擋得住**。差別只在終態碼從 `order_ineligible_at_send` 變 `order_ineligible` |
| **它會不會叫** | 見 §5 —— **預設不會,而有一格可以讓它叫** |
| rollback | 見 §6 |

**🔴 版本號要跳:`event_version: 1 → 2`。** 而**讀取端必須同時吃兩版**:
```
payload.event_version = 2 且有金額 ⇒ 用 payload(凍住的)
否則(舊列 / 版本 1)              ⇒ 走今天的現查路徑, 行為逐位元不變
```
⇒ 📌 **佇列裡還沒寄的舊列不會壞,而那正是「不要一次切換」的理由。**

### 🔴 而「凍幾個欄」是這一版最大的未決,`a2` 2026-09-11 打回來的

```
匯款信凍進 payload 的      = 2 個(total · balance_due)
付款信【select 回來的】金額 = 6 欄 + 每一列品項
  Adapter :107 逐字  subtotal, shipping_fee, discount_total, total, tax_total, cancelled_at
  Adapter :157 逐字  order_items(variant_sku, quantity, line_total, product_snapshot)
```

🛑 **⇒「照匯款信那條線做」只夠凍住 `total`。**
🔴 **只凍 `total` 而其餘欄位與品項仍現查 ⇒ 信上會出現【凍住的總額】配【現查的明細】,
而它們加起來不等於那個總額。**
📌 **那比「金額不準」更難查** —— 客人看到一封**自己跟自己對不起來**的信,而每個數字各自都有來源。

### ✅ 而樣板實況回來了(`13` 2026-09-11 開 `packages/use-cases/src/paid-email-html.ts`,671 行)

⛔ ~~六欄~~ **是【七欄】** —— `a2` 漏了 `display_id`。逐欄實況:

```
display_id      印   兩處(:607 訂單編號 · :622 正文再出現一次)
subtotal        印   :531 而標籤是 subtotalLabelOf('小計', taxTotal) ⇒ 🔴 標籤隨稅變
shipping_fee    印   :423 **0 也照印**(理由逐字「免運是客人想確認的一件事」)
discount_total  印   :345 有值才印, 負號是樣板加的
tax_total       印   :415 有值才印 —— 🔴 而它【同時】改 subtotal 那一列的標籤
total           印   :541 22px 粗體
cancelled_at    🔴 **查了不印** —— adapter :104 逐字「它不進信裡, 只用來判這封信還該不該寄」
品項            variant_sku 印 · quantity 印 · line_total 印
                🔴 **product_snapshot 整欄不印 —— 只取裡面的 `title`**(snapshotTitle() ⇒ :309 印 l.title)
```

📌 **⇒ 「`select` 撈了什麼 ≠ 樣板印了什麼」在這裡實測到兩次**:`cancelled_at` 撈了不印;
`product_snapshot` 撈了整包而只用一個 `title`。

### 🔴🔴 而那五個數是【一組】,不可分割 —— 凍-A 因此出局

```
DB 層    CHECK (total = subtotal + shipping_fee - discount_total + tax_total)
         約束名 orders_total_balances ⇒ 🎯 一列不平衡的訂單在 DB 上【寫不進去】
樣板層   :396 orderAmountsBalance(...) ⇒ 加不起來 ⇒ 🔴 **品項表 + 金額區整段不印, 而信照寄**
         理由逐字「一張看不到明細的帳, 比一張兜不攏的帳好。」
```

⇒ 🛑 **⇒ 挑著凍會出【兩種】事,不是一種:**

```
甲  凍一部分 + 現查一部分 ⇒ 兜不攏 ⇒ 那道判斷成立 ⇒ 客人收到一封
    【沒有明細也沒有金額】的付款確認信。**它不會錯, 它是空的。**
乙  🔴 而更糟的是它們【剛好平衡】的那一天 ⇒ 放行 ⇒ 客人收到一張
    **算式成立、而那個組合【從來不存在於任何一個時刻】的帳。**
```

**⇒ 剩下兩個選項,而 `product_snapshot` 那條紅線已經消失(見 §4b):**

```
⛔ 凍-A  只凍 total      **刪除。** 不是「不推薦」—— 它【必然】命中甲或乙
🟡 凍-B  凍五個數(subtotal · shipping_fee · discount_total · tax_total · total)
         🔴 而品項每列 line_total 仍現查 ⇒ 品項小計加起來可能 ≠ 凍住的 subtotal
         ⇒ 📌 **同一個病,退到下一層** —— 我不推薦
🟢 凍-C  凍五個數 + 每列(variant_sku · quantity · line_total · title)
         ⇒ 整封信自洽, 而 title 只凍字串不凍整包 ⇒ 不踩 PII 防線
         ⇒ **我推薦這一個**
```

**🔵 哪些【不】凍(照前例那條線判):**
```
凍   六個金額欄 + 每列小計       ← 它們是「當時是多少」
不凍 收件人信箱                  ← 後台可以改客人信箱(Sean 0908 拍甲), 改了要寄到新的
⛔ ~~不凍 品名 / 規格 ← 它們是描述~~ ⟦審B MF1⟧ 與凍-C「每列 title」自相矛盾, 已刪
```
✅ **⟦審A Q7 / 審B MF1⟧ 品名(`title`)要凍 —— 而凍它不改變客人看到的東西**:
信上的品名今天就來自 `order_items.product_snapshot.title`(下單當下的快照),而 repo 裡**沒有任何
`product_snapshot =` 寫入**(審A rg 零命中)⇒ 商品改名本來就不影響信。凍它只是讓每列四欄**同一次讀**。
🔴 **而它是自由文字 ⇒ 見 §10 ③ 的 PII 處置(截長度 + 登記成例外)。**

---

## 4b. ✅ `product_snapshot` 那條紅線 —— **已解除,不必端 Sean**

> ✅ **`13` 2026-09-11 開樣板證實:`product_snapshot` 整欄不印,樣板只用 `snapshotTitle()` 取出來的
> `title`(`paid-email-html.ts:309` 印 `l.title`;adapter 那半 `SupabasePaidEmailContextAdapter.ts:84-88`
> 逐字「白名單三欄之一」)。**
> ⇒ 🎯 **⇒ 只凍那個 `title` 字串,不碰整包 jsonb ⇒ 沒有商品資料落表 ⇒ 這條紅線消失。**
> 🔵 **這一題本來要端 Sean,現在不用了** —— 而讓它消失的是「去讀樣板」,不是「想清楚」。
>
> 🛑 **下面那一整段是【問題還在時】的分析,原樣留著不刪** ——
> 它記著這條紅線長什麼樣,而下一個想把整包 jsonb 塞進 payload 的人要在這裡撞到它。

### ⛔ 以下已解除(2026-09-11),留存

凍-C 若連每列小計一起凍,最自然的做法會把品項那一段整包帶進去,
而 `order_items` 那一段的 select 裡有 **`product_snapshot`**(Adapter :157)。

🛑 **把 `product_snapshot` 寫進 `email_outbox.payload` = 把商品資料落表,
而那直接踩 `order-email-assembly.ts:5-13` 那條防線的字面。**

```
那條防線擋的是   一次 DTO spread 就把 email / 電話 / 地址永久複製進表
product_snapshot 是什麼  order_items 上的商品當時樣貌(jsonb)
🔴 而它是【整包 jsonb】—— 我沒有量過它裡面有幾個鍵、有沒有夾到任何客人欄位
```

⇒ 🛑 **⇒ 這一格我不判,也不建議做法。兩個理由:**
1. **它是「要不要再放寬一次 PII 防線」,那是 Sean 的球,不是 plan 的球。**
2. 🔴 **而在問他之前要先量一件事:`product_snapshot` 裡到底有什麼。**
   ⇒ 今天 `SupabasePaidEmailContextAdapter.ts:84-88` 只從它取一個 `title`(白名單三欄之一)
   ⇒ 📌 **⇒ 如果信上只要 `title`,那就只凍 `title`,根本不必碰整包。**
   ⇒ ⇒ **這很可能讓這一題直接消失,而那是最省的結果。要我去量就說一聲。**

---

## 5. 🔴 壞法,與「它會不會叫」

> ⛔ **壞法① 我第一版寫錯了,2026-09-11 `13` 開樣板打回來。舊字面留刪除線:**
> ⛔ ~~「🟡 **可以讓它叫**:落表前斷言 `total = subtotal + shipping_fee - discount_total + tax_total`
> (那正是 `orders_total_balances` 的現行等式)⇒ 不相等就不入列」~~
>
> 🔴 **為什麼錯**:凍下來的那一組數**來自同一列 `orders`,而那一列本來就過了那道 CHECK**
> ⇒ 📌 **它們之間永遠平衡 ⇒ 那個斷言【恆為真】⇒ 它什麼都沒守。**
> ⇒ 🛑 **一道永遠不會紅的斷言,比沒有斷言更糟** —— 它會讓下一個人以為這一格有人看著。

```
壞法①  金額凍錯欄位(凍一部分 + 現查一部分)
       ⇒ 兩種結局, 而【兩種都不會通知我們】:
         甲 兜不攏 ⇒ paid-email-html.ts:396 那道 orderAmountsBalance 成立
            ⇒ 🔴 **品項表 + 金額區整段不印, 而信照寄**
            ⇒ 客人收到一封【沒有明細也沒有金額】的付款確認信。**它不會錯, 它是空的。**
         乙 🔴 剛好平衡 ⇒ 放行 ⇒ 客人收到一張算式成立、
            而那個組合**從來不存在於任何一個時刻**的帳
       它會不會叫  🔴 **不會。** 甲 只是少印給客人看, 我們這端零訊號;乙 連少印都沒有
       ⇒ 🛑 **唯一的防法是【不要挑著凍】** —— 五個數 + 每列當一組, 見 §4 的凍-C

壞法②  讀取端沒吃到 payload, 靜靜走回現查
       ⇒ 做了等於沒做, 而畫面完全正常
       它會不會叫  🔴 **預設不會。** 要它叫得加一格:
                   version=2 而讀取端走了 fallback ⇒ 記一筆 error(不是 warn)

壞法③  dedup_key 那一格(§3)
       ⇒ 症狀是【永久漏信】, 比金額不準嚴重
       它會不會叫  🔴 **不會** —— 撞唯一鍵那一刻看起來就像「這封信已經排過了」

壞法④  凍了不該凍的(例如凍了收件人信箱)
       ⇒ 後台改了客人信箱, 而信還是寄到舊的
       它會不會叫  🔴 **不會**, 而且**寄出去就收不回來**
```

🎯 **⛔ ~~四個壞法,三個是安靜的~~ ⇒ 訂正:【四個全部是安靜的】,而我原本以為有守門的那一個沒有。**
📌 **⇒ 這就是 Sean 要「多重對抗審查」的理由,而他是對的。**

### 🔴🔴 而碼自己寫了一句,它是本 plan 最重要的一句,原文照抄

`packages/use-cases/src/paid-email-html.ts:358-360` 與 `:386-390` 逐字:

```
🔴 **閘守【資料的一致】, 測試守【印出來的東西】—— 兩個機制【不可互相冒充】。**
   **renderer 少印一項 ⇒ 資料四數照樣平衡 ⇒ 本閘不會叫**;攔那個的是測試。
   ⇒ 📌 **一道閘的說明若把測試的功勞算進來, 下一個人會刪掉測試而以為閘還在保護他。**
```

⇒ 🎯 **⇒ 那道 `orderAmountsBalance` 守的是【資料彼此一致】,不守【印出來的東西】。**
⇒ ⇒ 🛑 **⇒ 它不是「凍金額」的安全網 —— 上面壞法①的乙那一種,它放行。**
📌 **而我第一版正好犯了它警告的那件事:把一道閘的射程寫得比它實際大。**

---

## 6. rollback

```
碼      一顆 revert。payload 多帶幾個鍵而讀取端不看它 ⇒ 行為回到今天
資料    🔵 **零回填** —— 已經落表的 payload 多幾個鍵不會壞任何東西
        (`email_outbox_payload_is_object` 那道 CHECK 只驗它是不是 object)
佇列    🔴 **而 revert 的時機有一格**:version=2 已入列而還沒寄的那幾封,
        revert 之後讀取端不認得 version 2 ⇒ 走 fallback 現查 ⇒ **行為 = 今天**
        ⇒ ✅ 所以 revert 是安全的, 不會卡住任何一封信
```

---

## 7. 🔴 「多重對抗審查」—— 待確認,而審查要審什麼

✅ **已答:Sean 拍「乙:兩個不同角度各一輪」(`docs/handoff/CURRENT.md` 存檔點 #3)。**
⇒ 2026-09-11 窗 B 已跑完:角度 A 錢與寄信正確性、角度 B 權限 / 落表 / 遷移 / 回捲,都用 Fable 5.1 唯讀。結論在 §10。
⛔ ~~**Sean 逐字「用多重對抗審查」。而「多重是幾輪 / 幾個角度」他沒說。**~~(下面那題留存)

```
Q: 「多重對抗審查」要怎麼跑?
A: 甲 = codex 兩輪(R1 修完再 R2), 同一把尺跑兩遍
   乙 = 兩個不同角度各一輪 —— codex 一輪(跨層契約/金流) + adversarial-reviewer 一輪(盲審)
```
🔵 **我推薦乙,而這是推論不是他說的**:他知道抽錯的代價是「信上金額永遠對不起來」,
而那種錯**同一把尺跑兩遍抓不到**——第二遍會看到第一遍看過的東西。
**標明是推論,請 Sean 自己拍。**

**而不管幾輪,審查要審的是這 ⛔ ~~五~~ **七**題(不要只寫「會跑 codex」):**
> 🔵 ⑥⑦ 是 2026-09-11 `13` 開樣板之後加的,全文在 §8b。**數字一起改,免得下一個人只審五題。**
```
① dedup_key 那一格(§3)—— 加了快照之後有沒有「重新入列」的路? 有就是永久漏信
② 讀取端吃兩版有沒有吃對 —— version=2 走 payload / 其餘走現查, 而中間態呢?
③ 凍的欄位集合對不對 —— 少一欄(如 tax_total)信上會自己對不起來
④ 🔴 哪些【不該】凍 —— 收件人信箱、品名, 而品名那一題今天沒有答案
⑤ 落表前那道加總斷言, 是不是與 orders_total_balances 現行等式【同一組】
   (2026-09-10 唯讀實查:total = subtotal + shipping_fee - discount_total + tax_total)
```

---

## 8. 🔴 零元單那一格 —— 我判它**不在** Q7 射程內,而理由要看

我今晚量到的:

```
settle_zero_total_order(20260901030000:1034-1048)翻 paid 而 :1048 逐字「✅ **不寫 order_payments**」
⇒ 改價閘的判準是 `count(*) FROM order_payments > 0`(20260909080000:181-182)
⇒ 🔴 零元單穿過那道閘 ⇒ 它 paid 了、信也寄了, 而改價的框還開著
🔵 今天被【折扣閘】接住(零元單一律來自全額折抵券 ⇒ discount_total > 0)
🛑 而那是巧合不是設計 —— 同一句 COMMENT(:1058)逐字說「儲值金那天走同一支」,
   而儲值金付掉的零元單, discount_total 沒有理由是非零
```

⟦審A⟧ 🔴 **補一格原本沒量的:`20260901030000`(`settle_zero_total_order` 所在)在 `supabase/APPLIED.tsv` 零記錄**
(`latest-definition-of.sh settle_zero_total_order` ⇒ `live = 查無`)⇒ **正式庫今天很可能根本沒有這條路。**
另審A 撿到一種兩道閘都穿的:`coupon_id` 非空而 `discount_total = 0`(免運券配 0 元小計)。與本 plan 無關, 一併交主視窗。

**我的判斷:不在射程內,分兩句:**

1. **Q7 做完之後,零元單那條路【也被蓋住了】** —— 因為金額是入列當下凍的,
   而不管那張單後來能不能改價,**信上印的都是當時那一份**。
   ⇒ 📌 **Q7 治的是「信上的數字」,而零元單那格是「單子能不能被改」——兩件不同的事,
   而 Q7 的修法剛好讓前者不再依賴後者。**
2. 🔴 **但零元單那個閘的洞【本身還在】**,它只是不再從付款信這條路漏出來。
   ⇒ **那該是自己的一列,不是 Q7 的一格。** 要不要開,請主視窗判。

---

## 8b. 🔴 兩格【沒有人查過】—— `13` 2026-09-11 自標,原樣帶進來

```
① PDF 附件那一份
   paid-email-html.ts 的 ⚠️ 段逐字:「hasPdfAttachment 為真時信上仍寫『訂單明細 PDF 已附在這封信裡』,
   而**那份 PDF 走的是另一條 render 路徑, 有沒有同樣的病本窗【未查】**。」
   ⇒ 🔴 Q7 凍了金額之後, **那份 PDF 有沒有吃到同一份快照, 沒有人知道**

② 純文字那一份
   同檔 :370 逐字:那天兩份信會**各出一種病** —— 純文字那份整段不印, HTML 那份照印一張兜不攏的帳
   ⇒ 🔴 而**客人看到哪一份, 是他的收信軟體決定的**(sweep-email-outbox.ts:423 逐字)
   🔵 兩份**共用同一支判準函式**(orderAmountsBalance)✅ —— 而那支函式**沒讀渲染**
   ⇒ 📌 所以「判準一致」不等於「印出來一致」
```

🛑 **⇒ 這兩格要進 §7 的審查題目,而且它們是【新的】,不在我原本那五題裡:**
```
⑥ 凍下來的快照, PDF 那條 render 路徑有沒有吃到?
⑦ HTML 與純文字兩份, 拿到的是不是同一份快照?
```

---

⟦審A⟧ ✅ **⑥ 今天 N/A**:寄信從來沒附 PDF(sweep 的 `sendInput` 從未給 `attachments`、`hasPdfAttachment` 從未傳 true;
`statement.pdf/route.ts` 是會員頁另一條路)。**⑦ 由 §4 那一格「物化成一個 `PaidEmailContext` 同時餵兩份」收掉。**

---

## 9. 我沒做的

沒動碼、沒寫 SQL、沒 commit、沒 push、沒對正式庫寫一個字。
本檔是 plan,**等 Sean 批了才動手**,而動手之後還要跑 §7 那一輪審查才 commit。
⟦窗 B 2026-09-11⟧ plan 引的七支檔在 plan 寫完(11:05)之後 origin/dev 與主樹 dev 都沒動過;
`admin_update_order_item_amount` 最新一代仍是 `20260909080000`(`latest-definition-of.sh`)。

---

## 10. 兩輪審查結論,與怎麼收(2026-09-11 窗 B)

```
角度 A 錢與寄信正確性      Fable 5.1  VERDICT: PASS(附 2 條 must-fix)
角度 B 權限/落表/遷移/回捲  Fable 5.1  VERDICT: FAIL · 4 條 must-fix
⇒ 合併後 5 條(A1 與 B3 是同一件)。全部改在 plan, 沒寫碼。
```

| # | 哪一輪 | 問題(白話) | 怎麼收 |
|---|---|---|---|
| ① | A1 · B3 | 快照要從哪讀沒寫;掃描 view 零金額,照做的人不是改 view(= migration)就是另寫一份 select(經銷價白名單最容易破) | §4「快照從哪讀」:入列時呼叫**同一支** `loadPaidContext`;讀不到 / 截斷 / 0 項 ⇒ 入列 v1。兩次讀(表頭、品項)之間的一致性靠收款閘(付款後金額不可改);**另加一道入列前檢查:品項小計加總 ≠ subtotal ⇒ 不帶快照、入列 v1** —— 它不是 §5 那道「恆為真」,因為來源是兩次讀 |
| ② | A2 | HTML 印快照而純文字仍現查 ⇒ 兩份信各有來源 | §4「HTML / 純文字 / PDF」:先物化成一個 `PaidEmailContext`,同時餵兩份;PDF 今天不存在,接的那天也吃同一個 |
| ③ | B2 | 「title 只凍字串 ⇒ 不踩 PII」說太滿:手動單的 title 是員工手打(`20260824020000:346`),可能夾客人姓名 / 刻字,而 `email_outbox` 沒有清除機制 | **title 落表前截 120 字**,並在 `order-email-assembly.ts:5-13` 那條防線**登記成「自由文字例外 #2」**;防線改寫成判準而不是欄名清單:只收①事件時點已定的事實(金額、數量、料號、時戳)②描述性字串要具名來源 + 長度上限 ③禁客人識別欄(信箱 / 電話 / 地址 / 姓名 / 統編)④每加一欄就 bump `event_version` 並登記。🔵 背景:同一段字早就永久存在 `order_items` 裡;`email_outbox` 只有 service_role 讀得到(anon / authenticated / pcm_readonly 零 grant,後台死信頁不 select payload —— 審B 實查 migration 字面) |
| ④ | B1 | 凍-C 說凍 title,同節又說「不凍品名」 | §4 刪掉「不凍品名」, 改成「凍, 而且不改變客人看到的東西」(審A 實查:`product_snapshot` 從未被更新) |
| ⑤ | B4 | v2 跳過現查後,排隊中被取消的單會不會照寄 | §4「取消的單還寄不寄」:**不會** —— 逐封閘獨立問 `cancelled_at`(`sweep-email-outbox.ts:1522-1524`);只是終態碼不同。寫明 |

**nit(照收,寫進實作時要做的事,不另起一節)**
- 五個金額與每列 `quantity` / `line_total` 落表前加 `Number.isSafeInteger` 斷言(比照 `order-email-assembly.ts:252`,不要照抄匯款那支的 `number` 原樣)
- v2 payload 缺鍵 / 型別錯 ⇒ 當 `unavailable`(記 error、重試),**不靜默退現查**;只有 v1 或沒有 `event_version` 才走現查
- 品項超過 50 列:`loadPaidContext` 今天回截斷 ⇒ 依 ① 入列 v1,不帶半份快照
- `p3_seal` 是唯一允許事後合併進 `order_created` payload 的鍵(`20260905440000:225-226` 用 `payload || jsonb_build_object('p3_seal', …)`);實作時在 builder 註明
- 保留期:落表的金額與品名**跟 `email_outbox` 一樣沒有清除機制**(backlog #281)⇒ 是永久副本。寫給 Sean 知道,見 §11

**兩輪確認成立的(不用改)**
- `dedup_key` 維持 `orderId`:沒有「快照過期 ⇒ 重排」的路;`admin_requeue_dead_email` 只翻狀態不動 payload / 鍵;信箱變更重排是新列新快照,而付款後金額不變 ⇒ 不撞鍵(§3 的推論,審A 實查成立)
- rollback(§6)成立:讀取端對 `event_version` **零依賴**(`sweep-email-outbox.ts` 零命中),revert 後 v2 列走今天的路,不卡信
- 部署:寫入端與讀取端都在 storefront 的 `email-sweep`,同一個部署單位 ⇒ 不會一邊新一邊舊。**上線時點是 Sean FF `main` 那一刻,不是推 `dev`**
- 凍-C 欄位集合沒有漏:樣板實際用到的 `ctx` 欄 = discountTotal / lines / orderDisplayId / shippingFee / subtotal / taxTotal / total;純文字同四欄品項

---

## 11. 給 Sean 的題(白話)

> 背景一句:付款確認信上的金額,今天是「寄出那一刻」才去查的。平常 5 分鐘內寄出沒差;
> 但寄信服務出狀況時可能拖到 4 天後才寄,那時印的就是 4 天後查到的數字。
> 你 09-11 拍了「乙:要把金額存下來」。這一題是批**怎麼存**。

```
Q1:付款信要不要在「排進寄信佇列那一刻」,把整封信的金額和每一項商品存一份,之後寄出都印那一份?
    (存的是:小計、運費、折扣、稅、總額,加上每一項的料號、數量、小計、品名)
A:  甲 批,照這樣做(推薦)
       ⇒ 信上每個數字都來自同一刻, 加起來一定兜得起來
       ⇒ 不用改資料庫;出事時退回舊版一步就好, 不會卡住任何一封信
  | 乙 先不要, 再改
       ⇒ 今天真客人是 0, 不做也還沒有人受影響

Q2:品名是員工手打的時候(手動建單), 可能打進客人的名字或刻字內容。存進寄信紀錄之後會一直留著
    (寄信紀錄目前沒有自動清除)。品名要不要一起存?
A:  甲 一起存, 但只存前 120 個字(推薦)
       ⇒ 信上的品名跟訂單頁永遠一樣;這段字本來就已經存在訂單裡, 只多一份、而且只有系統讀得到
  | 乙 品名不存, 寄出時再去訂單查
       ⇒ 少存一份自由文字;代價是「一整封信同一刻」少了品名這一欄
```
