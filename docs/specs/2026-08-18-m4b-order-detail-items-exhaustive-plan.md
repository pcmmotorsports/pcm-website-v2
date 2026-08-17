# Plan:訂單明細頁品項改「撈到盡」(`D2` 的 C 條)

> **狀態:等批准。鐵則 8(跨 3+ 檔 + 動共用讀模型)⇒ 批准前一行 code 都不動。**
> **寫於 2026-08-18 凌晨。作者 = B 窗。**
>
> 🔴🔴 **開工前必讀 —— 這一片的「批准」是誰給的**:
> ```
> D2 = 甲（調大 max-rows + 程式改撈到盡）  ← 🔴 Sean 2026-08-17 拍板
> Q-maxrows-2（C 條要不要一起改）          ← 🔴 主視窗 2026-08-18 裁定，【不是】Sean 拍板
> ```
> **兩者不同級,而三個月後沒人分得出來。** 引用本檔時要帶著這個區分。
> 主視窗裁定的理由(全部是 B 窗真資料實查到的,不是推的)見 §2-a。

---

## §1 要改什麼(一句)

**訂單明細頁的品項清單,從【內嵌撈】改成【頂層分頁撈到盡】。**

⚠️ **而它比 A 條(建箱候選)難,難在【消費者多而且要的欄位不一樣】** —— 見 §3。
🔴 **plan `2026-08-17-m4b-order-items-max-rows-plan.md` §3 把 C 列成一行,而那一行低估了它。**
本檔存在的理由就是把那一行展開。

---

## §2 為什麼(這一節是理由,不是背景)

### 2-a 三條實查到的病(2026-08-18 真後台 + 真資料量到,不是推的)

量法:拋棄式 PG + 真後台 + 種一張 **201 品項**的單 + playwright。
完整步驟 `docs/runbooks/local-admin-with-real-data-probe.md`。

```
1 明細頁品項表：DISTINCT SKU = 200 / 201 —— 缺 SKU-0147
  🔴 缺的是【中間那一件】不是尾巴：內嵌按 `id` 排序而 order_items.id 是隨機 uuid
     ⚠️ 這是【uuid 排序】的性質，不是【截斷】的性質。按 created_at 排序的查詢掉的就真的是尾巴。
  ⇒ 員工的主要工作面上，一件貨【看不見】，而畫面完全正常

2 取消複核區被 fail-closed。畫面逐字：
  「這張單的品項太多，畫面沒有列完」「沒有看到全部品項就不能複核取消範圍。請通知系統維護處理。」
  （cancel-review-section.tsx，讀 detail.itemsTruncated）
  ⇒ 這張單【永遠取消不了】，而修法是改資料層不是改那道閘（那道閘是對的）

3 件數摘要卡印「未知」（order-detail-summary-cards.tsx:174 / :247）
```

### 2-b 而 A 條(已交)**沒有**被 C 擋住 —— 這句要寫清楚,因為我一度說反了

```
❌ 我 2026-08-18 一度回報「明細頁的截斷旗標把出貨入口 fail-closed 了」
   ⇒ 假的。grep -n 'itemsTruncated|disabled' shipment-launcher.tsx ⇒ 只有 disabled={loading}
   真因是我的種子沒有到貨資料 ⇒ 201 件全 unknown ⇒ 不開窗
✅ 補了到貨資料之後：建箱彈窗 DISTINCT SKU = 201 / 201（SKU-0147 與 SKU-0201 都在）
```
⇒ **C 條的價值是上面那三條,不是「解鎖 A」。**

---

## §3 🔴🔴 硬約束:`AdminOrderPrintItem` **裝不下明細頁**

A 條能直接沿用 `listOrderItemsForPrint` 是因為建箱候選只要 4 個欄。
**明細頁不行。** 當場盤點(`grep -oE 'item\.[a-zA-Z]+' <各檔>`):

| 消費者 | 要的欄位 | `AdminOrderPrintItem`(6 欄)裝得下? |
|---|---|---|
| `order-detail-items-table.tsx:170` | id / title / variantSku / spec / quantity / quantitySummary / **unitPrice** / **lineTotal** | ❌ 缺兩個金額欄 |
| `cancel-review-section.tsx:205` | id / title / variantSku / quantity | ✅ |
| `item-procurement-section.tsx:253,272` | id / title / variantSku / quantity / quantitySummary / **procurements** / **procurementTruncated** | ❌ 缺採購 |
| `shipment-section.tsx:25` | id / title | ✅ |
| `picking-doc.tsx`(揀貨單 = plan 的 **B 條**) | 同明細表一族 | —— B 條範圍,本片不碰 |

🔴 **兩個缺口的性質【不同】,不可以合在一起處理**
(這個區分逐字取自 `packages/domain/src/order/types.ts:857-870`,是 V 窗打回前一版時立的):

```
unitPrice / lineTotal      = 【同列 scalar】⇒ 取它們【不產生任何截斷面】
                             當初排除只是 YAGNI（列印用不到），不是結構性理由
                             ⇒ 🔴 這一片可以直接加，加了不會把病帶回來

procurements               = 【內嵌陣列】，受 ORDER_ITEM_PROCUREMENT_EMBED_LIMIT 管
procurementTruncated         ⇒ 🔴🔴 取它進來 = 把我們正在拆的那道牆【換個位置裝回來】
                             ⇒ 這一片【不可以】直接加
```

⇒ **這就是為什麼 C 不是「照抄 A」。**

---

## §4 三個選項(**我推薦丙,理由在下面**)

```
甲｜把 procurements 一起取進頂層查詢
   代價：🔴 把內嵌截斷從「品項層」搬到「採購層」——
        病沒有消失，只是換一個地方發作，而【新位置更難發現】（採購列比品項列更少人核）
   ⇒ 我不推薦。這是 types.ts:861 明文警告的那個做法。

乙｜明細頁整頁改成頂層分頁，採購區【另外】各自撈
   代價：採購區變成 N+1（每個品項一次查詢）。201 品項 = 201 次往返，互動路徑上不可接受。
   ⇒ 除非改成「按下去才抓」（已有前例：fetchItemProcurementChoices），而那是另一片的 UI 改動。
   ⇒ 我不推薦【在這一片做】。

丙｜分兩層：品項清單撈到盡，採購區維持現況並【明確標示它自己的射程】  ← 🔴 推薦
   做法：
     1 新增 AdminOrderDetailFullItem = AdminOrderPrintItem + unitPrice + lineTotal
       （純 scalar，零截斷面；用 Pick 不重打，理由同 types.ts:884）
     2 明細頁改吃它（頂層分頁撈到盡）⇒ 品項表 / 取消複核 / 件數卡 / shipment-section 全部拿到全量
     3 採購區【維持吃內嵌那份】，但把它的射程講白：
       「這一區只顯示前 200 項的採購狀態」——🔴 而現在它是【靜默】的
     4 detail.itemsTruncated 的語意收窄成「採購區可能不完整」，不再代表品項表不完整
   代價：採購區在 200+ 品項的單上仍然不全，但【它會說】，而現在它不說。
   ⇒ 剩下那半寫進 backlog（採購區改「按下去才抓」）。
```

🔴 **推薦丙的理由**:它把**四個病治好三個**(品項表 / 取消複核 / 件數卡),
而第四個(採購區)從**靜默不全**變成**明說不全** —— 那是 Sean `Q-C16` 甲的同一條判準:
**「少印沒人會發現,多印客人會打電話」** ⇒ 先讓它會叫。

---

## §5 影響面、Rollback、風險

**要動的檔(丙案)**:
```
packages/domain/src/order/types.ts          新型別（共用契約 ⇒ 鐵則 12⑥ 邊緣，見下）
packages/adapters/src/supabase/…            新增或擴充頂層分頁查詢
apps/admin/src/components/orders/order-detail-route.tsx     資料源
apps/admin/src/components/orders/order-detail-items-table.tsx
apps/admin/src/components/orders/cancel-review-section.tsx
apps/admin/src/components/orders/item-procurement-section.tsx  射程文案
apps/admin/src/components/orders/order-detail-summary-cards.tsx
```
⚠️ **7 支檔 ⇒ 鐵則 8 明確命中,而且動到 `packages/domain` 的共用型別。**
🔴 **是否命中鐵則 12⑥(共用元件行為改動)**:`packages/domain` 是型別不是 `packages/ui`,
**字面上不命中**;但**新增型別 + 改讀模型**實質是動共用契約 ⇒ **我判要跑 codex 對抗審查,不自評免審。**

**Rollback**:一顆 commit,退就退那一顆。
🔴 **退回去 = 退回「明細頁靜默少一件 + 這張單永遠取消不了」,不是退回安全。**

**風險(未量)**:明細頁是**高頻互動頁**,改成分頁會多打 DB。
**本檔未量**明細頁現在的回應時間 ⇒ 這條是定性的。
⇒ **驗收要含改前改後各測一次同一張單**(A 條那次沒做,這次補上)。

---

## §6 驗收(**含真資料,不是只有三綠**)

```
1 三綠（TURBO_FORCE=1，0 cached）
2 單測：新增格要對「讀內嵌 vs 讀頂層」有判別力 —— 兩份刻意做成不一樣
  🔴 並且要真的餵 201 項（A 條那次 codex R3 抓到我用 3 項的 fixture 對 slice(0,200) 恆綠）
3 🔴 真資料：照 docs/runbooks/local-admin-with-real-data-probe.md 跑一次
   期望：明細頁 DISTINCT SKU = 201 / 201（現在是 200，缺 SKU-0147）
   期望：取消複核區【不再】顯示「品項太多，畫面沒有列完」
   期望：件數摘要卡【不再】印「未知」
   🔴 負向對照：採購區仍應顯示「只涵蓋前 200 項」那句新文案（不是靜默）
4 改前改後各量一次明細頁回應時間（本檔唯一的定量缺口）
5 codex 對抗審查（我判要跑，理由見 §5）
```

---

## §7 本檔【沒做】與【未確認】

- **零實作。** 等批准。
- ~~`ORDER_ITEM_PROCUREMENT_EMBED_LIMIT` 的值我沒有當場 grep~~
  **⇒ 已補查:`= 50`(`packages/adapters/src/supabase/mappers/order-procurement.ts:44`),
  送出處 `SupabaseOrderAdapter.ts:845`。**
  🔴 **而 `50` 比品項的 `200` 低四倍** ⇒ 採購那層的截斷**比品項層更早發生**:
  一個品項有超過 50 筆採購紀錄就開始掉,而那是**單一品項**的量,不是整張單。
  ⇒ **§4 甲案「把 procurements 一起取」的代價比我原本寫的更重**,推薦丙不變、理由更硬。
  📎 留痕:上一版我寫「沒有當場 grep」而照樣拿它論證 —— **一個 grep 就能關掉的未確認,
  不該留在 plan 裡當未確認。**(同 `feedback_assert-scope-only-after-reading-source-file`。)
- **`picking-doc.tsx`(揀貨單 = plan 的 B 條)不在本片範圍**,但它吃同一族欄位
  ⇒ 🔴 **本片做完之後 B 條會變得很便宜**(型別已經有了),這件事要寫進 backlog 免得被重估。
- **未量**:明細頁現在與改後的回應時間。
- **上面所有真資料數字都來自拋棄式環境**(`service_role` 的 GRANT 與 BYPASSRLS 是我自己下的、
  `auth.uid()` 是替身、26 支 migration 沒套上)⇒ **證得了行為,證不了正式站的權限設定。**
