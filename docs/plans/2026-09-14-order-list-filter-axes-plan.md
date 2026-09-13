# plan · 訂單列表「只看」三顆篩選軸 + 預設「未完成」—— 2026-09-14

> Sean 2026-09-14 00:5x 拍:Q4 甲(預設「未完成」亮)· Q5 乙(多樣的單 / 車行 / 直客 **加篩選軸,一口氣做好**)· 「我目的是完整的完成,不要分次,一次做到完畢」。
> 盤查:主視窗派 Plan subagent(opus)唯讀盤查 `agent/ops-8`(工具列 346a27914 / 凍結 d16d21d0e 之後),主視窗謄寫。數字附檔:行。

## 0. 現況
- 「只看」chips 已是「既有 URL 參數 → 按鈕」純映射:`apps/admin/src/lib/orders/order-toolbar-view.ts:70-105`(`VIEW_CHIP_KEYS` / `VIEW_CHIPS`);346a27914 檔頭逐字「三顆今天沒有篩選軸 ⇒ 不畫」。
- 篩選型別 `AdminOrderFilter`:`packages/domain/src/order/types.ts:327`;parser + 窮舉 href 表:`apps/admin/src/lib/orders/order-list-view.ts:393`(parse)/ `:789 byFilterKey` / `:843 values`(**加軸不列 ⇒ tsc 紅,那是機制**);下推:`packages/adapters/src/supabase/SupabaseOrderAdapter.ts:1323-1380`。
- 列表 view `admin_order_list_v` 第 6 欄已有 `tier_at_checkout`;**沒有品項數**。

## 1. 改什麼
三顆都在第三列「只看」,與六顆狀態 chip 純 AND(`VIEW_CHIP_KEYS` 與 `STATUS_CHIP_KEYS` 只在 `paymentStatus` 相交,新軸不相交)。

| chip | URL | filter | SQL | migration |
|---|---|---|---|---|
| 車行 | `?tier=store` | `customerTiers: ['store']` | `.in('tier_at_checkout', ['store'])` | 無 |
| 直客 | `?tier=general` | `customerTiers: ['general']` | `.in('tier_at_checkout', ['general'])` | 無 |
| **經銷**(主視窗裁:補第三顆,零 SQL) | `?tier=premiumStore` | `customerTiers: ['premiumStore']` | `.in(…)` | 無 |
| 多樣的單 | `?multi_item=1` | `multiItemOnly: true` | `.gt('item_count', 1)` | **要**(view 加 `item_count`) |

- 經銷:系統三級 general / store / premiumStore(`order-list-view.ts:283 MEMBER_TIER_LABEL` 印「經銷」);稿只畫兩顆 ⇒ 若只做兩顆,經銷單兩顆都看不到。主視窗裁**補第三顆「經銷」**(chip 一行、零 SQL、與系統三級一致;Sean「有建議就加進去」)。
- tier 白名單用 `lib/customers/customer-list-view.ts:102 TIER_VALUES`。
- 多樣的單為什麼要 migration:PostgREST 做不到 embed 的 HAVING;JS 側過濾會壞分頁與 `count: 'exact'`。

### migration `20260914020000_m4b_admin_order_list_v_item_count.sql`
- `scripts/migration-version-free.sh 20260914020000` 2026-09-14 已跑:116 ref / 8 worktree 沒人用(貼的當天重掃)。
- 從 `bash scripts/latest-definition-of.sh admin_order_list_v` 指的最新一代(`20260905360000_…:833`)抄,`CREATE OR REPLACE VIEW`;新欄 `(SELECT count(*) FROM public.order_items oi WHERE oi.order_id = o.id)::int AS item_count` **必須附在最尾**(第 45 欄;插中間 = `42P16 cannot change name of view column`,檔內記過兩次)。
- 口徑:數 `order_items` 列數,**不扣已取消件**(ceiling 寫檔頭;要扣改 `FILTER (WHERE …)`)。
- 事後閘:欄數 45、最後一欄名 `item_count`、GRANT 沒漂(`service_role` `20260814140000:151`、`pcm_readonly` `20260905160000:157`)、COMMENT 在。
- `database.types.ts` 手貼 `item_count: number | null`(Row)與 `?: never`(Insert / Update),不計進手動校正數。

### 計數 chips
零改動:`lib/orders/order-list-count.ts:47` 走 filter → href → parser → 同一支 total,新軸只要進 `buildOrderListHref` 就自動跟著;`page.tsx:216 applyStatusChip` 先清狀態鍵 ⇒ 不互相污染(語意同既有來源 / 管道:只看選了,六顆數字跟著縮)。

### 預設「未完成」(Q4 甲)
- **不動 parser 預設值**(parser 加預設 = 「全部」變成不可表達,且會蓋掉首頁卡與側欄帶參數的連結)。
- 改 `apps/admin/src/app/orders/page.tsx:162` `parseOrderListSearchParams` 回傳後一行:
  `const urlFilter = Object.keys(rawSearchParams).length === 0 ? applyStatusChip(parsed, STATUS_CHIPS[0]) : parsed;`(只在**裸 `/orders`** 生效)。
- 🔴 副作用要知道:母體從「全部」變 `goods_axis in (none, ordered, instock)`,adapter 那個 `if` 會**連帶** `.is('cancelled_at', null)` + `.neq('payment_status','refunded')` ⇒ **進站預設看不到已取消 / 已退款單**;點「全部」才看得到。稿就是這樣(未完成預設亮),照做。
- 首頁三格(`lib/dashboard/today-todo-read.ts:34 TODO_LIST_SPECS`)與 chip 連結全走 `frozenListHref`,一律帶 `date_from/date_to` ⇒ 非空 ⇒ 不被預設蓋掉。
- 受影響測試:`app/orders/page.test.tsx` 約 15 處 `renderPage({})`(第二列從無字變「未完成 N 張單」、`statusChipActive` 亮一顆)、`order-toolbar-browser.test.tsx` 預設幾何、`order-toolbar-entry.test.tsx`。改期望值的理由逐格寫在檔內(是行為改了,不是放寬)。

## 2. 影響
- 一般會員:零(後台 view / adapter)。
- 列表:多一欄 `item_count`(零消費者前零影響);裸 `/orders` 母體變「未完成」。

## 3. rollback
- TS 全部 = revert commit。
- migration **不 rollback**:`CREATE OR REPLACE VIEW` 拔不掉欄;真要拔得 `DROP VIEW` 再建並補兩道 GRANT + COMMENT ⇒ 前向做法是**留著那一欄**(零消費者 = 零影響)。

## 4. 切片(B 窗)
| 片 | 內容 | 依賴 | 分 |
|---|---|---|---|
| S1 | migration 20260914020000(檔 + 事後閘 + 檔頭 ceiling),**不貼**、等 Sean 點名 | 無 | 30 |
| S2 | tier 軸:domain `customerTiers` → parser `tier` → href 兩張窮舉表 → adapter `.in` → 三顆 chip(車行 / 直客 / 經銷)+ 往返測試 | 無 | 45 |
| S3 | 多樣的單:`multiItemOnly` 全鏈 + `.gt('item_count',1)` + `database.types.ts` 手貼 | S1(本機拋棄式 PG 可先驗;正式庫要貼了才能用) | 40 |
| S4 | 預設未完成一行 + 修 `page.test` / browser 基線 + 三綠 | S2 | 25 |
