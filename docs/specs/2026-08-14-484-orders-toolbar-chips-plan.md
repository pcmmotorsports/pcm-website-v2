# `#484` 訂單列表工具列 chip 排 —— plan

> 🔴 **結論先講:這片現在不該開工,而且是我自己在 `E-506` 說錯了。**
> 我當時寫「S1 是唯一沒有前置、資料面現成的片」。**那句話沒有查過資料面就寫了。查完之後它不成立。**

## 1. 查到什麼(可重跑)

「未到貨」要篩的是「貨還沒到」。有兩份資料都自稱知道這件事,**而它們不一致**:

| | 來源 | 誰在用 |
|---|---|---|
| A | `orders.fulfillment_status`(單值 enum,`.eq` 篩得動:`SupabaseOrderAdapter.ts:582`) | 現行 `<select>` 出貨狀態篩選 |
| B | `order_item_quantity_summary` 彙總到訂單層 | **列表上那顆狀態膠囊**(`order-status-axes.ts:126-133` `orderGoodsAxis`) |

正式站唯讀查證(2026-08-14):**13 張單的 `orders.fulfillment_status` 全部是 `notOrdered`**,
但用膠囊那份算法算,`PCM-2026-0104` 是 **`ordered`** ⇒ **1/13 兩邊不一致,而且欄位那一側從沒被推進過。**

```sql
select o.fulfillment_status::text,
 case when bool_and(coalesce(s.shipped_quantity,0)>=oi.quantity) then 'shipped'
      when bool_and(coalesce(s.instock_quantity,0)>=oi.quantity) then 'instock'
      when bool_and(coalesce(s.ordered_quantity,0)>=oi.quantity) then 'ordered'
      else 'none' end as ui_axis, o.display_id
from orders o join order_items oi on oi.order_id=o.id
left join order_item_quantity_summary s on s.order_item_id=oi.id
group by o.id, o.fulfillment_status, o.display_id;
```

**⇒ 拿 A 做 chip,會做出一顆「按了之後列表跟它旁邊那欄互相打臉」的按鈕。**
(而且 A 全是 `notOrdered` ⇒ 「未到貨」會回全部 13 張,包含膠囊寫著已定/現貨/出貨的那些。)

## 2. 三條路

| | 做法 | 檔數 / 估時 | 鐵則 | 問題 |
|---|---|---|---|---|
| **甲** | 只做 chip 排的**殼** + 「全部」一顆,「未到貨」拆出去 | 3 檔 / 25 分 | 8 否 | ✅ 安全,但**畫面上只有一顆 chip,Sean 看不出做了什麼** |
| **乙** | 「未到貨」接 **B**(與膠囊同一份資料) | 跨 `packages/domain` + `packages/adapters` + admin + 可能要 DB view / 產生欄 / RPC 篩選 / 90-150 分 | **8 中**;若動 schema **12③ 也中** | ✅ 唯一與畫面一致的做法;成本是本片的 3 倍以上 |
| **丙** | 「未到貨」接 **A**(`.in('fulfillment_status', ['notOrdered','ordered'])`) | 4-6 檔 / 60 分 | 8 中 | ❌ **不推薦**:已實測會與狀態欄打架(上面那筆 `PCM-2026-0104`) |

**我推薦:甲 + 把乙拆成獨立片排隊。** 理由:甲不會做錯東西;乙的成本與風險應該被單獨看見、
不該藏在一個標著「40 分工具列」的片裡。**但甲單獨上線的畫面價值接近零 ⇒ 這是要拍的,不是我能決定的。**

## 3. 若走甲(唯一我現在寫得出片界的那條)

- **動 4 檔**:`app/orders/page.tsx`(掛元件)/ 新 `components/orders/order-view-chips.tsx` /
  `lib/orders/order-list-view.ts`(chip 的 href 走既有 `buildOrderListHref`,**不新增 param**)/ 同層測試。
- **版面照 OD**:`overview-desktop.html:610-614` markup、`:91-99` CSS(`.bar` 34px、`.fchip` 藥丸、
  `aria-pressed=true` 深色實心)。⚠️ OD `:479-480` 自己記著:面板開著(658)時工具列會被壓到換行、
  41px 撐破 34px 的列 ⇒ **驗收要含面板開啟寬度。**
- **驗收(每條可 yes/no,且都是可跑的斷言,不是宣稱)**
  1. `render` 後,chip 排恰 1 顆 `aria-pressed="true"`,且它是「全部」
  2. 🔴 **按下去列表真的變**:在「有篩選」的 URL 下 render ⇒ 列表列數 = N;點「全部」後的 href
     再 render ⇒ **列數 ≠ N 且等於未篩選的總數**。(不是只斷言 chip 自己變色 —— 只驗顏色的話
     把 href 接錯照樣綠。)
  3. 「全部」的 href **不含**任何篩選 param(逐鍵斷言,不是字串 `toContain`)
  4. 容器 658(面板開)與 1412(面板關)兩種寬度下,`.bar` 的 `scrollHeight <= clientHeight`(不換行)
  5. 三綠 + build 四個 EXIT 分開貼
- **rollback**:單一 commit revert 即可 —— 甲**不動 param 白名單、不動 domain/adapter、不動 DB**,
  拿掉新元件與 `page.tsx` 那一行就回到現狀。**沒有資料面遺留。**

## 4. 我沒查的
- **乙到底要不要動 schema:沒查。** 我只確認了現行 adapter 是 `.eq` 單值,**沒有評估**能不能用
  既有 join(`order_items!inner` / `order_item_quantity_summary`)在 PostgREST 端表達「全部品項都 X」
  這種**全稱條件** —— 那是乙的第一個技術問題,也可能是它做不做得成的關鍵。
- **`orders.fulfillment_status` 為什麼從沒被推進過**(13/13 都是 `notOrdered`):**沒查**。
  它可能是死欄位、也可能是某條路徑漏寫。**這件事本身可能是一條 backlog**,我沒有自己立號。
- 「待處理」的定義仍未拍(`#485`),本 plan 不涉及。
