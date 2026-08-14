# #18 退貨收回 — 查證報告(A 窗夜跑,零 code、**不設計**)

> 只回答「要做這件事,現在缺哪幾塊、每塊多大」。事實親查於 `pcm-void-readers` @ `b5a70d88`。
> 🔴 **全部來自 repo 檔案,未對正式庫查詢。**

## §1 退貨有沒有落點?**零。而系統已經在對員工指路,指向一個不存在的地方。**

三組 pattern,範圍固定 = `supabase/migrations` + `packages` + `apps/admin/src` + `apps/storefront/src`(不含 `.next`):

| 組 | pattern | 命中 |
|---|---|---|
| A 實體名 | `order_returns`\|`order_return_items`\|`returned_quantity`\|`return_requested_quantity`\|`return_received_quantity` | **0** |
| B 欄名 | `return_id`(僅 migrations + domain + adapters) | **0** |
| C 中文 | `退貨` | **10** |

**正向對照(證明那個 0 不是 pattern 寫壞)**:同範圍換 `order_item_quantity_summary` ⇒ **191**;
把 A 組 alternation **原樣留著 `order_returns`** 只多加一個 `order_refunds` ⇒ **295**
⇒ 語法會動、`order_returns` 這個詞解析正常;再跑 A 組原式 ⇒ 仍 **0**。

🔴 **C 組那 10 行沒有一行是實作**,分三類:
- **會顯示給員工看的指路(1 行,最刺眼)**:`components/orders/cancel-review-section.tsx:118` 逐字
  「已到貨的部分要走**退貨流程**」——**那條流程不存在。**
- **不變式與債的註解(5 行)**:`20260730150000:119`(Q17=B「已到貨不可取消、只能走退貨」)、
  `20260803160000:84` 與 `20260803130000:51`(「歸第 3 批採購退貨線」)、`20260725130100:478`、
  `cancel-review-section.tsx:172`。
- **已登記的缺口(4 行)**:`shipment-candidates.ts:57` 逐字「摘要的 `instock` 被下修(**退貨**/更正)」
  ⇒ **有人已經預期 instock 會被退貨下修**;`orders/page.tsx:168`、`order-filter-chips.tsx:13`、`:49`(`退貨中` chip = `#500`)。

## §2 已出貨的單要退,取消線走得到哪一步?**一步都走不到。**

`apps/admin/src/lib/orders/cancel-view.ts:217` 逐字:「可取消量 = `quantity − instock − cancelled`,
而 **`shipped ⊆ instock`**(Sean 2026-08-05 拍板)」。
⇒ 已出貨 ⊆ 已到貨 ⇒ 那些量**從可取消量整份扣掉**。全出貨的單每項可取消量 = 0
⇒ 觸發 `cancel-view.ts:147` 的 `nothing_cancellable` ⇒ 畫面吐 `:118` 那句 hint。

🔴 **這是閉環的死路,不是「還沒做的功能」**:取消線**刻意**把已到貨擋掉(`20260730150000:119`),
把責任交給退貨線;退貨線不存在 ⇒ **已出貨的單在後台完全沒有出口**。

## §3 貨的軸與退貨的關係(只列事實,不選)

四個計數欄都在 `order_item_quantity_summary`:`ordered` / `instock` / `cancelled` / `shipped`,
關係由具名 CHECK 釘死:`oiqs_instock_le_ordered`(`20260730150000:113`)、`oiqs_shipped_le_instock`(`20260806100000:144`)。

| 記法 | 動作 | 會撞到什麼 |
|---|---|---|
| ① 下修 `instock` | 退回 = 當作沒到貨 | `shipped <= instock` 會擋 ⇒ **必須同時下修 `shipped`**。`shipment-candidates.ts:57` 已預期這條路 |
| ② 新增第五軸 `returned_quantity` | 只加一筆、不動既有四軸 | 不撞現有 CHECK,但要新增欄 + 新不變式,且**四軸的既有讀者要不要扣掉它,每個都要回訪** |

🔴 **既有機制最接近的 = `admin_delete_item_receipt`**(呼叫端在 `receipt-repository.ts:250`)——
現行唯一會下修 `instock` 的路徑。但它的語意是「**到貨登記錯了、撤銷登記**」,不是「貨真的回來了」。
**兩者帳上長得一樣、意義完全不同** ⇒ 拿它當退貨用會讓帳查不出真相。
⚠️ 而 `#498` 說它對「作廢的採購」還沒有分流(卡在 Sean 桌上)⇒ 它自己也還沒收乾淨。

## §4 缺哪幾塊、每塊多大(規模是**估**的,不是數的)

| 塊 | 內容 | 大小 | 前置 |
|---|---|---|---|
| **R0 決策** | 記法選①還是② / 退回的貨要不要回庫存 / 退款怎麼綁 | 零 code,**但擋住全部** | Sean |
| **R1 schema** | `order_returns` + `order_return_items` + `order_refunds.return_id` + 軸的不變式 | 1 支大 migration,鐵則 12②③ | R0 |
| **R2 writer** | 建退貨單 / 收到退貨 / 取消退貨 三支 owner RPC + 四軸同交易更新 | 2-3 片,鐵則 12③ | R1 apply |
| **R3 退款接線** | 退貨 → 退款(`order_refunds` 已在,`kind` 要不要加值未定) | 1-2 片,鐵則 12① | R2 |
| **R4 讀模型 + UI** | 明細頁退貨區塊 + 列表「退貨中」chip(`#500`) | 2-3 片 | R2 |
| **R5 指路修正** | `cancel-review-section.tsx:118` 那句話 | **1 片、很小** | **無** |

🔴 **R5 現在就能做,而且是唯一不依賴 R0 的。** 現況是叫人走一條不存在的路;
改成「已到貨的部分目前無法在後台處理,請聯繫系統維護」至少不騙人。**這是最便宜的一塊。**

## §5 Sean 那句「收進隱藏」現在沒有載體

列表只有**一個**隱藏述詞,而且單一用途:`order-list-view.ts:67-68` 的 `show_unpaid_card`(L6),
逐字「連**刷卡未付款**一起顯示」;`SupabaseOrderAdapter.ts:674` 逐字「預設隱藏『刷卡未付款』單」。
⇒ **不是通用封存軸**,是寫死的述詞。Sean 要的「取消+退款+退貨完的單收進隱藏」**需要另一個軸**
(或把 L6 一般化)。**本報告不設計它,只指出它不存在。**

## §6 誠實缺口

1. **未對正式庫查詢。** §1 的「零」是對 **repo 工作樹**的 grep,不是 `information_schema`。
   DB 上有沒有一張沒進 repo 的 return 表 ⇒ **未確認**。
2. **§4 的大小全部是估的**,我沒為任何一塊列出要改哪些檔。**不可以拿去排工時。**
3. **`admin_delete_item_receipt` 我只看呼叫端與回傳碼所在行,沒讀 RPC 本體**
   ⇒ 「唯一會下修 instock 的路徑」是**基於 §3 兩條 CHECK 的推論,不是逐支排除**。
4. **`order_refunds.kind` 現有哪些值我沒查** ⇒ R3 可能比我估的大。
5. **`#500`「退貨中」chip 的條目內容我沒開檔**,只引了 code 註解對它的描述。
