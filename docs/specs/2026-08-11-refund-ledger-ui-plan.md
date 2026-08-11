# 退款帳本畫面 plan(line map 知情缺口 3;S 五代唯讀偵察 + 草稿)

> 來源:`S-076-A`(主視窗派工)/ 缺口出處 `docs/specs/2026-08-11-refund-line-map.md:112-113`
> 產出者:S 窗五代,2026-08-11 深夜。**本檔是 plan 草稿,不是批准後的施工令**;實作歸屬與審查鏈等主視窗定。
> 🔴 全篇 schema 事實一律開**建表 migration 原始檔**核,不引 STATUS/plan 轉述(每條附 `檔案:行號`)。

---

## 0. 一句話結論(先講最重要的那件事)

缺口 3 的真實形狀**不是**「有一本帳本沒有畫面」,而是:

**後台已經有一個叫「退款帳本」的畫面,它讀的是另一張表。**
既有畫面(`refund-ledger-section.tsx` + `/orders/refund-exceptions`)讀 `order_refunds`(M-3 A7c);
L5b 帳本(`payment_refunds` + `payment_refund_events`)**零畫面、且對任何 client 角色零讀取權**。

⇒ 本片的兩個本體是 **①先開出一條讀取面(現在不存在,數法見 §1-3)** 與
**②解決畫面上會有兩個「退款帳本」的命名衝突**,而不是「畫一張表格」。
②是 Sean 拍板題(§7 Q1),不是我能定的。

「L5b 零畫面」的數法(line map `:113` 用的同一條,我複跑確認):
`grep -rl 'payment_refund_events' apps/ | wc -l` → **0**;
`grep -rl 'payment_refunds' apps/ | wc -l` → **0**。
「既有畫面讀的是 `order_refunds`」的座標:`apps/admin/src/lib/payment/refund-read.ts:76`(訂單頁帳本)
與 `:121`(異常清單)兩處 `.from('order_refunds')`。

---

## 1. 偵察結果 A:L5b 帳本讀取面現況(驗收條件 1)

### 1-1 兩張表與欄位(建表 migration 原始檔)

`supabase/migrations/20260810140000_m4b_lifecycle_l5b_refund_ledger.sql`

- **父表 `payment_refunds`**(`:75-117`):一列 = 一個 logical refund = **一次物理退款嘗試 = 一把冪等鍵**。
  `attempt_id`(`:79`,→ `payment_charge_attempts`)/ `supersedes_refund_id`(`:80`,重試鏈)/
  `idempotency_key`(`:81`,**就是 TapPay `bank_refund_id`**,形狀 `^[A-Za-z0-9_-]{1,20}$`,`:105`)/
  `amount`(`:82`,🔴 **整數「元」不是分**)/ `currency`(`:83`,CHECK = `'TWD'`,`:88`)/
  `strong_key`(`:84`)/ `lease_token`(`:85`)/ `created_at`(`:86`)。
  🔴 **無 `order_id` 欄** —— 要掛到訂單頁必須 `JOIN payment_charge_attempts ON id = attempt_id`
  取 `order_id`(op6a `20260811030000:144-146` 就是這樣走的)。
- **子表 `payment_refund_events`**(`:124-135`):append-only 事件流。
  `refund_id` / `event_type` / `seq`(`:128`)/ `lease_token` / `record_snapshot jsonb`(`:130`)/ `created_at`。
- **後續兩片的加法**:
  `payment_refunds.rec_trade_id`(2c,`20260811080000:238-239`,nullable、TapPay rec 快照)、
  `strong_key` 值域 `^(rec|bank):…`(同檔 `:325-327`)、
  `manual` 事件必須帶可判讀 verdict:`record_snapshot -> 'refunded'` 必須是 **boolean**
  (同檔 `:356-358`)。

### 1-2 event_type 值域與 terminal 集合(**2d 之後已經變過一次**)

`supabase/migrations/20260811110000_m4b_lifecycle_l5b2_2d_result_confirmed_event.sql`

- 值域 7 值(`:187-188`):`sent` / `result_success` / `result_confirmed` / `result_failed` /
  `result_unknown` / `reconcile` / `manual`。
- 🔴 **terminal 集合 = `result_confirmed` / `result_failed` / `manual`**(`:200-201` 的唯一索引述詞),
  **`result_success` 已退出 terminal**(`:206` 逐字:排除條件必須認 `result_confirmed`,
  否則訊號會提前消失)。
  ⇒ **畫面語意直接吃到這件事**:`result_success` = 「TapPay **受理**」,`result_confirmed` = 「**已確認**」,
  兩者是兩個不同的終局階段,顯示層不得合併成一句「已退款」。

### 1-3 🔴🔴 讀取面現況 = **不存在**(這條決定整個片界)

- `20260810140000:148-149`:`REVOKE ALL ON TABLE payment_refunds / payment_refund_events
  FROM PUBLIC, anon, authenticated, service_role, payment_confirmer;`
  `:150-151` 兩表 `ENABLE ROW LEVEL SECURITY` 且**零 policy**。
- 實查全庫 migration:`grep 'payment_refunds' supabase/migrations/*.sql | grep -iE 'grant|revoke'`
  → **只有那一行 REVOKE,從來沒有任何 GRANT**。
- 後台既有讀取層一律走 `createSupabaseServiceClient()`(`apps/admin/src/lib/payment/refund-read.ts:75`)
  = **service_role** ⇒ 對這兩張表**一格權限都沒有**。
- 佐證(不是推論):op6a 自己的斷言逐字寫著這件事 ——
  `20260811030000:267`「本函式不是 SECURITY DEFINER ⇒ service_role 對錢帳表零表權限,一格都跑不了」。

⇒ **任何 L5b 畫面都必須先有一支 SECURITY DEFINER 讀取 RPC**。這是 migration,不是前端片。

### 1-4 現存唯一的「可呼叫讀取面」= op6a(範式在這裡,別另發明)

盤點數法:`grep -rln 'FROM public\.payment_refund' supabase/migrations/ | sort` → **5 檔**。
逐檔分類:建表 `20260810140000` / 加欄 `20260811080000` / 改值域 `20260811110000` 三檔是 DDL 自己的斷言;
**`20260811050000`(OP4 歷史卡軌回填)是一次性 DML**,`:202`、`:288` 拿 `payment_refunds` 當
`NOT EXISTS` 排除條件 —— 它是 migration 內的一次性查詢,**不是 app 呼叫得到的讀取面**;
⇒ 真正可被 service_role 呼叫的只剩 op6a 一支。
(🔴 我第一版把這句寫成「唯一現存的 L5b 消費者 = op6a」,漏了 OP4 那檔 —— 盤點指令跑出五檔才發現,
已改成現在的字面。這條記在此,免得下一個人以為 op6a 是唯一碰過這兩張表的東西。)

`supabase/migrations/20260811030000_m4b_e10_op6a_compute_order_settlement.sql`
- `:51-54` `RETURNS jsonb` + `SECURITY DEFINER`;`:254-256` `REVOKE ALL … ; GRANT EXECUTE … TO service_role;`
- `:144-154` 已經有一份「有效退款」判定(正向存在式:**必須有 terminal 且全部是 `result_failed`** 才除外;
  `:141-143` 逐字寫明為什麼不能寫成 `NOT EXISTS` —— 那會讓 `sent`-only 與 `result_unknown`-only
  兩個最危險的未知態變成空集恆真)。
- ⇒ 本片的讀取 RPC **照抄這個形狀**(SECDEF + `search_path=''` + REVOKE/GRANT service_role + ACL 閉世界斷言),
  🔴 但**不得自己再寫一份有效事件判定**(理由見 §4 依賴)。

---

## 2. 偵察結果 B:既有 admin 訂單頁模式,哪些直接沿用(驗收條件 2)

| 現成資產 | 位置 | 本片怎麼用 |
|---|---|---|
| 明細頁載入與組裝(整頁 + 右側面板**共用**) | `apps/admin/src/components/orders/order-detail-route.tsx`(241 行;`:113` 三路 `Promise.allSettled`) | **加第四路**,不新建載入器。🔴 `:25` 逐字:複製一份 = 兩邊會慢慢分岔 |
| 帳本區塊元件(結構、容錯旗標、截斷旗標) | `components/orders/refund-ledger-section.tsx`(170 行) | **照抄結構、不共用元件**(讀不同表、欄不同);它的 `loadFailed` / `rowsTruncated` / `nowMs` props 形狀直接沿用 |
| 顯示層純函式 + 標籤字典 | `lib/payment/refund-ledger-view.ts` | 新增 L5b 專屬標籤檔;🔴 `Object.hasOwn` 取值(`:31`,原型鏈事故已中過六頁)、未知碼原樣顯示不猜 |
| 讀取層 + 顯式上限 + truncated 旗標 | `lib/payment/refund-read.ts:67-88`(`ORDER_REFUNDS_LIMIT = 100`) | 同款 N+1 取法。🔴 PostgREST `max-rows=1000` 會**靜默截斷**,不帶 `.limit` 不是「無截斷」 |
| 跨訂單清單頁模式 | `app/orders/refund-exceptions/page.tsx`(143 行) | 本片**不做**跨訂單頁(§5 片界說明) |
| 側欄導覽 | `components/layout/app-sidebar.tsx:23-33` | 本片不加項(沒有新頁面) |
| 入口旗標 | `lib/payment/refund-ui-flag.ts` | 🔴 **不吃它**。理由照既有先例逐字:`refund-ledger-section.tsx:18-20`「旗標控制的是**發起入口**;帳本列是既成事實,有列就得讓人看見」 |

---

## 3. 要顯示什麼(員工視角;準則 = 不用人教能做對)

準則出處:memory `project_admin-ux-operation-intuitiveness`(每個 UI 片驗收含「不用人教能做對嗎」)。

**掛哪裡**:訂單明細頁,既有「退款帳本」區塊**下方**,獨立區塊。理由:員工的問題是「這張單的退款怎麼了」,
不是「這筆錢在哪本帳」—— 兩本帳分開兩頁會逼員工自己記得要看兩個地方,那正是「要人教」。

**每列顯示(父列 = 一次退款嘗試)**:

| 欄 | 值 | 為什麼是這個字面 |
|---|---|---|
| 發生時間 | `created_at` | 沿用 `formatOrderDateTime` |
| 金額 | `amount` | 🔴 整數**元**,直接餵 `formatOrderAmount`,**不得除 100**(`20260810140000:82`;差 100 倍的 bug 在測試裡只長成「數字不一樣」) |
| 現在到哪 | 由**有效終局事件**推導的員工字面 | 見下方狀態字典 |
| 這筆錢動了沒 | 三態:**已確認出去** / **還不確定(勿重複發起)** / **沒有動** | 員工唯一真正要的答案 |
| 補充 | 重試鏈第幾手(`supersedes_refund_id` 有值 = 這是前一筆的重試) | 防「看起來退了三次」的誤讀 |

**狀態字典(草案,🔴 中文字面暫定、待 Sean 肉眼定稿;結構鎖字不鎖 —— 沿用既有片慣例)**:

- 無 terminal、只有 `sent` → 「**已送出、結果未知(勿重複發起)**」
- 無 terminal、有 `result_unknown` → 同上,並標**需人工對帳**
- `result_success`(已非 terminal)→ 「**TapPay 已受理,尚未確認入帳**」
- `result_confirmed` → 「**已確認退款完成**」
- `result_failed` → 「**失敗(錢沒有動)**」
- `manual` + `record_snapshot->'refunded' = true` → 「人工結案:**錢已出去**」
- `manual` + `refunded = false` → 「人工結案:**錢沒有出去**」🔴 語意待釘(§7 Q3)

🔴 **措辭鐵律沿用**(`refund-ledger-view.ts:5-9`):凡「還能退多少」一律不得出現在本區塊 ——
L5b 帳本同樣不含 Sean 在 TapPay Portal 場外退的錢。本區塊**只回答已發生什麼,不回答還能退多少**。

**讀取層走什麼**:server component → `refund-read` 同層新檔 → `createSupabaseServiceClient().rpc(<新 RPC>)`。
全程 server 端;本區塊零 client component、零經銷面欄位(這兩張表本來就沒有價格欄)。

---

## 4. 依賴(🔴 本片不得自行定義的東西)

**canonical「有效事件」predicate = P 八代沖銷片的一級交付物**
(`docs/specs/2026-08-11-refund-manual-reversal-plan.md:117-130`,契約是一個**具名 view**)。
該檔 `:124-125` 逐字:**所有讀取面一律消費它,不得再自己問「有沒有 manual」**。

⇒ **本片的排序結論(給主視窗排程用)**:
本片的讀取 RPC **必須排在沖銷片(③)之後**。若搶先做,RPC 裡就會出現第二份有效事件判定 ——
正是 P plan 明文禁止、且沖銷片之後必須回頭改的東西。
(現況已有一份在 op6a `:147-154`,沖銷片自己要改寫它;本片再加一份 = 從兩份變三份。)

**不阻擋的部分**:§3 的顯示字面、§2 的沿用盤點、狀態字典的結構,都不吃這條依賴,可先行定稿。

---

## 5. 片界與估時(15-45 分/片;超過拆)

| 片 | 內容 | 型 | 估時 | 前置 |
|---|---|---|---|---|
| **U1** | L5b 帳本讀取 RPC(migration):SECDEF + `search_path=''` + REVOKE/GRANT service_role + ACL 閉世界斷言;回一顆訂單的父列 + 有效終局;**消費沖銷片的 canonical view** | **高風險片**(鐵則 12 ①錢 ②權限 ③DB 結構) | 40 分 + 審查鏈 | 沖銷片 ③ 完成 |
| **U2** | 讀取層 + 顯示層純函式(mapper、標籤字典、N+1 截斷旗標)+ 單測 | 標準片 | 35 分 | U1 |
| **U3** | 訂單頁區塊掛載(`order-detail-route.tsx` 加第四路 `allSettled` + 新區塊元件)+ 頁層接線測試 | 標準片 | 40 分 | U2 |

**合計 3 片**(line map 的 14 片會變成 17 片;`docs/specs/2026-08-11-refund-line-map.md:110` 逐字已預告
「14 這個數字只會變大,不會變小」)。**Sean apply 停點 +1**(U1 的 migration)。

**L 級**:L1(欄位與狀態語意由 schema 決定、年 0-1 次變動)。**不是 L3** —— 畫面上沒有任何要員工日常維護的內容。

**刻意不做(YAGNI,寫明何時該加)**:
- **跨訂單的 L5b 帳本清單頁**:開燈(⑤)不需要它 —— 開燈要的是「員工看得到這張單發生什麼」。
  何時加:真退款實測(⑥)之後,若出現「不知道哪張單卡住」的實際值班需求,再照
  `/orders/refund-exceptions` 的形狀補一頁。
- **把兩本帳合併成一個區塊**:那是資料模型題不是畫面題,且會動到 M-3 已上線的顯示面。
- **任何寫入/操作按鈕**:本片是純讀取面。人工修正的動作歸沖銷片的 `admin_correct_refund_manual_verdict`
  (P plan `:152`),不在本片。

---

## 6. 連動面(只劃界、不重疊)

| 對象 | 邊界 |
|---|---|
| **③ 沖銷片(P 八代)** | 它定語意(canonical view)+ 寫入面;本片**只消費、不定義**。本片排它之後 |
| **2h-2m(P 線)** | `2m` 是「**三支讀取面**排除已 `result_confirmed` 的 attempt」(line map `:52`)= **誰該被掃到**;本片 = **員工看得到什麼**。兩者都讀同一批事件,但一個決定機器行為、一個決定人的認知 ⇒ 零重疊 |
| **④ 已付款取消整合(E)** | 它整合的是**取消流程**;本片零 action、零流程。E 的片若要在畫面上呈現退款結果,吃本片的顯示層,不另做 |
| **D 的 B2-c** | 不碰 |
| **⑤ 開燈** | 本片是它的前置(缺口 3 的全部內容)。開燈前置 = U1+U2+U3 三片綠 |
| **既有 `order_refunds` 帳本區塊(M-3 A7c)** | **完全不動它**。本片只在其下方新增區塊。🔴 唯一的交會點是命名(§7 Q1) |

---

## 7. 問題清單(語意拿不準的一律列在這、不硬寫)

```
Q1(Sean 拍板題;🔴 最該先答):訂單頁上會同時出現兩個退款區塊 —— 舊的讀 order_refunds、
   新的讀 L5b payment_refunds。兩個都叫「退款帳本」= 員工分不出來。命名怎麼定?
A: A|B|C
   A. 舊區塊維持「退款帳本」,新區塊叫「補償退款紀錄」(推薦:L5b 的來源就是補償退款線,
      且完全不用動已上線的 M-3 顯示面)
   B. 舊改叫「一般退款」、新叫「補償退款」(對稱好懂,但要動已上線區塊的字面)
   C. 兩區塊合併成一張時間軸,來源當一欄(員工最直覺,但要動 M-3 已上線顯示面+多一片工)

Q2(主視窗可裁):本片排在沖銷片之後(§4 的理由)—— 確認這個排序,還是要我先做不吃 view 的
   U2/U3(顯示層與掛載),U1 等 view 好了再補?
A: A|B
   A. 整片等沖銷片(推薦:U2 的 mapper 形狀會被 view 的回傳形狀決定,先做會重工)
   B. U2/U3 先行、U1 後補

Q3(依賴 P 八代已列的必答項,本片不自答):`manual` 且 `record_snapshot->'refunded' = false`
   在畫面上該顯示成「錢沒出去」還是「等同失敗」?
   —— 這題 P plan 自己標為必答(`2026-08-11-refund-manual-reversal-plan.md:139-141` 逐字:
   canonical 只回答哪一列有效、不回答 refunded=false 要算什麼)⇒ 本片**引用它的結論**,不自定義。
```

**另外兩條非決策的待確認**(不擋 plan、實作前查):
1. 讀取 RPC 的回傳形狀(jsonb vs `RETURNS TABLE`):op6a 用 jsonb,但它回的是單顆判定;
   本片回的是列陣列 ⇒ 兩種都合理,U1 開工時對照 `admin_*` 既有讀取 RPC 的多數形狀再定。
2. 重試鏈在畫面上要不要縮成一列(鏈尾)還是逐列攤開:取決於真實鏈長,而現在正式庫這兩張表
   **列數極少**(2c 前置閘會印列數)⇒ 先逐列攤開(資訊不損失),量大了再收。

---

## 8. 本檔的誠實邊界

- §1 全部欄位/ACL/值域事實 = 開 migration 原始檔逐行核對,附行號可複驗。
- §2 沿用盤點 = 實讀該六個檔案(行數逐一 `wc -l` 過)。
- **未做**:未在正式庫查這兩張表的實際列數與資料樣態(本片是唯讀偵察 + plan,不需要;
  U1 開工前應查一次,列數會影響 §7 待確認 2)。
- **未做**:未量測既有 `order_refunds` 區塊與新區塊並排後的版面(那是實作片的肉眼驗收)。
