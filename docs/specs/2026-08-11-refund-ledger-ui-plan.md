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

### 3-1 🔴 空狀態(補漏;實查後才發現這是主狀態不是邊角)

兩張表現在 **0 列**(§7-1),寫入面還沒生 ⇒ **開燈當天絕大多數訂單這一區都是空的**。
員工看到空白時必須能分辨三件事,而且**不能靠人教**:

| 情境 | 畫面 | 為什麼不能合併 |
|---|---|---|
| 這單沒有這類退款 | 「這張訂單沒有<區塊名>紀錄」 —— 🔴 `<區塊名>` **綁 Q1 的答案**,不得先寫死 | 正常態、不需要做任何事 |
| 讀取失敗 | 沿用既有 `loadFailed` 樣式 + 「請通知系統維護」 | **看起來也是空的**,但意思是「不知道有沒有」 |
| 功能尚未啟用 | 不渲染本區塊 | 見下 |

🔴 **空 ≠ 失敗**:兩者在畫面上都是「沒有列」,而它們對員工的指示完全相反(一個是安心、一個是快叫人)。
既有 `refund-ledger-section.tsx` 的 `loadFailed` prop 就是為這件事存在的 ⇒ **照抄,不要簡化掉**。
(這正是本 repo 記過的形狀:`feedback_guard-checks-existence-not-effect` 那族 —— 「沒有東西」不等於「沒事」。)

⚠️ 「功能尚未啟用時不渲染」與 §2 表格「**不吃** `refund-ui-flag`」不衝突:那條講的是**有列就得讓人看見**;
本行講的是**一列都沒有、且整條線還沒開**時不必占版面。**兩者的判準不同**(前者看資料、後者看旗標)⇒
U3 實作時要把它寫成兩個獨立條件,不要塞成一個布林(塞成一個 = 有列卻被旗標藏起來,正是前者禁的事)。

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

🔴 **2026-08-12 主視窗裁 Q4=A ⇒ 實際前置再往後推到「2g 之後」**(`S-082-A`)。
兩條依賴的性質不同,**都要滿足、不可互相取代**:
- **語意依賴 → ③ 沖銷片**:沒有 canonical view 就會生第三份判定(上一段)。
- **驗收依賴 → 2g**:寫入面在 2e/2f/2g,在那之前兩張表是 0 列(§7-1)⇒ 畫面驗不到「員工看不看得懂」,
  而那正是本片存在的理由。
- 2g 在 ③ 的下游 ⇒ **「2g 之後」蘊含「③ 之後」**,取 2g 為單一前置字面。
⚠️ line map 目前把 U 片依賴寫成「③ 之後」,**字面待 P 改**(`S-082-A` 第 3 點:主視窗轉達)。
   在 map 改好之前,以本檔為準。

**不阻擋的部分**:§3 的顯示字面、§2 的沿用盤點、狀態字典的結構,都不吃這條依賴,可先行定稿。

---

## 5. 片界與估時(15-45 分/片;超過拆)

| 片 | 內容 | 型 | 估時 | 前置 |
|---|---|---|---|---|
| **U1** | L5b 帳本讀取 RPC(migration):SECDEF + `search_path=''` + REVOKE/GRANT service_role + ACL 閉世界斷言;回一顆訂單的父列 + 有效終局;**消費沖銷片的 canonical view** | **高風險片**(鐵則 12 ①錢 ②權限 ③DB 結構) | 40 分 + 審查鏈 | **2g 完成**(含 ③;Q4=A) |
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
| **③ 沖銷片(P 八代)** | 它定語意(canonical view)+ 寫入面;本片**只消費、不定義**。語意依賴它,但**實際前置是 2g**(§4 裁定) |
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
   A. 舊區塊維持「退款帳本」,新區塊叫「補償退款紀錄」
      ⚠️ **2026-08-12 這個推薦已被打回**:Sean 反問「補償是什麼意思」(`S-084-A` §3)
      ⇒ 該詞沒過「不用人教」關。主視窗已另給他四個白話選項(含「系統自動退款」類),
      **答案回來以那個為準**,不是本行。
      🔴 我當初的推薦理由逐字是「L5b 的來源就是補償退款線」—— 那是**拿內部線名當客人看的字**,
      正是本 plan §3 自己引的準則(memory `project_admin-ux-operation-intuitiveness`:
      文案寫怎麼做、不寫內部語彙)明文禁的。**引了準則不等於套用了準則。**
   B. 舊改叫「一般退款」、新叫「補償退款」(對稱好懂,但要動已上線區塊的字面)
   C. 兩區塊合併成一張時間軸,來源當一欄(員工最直覺,但要動 M-3 已上線顯示面+多一片工)

Q2【已裁=A,`S-079-A`】本片排在沖銷片之後(§4 的理由)—— 確認這個排序,還是要我先做不吃 view 的
   U2/U3(顯示層與掛載),U1 等 view 好了再補?
A: A|B
   A. 整片等沖銷片(推薦:U2 的 mapper 形狀會被 view 的回傳形狀決定,先做會重工)
   B. U2/U3 先行、U1 後補

Q4【已裁=A,`S-082-A`:U 片排 2g 之後、拿真資料驗;開燈前置多一格=接受】
   兩張表現在 0 列、寫入面在 2e/2f/2g,
   ⇒ U3 做完時**可能一列資料都沒有**,「畫面對不對」肉眼驗不到。怎麼排?
A: A|B|C
   A. U 片排在 2g(寫入面)之後,拿真實資料驗(推薦:唯一能驗到「員工看得懂」的做法;
      代價=開燈前置再往後一格)
   B. U 片照現序,肉眼驗收只驗空狀態,有資料後補一次驗收(開燈前必補)
   C. 用拋棄式庫塞構造資料驗畫面(驗得到形狀,但驗不到真實語意;正式庫不得塞)

Q3(依賴 P 八代已列的必答項,本片不自答):`manual` 且 `record_snapshot->'refunded' = false`
   在畫面上該顯示成「錢沒出去」還是「等同失敗」?
   —— 這題 P plan 自己標為必答(`2026-08-11-refund-manual-reversal-plan.md:139-141` 逐字:
   canonical 只回答哪一列有效、不回答 refunded=false 要算什麼)⇒ 本片**引用它的結論**,不自定義。
```

**原本掛著的兩條待確認 —— 2026-08-12 00:3x 已查完,兩條都結案**(唯讀,不動 Q2=A 的押住狀態):

1. **回傳形狀 = `jsonb`,無懸念。** 問 catalog 而不是數 migration 的 CREATE 敘述
   (後片會改定義,文字掃描看不到 —— memory `reference_count-objects-from-catalog-not-create-statements`):
   `SELECT proname, pg_get_function_result(oid), proretset FROM pg_proc … WHERE proname LIKE 'admin\_%' OR 'pcm\_%'`
   → **全部 `proretset = false`,零支 set-returning**;結構化回傳一律 jsonb。
   **範式 = `admin_list_order_payments`**(`20260811090000`)——它正好也是「回一串列」的讀取 RPC。
   兩條可直接繼承、不必重新踩:
   - 🔴 `jsonb_agg` 對**空集合回 NULL 不是 `[]`** ⇒ 必須 `COALESCE(…, '[]'::jsonb)`(該檔 `:34`、`:117`)。
     **本片踩到這條的機率是 100%** —— 見下面第 2 點:兩張表現在就是空的。
   - 🔴 **禁把裸列塞進 `jsonb_build_object`**(該檔 `:341-342`):`jsonb_agg(p)` 會外流全部欄位,
     未來新增的欄位自動跟著外流 ⇒ 欄位白名單逐欄寫死。
2. **重試鏈逐列攤開(定案),理由換成實測**:正式庫實查
   `SELECT count(*) FROM payment_refunds` → **0**、`payment_refund_events` → **0**(2026-08-12 00:3x,MCP 唯讀)。
   ⇒ 沒有任何真實鏈可以拿來反對「攤開」,收合是純想像的最佳化 ⇒ **逐列攤開**,量大了再收。

### 7-1 🔴 兩張表現在是空的 —— 這件事本身改了 plan 兩處

`payment_refunds` = **0 列**、`payment_refund_events` = **0 列**(實查同上)。而且**寫入面還沒生**
(寫入來自 L5b-2 的 2e/2f/2g,在本片之前排;§4 裁定後本片前置=**2g 之後**)。兩個後果:

- **空狀態不是邊角,是開燈當天的主狀態** —— 原 §3 沒寫它,這是本 plan 的漏。補進 §3-1。
- **U3 的肉眼驗收會沒有東西可看** ⇒ 新增 Q4(下方),交主視窗排。

---

## 8. 本檔的誠實邊界

- §1 全部欄位/ACL/值域事實 = 開 migration 原始檔逐行核對,附行號可複驗。
- §2 沿用盤點 = 實讀該六個檔案(行數逐一 `wc -l` 過)。
- ~~**未做**:未在正式庫查這兩張表的實際列數與資料樣態~~ → **2026-08-12 00:3x 已查**(MCP 唯讀):
  兩表皆 **0 列**。結果比預期重要:它結案了 §7 待確認 2,並逼出 §3-1(空狀態)與 Q4(驗收可行性)。
  ⚠️ 這次查的是**列數**,不是「資料樣態」—— 0 列之下沒有樣態可看,**欄位語意仍只由 schema 與 COMMENT 背書**。
- **未做**:未量測既有 `order_refunds` 區塊與新區塊並排後的版面(那是實作片的肉眼驗收)。
