# 交接:E10 第 1 批 A7「取消真相表」—— 已 apply production、已 push

> **狀態:`93ef491` 已 push(`origin/dev` = `93ef491`、未推 0)· migration `20260730130000` 已 apply production(ledger 88 支)· apply 後獨立驗證全綠。**
> 日期:2026-07-30 晚 · Milestone M-4b · branch `dev`
> 上一份交接 = `2026-07-30-301-tappay-record-handoff.md`(#301 TapPay Record 三欄位)
> 施工權威 = `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md`(**§5.0 DAG = 唯一順序**)
> 片級 plan(含五輪審查全紀錄與施工發現)= `docs/specs/2026-07-30-e10-a7-order-cancellations-plan.md` **v5**

---

## 1. 一句話

建好 `order_cancellations` + `order_cancellation_items` 兩張表 ⇒ **27 項第 19 項「取消訂單」第一次有地方可寫**。
**但還按不下** —— 寫入端在 A8a1/A8a2、畫面在 A13a/A13b。本片是 M 型(純 schema、零 trigger、零函式)。

---

## 2. 下一片:三選一(照 §5.0 DAG,都可以開工)

| 選項 | 是什麼 | 為什麼可能先做 |
|---|---|---|
| **A7-t** | 🆕 **Sean 07-30 拍 Q1=A 新增的 T 片**:兩支 DEFERRED CONSTRAINT TRIGGER 擋「有 header、零明細」,照 `order_refunds` 的形狀(`20260725130100:182-186`)| 它補的是**目前唯一沒有 DB 層防線的洞**(合約債 ④);而且 A7 的結構斷言現在寫的是「新表零 user trigger」,**A7-t 落地時必須把它改成「恰好 2 支且是預期那兩支」**(已寫在 migration 註解裡) |
| **A7b** | `order_refund_jobs` schema + 完整狀態機合約(M 片)| 第 1 批表第 25 列;它是退款線(第 3 批)的 schema 前置 |
| **A1** | `order_items` 加三個摘要欄 `ordered/instock/cancelled_quantity`(M 片)| §5.0 DAG 上 A7 → A7b → **A1** 就是原定序;A1 之後才輪到 T 型的 A5b/A2b1/A4a |

🔴 **照 DAG 字面,原定序是 A7 → A7b → A1**;A7-t 是 Sean 新增的片、DAG 沒排它。
我的建議:**先 A7-t**(它與 A7 同一個資料域、脈絡最近,而且它一落地就要回頭改 A7 的一條斷言 —— 隔越久越容易漏)。

### 🔴 A7-t 開工必讀(已經寫死的東西,不要重新設計)

1. **形狀來源 = `order_refunds` 的兩支 trigger**(`20260725130100:182-186` 起)。逐字理由:
   **只掛子表的話,「插了 header 但一列明細都沒插」永遠不會觸發任何事件** ⇒ 空 header 完全擋不住。
   ⇒ **必須兩支**:header 表一支 `AFTER INSERT`、子表一支**含 DELETE**(刪明細後 header 會變成零明細)。
   `order_refunds` 的 trigger function 還處理了 `UPDATE` 同時驗 OLD 與 NEW(把明細從 A 改掛到 B 時,A 可能變零明細卻沒人檢查)—— 那條也要照抄語意。
2. **A7 的斷言要同步改**:A7-1 的結構驗收現在斷言「兩張新表 user trigger = 0」。
   A7-t 落地後那條會**當場紅**(這是刻意設計的連動閘)⇒ A7-t 必須在同片把它改成「恰好 2 支、且是預期的那兩支」。
   位置:`supabase/migrations/20260730130000_...sql` 的 §3.6。
3. **A7-t 是 T 型 = 高風險片**(鐵則 12③)⇒ 關卡1 審 plan + commit 前關卡2 審 diff。

---

## 3. 這片的實際內容(3 檔)

| 檔 | 是什麼 |
|---|---|
| `supabase/migrations/20260730130000_m4b_e10_a7_order_cancellations.sql`(660 行)| **A7-1**:兩表 + 2 索引 + ACL(service_role SELECT only + RLS zero-policy)+ 結構/定義/ACL 驗收 DO block(**零合成資料、零行為探針、零條件略過**)|
| `scripts/a7-behavior-probe.sql`(618 行)| **A7-2**:環境閘 + trigger inventory 閘 + 合成 fixture(3 單 / 3 品項)+ **36 條行為探針** + 整份 ROLLBACK + 交易外零殘留複驗 |
| `scripts/a7-verify.sh`(154 行)| **可重現的突變 harness**:`scripts/a7-verify.sh all /tmp/a7v` 一鍵跑完 |

### 怎麼重跑驗證(接手者請自己跑一次,不要只信本檔)

```bash
scripts/a7-verify.sh all /tmp/a7v
```

預期尾行:`════ A7 驗證結果:通過 37 / 失敗 0 ════`
內容 = A7-1 結構驗收綠 + **21 條結構突變全紅** + A7-2 **36/36** + 零殘留複驗 + **13 條行為突變全紅** + **兩組零突變對照綠**。

🔴 **workdir 必須是短路徑**(例 `/tmp/a7v`):PG 的 Unix socket 上限 103 bytes,scratchpad 全路徑會讓 postmaster 啟動即死(實測)。

---

## 4. apply 後的正式站事實(獨立驗證,不採信 migration 自述)

| 項 | 值 |
|---|---|
| 兩表存在 + RLS | ✅ 皆 `true`、**policy 數 0** |
| `anon` / `authenticated` 對兩表的任何權限 | ✅ **0**(原則 3 守住) |
| `service_role` 非 SELECT 權限 | ✅ **0** |
| 約束分佈 | CHECK 4 / FK 4 / PK 2 / UNIQUE 3 |
| 索引 | 7(2 PK + 3 UNIQUE + 2 顯式) |
| 新表列數 | 0 / 0 |
| 新表 user trigger | **0**(A7-t 之後應為 2)|
| ledger | **88** 支(apply 前 87、local-only 恰 1、remote-only 0)|
| `orders` | **31**(apply 前後同值)|

⚠️ **誠實邊界**:`order_items=41 / attempts=29 / pending_invoices=4` 比 STATUS 的 07-28 快照(39/27/3)多,
那是 `PCM-2026-0105` 與 `PTNGY2` 兩張新單造成的;**我沒有 apply 前對這三張表的自測基準**(只有 `orders` 有)。
本片是純 expand(只建兩張空表、對既有表零 DML/零 ALTER)⇒ 型式上不可能改動它們。

---

## 5. 🔴 施工中被自己的探針/突變抓到三件事(全部推翻我原本寫的東西)

1. **`[[:space:]]` 是 locale-dependent** —— 探針當場紅:`other` 配一格**全形空白寫得進去**。
   根因:C locale 下 `'　' ~ '[[:space:]]'` = **false** ⇒ `[^[:space:]]` 反而命中它。
   ⇒ 改成**明列 34 個碼位**;`payload_hash` 也從 `[0-9a-f]` 改成**明列 16 字元**(range 同樣 collation-dependent,關卡2 抓)。
   🔴 **連帶查出:隔離庫(C)與正式站(`en_US.UTF-8`,唯讀實查)字元類語意不同** ⇒ 「本機隔離庫驗過」的效力有折扣 ⇒ **#305**。
   A2/A3 用同款寫法,**在正式站有效、不是破口**,但它們的行為探針在隔離庫**因空表被略過** ⇒ 那條防護從未被實測。
2. **`actor` 形狀 CHECK 被 FK 嚴格支配** —— 拿掉它探針照樣綠(非 slug 值必然也不在 `staff`);
   而它**原理上無法獨立證明**(`staff.id` 自帶 `staff_id_format` ⇒ 形狀傳遞性保證)
   ⇒ 依「防護不得命名超出實際能力」**刪除**,探針 17 改為斷言 FK。
3. **突變 runner 自己假綠** —— 正向探針失敗噴 PG 原生錯誤、不帶自家訊息 ⇒ 只 grep 自家訊息的 runner
   會把「腳本其實炸了」判成綠。判定改成「**兩句成功 NOTICE 都要出現**」。

---

## 6. 審查鏈(五輪、58 must-fix + 31 nit,全折入、駁回 0)

| 關 | 輪 | 審查者 | 結果 | 最重的一條 |
|---|---|---|---|---|
| 1 | R1 | codex `gpt-5.6-sol` xhigh | NO-GO 19+4 | 我的 DO block 只驗「非 7 值被擋」⇒ 一個只允許 `customer_request` 的 CHECK 會讓整組驗收通過 |
| 1 | R2 | codex 同上 | NO-GO 16+5 | **「BEGIN → migration 全文 → RAISE」的模擬會真的提交** —— 檔案自帶 `COMMIT;` ⇒ 那是一次沒進 ledger 的正式 apply |
| 1 | **R3** | **Fable(換模型換角度)** | NO-GO **8(全新洞)** | 「突變後只有它轉紅」**物理不可滿足**(共用約束);回滾守門**在唯一需要它的那天擋死自己** |
| 1 | R4 | Fable(delta) | NO-GO 3+4 | 我的突變紅名單**沿用舊探針編號**、種子本身是錯的;archive 表「service_role only」五個字擋不住 Supabase 的 default-privilege re-grant |
| **2** | R1 | codex | NO-GO **12+12** | **8 條是「驗收有洞」不是 code 錯**:`actor` FK 沒驗 `ON DELETE RESTRICT`(改 CASCADE 全綠)、`reason_code` 只驗「七值有出現」(加第八值抓不到)、環境閘是黑名單不是白名單、突變證據不可重現 |

🔴 **五輪裡有四輪抓到的是「上一輪修法自己開的洞」**,不是原本要修的東西。

**我自己關掉一條它標「不確定」的**:正式站 PG **17.6** vs 本機 **17.10** 的 `pg_get_constraintdef` 渲染差異
⇒ 用純唯讀查詢問正式站同形既有約束,**逐字元相同**;apply 成功又再證一次。

---

## 7. 🔴 未做 / 待辦

- **A7-t 尚未施工**(Sean 拍 Q1=A 新增)
- **`docs/runbooks/2026-07-30-a7-rollback.md` 尚未撰寫** —— 承接時點 = **A8a1 開工前置**(第一個 writer 出現前必須存在;現在本表零寫入 GRANT ⇒ 風險窗未開)
- **A8a1 的開工前置問題(plan §6.1)**:master plan 字面上 A8a1 寫 header、A8a2 才寫 items
  ⇒ A8a1 單獨上線會產生零明細 header。**約束已由 Sean 拍 Q2=A 寫進 master plan §5.1 的 A8a1/A8a2 兩列**,
  但「A8a1 是否自己寫整單 items」仍要在 A8a1 的片級 plan 明確選一邊
- **合約債 ①③⑥⑦⑧**(payload_hash 正規化 + golden vector / 對客欄一致性 / `actor` 的 `is_active` / 冪等重送三格語意 / 輸入正規化)全部落在 **A8a1** 的驗收條件
- 🟡 **STATUS 主表 92 行 vs 規則 ≤30**(接手前即 84)—— 未自行處理、建議獨立成片
- 🟡 新開 backlog **#303 / #304 / #305** 皆未排入

---

## 8. 並行 session 注意

本 session 期間另有一個 session 在同 repo 工作(手機目錄 UX:`CascadeFilterTop` / `FilterDrawer` / `ProductsPage` /
`MobileVehicleSheet` / `ProductsMobileControls` / `docs/superpowers/` / `docs/decisions/0007-*` 等十餘檔)。
**其檔案全程未觸碰、未納入本片 commit**(已用 `git show --name-only` 逐檔複驗 = 零混入)。
接手時工作樹若仍有那些檔案,**那不是本線的殘留**。

— END —
