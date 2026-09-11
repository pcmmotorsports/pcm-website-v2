# plan(鐵則 8):商品頁副標「等 N 款車型」—— 改什麼 / 為什麼 / 影響 / rollback(2026-09-11,E5;Sean 批 B-甲)

## 改什麼
- `scripts/rpm-transform.ts`:`buildSubtitle` 多收群內去重車款清單;新增 `distinctModelLabels`(N 的唯一定義寫在函式旁註解:**fitments 的 motoBrand+modelCode 去重、不含年式、unconfirmed 也算(主視窗裁 Q1,跟卡片/表格同尺)、任一欄非字串或沒車型 ⇒ 整筆略過**)與 `buildVehicleSegment`(N≤1 不變;N=2「A / B」;N≥3「代表 等 N 款車型」,代表 = view.vehicle_label,比對去空白不分大小寫;**代表為空 ⇒ 維持現況只分類詞,不自己挑**)。`transformGroup` 的 `fitments` 提前算一次,副標與 `fitments` 欄用同一份。
- `scripts/rpm-transform.test.ts`:+9 案例(N=1 跨年式、N=2、N=6 PRN011525 形狀、同 model 不同年式散在兩變體、unconfirmed 不計、fitments 空、vehicle_label null 不變、單欄非字串/只有品牌略過、代表大小寫差異不換人)。既有 golden(N≤1)byte 不變(vitest 83→85)。
- 🔴 R3(opus)量出:15,577 群裡 **214 群代表為空**(`products.brand/model` NULL 但 fitments 有 ≥2 台;gilles 107、eazigrip 33、bonamici 20…)⇒ 這 214 群副標**維持現況不變**(不從 fitments 自己挑代表);代表逐字不在集合 = 0 群(214 全是空的那種)。

## 為什麼(前提要更正一次)
- 原提案說「商品卡副標只寫一台」。**實查:清單頁卡片不讀 `subtitle`**,它走 `apps/storefront/src/lib/product-card-fits.ts:70`,多款已顯示「適用 N 款車型」。**`subtitle` 出現在商品頁標題下那行**(`components/ProductInfo.tsx:370 pd-sub`)與 **SEO description / OG description / JSON-LD description**(`app/products/[slug]/page.tsx:58`、`lib/product-jsonld.ts:150`);admin 列表不讀(`product-repository.ts:95`)。⇒ 改的是**商品頁副標與搜尋引擎看到的描述**,不是清單卡片。PRN011525 商品頁現在寫「KTM 1290 Super Duke R · 車身防護與防摔」,1390 車主點進來看到的第一行是 1290。
- `subtitle` 也被搜尋讀:trgm 索引(`migrations/20260903060000…:126`)與 `search_catalog` SQL(`20260910070000…:92`)⇒ 副標變長會進索引;正式效能未量(Codex 點)。

## 影響(自己算,2026-09-11 11:0x 報價單庫 `storefront_fitments_v` 去重 brand+model)
- 有 fitment 的 20,369 群裡 **15,577 群 ≥2 台**(2 台 ≈4,000、3-5 台 ≈5,000、≥6 台 6,556),下一班同步這 15,577 群的 `products.subtitle` 會改寫;N≤1 的群 byte 不變。
- 改前 → 改後(真資料、真函式):`PRN002390-035381` 「Kawasaki Ninja ZX-14R · 操控部品」→ 不變;`PRN002188-003252-003315`「BMW S 1000 RR · 操控部品」→「BMW S 1000 RR / BMW S 1000 R · 操控部品」;`PRN011525`「KTM 1290 Super Duke R · …」→「KTM 1290 Super Duke R 等 6 款車型 · …」。

## 寫入發生在哪一刻(開檔確認,不是 commit 當下、也不是 Vercel 部署)
`.github/workflows/rpm-sync.yml:76` cron `30 4 * * *`(UTC 04:30 = 台灣 12:30;延遲數字 workflow:69 有更新紀錄,這裡不引舊值),`actions/checkout@v6` 沒固定 ref ⇒ schedule 事件跑**預設分支**的程式(`git remote show origin` 實查 HEAD branch = `dev`;`workflow_dispatch` 手動觸發則看選的分支)跑 `scripts/rpm-import.ts --confirm-write`(:172)⇒ **這個 commit 進 `dev` 之後的下一班 cron**(或有人 `workflow_dispatch` 手動觸發)才會寫;在那之前正式庫一列不變。跟 Vercel 部署無關(這支不在 Vercel 上跑)。

## dry-run 怎麼跑(不寫)
`pnpm exec tsx scripts/rpm-import.ts --dry-run --supplier=evotech`(`rpm-import.ts:155` `DRY_RUN`;沒帶 `--confirm-write` 不寫)。看樣本卡片的 subtitle。

## rollback
- `ProductRow.subtitle` 是**無條件帶 key**(`rpm-transform.ts:453`,不像 description/附件是條件省 key)⇒ 每班同步都會 upsert 覆寫(`rpm-import.ts:933` onConflict `supplier_slug,external_id`)。⇒ **revert 這個 commit 進 `dev`,下一班同步會把 15,577 群寫回舊副標,不用另外補**。
- 🔴 條件(Codex 點):只對「**再次成功同步**的商品」成立 —— 某家當班 `skipProductSync`(`rpm-import.ts:954`,本站商品舊值讀取失敗時整批跳過)、來源消失、供應商退出排程、前置 gate abort 或批次失敗,那些商品的副標會停在新值直到下一次成功。要驗:revert 後一班,對 15,577 群逐群比 `subtitle` 是否回舊值。
- 不需要 DB migration、不需要手動 UPDATE。

## 🔴 等 Sean 拍的兩題(R3 抓到,程式先照原批做)
1. ~~unconfirmed 要不要排除~~ **已裁:不排除**(主視窗 2026-09-11,理由如下)。原題:本改動排除;但清單卡片 `product-card-fits.ts:56-73`「N 款車型」與商品頁適用車款表 `ProductFitments.tsx:66-79` **都不排除**(表格只是不顯「未確認」標)⇒ 一群 4 台含 1 台 unconfirmed 會變成卡片「4 款」、副標「等 3 款車型」、表格 4 列。甲 副標也不排除(跟既有兩處同一把尺,改一行)| 乙 維持排除,同批把卡片與表格也改排除 | 丙 維持不一致。
2. **量詞**:卡片寫「N **款車型**」,副標批的是「等 N **台**」;要不要統一成「等 N 款車型」。

## 驗收
1. 三綠(`TURBO_FORCE=1 pnpm typecheck` / `pnpm lint` / `pnpm build`)+ vitest 該檔全綠。
2. 併進 dev 後第一班同步:抽 PRN011525(等 6 款車型)、PRN002188-003252-003315(列兩台)、PRN002390-035381(不變)三個商品頁,肉眼看副標;OG description 跟著變。
3. **做完的定義 = Sean 自己開瀏覽器看商品頁**(本專案 CLAUDE.md)。
