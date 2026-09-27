# 計畫：Ilmberger「左右一對」出貨時提醒拆成左、右各一件（網站後台，2026-09-27，窗「進度 a0」）

> 主視窗派工。報價單側 `be23d433`（報價單 14，審查中）：左右合卡、spec 加 `position`（左／右／左右一對）、另產「一對」虛擬款（sku `{群鍵}-PAIR[-G|-M]`，`raw_jsonb.pair_components = [左料號, 右料號]`）。
> 片 1（商品頁「位置」維）已 commit（rebase 後 `dac11e353`）。本計畫是片 2：後台出貨彈窗與揀貨單的提示（出貨單原本也列入，後來裁定不印）。
> **實作更正**：原本打算改 `packages/domain` 的共用型別，實際**沒有改**；改成後台自己查、用 prop 傳進三個畫面（見第 2 節最後一條）。

## 1. 查到的事實

- 同步**沒有**把 `pair_components` 帶到網站：`rpm-fetch.ts` 不讀 `raw_jsonb`（檔頭第 16 行），`rpm-transform.ts::transformVariant` 的 `metadata` 固定寫 `{}`（第 762 行「停寫全部」）。
- `spec`（含 `position`）會照原樣進 `product_variants.spec`，下單時進 `order_items.product_snapshot.spec`。
- 後台三個畫面的品項都來自 `AdminOrderDetailItem`（`packages/domain/src/order/types.ts:1081`），已有 `variantSku` 與 `spec`，沒有 `product_id`。

## 2. 做法（建議甲）

**甲（建議）：不改同步，在後台讀訂單時用「同一張商品卡的兄弟款」找出左、右料號。**
- 判定「一對」：`spec.position === '左右一對'`，或 `variantSku` 以 `-PAIR`、`-PAIR-G`、`-PAIR-M` 結尾。
- 找兄弟：用一對款的 sku 查 `product_variants` 取 `product_id`，再讀同一個商品的所有款；左 = `spec` 除了 `position` 之外都相同、`position = 左`；右同理。
- 左、右**各恰好一個**才印料號；找不到或多於一個 ⇒ 只印「一對：出貨時請拆成左、右各一件（料號請到報價單確認）」，不猜。
- 讀取失敗 ⇒ 同上的保守句，不擋出貨、不讓頁面壞掉。
- ~~型別：`AdminOrderDetailItem` 加一欄 `pairSplit`~~ ⇒ **實作改成不動共用型別**：
  - 判定與找兄弟：`apps/admin/src/lib/orders/pair-split.ts`；讀資料庫：`pair-split-read.ts`（`loadPairNotesForItems`，沒有一對款就不查）。
  - 揀貨單頁呼叫一次，把 `{ 料號: 提示字 }` 以 `pairNotes` prop 傳給 `PickingDoc`。
  - **出貨單與它的 PDF 不印**（主視窗 2026-09-27 在 Fable R1 後裁定）：出貨單隨貨給客人，員工用的提示不該出現在客人拿到的紙上。
  - 出貨彈窗：`ShipmentCandidateItem` 加 `pairNote`（只有料號，不是價格、客人資料或供應商），在 `loadShipmentCandidates` 補上。

**乙：改同步，把 `pair_components` 帶進 `product_variants.metadata`。**
- 要改報價單 `storefront_catalog_v`（加一欄）＋ 網站 `rpm-fetch.ts`／`rpm-transform.ts`（metadata 目前刻意全停寫）。資料來源最權威，但動兩個 repo 的同步與 view，範圍大一截。

選甲的理由：一對款與左右款由同一次抓取、同一個群鍵產生，必定在同一張商品卡；找不到就保守不印料號，錯不了。以後若要改走乙，只換「找料號」那一支。

## 3. 畫面文字（員工看的）

- 出貨彈窗、揀貨單在那一列品名下方加一行（出貨單不印，見第 2 節）：
  - 找得到：「一對：出貨時請拆成左、右各一件（左 料號A、右 料號B）」
  - 找不到：「一對：出貨時請拆成左、右各一件（料號請到報價單確認）」
- 印刷版面照 OD 稿既有的品項列樣式，不另開欄位；這一行用現有的小字樣式。

## 4. 測試（先寫會紅的）

- 判定：position 或 sku 後綴兩種都算；一般款不算。
- 找兄弟：左右各一 ⇒ 兩個料號；缺一邊或重複 ⇒ 保守句；表面不同的兄弟不算。
- 三個畫面：一對那一列出現提示字；一般品項沒有。
- 讀取失敗不擋頁面。

## 5. 影響與退回

- 只影響後台顯示與列印；不動訂單、庫存、出貨寫入。
- 多一次讀取（只有訂單裡真的有一對款時才讀）。
- 退回：revert。
