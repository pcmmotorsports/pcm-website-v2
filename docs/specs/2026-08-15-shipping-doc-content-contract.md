# 出貨單 · 內容合約(2026-08-15)

> **這份檔只回答「紙上該有什麼資料、資料從哪來、拿不到怎麼辦」。**
> **不寫版面、不寫視覺、不寫樣式** —— 視覺由 OD 主導、B 窗當窗口,是另一份產物。
>
> 觸發:Sean 2026-08-15 看過真站出貨單後逐字「跟我心目中差異甚遠,也跟我們原本說要給客人的
> 資訊差異很多」「不能說醜,只能說簡陋＋資訊漏缺」「這種東西應該用設計用的 skill 去設計」
> ⇒ 片2b-2 的範圍由「加金額區塊」變成**整張重新設計**。
>
> 🔴 **行號會漂**:引用前用同段給的錨點自己重跑。座標實測自 worktree `/Users/sean_1/pcm-print`
> branch `print-docs` @ `df5232c8`。

---

## §0 現況(實查,不是印象)

現行 `apps/admin/src/components/print/shipping-doc.tsx` 印出來的**全部**內容:

```
出貨單 / 訂單編號 :240 / 箱號 :241 / 收件人三行 :252-254 / 下單時間 :258 /
本次出貨項數 :259 / 料號·品名規格·數量 :194-196 / 尚未出貨區 :286-290 /
手寫空格「出貨人____ 日期____」:320-321
```
數法:`grep -nE '<h1|<th|<span>|收件人' apps/admin/src/components/print/shipping-doc.tsx`

---

## §1 抬頭七值(A 組)—— 🔴 **座標不存在,要新建**

**逐字如下。不准正規化 —— 全形半形不准動、`+886` 不准改 `0`、英文名的句點是拍板的一部分。**

```
1  派達有限公司
2  +886 930-531-867
3  sean@pcmmotorsports.com
4  90003020
5  新北市新莊區化成路736巷18號1樓
6  @pcmmoto
7  PCM MOTOR PARTS LTD
```
🔴 **第 7 值 2026-08-15 當日反覆三次,最終為【無句點】。過程要留,不能只留結果:**
```
稍早    七值逐字表寫  PCM MOTOR PARTS LTD.   （有句點）
稍後    Sean「都用有句點 PCM MOTOR PARTS LTD.」
主視窗回問（附 phase-1-backlog.md:6360 的 2026-06-22 確認：無句點）
        Sean「有句點」                      ← 重申
🔴 最終  Sean「好啦～沒句點，抱歉」          ← 定案
```
✅ **`docs/phase-1-backlog.md:6360`(2026-06-22 確認無句點)從頭到尾是對的 —— 檔案贏了三次口頭。**
🔴 **判別句(這題最貴的一課)**:**他確認的是【那個事實】,還是【他對那個事實的記憶】?**
「重申」不是驗證 —— 重申的是記憶,不是登記證。**事實類問題要問「你手上有那份文件嗎」,
不是「你確定嗎」。** 登記證本身仍未見(見 §6 第 1 條的數法)。

| # | 判準 | 拿不到時 |
|---|---|---|
| 1-7 | 逐字 byte 相同;守門要**斷言渲染輸出**,不是斷言常數 | 不適用(是我們自己的值) |

🔴 **座標實查結果:admin 側零抬頭常數。**
```bash
git grep -n '派達有限公司\|pcmmoto\|90003020' -- apps/admin/src
```
⇒ 3 檔命中,**逐行看全部是 `pcmmotorsports.com` 網域字串**
(`apps/admin/src/lib/orders/workflow-form.ts:47` / `apps/admin/src/lib/sso/config.ts:7`),
**沒有一處是抬頭常數** ⇒ **要新建**。放 repo 常數是 `Q-D-21` 拍板(主視窗裁),**不放 env**:
env 值改了 repo 一個字都不會動 ⇒ 沒有 diff、沒有 review ⇒ 等於把對外內容移出審查鏈。

**8. LINE QR 圖** — 目標路徑 `apps/admin/public/line-qr.png`,**檔尚未下載**。
🔴 實查:`ls apps/admin/public/` ⇒ **`No such file or directory`**
—— **那個目錄本身不存在**,不是「存在但空的」⇒ 要連目錄一起建。
用 Sean 給的**帶參數版** `https://qr-official.line.me/gs/M_txf2800h_BW.png?oat_content=qr`
(24,553 bytes / sha256 `a1bf94e7c52d…`)。🔴 **不准自己產生 QR** —— 無參數版與帶參數版
解壓後像素內容不同 ⇒ 會掃到不同的東西;自己產等於選第三種 payload。

---

## §2 這張單是誰的(B 組)

| # | 欄 | 資料來源座標 | 判準 | 拿不到時 |
|---|---|---|---|---|
| 9 | 客人公司名 | `packages/domain/src/order/types.ts:1053` `invoiceRequest.title` | 🔴 **印在收件人區,抬頭區禁止** | 見下方裁示② |
| 10 | 買受人統編 | 同檔 `:1052` `invoiceRequest.taxId` | 「**買受人**」是 Sean 逐字,不准改「客戶統編」「買方統編」 | 見下方裁示② |
| 11 | 收件人姓名 | `apps/admin/src/lib/shipping/shipment-repository.ts:230` `recipientSnapshot.name` | 空字串是**合法寫入**,不是髒資料 | 整張不印(現行 `shippingDocBlocker` 已擋) |
| 12 | 收件人電話 | 同上 `.phone` | 同上 | 同上 |
| 13 | 收件人地址 | 同上 `.line` | 同上 | 同上 |

🔴 **9/10 與 §1 的 1/4 是【同一個概念的兩份資料】,字面幾乎一樣而語意完全相反:**
`invoiceRequest.title` 是**客人的**公司名(發票抬頭),而欄位就叫 `title`。
⇒ **禁令的軸是【位置】不是【欄位】**:同一個欄位,抬頭區禁止、收件人區必須。

---

## §3 這箱怎麼寄的(C 組)—— **整組零採用**

| # | 欄 | 資料來源座標 | 判準 | 拿不到時 |
|---|---|---|---|---|
| 14 | 貨運商 | `shipment-repository.ts:201` `carrierCode` | 值域 `hct\|sf\|other`(CHECK 在 `supabase/migrations/20260805170000_m4b_e10_b2_s1a1_shipments.sql:104`)。**不准裸印 `other`** | 見裁示① |
| 15 | 取貨方式說明 | 同檔 `:202` `carrierNote` | `other` 時 DB 保證非空(同 migration `:113` 的等價 CHECK) | 見裁示① |
| 16 | 物流單號 | 同檔 `:203` `trackingNumber` | 🔴 **DB 恆時保證**:`shipped_at IS NULL OR carrier_code='other' OR NOT is_blank(tracking_number)`(同 migration `:161-165`)⇒ **已出貨且非 `other` ⇒ 必有值** | 僅 `other` 可無 ⇒ 該情形改印第 15 欄 |
| 17 | 出貨日 | 同檔 `:204` `shippedAt` | 🔴 **這一欄在兩種情況下語意不同,而標籤刻意相同** —— 不得寫成恆等於 `shippedAt`,見裁示③ | `null` ⇒ 印**列印當天**;標籤兩條路都是「**出貨日**」(Sean 2026-08-15 拍甲) |
| 18 | 訂單編號 | `packages/domain/src/order/types.ts:998` `displayId` | 🔴 **必須帶標籤** | — |
| 19 | 箱號 | `shipment-repository.ts:199` `shipmentReference` | 🔴 **必須帶標籤** | — |

🔴 **18/19 是 Sean 截圖上那兩個並排的碼**(`RCPVVJ` / `9JR7NH`)。
**兩個都要有標籤,不能裸印** —— 但「客人該拿哪個去查」是**產品問題**,見 §6。

---

## §4 數量讀得懂(D 組)

| # | 欄 | 資料來源座標 | 判準 | 拿不到時 |
|---|---|---|---|---|
| 20 | 訂購總數 | `packages/domain/src/order/types.ts:800` `quantitySummary.quantity` | 見下方恆等式 | `quantitySummary` 為 `null` ⇒ 印「—」不補 0 |
| 21 | 已取消數 | 同檔 `:806` `cancelledQuantity` | 同上 | 同上 |
| 22 | 已出貨數 | 同檔 `:832` `shippedQuantity` | 同上 | 同上 |

🔴 **恆等式(這是本組存在的理由)**:
```
訂購總數 = 本次出貨 + 尚未出貨 + 已取消
```
現行紙上只有「本次出貨 3 / 尚未出貨 3」,**沒有 6** ⇒ 讀者看到兩個 3,讀起來像自相矛盾。
主視窗查 DB 對照:`quantity=6 / shipped=3 / cancelled=0` ⇒ **算術本來就對,缺的是分母。**

⚠️ `quantitySummary` 為 `null` 的意思是「**不知道**」,不是「都是 0」
(既有 idiom,`unshippedQuantity()` 在 `apps/admin/src/components/print/shipping-doc.tsx:122-127`
已經這樣處理)。**不補 0** —— 補了會讓「讀不出來」跟「真的是零」長得一樣。

---

## §5 金額(E 組)—— 原片2b-2 範圍,仍零實作

| # | 欄 | 資料來源座標 | 判準 | 拿不到時 |
|---|---|---|---|---|
| 23 | 小計 | `packages/domain/src/order/types.ts:1008` `subtotal` | `Money` 型別,禁用 `number` 處理 | — |
| 24 | 運費 | 同檔 `:1009` `shippingFee` | 同上 | — |
| 25 | 折扣 | 同檔 `:1010` `discountTotal` | **只能印一行**,見 §6 | — |
| 26 | 總計 | 同檔 `:1011` `total` | 標籤逐字「**訂單金額**」 | — |

🔴 **第 26 欄的標籤是拍板值,逐字「訂單金額」。**
❌ 被排除的四個:`付款金額` / `應付金額` / `訂單總計` / 任何帶「僅供對照」的版本。
**被排除的理由要寫進註解** —— 下一個人只看到結果會覺得是隨手選的。

**27. 退款小字** — 逐字:
```
取消品項之退款將另行處理,實際金額與時間以退款通知為準
```
**28. 付款狀態** — 🔴 **先不印**(`Q-D-19`,主視窗裁)。觸發條件:之後若要當對帳用途再評估。

**紙的定性**(`Q-D-20` 拍板甲)= **出貨明細單(請款類)**,不是 packing slip。
通用慣例已查(2026-08-15):packing slip **不含金額** ⇒ 含金額就是 invoice 類,分類正確。

---

## §6 🔴🔴 拿不到的(原文照收 —— **本節是這份檔最重要的一節**)

> **這一節存在的理由:擋掉下一個人去【發明】資料。**
> 一個欄位「應該要有」跟「我們手上有」是兩件事,而後者答不出來時最容易被補一個看起來合理的值。

1. **英文公司名的法定登記證** —— 有沒有句點是**事實問題**,repo 裡查不到登記證。
   紙上拍板為**有句點**(`Q-紙1` 拍甲、值選乙,2026-08-15)。

   🔴🔴 **而 repo 裡有一個【方向相反的 Sean 確認】,兩次都白紙黑字 ——**
   **這個分歧本身就是證據,不要挑一個消滅。**
   ```bash
   git grep -nE 'PCM MOTOR PARTS LTD[^.]' -- . | grep -v '^design-reference'   # ⇒ 5 行
   git grep -nE 'PCM MOTOR PARTS LTD$'    -- . | grep -v '^design-reference'   # ⇒ 0 行(行尾情形)
   ```
   正向對照(證明 pattern 抓得到無句點版):
   `printf 'PCM MOTOR PARTS LTD 版權' | grep -cE 'PCM MOTOR PARTS LTD[^.]'` ⇒ `1`

   **無句點版逐行(5 處)**:
   | 位置 | 性質 |
   |---|---|
   | `apps/storefront/src/lib/site-config.ts:16` `LEGAL_NAME_EN` | 🔴 **SSoT 常數本身** |
   | `apps/storefront/src/lib/org-jsonld.test.ts:47` | 釘上面那顆常數的守門 |
   | `apps/storefront/src/lib/org-jsonld.ts:40` | 註解 |
   | `docs/specs/2026-07-23-pcm-legal-terms-privacy-draft.md:16` | 服務條款正文草稿 |
   | 🔴 `docs/phase-1-backlog.md:6360` | **逐字「英文登記名 `PCM MOTOR PARTS LTD` 已於 2026-06-22 由 Sean 確認、落 `alternateName`」** |

   ⇒ **Sean 在 2026-06-22 確認了無句點版,在 2026-08-15 確認了有句點版。**
   兩次都是他本人、兩次都被記下來、值相反。**這不等於「新的推翻舊的」。**

   **有句點版逐處(自己量,不轉抄)**:
   ```bash
   git grep -n -F 'PCM MOTOR PARTS LTD.' -- . | grep -v '^design-reference'
   ```
   ⇒ 14 行(排除本檔),分佈:
   | 檔 | 數 | 性質 |
   |---|---|---|
   | `apps/storefront/src/components/HomeFooter.tsx` | 3(渲染 `:119` + 註解 `:3`/`:46`) | 頁尾版權列 |
   | `apps/storefront/src/components/ComingSoon.tsx` | 1(`:211`) | 同上 |
   | 🔴 `apps/storefront/src/app/brands/page.tsx` | 2(`:30` `TITLE` / `:31` `DESCRIPTION`) | **頁面 metadata** |
   | 🔴 `apps/storefront/src/app/brands/[slug]/page.tsx` | 1(`:75` `title`) | **頁面 metadata** |
   | 三支 `*.test.tsx` | 6 | 釘上面那些的守門 |

   🔴🔴 **⇒ 「結構化資料用無句點、頁面顯示用有句點」這個分法【不成立】。**
   `brands/page.tsx:30-31` 與 `brands/[slug]/page.tsx:75` 是 **`<title>` 與 meta description**
   —— 那**也是餵搜尋引擎的面**,和 `alternateName` 同一類,而它們用的是**有句點版**。
   ⇒ **兩個版本在同一個類別裡對撞**,不是各司其職。

   ## ✅ 2026-08-15 當日結案:**無句點**

   Sean 最終逐字「**好啦～沒句點,抱歉**」⇒ **正典值 = `PCM MOTOR PARTS LTD`。**
   與 `docs/phase-1-backlog.md:6360` 的 2026-06-22 確認一致。

   **⇒ 方向與上面那段的推測相反,而【上面那段不刪】** —— 它記錄的是當時已知的事實與量測,
   刪掉會讓下一個人以為這題從頭到尾很單純。

   **本片(D-042)已做的**:把偏離的 11 處拉回 SSoT(`git grep -nE 'PCM MOTOR PARTS LTD\.'
   -- apps packages` 由 13 → 2)。剩下 2 處**刻意保留**,都在
   `apps/storefront/src/components/HomeFooter.tsx`:
   - `:3` 記錄 2026-08-05 之前的**歷史字面** ⇒ 改它=偽造當時的字面
   - `:48` 引用 **OD 設計稿逐字**,而 OD 真的寫有句點 ⇒ 改它=偽造 OD 的內容。
     量法(`-rc` 打在目錄上是**逐檔輸出**、不是總數,要自己加總):
     ```bash
     OD=<Open Design 的 pcm-home-redesign 目錄>
     grep -rc 'PCM MOTOR PARTS LTD\.' "$OD" | awk -F: '{s+=$NF} END{print s}'   # ⇒ 511 次
     grep -rl 'PCM MOTOR PARTS LTD\.' "$OD" | wc -l                            # ⇒ 322 檔
     printf 'PCM MOTOR PARTS LTD. 版權所有' | grep -c 'PCM MOTOR PARTS LTD\.'   # 正向對照 ⇒ 1
     ```
     ⚠️ **本行原寫「288 處」,那是另一條命令的輸出**
     (`grep -rhoE 'PCM MOTOR PARTS LTD.{0,6}' | sort | uniq -c` 之後,
     片語「PCM MOTOR PARTS LTD. 版權所有」的次數;它同時也等於全 OD「版權所有」的總數)。
     **數字是真的,但它掛在產不出它的命令上** ⇒ 複驗者會拿到 511 / 322 / 759,沒有一個是 288。
     (E 窗 `E-627-TO-D` MF1 抓;本窗獨立重跑同值後改。)
     **兩處都已就地加註說明。**

   🔴🔴 **這是鐵則 1「design 直接搬、不翻譯」的一個具名例外** ——
   OD 寫有句點、我方刻意無句點(Sean 拍板 > design)。
   **下一個人若「照 OD 對齊」把句點加回來,就是把 Sean 的拍板改掉。**

   ⚠️ **登記證本身仍未見 = 未確認**(數法:
   `git grep -rniE '登記證|營利事業|統一發票證明|公司登記' -- docs apps packages` ⇒ 10 行,
   逐行看沒有一行是登記證;正向對照 `printf '營利事業登記證' | grep -ciE '登記證|營利事業'` ⇒ 1)。
   ⇒ **現行值的依據是 Sean 口頭 + 06-22 檔案紀錄,不是登記證。** 若日後見到登記證與此不符,
   那是重新拍板的題,不是執行者自行改。

   🔴 **判別句(這題最貴的一課)**:**他確認的是【那個事實】,還是【他對那個事實的記憶】?**
   當日「重申有句點」曾被當成定案,**而重申不是驗證** —— 重申的是記憶,不是登記證。
   事實類問題要問「**你手上有那份文件嗎**」,不是「你確定嗎」。

2. **折扣的組成**(經銷價折了多少 vs 商品特價折了多少)—— `discountTotal` 是**單一合計值**,
   schema 沒有分項欄 ⇒ **只能印一行「折扣」**。
   ⚠️ 「經銷價與特價都走 `discount_total`」目前**唯一載體是一句對話**,
   而 schema(`price_store` 是獨立價格欄)往另一個方向長。已記在 backlog `#513`,
   三處指標在 `#47` / `#215` / `#390`。

3. **預計送達日** —— **零欄位、零來源**。不要從貨運商推算。

4. **`RCPVVJ` / `9JR7NH` 哪個是客人拿去查的** —— 🔴 **這不是資料問題,是產品問題**:
   貨運查詢要用 `trackingNumber`(第 16 欄),**那兩個都不是**。
   ⇒ **要 Sean 定「客人要查什麼」**,定了才知道紙上哪個號要放大、哪個要標「內部用」。

---

## §7 三題裁示

**① 貨運商 `other` 時印什麼 —— 主視窗裁**
印 `carrierNote`,**但不是裸印**:寫成「取貨方式:<carrierNote>」,不是「貨運商:other」。
🔴 **加一條驗收**:`carrierNote` 為空或只有空白 ⇒ **整張紙不印**,走既有
`shippingDocBlocker`(`apps/admin/src/components/print/shipping-doc.tsx:43`)那條路,
訊息寫「這箱沒有填取貨方式,不能印出貨單,請先補」。
理由:`other` 的意思就是「規則之外」,**規則之外而又沒有說明 = 客人拿到一張看不懂怎麼拿貨的紙**。

**② 客人公司名/統編兩欄皆 null —— 主視窗裁**
**整區省略,不留空欄。** 理由兩條:
1. 這張紙**不是表單**,空欄在紙上讀起來像「這裡漏填了」⇒ 客人會打電話來問。
2. 與 §4「不補 0」看似相反、其實不同:那裡 0 會被誤讀成**事實**;
   這裡「沒有開發票需求」**本身就是一個確定的事實**,沒有東西要表達就不要留位置。
⚠️ **驗收加一格**:兩欄**一起有或一起無**;**只有其中一欄有值 = 資料異常 ⇒ 整區不印並記錄**。

**③ `shippedAt` 為 null(建箱未寄)那張紙印什麼日期 —— ✅ Sean 2026-08-15 拍板【甲】**

Sean 逐字:
```
甲 員工先印單、單子跟著貨一起交給貨運, 那日期就是當天=出貨日期。
```
⇒ **建箱未寄的箱子照印**,不走 fail-closed 整張不印。

🔴 **但他的前提是「印完當天就交貨運」,而那個前提會不成立** ——
**箱子在店裡過夜** ⇒ 紙上印 X 日、DB 的 `shippedAt` 之後寫成 X+1 日
⇒ **紙與系統對不上,而客人手上是紙。** 這個邊界他沒有被問到。

**主視窗裁(在 Sean 拍板的語意內,不另問)**:
| `shippedAt` | 印什麼 | 這個值的性質 |
|---|---|---|
| **有值** | 印 `shippedAt` | **事實**(貨運真的收走了) |
| **為 null** | 印**列印當天** | **當下的預期**,之後可能不成立 |

🔴🔴 **⇒ 這一欄在兩種情況下語意不同,不得寫成「恆等於 `shippedAt`」。**
下一個人最可能犯的錯就是看到欄位叫「出貨日期」就直接接 `shippedAt`,
**而 null 那條路他會補一個 fallback,補完長得一模一樣、沒有任何東西會紅。**
⇒ 同族 memory `feedback_near-identical-literals-opposite-semantics`:
**兩個日期字面長得一模一樣,來源與保證完全不同。**

**✅ 標籤文案 —— Sean 2026-08-15 拍板【甲】,逐字:**
```
甲 都叫「出貨日」（簡單，偶爾會跟系統差一天）
```
⇒ **兩種情況共用一個標籤「出貨日」,不分流。**

🔴🔴 **他選的是【標籤共用】,不是【語意相同】。這兩件事不可混。**
括號那半是拍板的一部分:**他明知偶爾會與系統差一天,接受了那個代價。**
⇒ **上面那張語意分歧表不准刪、不准簡化成「出貨日 = `shippedAt`」。**

⚠️ **下一個人最可能做的事**:看到欄位叫「出貨日」就拿它去**對帳**。
**那會錯,而且錯得沒有訊號** —— 紙上是 X 日、DB 是 X+1 日,兩邊各自都自洽。
⇒ 要對帳請讀 `apps/admin/src/lib/shipping/shipment-repository.ts:204` `shippedAt` 本身,
**不要讀這張紙上的字**。(此段為設計約束,非量測結論 —— **未數**。)
**驗收(不論選哪案)**:`shippedAt` 有值與為 null **各一格守門**,
且**斷言渲染出來的文字**(不是斷言傳進去的參數)——
釘參數擋不住顯示層把兩條路折成同一個字面。

---

## §8 誠實邊界

- 本檔**只定內容**。版面、字級、分頁、紙張尺寸**一個字都沒寫**,那是 OD/Design 的產物。
- 座標全部來自**開檔實查**(非記憶、非轉抄),但**行號會漂** ⇒ 引用前用同段錨點重跑。
- **沒查**:`apps/admin/public/` 的圖檔內嵌文字、`.env*` 的值、DB 設定表的**內容**
  (只掃過表名層,且那不是本檔作者的量測)。
- 第 8 欄的 QR 檔尚未下載 ⇒ **「本 app 第一個靜態資產」這句是預測,不是現況。**
