# 計畫：匯入時擋掉「品名是聯絡方式」的非商品列（2026-09-27，窗「進度 a0」）

> 狀態：Sean 2026-09-27 B3 乙批准（經主視窗轉達），已實作。碰匯入管線、不碰錢。
> 查證：`~/pcm-mailbox/查證-非商品混入-20260927.md`（全站 26,534 件上架商品只有 gbracing `SPB` 一件）。

## 改什麼

- `scripts/rpm-transform.ts` 新增 `isNonProductListing(row)`：英文或中文品名符合任一條就算非商品——email（`@` 後面要有網域點，所以 kspeed「TT@CO」不算）、網址（`http://`、`https://`、`www.`）、`please contact`／`contact us`／`enquir`／`price on request`、「請聯絡／請洽／洽詢／來電詢價」。`Contact Surface`、`reed contact` 這類零件術語不算。
- `scripts/rpm-import.ts`：每一群先把非商品列拿掉；整群都是非商品就跳過（算「還在來源裡」，不觸發「原廠已無此品」）。非商品列的料號併進「本次來源有的規格」，所以變體級對賬不會把網站上已有的那一列當孤兒刪掉。匯入紀錄印一行「非商品列跳過 N 列，其中整群 M 群：料號…」。
- 所有供應商都套用（不是只有 gbracing）。

## 影響

- 以後報價單再出現這種列，不會被建成商品。
- **網站上已經有的 `SPB` 不會因此下架**：它從此不更新，原樣留著。要下架是另一件事（正式庫寫入）。
- 其他商品不受影響：22 家、62,414 列來源全部跑過，只擋到 `SPB` 一列；gbracing 乾跑孤兒 0、待標記「原廠已無此品」0。

## 退回

revert 這一顆 commit 即可；沒有動資料庫。

## 驗證

- `scripts/rpm-transform.test.ts` 新增 3 格（擋 SPB 中英文品名／擋網址與請聯絡／不擋 TT@CO、Contact Surface、reed contact、一般螺絲），先紅後綠。
- 全供應商來源掃描：22 家、62,414 列，擋 1 列（gbracing SPB）。
- `rpm-import.ts --dry-run --supplier=gbracing`：rc=0，跳過 1 列，949 群照常，孤兒 0，待標記 0。
