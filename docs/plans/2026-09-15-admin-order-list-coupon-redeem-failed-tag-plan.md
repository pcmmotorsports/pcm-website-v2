# 2026-09-15 · 後台訂單列表加紅標:券扣抵失敗(system_coupon 備註)—— plan

> 🔴 **實作走丙(另打一發只取 order_id),不是甲,見 01e01989f。** 甲(嵌入)撞到「order_notes 只在明細投影、不得滲入列表投影」守門,主視窗裁丙。

> 設計窗。來源:`~/pcm-mailbox/稽核-ecommerce-cia-20260915.md` P1-5;Sean 逐字「q3: 乙」= 先不修擋法,只把超用備註做成後台訂單列表紅標。主視窗 pcm-website-v2-b7 派工。
> **本檔只是 plan,零碼改動。** 碰共用 adapter 投影(甲)或 view(乙)⇒ 鐵則 8,等批。

## 1. 白話

- 客人付款那一刻,系統才真的扣券。扣失敗(例如「每人限一次」已經用過)時,**錢照收**,系統在那張單寫一行內部備註(作者 `system_coupon`)。
- 今天**沒有任何畫面讀這行備註** ⇒ 員工不會知道。
- 本片:訂單列表上,有這行備註的單顯示一顆紅標,員工點進去看備註處理。
- 🔴 **正式庫今天 0 張**(2026-09-15 唯讀:`order_notes` 裡 `author='system_coupon'` 共 0 列)⇒ 上線當下畫面不會有任何變化,要等真的發生才看得到。

## 2. 查到的事實

| # | 事實 | 出處 |
|---|---|---|
| 1 | 備註寫法:`order_notes(note_type='internal', author='system_coupon')`,第一行「🔴 優惠券扣抵失敗, 而這張單【已經收到錢】—— 需要人工處理。」 | `supabase/migrations/20260901030000_m4b_zero_total_settle.sql:661-676` |
| 2 | 寫它的 trigger `coupon_redeem_on_paid` 最新一代就是上面那支(共 2 代) | `bash scripts/latest-definition-of.sh coupon_redeem_on_paid` |
| 3 | 🔴 **它不只記「超用」**:付款時 `redeem_coupon` 任何失敗都寫(限一次、總量用完、券被停用…),失敗原因在備註內文 `SQLERRM` | 同 #1,`EXCEPTION WHEN OTHERS` 包住整段 |
| 4 | 列表資料來源:`admin_order_list_v`(最新 `20260914020000`,內文 `order_notes` 0 次)+ 投影 `ADMIN_ORDER_LIST_SELECT`(沒有嵌入 `order_notes`) | `packages/adapters/src/supabase/SupabaseOrderAdapter.ts:248-249`、`:1311-1322` |
| 5 | 關鍵字搜尋走 RPC `admin_search_orders`,只回單號清單,資料仍從 #4 那條撈 | 同檔 `:1245-1275` |
| 6 | `order_notes` 對 service_role 開 SELECT;有 `(order_id, created_at)` 索引 | `20260729030000_m4b_e10_a3_order_notes.sql:150`、`:205-206` |
| 7 | 員工可以軟刪除備註(`deleted_at`)| `apps/admin/src/lib/orders/note-repository.ts:170` |

⇒ **列表今天沒帶到這行備註。** 要帶就得動資料來源 ⇒ 下面兩條路。

## 3. 兩條路

| | 甲 投影加嵌入(推薦) | 乙 view 加欄 |
|---|---|---|
| 做法 | `ADMIN_ORDER_LIST_SELECT` 加 `order_notes(id)`,查詢加 `.eq('order_notes.author','system_coupon')`、`.is('order_notes.deleted_at', null)`、`.limit(1, { referencedTable: 'order_notes' })`;mapper 轉成 `hasCouponRedeemFailure: boolean` | `admin_order_list_v` 加 `EXISTS (...) AS has_coupon_redeem_failure` |
| migration | **無** | 有(要寫 rollback、貼板、板先貼碼才合) |
| 只帶什麼 | 只帶 note id,**不帶內文**(內文有 SQLERRM、券碼) | 只帶一個布林 |
| 未知 | 🔴 透過 view 嵌入 `order_notes` PostgREST 認不認得到關聯 —— 既有四層嵌入(customers / order_items…)透過同一個 view 可用(`:1298-1301` 實測紀錄),**吻合但未證實** | 無 |
| 會影響 | 列表每頁多一個嵌入子查詢(每單最多 1 列,走索引) | 同左,在 SQL 內 |

- 嵌入的篩選**不加 `!inner`** ⇒ 只篩子列,不會把沒有備註的單從列表拿掉(總筆數不變)。
- 甲的未知若實測不過 ⇒ 退回乙,不硬改。

## 4. 範圍(甲)

1. `packages/adapters/src/supabase/SupabaseOrderAdapter.ts`:投影 + 三個嵌入篩選。開工先 grep `ADMIN_ORDER_LIST_SELECT` 其他使用處。
2. `packages/adapters/src/supabase/mappers/order.ts`:列表 mapper 加一個欄。
3. `packages/domain/src/order/types.ts:656` `AdminOrderSummary` 加 `hasCouponRedeemFailure`。
4. `apps/admin/src/components/orders/orders-table.tsx` + `apps/admin/src/app/globals.css`:紅標。
   - 字面:**「券扣抵失敗」**(對齊備註第一行)。🔴 不寫「超用」—— 事實 #3,它不只記超用。
   - 樣式:OD 稿 `pcm-524f` 今天查不到(OD daemon 沒開)。開工時先查稿;稿上沒有 ⇒ 借列表現有 `.inv-tag` 形狀(`globals.css:2450-2459`),底色用既有 token `--destructive`(`globals.css:126`,`#b42318` / 白字),不配新色。
   - 位置:客戶格,發票 tag 同一層(列高不變)。**不做成可點**,點整列照舊進明細看備註。
5. 測試:mapper 一格(嵌入有列 ⇒ true;空陣列 / 缺欄 ⇒ false)。
6. 驗收:正式庫 0 張 ⇒ 本機造一張帶 `system_coupon` 備註的單,開後台列表肉眼看紅標;再軟刪該備註,紅標消失。
7. 三綠 + codex 一輪(碰券 / 訂單讀模型)。commit 不推。

## 5. 天花板(寫明,不做)

- 員工把備註軟刪除 ⇒ 紅標消失。等於「已處理」,但**沒有處理紀錄**。要「已核對」按鈕是另一題(Sean 未答)。
- 作者 `system_coupon` 是字面比對。員工身分來自員工表,正常不會有人叫這個名字;這不是權限邊界。
- 不加側欄數字、不加「只看有紅標」篩選。要再說。

## 6. Rollback

甲:revert 那一顆 commit(無 DB 變更)。乙:revert + 跑 view 的 rollback 檔。

## 7. 要批的

```
Q:紅標的資料要從哪裡來?
A:  甲 投影加嵌入(推薦):不用 migration、不用貼板;開工第一步本機對真資料打一次, 不通就停回報改乙
  | 乙 view 加一欄:穩, 但要寫 migration、Sean 或主視窗貼板、板先貼碼才能合
```

## 8. 估時

甲:實作 + 本機造資料看 + 三綠 ~40 分;codex 一輪另計。
