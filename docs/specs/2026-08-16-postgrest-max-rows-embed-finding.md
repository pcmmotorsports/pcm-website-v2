# PostgREST `max-rows` 對內嵌陣列的行為 —— 查證結果 + 我方缺口盤點

> **這份是【查證結果】,不是 plan,零程式改動。**
> **提出**:A 窗,2026-08-16。起因:我自己在片4c 的 commit body 裡寫下一個**未驗前提**,
> 並把「先驗它」列為 backlog 第一步。**現在驗完了,而結論與我的猜測相反。**

---

## 0. 🔴 結論(先講)

```
問     PostgREST 的 db-max-rows 套不套用到內嵌陣列（select=*,order_items(*)）？
答     套用。
       而且【內嵌被截斷時零訊號】—— 仍回 HTTP 200，Content-Range 不反映。
```

⇒ **我原本寫的「若不套用,列表那條缺口就消失」被推翻。缺口是真的,而且偵測不到。**

---

## 1. 證據(我親自抓過官方頁面覆核,不是只收 subagent 轉述)

**① 設定文件** — <https://docs.postgrest.org/en/latest/references/configuration.html>
> `A hard limit to the number of rows PostgREST will fetch from a view, table, or function.`

⚠️ **這句沒有明講含不含內嵌** —— 用詞是 `rows PostgREST will fetch`。單看它判不出來。

**② 官方 repo issue #2776** — <https://github.com/PostgREST/postgrest/issues/2776>
標題 `Provide an accurate way to determine if the returned response is complete or partial`,**狀態 open**。
> 「the `db-max-rows` setting **also applies to embedded tables** (which I understand is a very good thing, for safety reasons)」
> 「the HTTP 206 **doesn't apply to embedded resources** (when only the embedded resource is
>   effectively limited to `db-max-rows`, I always get an **HTTP 200**)」

### 🔴 證據層級要標清楚,不要當定案
上面兩句是 **issue 作者的敘述,不是 maintainer 的正式聲明**。
**但**:它在官方 repo、未被反駁,而且**整串討論的題目是「206 該不該也套到內嵌」——
不是「內嵌到底受不受限」** ⇒ **那個前提在討論裡是雙方接受的。**
⇒ **當高可信,不當定案。** 要定案得實測(見 §4)。

**③ 內嵌自己的 limit 語法** — <https://docs.postgrest.org/en/latest/references/api/resource_embedding.html>
官方範例 `actors.limit=10` / `actors.offset=2`;多層用點串。
supabase-js 對應 `.limit(n, { referencedTable: '…' })`。

**④ 反面證據**:**查無**任何官方來源說「內嵌不受 `max-rows` 限制」。
⚠️ **這條的「查無」範圍是【未窮舉】的** —— 實際查過的來源只有:
`docs.postgrest.org` 設定頁與 resource_embedding 頁、PostgREST repo 的 issue #2776 與 #2155、
`CHANGELOG.md`。**沒有查**:Supabase 官方文件全站、PostgREST discussions、Stack Overflow。
⇒ **標「在上述範圍內查無」,不是「不存在」。**
📎 CHANGELOG 有一條方向不同的排除:`[10.1.0]` 起 `max-rows` 不再套用到
POST/PATCH/PUT/DELETE 的回傳列(issue #2155)—— **GET + embedded 這條路徑沒有類似排除。**

---

## 2. 🔴 我方缺口盤點(先分類再報數)

**兩支列表 select 都含內嵌、都沒設任何 `referencedTable` 上限**:
```
ORDER_LIST_SELECT         內嵌 1 個：order_items(
ADMIN_ORDER_LIST_SELECT   內嵌 6 個：brands( customers( order_item_quantity_summary(
                                     order_items( product_variants( products(
數法  awk '/^export const <名> =/,/;$/' packages/adapters/src/supabase/SupabaseOrderAdapter.ts \
      | grep -oE '[a-z_]+\s*\(' | sort -u
```

**⚠️ 那 6 個【不是】6 個風險** —— 只有**陣列**型的內嵌會被 `max-rows` 砍。
**判別數法**(對每個表跑,看 `REFERENCES` 的方向):
```
指進來（別表 FK → 本表）= 一對多 = 陣列 = 有風險
  grep -rhoE '[a-z_]+ +uuid[^,]*REFERENCES +(public\.)?orders\(' supabase/migrations/*.sql | sort -u
指出去（本表 FK → 別表）= 多對一 = 單一物件 = 無風險
  grep -E 'REFERENCES' <orders 建表檔> | grep -E 'customer_user_id|variant'
```

| 內嵌 | FK 方向 | 形狀 | 有風險? |
|---|---|---|---|
| `order_items` | `order_items.order_id → orders`(**指進來**) | **陣列** | 🔴 **有** |
| `customers` | `orders.customer_user_id → customers`(指出去) | 物件 | 否 |
| `product_variants` | `order_items.variant_id → product_variants` | 物件 | 否 |
| `products` | `product_variants.product_id → products` | 物件 | 否 |
| `brands` | products → brands(指出去) | 物件 | 否 |
| `order_item_quantity_summary` | `order_id uuid PRIMARY KEY REFERENCES`(1:1) | 物件 | 否 |

**⇒ 真正的風險面 = `order_items(` 一個,而它在【兩支】select 裡都沒有上限。**

🔴 **我第一次跑分類時用了一條壞命令**:`... | sed 's/.*/被別表參照(一對多→陣列)/'`
—— **那個 `s/.*/…/` 對每一行無條件替換** ⇒ 六個表全印同一句「一對多→陣列」。
**那是假量測,而它的輸出看起來完全正常**(六行整齊、格式對、沒有錯誤訊息)。
⚠️ **它甚至不需要 grep 有命中就會印** —— 我把「工具的輸出」當成了「世界的狀態」。
⇒ 改成從 **FK 方向**判(`REFERENCES` 指進來 = 一對多 = 陣列),才得到上表。

**對照組:明細那支【有】設上限**,共 6 個
(`SupabaseOrderAdapter.ts` 搜 `referencedTable`,`findAdminOrderDetail` 內)
⇒ `order_notes` / `order_item_procurement` / `order_items`(200)/ `payment_charge_attempts`
/ `order_cancellations` / cancellation items。**明細沒問題,列表有。**

---

## 3. 影響:誰會因此顯示錯的東西

**列表的狀態膠囊** 走 `orderStatusView` → `orderGoodsAxis` → `goodsAxisOfLines(order.lines)`,
而 `goodsAxisOfLines` 三條判定都是 `.every(...)`
⇒ **`order_items` 被截斷時,看得見的子集全出貨就答「出貨完成」。**
📎 這與片4c 修掉的明細那條**是同一個病**,只是**列表這側沒有旗標可以裝閘**
(`AdminOrderSummary` 上零截斷欄位)。

**⚠️ 觸發門檻**:一張單的品項數要超過專案的 `max-rows`(repo 記載 production 實測 1000)。
⇒ **比明細那條(我方常數 200)難踩得多。**
🔴 **但「難踩」與「踩到會不會知道」是兩件事** —— 這一條**踩到零訊號**,
而明細那條**踩到會印「未知」**。⇒ **不可偵測性上更糟,觸發機率上更好。**

---

## 4. 建議的下一步(不是我決定)

```
① 最小修法：兩支 list select 各加一個 .limit(n, { referencedTable: 'order_items' })
   ⇒ 邊界從「伺服器的 max-rows」收回「我方常數」，與明細那支一致
   ⚠️ 但【只加 limit 不加旗標】= 把「不知道有沒有被截」變成「一定被截且仍不知道」
      ⇒ 要同時給 AdminOrderSummary 一個 itemsTruncated（動 domain 型別 ⇒ 鐵則 8）
② 或者：判定「一張單超過 1000 個品項」在 PCM 實務上不可能 ⇒ 登記為【已知且接受的殘餘風險】
   🔴 若走這條，殘餘風險【不能由我自宣接受】—— 要 Sean 說了才算（工作守則 R6）
```

**我的建議**:先問 Sean 一句「一張訂單的品項數有沒有可能破千」。
**是** ⇒ 走 ①(要寫 plan、中鐵則 8)。**否** ⇒ 走 ②,把理由與門檻寫進 code 註解就好。

---

## 5. 誠實缺口

- **我沒有實測。** 結論建立在官方文件 + 官方 repo issue 的**作者敘述**上。
  要實測得構造一張品項數超過 `max-rows` 的單並觀察回應,**我沒有那個環境**。
- **`max-rows` 的值(1000)是 repo 內記載的「production 實測」,我沒有重量。**
  它若被改小,門檻會跟著變低,而**本檔的「難踩」結論建立在那個 1000 上**。
- **我沒有查 storefront 那支 `ORDER_LIST_SELECT` 的消費端會不會受影響** ——
  只確認了它同樣沒設上限。它的下游做什麼,未查。

---

## 6. 🔴 實測補完(2026-08-18,W3;**純追加,上面一個字沒改**)

> **這一節關掉 §5 第一條誠實缺口的一半。** §5 逐字「**我沒有實測**…**我沒有那個環境**」——
> 那句在寫的當下為真;現在有人有那個環境了,所以把量到的補在這裡,**而不是留在一封信裡**。
> ⚠️ **§5 那段留著不刪**:它記著本檔前半的證據等級是「官方文件 + issue 作者敘述」,那件事沒有變。

### 6-a 本檔沒答的那一題:`max-rows` 是**每個內嵌陣列各自算**,還是**整份回應合計**?

**答案:per-array —— 每個內嵌陣列各自算,整份合計不受限。**

**量測環境(要跟著數字走,不可拆開引用)**
```
拋棄式 PG 55503 + PostgREST 3999（docs/runbooks/local-admin-with-real-data-probe.md）
db-max-rows 臨時設 5（跑完已還原 2000 並驗過，見 6-c）
2026-08-18 10:4x CST
🔴 這測的是【PostgREST 的行為】，不是【正式站的 db-max-rows 設定值】。兩件事分開。
```

**量具先表演兩個世界(正向對照在前,不是事後補的)**
```
A 正向對照 —— 先證明這個擺法看得見截斷
  一張 6 品項的單、max-rows=5
  GET /orders?select=display_id,order_items(id)&display_id=eq.PCM-2026-9099
  ⇒ 撈到品項 = 5        ✅ 看得見。所以下面那個「沒被砍」是真的沒被砍，不是量不到

B 主實驗
  三張單 × 4 品項（每張 4 < 5，合計 12 > 5）、max-rows=5
  GET /orders?select=display_id,order_items(id)&display_id=in.(9001,9002,9003)
  ⇒ 4 / 4 / 4       外層 3 張、內嵌合計 12
  ⇒ per-array。整份合計【沒有】被砍到 5
```

⇒ **對本檔 §4 的含義**:①與②兩條路**都還成立**,而「有一種看不見的合計截斷」這個更壞的可能
**被排除了**(在單層內嵌這個範圍內)。

⚠️ **射程限定**:只測了**單層內嵌**(`orders → order_items`)。
**巢狀兩層**(`orders → order_items → order_item_procurement`)會不會共用額度 —— **未測**。

### 6-b 順手量到的 `Content-Range` 形狀 —— **它是 `#634` 的【正向對照】,不是那個 NaN 的來源**

> 🔴 **這一小節的第一版寫錯,而且錯的方向會讓人撤掉守門,所以留痕不刪。**
> 原句逐字:~~「這個 `*` 就是 `parseInt('*')` ⇒ NaN 的來源」~~ **不成立。**
> 我(W3)量到 `*` 就接上了 NaN,**沒有回去開呼叫端與函式庫**確認它走的是哪一條。
> W4 同日獨立開檔核出同一件事,兩邊結論一致。

**量到的兩個世界(PostgREST 14.16,`db-max-rows` 臨時設 5)**
```
不帶 Prefer: count       HTTP 200 OK        Content-Range: 0-4/*
帶 Prefer: count=exact   HTTP 206 Partial   Content-Range: 0-4/6   ← 【已被 max-rows 砍】那一發
```
🔴 **第二行是關鍵:即使發生截斷,只要有要 count,回的仍是真數字、不是 `*`。**

**為什麼這是正向對照而不是佐證**(函式庫逐字,`postgrest-js@2.105.3`
`src/PostgrestBuilder.ts:483-486`):
```js
const countHeader = this.headers.get('Prefer')?.match(/count=(exact|planned|estimated)/)
const contentRange = res.headers.get('content-range')?.split('/')
if (countHeader && contentRange && contentRange.length > 1) {
  count = parseInt(contentRange[1])
}
```
⇒ **`parseInt` 只在客戶端有送 `Prefer: count=…` 時才跑。**
```
不帶 Prefer ⇒ 拿到 `*`，但 parseInt 根本沒被呼叫 ⇒ count = null，【不是 NaN】
帶 count    ⇒ parseInt('6') ⇒ 6，【也不是 NaN】
⇒ 🔴 上面量到的兩個世界，沒有一個產得出 NaN；
   而 `*` 出現的那個世界，正好就是 parseInt 不會執行的那個世界。
```
**NaN 要兩件事同時成立**:①客戶端**有送** `Prefer: count`(我方 `SupabaseOrderAdapter`
`#pageOrderItems` 在 `page === 0` 恆送)②**而回應的分母不是數字**(被代理 / CDN / 錯誤路徑
換成 `*` 或拿掉)。⇒ `#634` 條目裡的「觸發條件**未確認**」**應該更硬,不是更軟。**

⚠️ **這不動搖要不要留守門** —— `Number.isFinite(count)` 擋的是「拿不到數字」這個**狀態**,
而理由是**失敗方向**(`reportedTotal` 的定義是「一個信得過的總數」,`NaN` 定義上不是),
**不是可達性**。🔴 **拿可達性當修法理由的話,下一個人一驗會判它不成立、然後把守門撤掉。**

**另一件仍然成立、而且值得單獨記住的**:
**不帶 `count` 時狀態碼是 `200` 不是 `206`** ⇒ 「拿狀態碼判有沒有截斷」在**沒帶 count 的呼叫上恆判成沒截斷**
—— 那是**一格恆真守門的配方**。⚠️ 反過來說 `206` 也**只有**帶 `Prefer: count=exact` 時才出現
⇒ 要拿它當判準得先查呼叫端有沒有帶。**逐一呼叫端未查,標未確認。**

### 6-c 不留痕(照 `docs/patterns/mutation-harness-restore.md`)

```
改：db-max-rows 5   →  跑完   →  還原 2000  →  重啟 PostgREST
還原驗證：同一張 6 品項的單回 6（不是 5）✅  —— 驗的是行為，不是「我改回去了」這句話
```
**這一發是在拋棄式環境做的,沒有碰任何 `.env*`、沒有碰正式站、沒有碰共用設定檔。**
