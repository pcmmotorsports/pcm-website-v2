# `#514` 出貨狀態欄 —— 偵察(不寫 plan)

> 2026-08-19 G2。主視窗交辦四格,**只偵察、先不寫 plan**,理由是「先確定它是【UI 一行】還是【要動 DB】」。
> 零 code 改動。所有座標當場開檔。

## 一句話結論

**短期那半【已經修好了,而且在 dev 上】;長期那半【沒動】,而它今天【沒有活的傷害】,只有【殘留的可再犯面】。**

---

## 格 1:「13/13 恆假」今天還成不成立?

### ✅ 顯示面:**已修,而且我驗過它在 dev 上**
```
git merge-base --is-ancestor 5e63de69 HEAD ⇒ **是**(短期修法那顆在 dev)
⚠️ 條目自己寫「本條目所在的分支(void-readers)沒有那顆 commit」—— 那是【當時】的話,今天已經不成立
```
`git show 5e63de69` 逐字:
```
- <Field label='出貨狀態' value={FULFILLMENT_STATUS_LABEL[detail.fulfillmentStatus]} />
+ (改讀 GOODS_AXIS_LABEL[orderDetailGoodsAxis(detail)])
```
而客戶頁那一欄:`grep -c "fulfillmentStatus\|出貨狀態" customer-detail-sections.tsx` ⇒ **0**(整欄拿掉了)。

> ### ⚠️ 2026-08-19 G2 自查:**上面那把尺比它下的結論窄,而結論僥倖是對的**
> 那個 pattern 只認 **camelCase 的 `fulfillmentStatus`** 與**中文「出貨狀態」**四個字 ——
> 🔴 **它抓不到 snake_case 的 `fulfillment_status`,而那個字面就在同一支檔的 `:64`。**
> ⇒ 換成不分大小寫、放寬到 `fulfillment|出貨` 重量:**3 處命中,不是 0。**
> ```
> :63  {/* 🔴🔴 `#514`:「出貨」那一欄 2026-08-15 **拿掉**,不是忘了畫。
> :64      它讀的是 `orders.fulfillment_status` —— …
> :90  {/* `#514`:出貨欄已移除,理由見表頭註解。 */}
> ```
> ✅ **而結論仍然成立**:那 3 處**全部是【解釋這一欄為什麼被拿掉】的註解**,
> 不是還活著的渲染 ⇒ **那一欄確實不在了。**
> 🔴 **但這個「對」不是那把尺掙來的** —— 它回 0 的理由裡有一半是它瞎(漏 snake_case),
> 只是這一次瞎掉的那一半剛好也不是活的渲染。
> ⇒ 📌 **記在這裡的用途:不要把這一行當成「這種量法可以」的先例。**
>   同族母條 `docs/patterns/guard-and-instrument-traps.md`「掃描字集比宣稱窄」。
> ✅ 順帶重量 `:104` 那一發(`…435-shipping-rpc-audit-plan.md`):
>   區分大小寫 / 不分大小寫 / 加中文 **三種尺都是 0** ⇒ 那一格的 0 是真的。

### ⚠️ 資料面:**我量不到,而我要說清楚為什麼**
```
原症狀是 `select fulfillment_status, count(*) from orders group by 1` ⇒ notOrdered 13
🔴 我沒有 DB access;而【後台現在也沒有任何頁面讀那一欄】⇒ 從 UI 也繞不出來
   (訂單列表的篩選在 #484a A2 之後改吃 goods_axis,不再吃 fulfillment_status)
⇒ **我能說的只有「零 writer」這一面**:條目查過全 migrations 零寫入者,
   而我複驗了應用層 —— 見格 3 那張表。
⇒ **「今天還是不是 13/13」需要一句 SQL,那在 Sean 手上。**
   ⚠️ 而**那個數字對處置沒有影響**:零 writer ⇒ 它只會停在 DEFAULT,不會自己變對。
```

---

## 格 2:員工現在看到什麼?而「恆假」與「功能沒做」在畫面上長得一樣嗎?

```
明細頁   那一格還在,而**資料換來源了**(貨品軸真相)
         🔴 而 5e63de69 自己寫了一句很重要的:
           「**修完之後多數單仍顯示『未訂貨』,而那是對的**」——正式庫多數單還沒採購
         ⇒ 🔴 **修好前後,畫面上多數單的字面【一樣】** —— 因為文案表逐字相同,
           變的只有資料從哪來。**那正是「恆假」與「碰巧都對」長得一樣的那個形狀。**
客戶頁   那一欄**不見了**(不是顯示錯的值,是拿掉)
```
⇒ **回答主視窗那一問:是的,長得一樣,而且這一例是最乾淨的示範** ——
**修法讓畫面幾乎沒變,而正確性從 0 變成 1。**

---

## 格 3:修法在哪一層?會不會要 migration?

### 🔴 我找到一個條目沒寫的:**顧客站仍然把那個欄位傳進顯示函式**
```
apps/storefront/src/components/account/tabs/OrdersTab.tsx:71
apps/storefront/src/components/account/tabs/OverviewTab.tsx:153
  兩處都是 orderStatusLabel(o.paymentStatus, o.fulfillmentStatus)
```
**而它今天【沒有傷害】,理由要開檔才看得到**:
```
apps/storefront/src/lib/orders/order-display.ts:54-56
  export function orderStatusLabel(payment: PaymentStatus, _fulfillment: FulfillmentStatus)
  ⇒ 第二個參數叫 `_fulfillment`(底線 = 刻意不用),switch 只看 payment
同檔 :41-42 逐字寫了為什麼留著:
  「簽章保留雙參數(消費端 OrdersTab/OverviewTab 零改動;`fulfillmentStatus` 契約收縮 = A9s 片、
   依 DAG 在本片之後 —— **先砍型別會讓仍在讀的 TSX 編譯斷**)」
```
⇒ **顧客那一面沒有在讀死欄位的值,只是在傳它。** 這一格是**殘留**,不是 bug。

### 殘留面的分母(長期那半要處理的東西)
```
mapper 直送     packages/adapters/src/supabase/mappers/order.ts:188 與 :373
                fulfillmentStatus: row.fulfillment_status
                ⚠️ 條目寫的是 `:180` ⇒ **行號已漂**(引用前要重 grep)
domain 型別     packages/domain/src/order/types.ts 有 4 處欄位宣告 + order.ts 的預設值
                而 types.ts:310 逐字「`#484a` 片 A2:`fulfillmentStatus` **已移除**(不是忘了列)」
                ⇒ **列表篩選那一軸已經退場了**,剩下的是明細/摘要型別
```

### ⇒ 分層答案
```
UI 一行?      ❌ 短期那半已經做完了,沒有「一行」可做
要動 DB?      ⚠️ **不一定** —— 長期那半有兩條路,成本差很多:
  路 A 只從【型別與 mapper】移除,DB 欄位留著不動
       ⇒ 零 migration、零 apply、不進佇列
       ⇒ 而 DB 裡仍留著一個 DEFAULT 'notOrdered' 的死欄位(可接受?那是取捨)
  路 B 連 DB 欄位一起 DROP
       ⇒ 🔴 碰 schema ⇒ 鐵則 12③ ⇒ 進 Sean 的 apply 佇列
       ⇒ 而 DROP 之前要先確定沒有任何東西讀它(路 A 是它的前置)
⇒ 🔴 **路 A 是路 B 的前置,而路 A 自己就有價值**(它讓「再被引用一次」變成不可能)
⇒ **所以這一條【現在不必進 apply 佇列】** —— 那是主視窗要的那格答案。
```
⚠️ 而路 A 要照那條**documented DAG** 做:`order-display.ts:41-42` 逐字
「**先砍型別會讓仍在讀的 TSX 編譯斷**」⇒ 順序是「先改 TSX 的呼叫端 → 再收簽章 → 再砍型別」。

---

## 格 4:與 `#435`(出貨稽核)撞不撞?

```
grep -c "fulfillment_status\|fulfillmentStatus" docs/specs/2026-08-19-435-shipping-rpc-audit-plan.md ⇒ **0**
#435 動的是三支出貨 RPC(create_shipment / add_shipment_items / mark_shipment_shipped)+ 稽核
```
⇒ **零交集,不撞。**
⚠️ 而**兩者都在「出貨」這個字底下** —— 這是本次唯一需要注意的地方:
**同一個詞底下的兩件事,分母不同。** `#435` 動的是**寫入路徑**,`#514` 動的是**一個沒有寫入路徑的死欄位**。

---

## 誠實揭示

```
· 「今天是不是還 13/13」我量不到(無 DB access,且已無 UI 讀那一欄)⇒ 需要一句 SQL,在 Sean 手上
  而我論證了【那個數字對處置沒有影響】—— 零 writer ⇒ 它不會自己變對
· 「零 writer」這一面是條目查的(全 migrations),我複驗的是【應用層】那一半,不是 migrations 那一半
· 路 A / 路 B 的成本我沒有拆到步驟級(未估)
· 我沒有開瀏覽器 —— 格 2 的畫面描述是讀 5e63de69 的 diff 與現行 code 得到的
```
