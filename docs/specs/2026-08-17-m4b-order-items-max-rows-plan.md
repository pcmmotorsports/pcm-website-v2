# Plan:訂單品項的 `max-rows` / 內嵌截斷修法(鐵則 8 ⇒ **等 Sean 批准,本檔零實作**)

> **狀態:等 Sean 批(鐵則 8:跨 3+ 檔 + 動查詢)。批准前一行 code 都不動。**
> **寫於 2026-08-17 夜。作者 = B 窗(真登入線),因 max-rows 屬查詢/資料層而排給本窗。**
> 🔴 **本檔每個數字旁邊都帶量法與範圍。表會被抄走,前後文不會。**

---

## §1 要改什麼(一句)

**把還在吃「內嵌 `order_items`」的三條路,改成頂層分頁查詢撈到盡** ——
內嵌那條被 `ORDER_ITEMS_EMBED_LIMIT = 200` 夾住,**而那個 200 正好落在正常業務的上緣**。

⚠️ **不是全部三條都要改成一樣的東西**,分級見 §3。

---

## §2 為什麼(這一節是理由,不是背景)

### 2-a 🔴 業務事實:一張單的品項**可能到 200 個** —— 而 code 的上限剛好就是 200

**Sean 逐字(業務事實)**:一張訂單品項**可能到 200 個**。
**code 現況(當場 grep,附行號)**:
```
packages/adapters/src/supabase/mappers/order.ts:407   export const ORDER_ITEMS_EMBED_LIMIT = 200;
packages/adapters/src/supabase/mappers/order.ts:873   itemsTruncated: row.order_items.length >= ORDER_ITEMS_EMBED_LIMIT,
packages/adapters/src/supabase/SupabaseOrderAdapter.ts:847  .limit(ORDER_ITEMS_EMBED_LIMIT, { referencedTable: 'order_items' })
```
⇒ **判定用 `>=`** ⇒ **恰好 200 項的單就已經被標成截斷** ⇒ **業務上緣就是斷點,不是未來風險。**

⛔ **本檔初稿在這裡引錯了行**:原寫 `:389`,而 `:389` 用的是
**`ADMIN_ORDER_LIST_ITEMS_EMBED_LIMIT`(值 = `500`,`:428`)** —— **是列表頁那顆,不是明細那顆。**
🔴 落筆後逐條複驗時當場抓到並更正。**留痕的理由**:這份 plan 的整個論證建立在「上限剛好是 200」上,
**引錯一個常數就會讓讀者去看錯的那一顆**,而兩顆的值不同(200 vs 500)、母體也不同。
📎 同一支檔裡有**三顆**長得很像的常數(`:407`=200 / `:428`=500 / `:438`=500)⇒ **抄行號比抄名字更容易錯。**

🔴🔴 **這個 200 是【業務事實】,不是【現況量測】。**
Sean 同日另一句逐字:「**現在沒有正式的訂單,都還沒對外開放使用,所有都是我們自己測試的。**」
⇒ **今天去庫裡量,量不到 200 項的單**(庫內都是測試單)。
⇒ **不要因為「庫裡沒有」就判這條不急** —— 那會把「還沒發生」讀成「不會發生」。
⚠️ 反過來也要誠實:**本檔沒有「正式庫今天有幾張單超過 N 項」的數字**,因為那個母體現在是空的。

### 2-b 🔴🔴 「A 會餵壞 B」—— 只修品項那半等於沒修

**形狀**:品項清單(A)被 200 夾過之後,**那份被夾過的 id 集合**再被拿去查箱(B)。
```
訂單 300 項 → A 只拿到前 200 → 用這 200 個 id 去查箱
            → 第 201~300 項所在的【箱】根本不會被查到
            → 而那【不算截斷】：B 這半自己查得好好的，回傳完整
            ⇒ 零訊號。紙上少列品項，而紙看起來完全正常。
```
⇒ **兩半必須同一顆 commit 改。只改 B 的截斷偵測,救不了被 A 餵壞的那部分。**

✅ **這條在【出貨單】那一條路上已經解掉了**(不是本檔的功勞,先講清楚):
`apps/admin/src/app/print/orders/[id]/shipping/[shipmentId]/page.tsx:54-61`
逐字寫著「品項改走頂層分頁查詢撈到盡(`Q-C18` 甲,Sean 2026-08-17 批)」,
並在 `:57-60` 明寫它同時解掉這條連鎖。**⇒ 該路徑不在本檔範圍,不要重做。**

### 2-c V-041 量測:內嵌**受** `db-max-rows` 管,而且**顯式 embed limit 也會被夾**

🔴🔴 **引用這段時,下面三條範圍標籤一個字都不能拿掉**(逐字取自 `scripts/v041-embed-max-rows-probe.sh:4-7`):
> · 量到的是【本機這一版 PostgREST 的行為】,不是 Supabase 上的行為。
> · 本機 `db-max-rows` 是【我自己設的 100】,與正式站 Dashboard 的 **1000** 是【兩個不同的東西】,**不互相引用**。
> · 「本機量到 X」不得寫成「線上是 X」。

**量到的結論**:**內嵌【受】`db-max-rows` 管**,且**寫了顯式 embed limit 也會被夾**(要 200 只拿到 100)。
**環境**:本機 / PostgREST 14.16 / PG 17.10 / `db-max-rows=100`(自設)/ 2026-08-17。
**可重跑**:`bash scripts/v041-embed-max-rows-probe.sh`
⚠️ **production 的 PostgREST 版本未比對。**

⇒ **對本檔的意義**:`ORDER_ITEMS_EMBED_LIMIT = 200` **不是唯一的天花板** ——
它上面還有一個伺服器層的 `max-rows`,而**那一層的截斷 `itemsTruncated` 看不見**
(`order.ts:404-405` 自己就寫著這個殘餘風險,逐字「若專案 `max-rows` 日後被設到低於本值,
截斷會發生在那個更低的數字上而本判定看不見」)。

---

## §3 影響面(哪三條路、各自該怎麼改)

**還在吃內嵌 `detail.items` 的非測試呼叫點(當場 `git grep`,逐支開檔確認)**:

| # | 路徑 | 現況 | 建議修法 | 為什麼是這個等級 |
|---|---|---|---|---|
| **A** | `apps/admin/src/lib/shipping/shipment-candidates.ts:182` | `detail.items.map(...)` 產**建箱候選清單** | 🔴 **改頂層分頁**(同 `listOrderItemsForPrint` 那條路) | **最嚴重**:候選清單被夾 ⇒ **第 201 項之後【永遠沒有辦法被裝箱】** —— 不是顯示問題,是**功能上做不到** |
| **B** | `apps/admin/src/app/print/orders/[id]/picking/page.tsx:32,48` | 揀貨單讀 `findAdminOrderDetail` | 🔴 **改頂層分頁** | 揀貨單少列品項 ⇒ **員工照著揀,少揀的那些不會有人發現**(紙看起來正常) |
| **C** | `apps/admin/src/components/orders/order-detail-route.tsx:132` | 訂單明細頁 | ⚠️ **看 Sean 怎麼決定**,見 §4-Q2 | 明細頁**有** `itemsTruncated` 旗標可顯示 ⇒ 它至少**會叫**;但「會叫」與「看得到全部」是兩件事 |

**已經解掉、不在範圍**:`print/orders/[id]/shipping/[shipmentId]/page.tsx`(`Q-C18` 甲已批已做)。

**連動面**:
- `packages/adapters/src/supabase/SupabaseOrderAdapter.ts:927` `listOrderItemsForPrint` —— **現成的頂層分頁實作**,A/B 兩條沿用它即可(**不要再寫第二支**)。
  ⚠️ 它有 `PRINT_ORDER_ITEMS_MAX_PAGES = 50`(`SupabaseOrderAdapter.ts:425`)上限,
  且**命中時 throw、不回部分**(`:417-423` docstring)。
- 🔴 **port 那條我原本寫「估計不需要動」—— 查了之後【相反】,已更正**:
  `grep -n 'listOrderItemsForPrint' packages/ports/src/IOrderRepository.ts` ⇒ **零命中**。
  它**只存在於具體 adapter 上**(`SupabaseOrderAdapter.ts:927`),**沒有進任何 port 介面**。
  ⇒ **而目前之所以還能用,是因為 `getAdminOrderRepository()` 的回傳型別逐字是
    `SupabaseOrderAdapter`(`apps/admin/src/lib/orders/order-repository.ts:24`),不是介面。**
  ⇒ **這一點要在施工時決定**:沿用具體型別(最小改動,但 admin 直接綁 adapter)
    還是把方法提進 `IOrderRepository`(乾淨,但動 port = 動共用契約)。**本檔不替它拍板。**
  📎 **留痕的理由**:我第一版寫「估計不需要動 port」——**那是推的,不是查的**,
     而一個 grep 就推翻了它。**「估計」兩個字出現在 plan 裡就是一個該當場查掉的東西。**

---

## §4 Rollback、風險、要 Sean 拍的兩題

### Rollback
每條路各自獨立 ⇒ **一條一顆 commit,退就退那一顆**。
🔴 **而退回去 = 退回「靜默少列」那個狀態**,不是退回安全。這句要寫進每一顆的 commit body。

### 🔴 風險:改完之後**多打幾次 DB**
頂層分頁 = 每 N 列一次往返。`listOrderItemsForPrint` 的 docstring 逐字「**這個數只影響往返次數**」。
⇒ **建箱候選那條(A)是【互動路徑】不是列印路徑** —— 員工按下去要等。
**本檔未量**那條路徑現在的耗時,**缺的那道檢查 = 改前改後各測一次同一張單的回應時間。**

### 要拍的兩題

```
Q-maxrows-1：三條路要一次做完，還是先做 A（建箱候選）？
A: 甲｜先做 A 一條，驗完再排 B/C
     理由：A 是【功能上做不到】等級（第 201 項之後裝不了箱），B/C 是【顯示不全】等級
     代價：B（揀貨單）在那之前仍會少列，而紙看起來正常
   乙｜A+B 一起做（都是列印/出貨線，改法相同）
     理由：兩條共用 listOrderItemsForPrint，一起改省一次審查
     代價：一顆 commit 動兩條路，出事時不好切
🔴 我推薦甲，理由是【等級不同】：A 會讓員工做不到事，B 只是紙上少列。
   而甲的代價（B 暫時仍少列）在「還沒對外開放、都是自己測試」這個前提下可以承受。

Q-maxrows-2：訂單明細頁（C）要不要一起改成撈到盡？
A: 甲｜不改，保留 itemsTruncated 旗標 + 把警告做明顯
     理由：明細頁是【看】不是【做】，而且它是唯一會叫的那條
     代價：超過 200 項的單，明細頁永遠看不到全部
   乙｜改成撈到盡
     理由：一致性；使用者不必知道「這頁有上限」
     代價：明細頁是高頻互動頁，多次往返的成本最直接被感受到
🔴 我沒有推薦。理由是本檔【沒有量過】明細頁現在的回應時間，
   而這題的答案取決於那個數字 ⇒ 我不想用一個沒量過的東西替你決定。
```

---

## §5 本檔【沒做】與【未確認】(明寫)

- **零實作。** 本檔是 plan,鐵則 8 ⇒ 等 Sean 批。
- **正式庫今天沒有超過 200 項的單可量**(Sean:都還沒對外開放、都是測試單)⇒ 本檔**沒有現況母體數字**。
- **production 的 PostgREST 版本未比對**;V-041 的 `100` 是**本機自設**,與正式站的 `1000` **不互相引用**。
- **未量**:A/B/C 三條路現在各自的回應時間 ⇒ §4 那條風險是**定性的,不是定量的**。
- ~~**未逐字確認**:`IOrderRepository` 是否已足夠、不需要動 port。~~
  **⇒ 已查:port 內【零命中】,那支方法只在具體 adapter 上。** 詳 §3 連動面(含施工時要決定的兩條路)。
- **`listOrderItemsForPrint` 的 `MAX_PAGES` 命中時 throw** —— 本檔**沒有評估**「一張單多到觸及 MAX_PAGES」時使用者看到什麼。
