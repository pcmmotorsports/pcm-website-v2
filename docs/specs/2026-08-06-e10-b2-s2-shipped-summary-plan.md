# E10 第 2 批 · B2-S2:`shipped` 進摘要 片級 plan **v2 —— 🛑 已作廢**

> # 🛑 **本檔已作廢(2026-08-06,Sean 拍板 Q3=A)——不得用來開工,僅供素材與審查軌跡查考。**
>
> **取代者 = 兩份新 plan**:
> - **小線** `docs/specs/2026-08-06-e10-b2-s2a-summary-columns-plan.md`
>   = 摘要表加欄 + C8/C9/C6′ + quarantine 機制設計。
> - **大線**(重算接線 + harness/runbook 連動)—— 檔名待起草。
>
> **作廢理由**:本檔關卡1 兩輪皆 FAIL(R1 25 must-fix + 2 nit、R2 22 must-fix 且 14 條標
> 「R1 未真正修復」),兩輪硬上限用盡。判讀 = **不是審查鬼打牆,是我把體積過大的一件事
> 塞進一份 plan**;Sean 2026-08-06 拍 Q3=A 拆兩線,各寫各的 plan、各自跑新的兩輪額度。
>
> **另外兩題的拍板連動**:
> - **Q1=A**:`shipment_items` 那支重算 trigger **整塊移出** —— 小線大線都不含,
>   隨未來「開放改箱」的片一起做(理由見本檔 §3.3a:它今天沒有唯一契約)。
> - **Q2=A**:封窗改用 **quarantine 目錄**物理閘(本檔 §2 的純文字封窗被 R2 #3 打掉)。
>
> 審查軌跡:`docs/reviews/2026-08-06-b2-s2-k1-codex-r1.md` / `-r2.md`。
> 實跑證據(仍有效、兩份新 plan 共用):`docs/reviews/2026-08-06-b2-s2-precheck-runs.md`。

> 狀態:**R1 已折入,待 R2 確認;不得開工**。上游 = `docs/specs/2026-08-05-e10-b2-shipments-db-plan.md`(v5.4,S1 三片,**已 apply 正式站**)。
> 承接 v5 §7.1 交棒條款 + `docs/specs/2026-08-05-shipped-enforcement-analysis.md` 的 Sean Q1=A / Q2=A 拍板。
> R1 報告 = `docs/reviews/2026-08-06-b2-s2-k1-codex-r1.md`(FAIL / 25 must-fix + 2 nit,逐條處置見 §0.3)。
> 撰寫 = 2026-08-06 夜跑窗(worktree `pcm-a4a-chain`),依 `B-130-A` + `B-131-A` 派工。本輪**零 migration 實作**。

---

## §0 本片是什麼

把「已出貨量」變成 `order_item_quantity_summary` 的第四軸,並讓 A4a 的 row-level 重算鏈維護它;
承重不變式 **I1 = `shipped_quantity ≤ instock_quantity`(C9)** 由摘要表 CHECK 承擔(Sean 08-05 Q1=A)。

### 0.1 輸入與其權威性

| 輸入 | 用途 | 權威性 |
|---|---|---|
| B2 plan v5.4 §7.1(`:689-728`) | S2 交棒條款(🔴 重算必同掛 `shipments`)| 已過兩輪 Fable 審查 |
| `2026-08-05-shipped-enforcement-analysis.md` §7 | C9 承重 + 六條配套 | Sean 拍板 Q1=A/Q2=A(`:304-305`) |
| memory `project_m4b-b2-shipments-db-decisions` | 四拍板 + 追加段 + `RETURN NULL` 通則 | Sean 逐條落檔 |
| v5 plan `:755`(v4 §9.1 A-F 結論) | 併發承重件 = parent 鎖、承重點 = **鎖排在讀 SUM 之前** | 探針已實測、檔案不採用(v5 §9) |
| `docs/reviews/2026-08-06-b2-s2-precheck-runs.md` | 兩個未確認件的實跑結論(§7) | 本輪實測,附原始輸出 |
| `docs/reviews/2026-08-06-b2-s2-k1-codex-r1.md` | 關卡1 R1 findings | 本輪,零留痕已驗 |

### 0.2 前提事實(本輪親驗,非引述)

🔴 **S1 三支已在正式站**。2026-08-06 以 `supabase migration list` 唯讀親查遠端帳本:
`20260805170000` / `20260805170100` / `20260805170200` 三列 Local 與 Remote 欄皆有值。

🔴 **正式站四張表列數實查**(2026-08-06,Supabase 唯讀 `execute_sql`):
`order_item_quantity_summary` = **0**、`shipments` = **0**、`shipment_items` = **0**、
`order_item_procurement` = **0**、`order_items` = 42。
⇒ 摘要表 0 列的**真正原因是採購表 0 列**(A4a 惰性建列從未被觸發),**不是**「v5 交付時兩表 0 列」。
⇒ 這組數字同時是 §6 cut point 的**真相 gate 實測值**(R1 #18),但 **apply 當下必須重跑**。

### 0.3 R1 逐條處置(25 must-fix + 2 nit)

| R1 # | 處置 | 落在 |
|---|---|---|
| 1 a1 restore 回滾世界假綠 | ✅ 改**版本感知**:重套「所有版本號 > A1 且動到摘要表」的 migration,不硬編碼 S2a | §7.3 |
| 2 活體斷言只驗沒噴錯 | ✅ 改造四軸 fixture + 回查四個新值 + S2a 結構指紋 | §4 項 20/24 |
| 3 U/D「不可達」是錯的 | ✅ **收回宣稱**:停用 block trigger 即可構造 ⇒ 兩枝**現在就配負測** | §3.3 / §4 項 26-27 |
| 4 U/D 缺 OLD/NEW 語意 | ✅ 明訂 OLD+NEW 都重算、去重後 `ORDER BY` | §3.3 |
| 5 「兩支都不可少」過度宣稱 | ✅ **收回**:`shipment_items` 那支今天在正常路徑無唯一契約,改標防禦性 | §3.3 |
| 6 trigger 結構閘不完整 | ✅ 加 `tgfoid/tgconstraint/tgdeferrable/tginitdeferred/tgattr` + `pg_get_triggerdef` 全等 | §4 項 8 |
| 7 新函式安全面無驗收 | ✅ 新增整格 | §4 項 9b |
| 8 多品項重算缺固定鎖序 | ✅ trigger 內 `ORDER BY order_item_id` + barrier 格 | §3.3 / §3.5 |
| 9 C8 沒有「只紅它」負測 | ✅ 新增 | §4 項 14b |
| 10 項 18 量不到 rollback | ✅ 改構造「X1 在 COMMIT 失敗」再回查兩邊都回滾 | §4 項 18 |
| 11 突變矩陣不可能每靶只紅一格 | ✅ 拆**結構環境**與**行為環境**,逐靶寫唯一 oracle | §5 |
| 12 PR4 造洞法會被舊 oracle 抓到 | ✅ 改「只動 shipped 真相、前三軸不動」的 fixture | §4 項 22 |
| 13 「真相式只出現一次」與獨立 oracle 衝突 | ✅ **收回**:改列三個允許位置 + 逐字錨 + 消融 | §1.1 |
| 14 rollback runbook 留活地雷 | ✅ 同片更新依賴清單 + DROP 序 + rehearsal | §4 項 21b / §6 |
| 15 a4a harness 收尾只守五函式 | ✅ 擴成七函式六 trigger + 候選全集 | §4 項 23b |
| 16 md5 pin 範圍與維護者未定 | ✅ pin `pg_get_functiondef` + catalog tuple;forward/down 各凍結 | §3.2 |
| 17 md5 負測可因重跑假證明 | ✅ 改在「A4a+S2a、未套 S2b」的對照庫用合法註解突變 | §4 項 6 |
| 18 cut point「安全」未證實 | ✅ 真相 gate 已有實測值(§0.2)+ 補故障注入 | §6 |
| 19 backfill 沒有值的 oracle | ✅ 獨立四軸公式比對 + 活動品項缺列檢查 | §3.4 / §4 項 17 |
| 20 PR1 fixture 保證不了 instock=2 | ✅ 明訂 receipts = 2+1、刪 quantity=1 那筆 | §4 項 14/15 |
| 21 契約債沒全樹結清 | ✅ 全樹 grep 已做,**真汙染 2 處**逐一列名 | §3.6 |
| 22 DB COMMENT 清償範圍不足 | ✅ 列出全部受影響 COMMENT | §3.6 |
| 23 型別重生無人承接 | ✅ 進交棒表 + apply 後 checkpoint | §9 項 8 |
| 24 片界 + 同 commit 超 45 分 | ✅ **拆成五片**、封窗改「全部 commit 到齊前禁止 apply」 | §2 |
| 25 「三支 S1 harness 新格」沒規格 | ✅ 逐支列 cell / mutant / oracle | §4 S2c-3 |
| 26 nit 有限枚舉不是證明 | ✅ 改稱「代數證明 + 有限域 smoke」 | §1 |
| 27 nit 行號漂移三處 | ✅ 已改 A1:121-124 / A1:63-66 / 兩處改區段 | 全檔 |

🔴 **沒有一條被駁回。** #18 與 #21 有「部分過期 / 更精確」的補充,見 R1 報告的親驗表。

### 0.4 🛑 R2 FAIL 凍結公告(2026-08-06;**本檔不得用來開工**)

關卡1 **R2 = FAIL / 22 must-fix**(14 條標「R1 未真正修復」),報告 `docs/reviews/2026-08-06-b2-s2-k1-codex-r2.md`。
**兩輪用盡 ⇒ 停,不開 R3;R2 findings 刻意不折入**(方向題沒拍板前折了會白折)。

🔴 **v2 已知壞掉、不得照抄的三處**(等 Sean 拍完方向再改):

| 位置 | 病 |
|---|---|
| §7.3 版本感知 restore 的**選檔規則** | 實跑證明會選中 **6 支**,含 A4a(內有 5 個裸 `CREATE FUNCTION`)⇒ 重跑必 `42723`,連 S2a 都到不了。**這是 v2 為了修 R1 #1 才引進的新 bug** |
| §2 的「五片全 commit 前禁止 `db push`」 | **只有文字、沒有物理閘**;migration 一進目錄任何人都能提前 apply |
| §4 項 28(型別重生)× §2 封窗 | 循環矛盾:S2c-3 要在 push 前 commit,項 28 卻只能在 apply 後做。**修法已明確**(獨立成 apply 後的 S2d checkpoint),待方向拍板一併改 |

🔴 另有一條**設計岔路**已升級成 Sean 的決策題,不由審查輪決定:
**`shipment_items` 那支重算 trigger 本片到底做不做**(R1 #5 要我收回「不可少」的宣稱,R2 #19 直接主張它不該在本片落地)。

---

## §1 不變量集合與蘊含結構

新增三條 CHECK,全部掛在 `public.order_item_quantity_summary`:

| # | 具名 | 定義 | 角色 |
|---|---|---|---|
| **C8** | `oiqs_shipped_nonneg` | `shipped_quantity >= 0` | 值域;與 C1/C2/C3 同形 |
| **C9** | `oiqs_shipped_le_instock` | `shipped_quantity <= instock_quantity` | 🔴 **唯一承重件**(分析 §2) |
| **C6′** | `oiqs_cancelled_shipped_le_quantity` | `cancelled_quantity::bigint + shipped_quantity::bigint <= quantity::bigint` | 🟡 **冗餘**,Q2=A 知情保留 |

蘊含關係:**`C9 ∧ C7 ⇒ C6′`**(`s ≤ i` 且 `i + c ≤ q` ⇒ `c + s ≤ c + i ≤ q`)。
🔴 **這是代數證明**(非負整數上逐點成立);§4 項 16 的 `generate_series(0,6)` 四重迴圈是
**有限域 smoke**,不是證明本身(R1 nit #26)。

⇒ **C6′ 的獨立負測在通電路徑上構造不出來**,這是它冗餘的機器證明,不是漏測
(memory `feedback_unconstructible-negative-test-means-noop-guard` 的正用)。
🔴 驗收因此**不得**給 C6′ 排「只紅它一條」的負測格 —— 排了必然構造失敗,然後有人會去放寬 C9 讓它可構造。

`::bigint` 沿用 A1 C7 的理由(`20260730150000:121-124`):兩個 integer 相加先溢位成 `22003`,
負測會紅在錯的地方。C9 是**單欄比較、無相加**,故不需要 `::bigint`(分析 `:205-206` 明文)。

### 1.1 `shipped` 真相式:允許三處,不是「只有一處」(R1 #13)

```sql
COALESCE(sum(si.shipped_quantity), 0)
  FROM public.shipment_items si
  JOIN public.shipments s ON s.id = si.shipment_id
 WHERE si.order_item_id = <品項>
   AND s.deleted_at IS NULL          -- Q3=A:作廢即退量
   AND s.shipped_at IS NOT NULL      -- 未寄出的草稿箱不算
```

v1 寫「全 repo 只准出現一次」= **做不到**:helper 回傳 `void`,break-glass 漂移 oracle 必須
**獨立**算一份來跟摘要比,靠呼叫 helper 反而變成「拿被測物當 oracle」。

🔴 **改成:允許且只允許三處,每處掛逐字錨 + 各自的消融格**

| # | 位置 | 角色 | 錨 |
|---|---|---|---|
| 1 | A4a helper 內(S2b) | **唯一 writer** | 現行字面錨機制(`20260803140000:587-589` 同型) |
| 2 | `docs/runbooks/a4a-summary-rollback.md` 漂移 oracle | **獨立 checker**(必須獨立,否則零判別力) | 與 #1 逐字比對的結構斷言 |
| 3 | `scripts/a4a-verify.sh` 四軸 oracle | harness 側 checker | 同上 |

**消融**:任一處被改動而其他兩處沒跟上 ⇒ 逐字比對格必紅。
(反面教材 = `instock` 已有兩式分歧,分析 F7:A8a2 守門帶 `r.quantity > 0`、helper 不帶。)

---

## §2 片界(**五片**;R1 #24 拆片後每片 ≤45 分)

| 片 | 型 | 內容 | 鐵則 12? | 估時 |
|---|---|---|---|---|
| **S2a** | M | 摘要表 `ADD COLUMN shipped_quantity` + C8/C9/C6′ + 全部受影響 COMMENT(§3.6)+ 結構驗收 | ③ ⇒ **是** | 30 分 |
| **S2b** | T | A4a helper 四軸化(md5 前置閘 → `CREATE OR REPLACE`)+ 兩支重算 trigger + 有值 oracle 的 backfill + 結構驗收 | ③ ⇒ **是** | 45 分 |
| **S2c-1** | 非 M | break-glass oracle 四軸化:`docs/runbooks/a4a-summary-rollback.md` + `scripts/a4a-verify.sh:152` + **rollback 依賴清單與 DROP 序**(R1 #14) | 否 | 40 分 |
| **S2c-2** | 非 M | `scripts/a4a-verify.sh` 的**判別力修復**:突變靶 N8 錨同步、收尾 md5 擴成七函式六 trigger(R1 #15)、四軸格 | 否 | 40 分 |
| **S2c-3** | 非 M | `scripts/a1-verify.sh` 版本感知 restore + 活體斷言(§7.3)+ 三支 B2 S1 harness 的新格(§4 S2c-3) | 否 | 45 分 |

🔴 **片序 S2a → S2b 強制,且不可倒**(§6)。
🔴 **封窗合約(R1 #24 修法)**:五片各自可獨立 commit;**但 `supabase db push` 不得在五片全數 commit 之前執行。**
v1 寫「S2c 必須與 S2b 同一批 commit」= 85 分鐘一片、違反鐵則 4 ⇒ **收回**,改由 apply 封窗承擔。
理由不變:S2c-1 沒到齊,break-glass 對 shipped 軸就是真空(分析 §3 / §7 第 3 點)。

🔴 **S2c 三片不得被當成「收尾雜事」砍掉**:它們含本輪實測出來的 harness 斷裂態(§7),
那是 S2 落地後**唯一會讓別人踩到**的東西,踩到的形狀是「別支 harness 大面積紅」。

---

## §3 設計

### 3.1 S2a:加欄與三條 CHECK

```sql
ALTER TABLE public.order_item_quantity_summary
  ADD COLUMN shipped_quantity integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT oiqs_shipped_nonneg     CHECK (shipped_quantity >= 0),
  ADD CONSTRAINT oiqs_shipped_le_instock CHECK (shipped_quantity <= instock_quantity),
  ADD CONSTRAINT oiqs_cancelled_shipped_le_quantity
    CHECK (cancelled_quantity::bigint + shipped_quantity::bigint <= quantity::bigint);
```

- `NOT NULL DEFAULT 0` 在 PG11+ **不重寫表**(常數 default 走 catalog);`ADD CONSTRAINT CHECK` **全表掃描驗證**。
- 正式站列數見 §0.2(實查 = 0)⇒ 掃描瞬間完成。
  🔴 **row-count gate 仍要留**(抄 A1 `20260730150000:63-66` 的先例):§0.2 是 08-06 快照,
  **apply 當下必須重跑**;採購功能一旦被員工用起來,摘要表就會開始長列。
- 取 `ACCESS EXCLUSIVE` 持有到 COMMIT ⇒ `SET LOCAL lock_timeout = '5s'` / `statement_timeout = '60s'`。
- **既有列恆過三條**:`shipped=0` ⇒ C8 恆真、C9 = `0 ≤ instock`(C2 保證 instock ≥ 0)恆真、C6′ 退化成既有 C6。

### 3.2 S2b:helper 四軸化與 md5 前置閘

**替換方式 = `CREATE OR REPLACE`,前面掛前置閘。**

- A4a 原檔用**裸 CREATE**(`20260803140000:138` 明文「禁 OR REPLACE,A7-t 教訓」)——
  那條紀律的對象是**新建**(重跑要撞 `42723`)。本片是**蓄意替換**,裸 CREATE 物理上做不到;
  `DROP FUNCTION` + `CREATE` 則會在有相依物時紅在別的地方。

🔴 **前置閘三段(R1 #16 修法)**

| 段 | pin 什麼 | 為什麼不能少 |
|---|---|---|
| ① | **`pg_get_functiondef(helper)` 的 md5**,不是 `prosrc` | 只 hash `prosrc` 的話,`search_path` / `lock_timeout` / `SECURITY DEFINER` 漂移全部隱形 |
| ② | helper 的 `proowner` / `prosecdef` / `proconfig` 全陣列 | `pg_get_functiondef` 不含 owner |
| ③ | S2a 產物:`shipped_quantity` 欄存在 + 三條 CHECK 具名存在且 `pg_get_constraintdef` 逐字相符 | 這是片序不可倒的**物理**保證(§6) |

**指紋的維護者(R1 #16 後半,v1 沒寫)**:
- **forward(S2b)**:閘裡凍結的是**三軸版**指紋;S2b 自己在結尾把**四軸版**指紋寫進 migration COMMENT。
- **down(回滾片)**:閘裡凍結**四軸版**指紋(即 S2b 結尾那個),還原後在 COMMENT 寫回三軸版。
- **未來任何再替換 helper 的片**:必須先 pin 當下版本、結束時公告新指紋。**逐字寫進兩支 migration 檔頭。**

**替換後必須逐項斷言**(`CREATE OR REPLACE` 保留 owner 與 ACL、**但 `SET` 子句被新定義整組取代**):
owner / `prosecdef` / `proconfig` 全陣列逐字(`search_path=public, pg_temp` + `lock_timeout=5s`)/ 零 grantee。

🔴 **helper 的 `search_path` 維持 `public, pg_temp`、不回改成 `''`**:
memory 拍板「新函式一律 `''`,a5a 的 `public, pg_temp` 是舊慣例**不回改**」——
helper 是既有函式,本片只加第四軸,不趁機改它的執行環境。
**本片新建的兩支 trigger 函式一律 `SET search_path = ''` + 全限定名**;兩種慣例並存是刻意的,COMMENT 寫明。

### 3.3 S2b:兩支重算 trigger

| 表 | 事件 | 名稱 | 型 |
|---|---|---|---|
| `shipment_items` | `AFTER INSERT OR UPDATE OR DELETE` | `shipment_items_summary_recompute_ac` | CONSTRAINT TRIGGER, **NOT DEFERRABLE**, FOR EACH ROW |
| `shipments` | `AFTER UPDATE OF shipped_at, deleted_at` | `shipments_summary_recompute_ac` | CONSTRAINT TRIGGER, **NOT DEFERRABLE**, FOR EACH ROW |

#### 3.3a 兩支各自承擔什麼(R1 #5:v1 的「兩支都不可少」是過度宣稱,**收回**)

| trigger | 今天唯一承擔的可觀察契約 | 誠實標記 |
|---|---|---|
| `shipments` 那支 | 🔴 **承重**。X3 擋死「已寄出包裹再加品項」⇒ **唯一讓 `shipped` 升值的路徑是 `shipped_at` 那筆 UPDATE**;也是 Q3=A 作廢/unvoid 退量的唯一路徑 | 拿掉它 ⇒ `shipped` 恆 0 且**零錯誤訊息**(§4 項 13) |
| `shipment_items` 那支 | 🟡 **今天沒有唯一契約**。正常路徑(建箱 → 加品項 → 設 `shipped_at`)的 `shipped` 值**完全由 `shipments` 那支寫對**;加品項當下 `shipped_at` 必為 NULL ⇒ 它算出來的一定是 0 | **防禦性**:①解除 append-only 後的 U/D 面 ②X3 若日後被放寬 |

🔴 **v1 §3.3 寫「未來任何人想精簡成一支 = 靜默把整條不變式關掉」—— 這句只對 `shipments` 那支成立。**
對 `shipment_items` 那支,正確的話是:「拿掉它今天不會有任何一格紅,**這正是它被標成防禦性的理由**;
要拿掉的人必須同時證明 append-only 與 X3 都還在。」

#### 3.3b U/D 兩枝:**可構造,現在就配負測**(R1 #3,v1 說「不可達」是錯的)

v1 寫「被 append-only 三支 block trigger 擋死 ⇒ 不可達、無負測」。
🔴 **錯**:在拋棄庫裡只要 `ALTER TABLE … DISABLE TRIGGER shipment_items_block_update_bu`
(與 `_block_delete_bd`)、**保留新的重算 trigger**,今天就構造得出 UPDATE / DELETE。
⇒ **兩枝現在就要有負測與事件面消融**(§4 項 26/27),**不得遞延**。

#### 3.3c 函式體語意(R1 #4 / #8)

```
shipment_items 那支:
  受影響品項集合 = {OLD.order_item_id, NEW.order_item_id}(依 TG_OP 取用、NULL 剔除)
  🔴 去重後 ORDER BY order_item_id,逐一 PERFORM helper
  理由:re-parent(order_item_id 從 A 改 B)若只重算 NEW,A 的 shipped 永久殘留(R1 #4)

shipments 那支:
  受影響品項集合 = SELECT DISTINCT si.order_item_id FROM shipment_items si WHERE si.shipment_id = NEW.id
  🔴 ORDER BY si.order_item_id,逐一 PERFORM helper
  理由:未排序的 DISTINCT 迭代,兩張含重疊品項的包裹併發出貨會反序取鎖 ⇒ 真 40P01(R1 #8)
```

#### 3.3d 發火序

- `shipment_items`:既有 `shipment_items_parent_guard_ac` < 新的 `..._summary_recompute_ac`(`p` < `s`)
  ⇒ 守門先跑、重算後跑,**不需要 `_zc` 後綴**。名稱序斷言必須明文,改名即紅。
- `shipments`:既有 X1 `shipments_items_presence_ac` 是 **DEFERRED**(COMMIT 才驗),
  新的重算是 **NOT DEFERRABLE**(語句結束即跑)⇒ **重算實際上排在 X1 之前**,名稱序在此不載重。
  🔴 前提:重算讀 `shipment_items` 時品項已在(X3 保證出貨前品項就位);
  X1 若在 COMMIT 紅掉則整筆回滾、重算一併蒸發。**這是前提不是觀察,§4 項 18 要真的構造它。**

**`NOT DEFERRABLE` 的理由**:R1-19 契約「不新開交易」;且 **CHECK 不可 defer**,
把重算 defer 到 COMMIT 只會讓錯誤更晚出現、不會讓它消失。

### 3.4 S2b:backfill 要有**值**的 oracle(R1 #19)

抄 A4a `20260803140000:370-401` 的形狀:trigger 建立**之前**、同交易、逐品項呼叫 helper。
v1 只寫「`RAISE NOTICE` 印重算列數」⇒ **helper 漏算或漏掉某個 order_item 時,NOTICE 照樣印、migration 照樣成功。**

🔴 **改成兩段 oracle,任一不符即 `RAISE`**:
1. **值漂移**:對每個候選品項,用 §1.1 的獨立四軸公式重算一次,與摘要列逐欄比對(四軸全比,不只 shipped)。
2. **缺列**:`shipment_items` 有列的 `order_item_id` 全集 **⊆** 摘要表 `order_item_id` 全集,差集必須為空。

候選集合 = `SELECT DISTINCT order_item_id FROM shipment_items`(§0.2 實查 0 列 ⇒ 今天 no-op)。

### 3.5 併發

承重件 = **helper 內的 parent `FOR NO KEY UPDATE`**,承重點 = **鎖排在讀四軸 SUM 之前**(v5 plan `:755`)。
本片零新鎖原語:兩支新 trigger 只呼叫既有 helper ⇒ 自動繼承同一把鎖。
🔴 **不得在 trigger 函式裡自己讀 SUM 再呼叫 helper** —— 那會在鎖之外讀值,把承重點繞掉。

**兩層鎖序風險**:
1. **trigger 內**(§3.3c):多品項迭代必 `ORDER BY order_item_id` + 雙 session barrier 格(R1 #8)。
2. **多列 INSERT**(v5 §7 項 10 同型):`INSERT INTO shipment_items VALUES (…),(…)` 是 `FOR EACH ROW`,
   依**輸入列序**逐一取 NKU ⇒ 兩交易以相反品項序裝箱仍可能真 `40P01`。
   **本片零 writer、造不出來也不宣稱擋得住**;交棒出貨 writer RPC(§9 項 2)。

### 3.6 全樹字面與 COMMENT 結清(R1 #21 / #22)

**A. 程式碼與 spec 裡與 Sean 拍板矛盾的活字面 —— 全樹 grep 實查,真汙染 2 處**

| 檔案:行號 | 現況字面 | 要改成 |
|---|---|---|
| `packages/domain/src/order/types.ts:531` | 「第 2 批…要在同一片把本式改成 `quantity − instock − cancelled − shipped`」 | Q1=A/Q2=A 終案:**公式不減 shipped**(`shipped ⊆ instock`,減了是重複扣);承重改由 C9 |
| `docs/specs/2026-08-05-e10-cancel-ui-wire-plan.md:285` | 同上 | 同上 |

⬜ **非汙染、不得動的 2 處**(標明出處的引述,改了反而破壞可追溯):
`2026-08-05-shipped-enforcement-analysis.md:30`(F10 引 master plan 原文,同檔 F11 已推翻)、
`2026-07-28-…master-plan-v2.md:387`(row 37 本體已含 08-05 就地更正)。

**B. 受影響的 DB COMMENT(逐一列名,S2a/S2b 要驗新字面)**

| COMMENT | 現況過期字面 |
|---|---|
| A1 契約債 `20260730150000:152-158` | 「第 2 批同一片必須 ①加 shipped ②納入 C6/C7 ③改 A8a1/A8a2 守門」 |
| A1 `oiqs_instock_cancelled_le_quantity` 的 COMMENT(同檔 `:157-158`) | 同上契約債字面 |
| A1 摘要表複合 FK 的 COMMENT | 「三個數量」(S2 之後是四個) |
| A4a helper COMMENT `20260803140000:191-192` | 「由**三張**真相表重算」「只由本片**四支** trigger 與 backfill 呼叫」 |

🔴 **A1 契約債的清償字面必須逐字寫明「三項裡只做兩項」**:
①加欄 ✅ ②納入 **C6′(C7 不動)** ✅ ③**不做** —— 守門公式不減 shipped(Sean 08-05「無直送」拍板)。
**不得只寫「已清償」而不寫第三項刻意不做** —— 那是把已拍板的偏離藏進「完成」。

---

## §4 驗收(每條一個可判定 oracle)

> 🔴 **通則(memory `RETURN NULL` 條)**:每一條「→ 成功」的正測,oracle **不得只驗「沒噴錯」**,
> 必須回查該欄新值真的落庫。`UPDATE 0` 與 `UPDATE 1` 在只看錯誤的測試裡完全一樣。

### S2a

| # | 條件 | oracle |
|---|---|---|
| 1 | 欄存在且型別/NOT NULL/DEFAULT 逐字 | `pg_attribute` + `pg_attrdef` 比對 |
| 2 | C8/C9/C6′ 三條具名存在且 `pg_get_constraintdef` **逐字**相符 | 字串全等,非 `LIKE` |
| 2b | 🔴 **雙向**:摘要表的 CHECK 具名集合**恰等**預期全集(偷加第四條要紅)| S1 消融 #10 的回歸 |
| 3 | 🔴 **既有列違反 C9 時必紅**(R1 修:v1 的「apply 成功即證」在 0 列時恆真) | 造一列 `shipped=3/instock=2` 再 apply ⇒ 必 `23514` + conname |
| 4 | §3.6-B 全部 COMMENT 的新字面(含「第三項刻意不做」) | `obj_description` / `col_description` 逐字 grep |
| 5 | 🔴 重跑 S2a 必紅 | 第二次 apply 撞 `42701 duplicate_column`,紅在 BEGIN 之後 ⇒ 整支回滾 |

### S2b

| # | 條件 | oracle |
|---|---|---|
| 6 | md5 前置閘:helper 定義被改過 ⇒ 拒繼續。🔴 **負測要在「A4a+S2a、未套 S2b」的對照庫**用**合法註解字元**突變(R1 #17:在已套 S2b 的庫上「重跑」必被拒,那證明不了判別力) | mutant 被拒、零突變放行,兩者都要觀察到 |
| 6b | 前置閘 pin `pg_get_functiondef` 而非 `prosrc` | 只改 `SET lock_timeout` 不改函式體 ⇒ 閘必紅 |
| 7 | 前置閘:S2a 未套 ⇒ 拒繼續 | 在只套到 A1 的庫上跑 S2b,必 `RAISE`(**不是 42703**) |
| 8 | 🔴 兩支 trigger 的**完整**結構(R1 #6):`tgname` / `tgenabled` / `tgtype` / **`tgfoid`** / **`tgconstraint`** / **`tgdeferrable`** / **`tginitdeferred`** / **`tgattr`** + `pg_get_triggerdef` 全等 | 只比前三者的話:指錯函式、退化成非 constraint trigger、`UPDATE OF` 變成任意 UPDATE 都會溜過 |
| 9 | helper 替換後 owner/secdef/proconfig **全陣列**/零 grantee | S1 消融 #4:只比 `search_path=%` 前綴會全盲 |
| 9b | 🔴 **兩支新函式的安全面**(R1 #7):owner / `prosecdef` / `proconfig` 含 `search_path=''` / `aclexplode` 零 grantee / 函式本體錨 / trigger 真的指向它們 | S1 消融 #3 的回歸(新函式會吃 shim default privileges) |
| 10 | **正測**:建箱掛品項 → `UPDATE shipments SET shipped_at` → 摘要 `shipped_quantity` = 該量 | 回查落庫值 |
| 11 | **正測(Q3=A 退量)**:作廢包裹 → `shipped_quantity` 回 0。**含 `submitted` 態作廢**(S1 消融 #26) | 回查落庫值 |
| 12 | **正測(unvoid)**:`deleted_at` 設回 NULL → shipped 回升。**含「由已出貨作廢態 unvoid」**(#26) | 回查落庫值 |
| 13 | 🔴 **消融:拿掉 `shipments` 那支** → 項 10 的 shipped **恆 0 且零錯誤** | v5 §7.1 交棒條款的機器證明 |
| 14 | **C9 負測(PR1)**:qty=3、receipts **2+1 兩筆**、出貨 3,`DELETE` 掉 **quantity=1 那筆** ⇒ `23514` + conname = `oiqs_shipped_le_instock`,終態 `shipped=3 > instock=2`(R1 #20 修:v1 的單筆 fixture 會得到 instock=0) | SQLSTATE + **conname** 雙比對(S1 消融 #20/#21) |
| 14b | 🔴 **C8 只紅它負測**(R1 #9):`shipped=-1, instock=0, cancelled=0, quantity=0` | 只違反 C8;SQLSTATE + conname |
| 15 | 🔴 **C9 承重性**:`DROP CONSTRAINT oiqs_shipped_le_instock` 後重放項 14 ⇒ **必須全綠**且呈 `shipped=3 > instock=2` | 仍被擋 = C9 非承重、§1 蘊含圖錯 |
| 16 | **C6′ 冗餘性有限域 smoke**:`SELECT count(*) FROM generate_series(0,6) q, … WHERE s<=i AND i+c<=q AND c+s>q` = 0 | 非 0 ⇒ §1 作廢。**這格不是實作驗收**(R1 #26) |
| 17 | backfill 的**值** oracle(§3.4 兩段)+ 候選 0 列時印 0 | 值漂移非零或差集非空 ⇒ `RAISE` |
| 18 | 🔴 **X1 失敗時重算一併蒸發**(R1 #10):構造「重算已寫值 → X1 在 COMMIT 紅」⇒ 交易外回查摘要與品項**兩邊都回滾** | v1 的「觀察重算先發生」證不到這件事 |
| 19 | 名稱序:`shipment_items` 上守門先於重算;**同時違反時歸因比對 conname / 訊息文字**(S1 消融 #21) | 只比 SQLSTATE 的歸因是錯的 |
| 20 | 🔴 **A4a 鏈活體**(R1 #2):造已知四軸 fixture → 直呼 helper → **斷言 rc=0 且回查四個欄的新值全部正確** | v1 的「直呼成功」被空函式騙得過 |
| 26 | 🔴 **U/D 負測(R1 #3)**:`DISABLE` block_update / block_delete → `UPDATE shipment_items SET shipped_quantity` → shipped 跟動;`DELETE` → shipped 回落 | 兩枝各一格 |
| 27 | 🔴 **re-parent(R1 #4)**:`UPDATE … SET order_item_id = B` ⇒ **A 與 B 兩邊的 shipped 都要對** | 只重算 NEW 的實作 ⇒ A 殘留、此格紅 |

### S2c-1

| # | 條件 | oracle |
|---|---|---|
| 21 | oracle 四軸化落在 **runbook `:60-71,147` 與 `a4a-verify.sh:152` 兩處** | 只改一處 = 半個洞;判別力由項 22 提供,**不靠靜態 grep**(S1 消融 #13) |
| 21b | 🔴 **rollback runbook 依賴清單**(R1 #14):現行只枚舉四 trigger / 五函式 ⇒ S2 後補成 **六 trigger / 七函式**,含 DROP 序與一次 rehearsal | 漏了的話,撤 helper 後**下一筆 DML 才爆** |
| 22 | 🔴 **PR4 洞實證(R1 #12 修 fixture)**:DISABLE 六支 → **只動 shipped 真相(改 `shipments.shipped_at`/`deleted_at`)、前三軸完全不動** → ENABLE → 跑**舊三軸** oracle ⇒ **通過**;換四軸版 ⇒ **必 RAISE** | v1 引用的「DELETE receipt」會讓舊 oracle 因 instock drift 就 RAISE,測不到 shipped 軸 |

### S2c-2

| # | 條件 | oracle |
|---|---|---|
| 23 | 🔴 `a4a-verify.sh` 突變靶 **N8** 的文字錨同步更新 | 本輪實測:helper 一改寫,該靶壞成 `syntax error at or near ","`,**不是紅得漂亮**。改後要驗「突變真的翻面」 |
| 23b | 🔴 收尾零殘留閘擴成 **七函式 / 六 trigger / 四軸 oracle / 候選全集**(R1 #15) | 新兩函式被竄改或殘留時,現行五函式 md5 收尾仍全綠 |

### S2c-3

| # | 條件 | oracle |
|---|---|---|
| 24 | 🔴 `a1-verify.sh` 收尾**版本感知 restore** + 活體斷言(§7.3) | restore 段自己壞掉 ⇒ 活體斷言(項 20 同形)必紅 |
| 25a | `b2s1a1-verify.sh` 新格:`shipments` 上 trigger 具名集合含 `shipments_summary_recompute_ac`,且 `pg_get_triggerdef` 全等 | 唯一 mutant = 改該 trigger 的 `UPDATE OF` 欄集 ⇒ 只有此格紅 |
| 25b | `b2s1a2-verify.sh` 新格:名稱序契約重跑(S1a-2 立的斷言,S2 是「在這兩張表掛 trigger 的片」⇒ 契約債觸發) | 唯一 mutant = 把新 trigger 改名成排在 `items_presence_ac` 之前 |
| 25c | `b2s1b-verify.sh` 新格:`shipment_items` 上守門先於重算 + 值 oracle(加品項後 shipped 仍 0) | 唯一 mutant = 拿掉 `shipment_items` 那支 ⇒ 只有「U/D 兩格 + 本格」紅 |
| 25d | 三支 harness 與 `a4a-verify` 在 S2 之後全綠,**數字逐支入帳** | 回歸格,不宣稱判別力 |
| 28 | 🔴 **`database.types.ts` 重生**(R1 #23):apply 後 `order_item_quantity_summary` 型別含第四欄 | 見 §9 項 8 的交棒(Sean apply 後才做得到) |

### 4.1 逐格 ablation 自查(`B-131-A` ②;v1 抓到的五個缺陷,v2 已全修)

| v1 缺陷 | v2 處置 |
|---|---|
| 項 3「apply 成功即證」在 0 列時**恆真** | ✅ 改成「造違反列再 apply,必紅 23514」 |
| 項 9 proconfig 只比前綴會全盲(S1 消融 #4) | ✅ 全陣列逐字 + owner |
| 項 19 只驗 SQLSTATE 的歸因是錯的(S1 消融 #21) | ✅ 改比對 conname / 訊息文字 |
| 項 21 靜態 grep 同 S1 消融 #13 形狀 | ✅ 判別力改由項 22 的兩版對跑提供 |
| 項 16 / 25d 是代數命題與回歸格 | ✅ 明文標「不宣稱判別力」 |

---

## §5 突變靶(R1 #11:分兩個環境,逐靶唯一 oracle)

> 🔴 v1 寫「每個靶只准紅一格」**做不到**:拿掉一支 trigger 會同時紅結構格與行為格。
> ⇒ 改成**兩個獨立環境**,每個靶只在**它自己的環境**裡跑,並指定該環境內**唯一執行的 oracle**。

**環境 A(結構突變)**:只跑結構斷言,不跑任何行為格。

| 靶 | 動作 | 唯一 oracle |
|---|---|---|
| ① | C9 定義 `<=` → `<` | 項 2 |
| ②s | 拿掉 C9 | 項 2b(集合不等) |
| ⑦ | trigger 改掛 `BEFORE` | 項 8(`tgtype`) |
| ⑦b | trigger 指向另一支函式(同名同 tgtype) | 項 8(`tgfoid`) |
| ⑦c | `UPDATE OF shipped_at, deleted_at` → 任意 `UPDATE` | 項 8(`tgattr`) |
| ⑩ | md5 前置閘拿掉 | 項 6 |
| ⑩b | 前置閘改 pin `prosrc` | 項 6b |
| ⑪ | 新函式 `search_path` 改成 `public` | 項 9b |

**環境 B(行為突變)**:只跑行為格,結構斷言全部跳過。

| 靶 | 動作 | 唯一 oracle |
|---|---|---|
| ②b | 拿掉 C9 | 項 15(承重性:必須**全綠**) |
| ③ | 拿掉 `shipments` 那支 trigger | 項 13 |
| ④ | 拿掉 `shipment_items` 那支 trigger | 🔴 **項 26/27(U/D 與 re-parent)**,**不是**項 10 —— 項 10 走 `shipments` 那條路,拿掉這支照樣綠(R1 #5) |
| ⑤ | 真相式漏 `deleted_at IS NULL` | 項 11 |
| ⑥ | 真相式漏 `shipped_at IS NOT NULL` | 項 10 的草稿箱變體 |
| ⑧ | `shipments` 那支漏 `deleted_at` 事件面 | 項 11 |
| ⑨ | helper 把 NKU 鎖移到讀 SUM 之後 | 併發 barrier 格(§3.5)—— 🔴 **S1 消融 #25 的回歸點**:S1 拿掉 NKU 時 harness 全綠,本靶**必須真的翻面** |
| ⑫ | `shipment_items` 那支只重算 NEW | 項 27 |
| ⑬ | 兩支的迭代拿掉 `ORDER BY` | 雙 session barrier 格(§3.3c) |
| ⑭ | backfill 漏掉一個候選品項 | 項 17 的差集段 |
| ⑮ | C8 拿掉 | 項 14b |

🔴 **每個靶先驗「sed 真的改到東西」(`cmp`)**,否則零突變會被當成抓到(`a1-verify.sh:25` 已是常駐紀律)。

---

## §6 Cut point 與 apply 合約

**兩支 migration 同批 apply,順序強制 `S2a → S2b`;五片全數 commit 前禁止 `db push`(§2 封窗)。**
🔴 `supabase db push` 逐支提交、**非同一 transaction** ⇒ 同批的效力 = 把危險窗縮到一次 apply 事件內。

**apply 前硬 gate(R1 #18)**:實查 `shipments` / `shipment_items` / `order_item_procurement` 三表列數。
§0.2 的 08-06 快照全為 0;**非 0 時本節的「安全」論證全部要重做**(有真實 shipped 真相時,
S2a→S2b 的 gap 內摘要 `shipped` 會全為 0 = 帳面失真)。

| 狀態 | 結果 | 安全? |
|---|---|---|
| S2a 成功、S2b 失敗 | 摘要多一欄恆 0 + 三條 CHECK;helper 仍三軸、upsert 欄位清單不含 shipped ⇒ 既有列 shipped 不被動到 | ✅ **在真相 gate 成立時安全**;🔴 **故障注入待做**(R1 #18):S2b 後段人為失敗,驗 helper / trigger / 摘要皆回復原狀 |
| 兩支皆成功 | 完整 | ✅ |
| 🔴 **順序倒置(先 S2b)** | helper 四軸寫不存在的欄 ⇒ **`42703`**,A4a 全鏈當場死(A5a 採購 upsert、A8a2 部分取消、receipts 任何寫入全爆) | ⛔ **禁止**;S2b 前置閘段③ 即為此而設 |

**回滾**(forward-only ⇒ 另立版本號更大的 down migration):
- **S2b down** → DROP trigger ×2 + **對應函式 ×2** + helper 還原三軸(**閘 pin 四軸指紋**,§3.2)。
  🔴 `DROP TRIGGER` **不帶走函式**(v5 §6 被 R3-Fable 抓過同型漏處)。
- **S2a down** → DROP CONSTRAINT ×3 + DROP COLUMN + COMMENT 還原。
- 🔴 **回滾順序與 apply 相反**:必須先還原 helper(S2b down)再砍欄(S2a down),
  否則砍欄那一刻 A4a 鏈立刻 `42703`。
- 🔴 **runbook 依賴清單同步**(R1 #14):現行 runbook 只枚舉四 trigger / 五函式,S2 後是六 / 七。

---

## §7 🔴 harness 連動(本輪實跑產出)

> 全文(指令 + 原始輸出)= `docs/reviews/2026-08-06-b2-s2-precheck-runs.md`。此處只留結論與處置。

### 7.1 未確認件 ①:`provision` 會不會把未來的 S2 一起套進拋棄庫 → **會**

`scripts/d1t2-rehearsal.sh:53` 是 `for f in supabase/migrations/*.sql`,唯一硬編碼跳過 `20260723120000`(`:55`)。
天然實驗:B2 三支是腳本寫成後才進目錄的,provision 完拋棄庫實查
`to_regclass('public.shipments')||' / '||to_regclass('public.shipment_items')` → `shipments / shipment_items`。

⇒ provision 是 `a1-verify` / `a4a-verify` / `a6-verify` / `a7*` 一族的共用地基。
**S2 一落地,每一支走 provision 的 harness 都在四軸世界裡跑。**

### 7.2 未確認件 ②:S2 之後 a1-verify 的行為探針紅不紅 → **不紅,61/0 全綠**

| 情境 | a1-verify |
|---|---|
| S2 未套(基準) | **PASS=61 / FAIL=0** |
| S2 形狀已套 | **PASS=61 / FAIL=0**(尾段逐字相同) |

機制:`a1-behavior-probe.sql` 對摘要表**直寫**(16 `INSERT` / 7 `DELETE`),`grep -c pcm_a4a` = **0**
⇒ 四軸 helper 那條路徑在整支 harness 裡**從未被走到**。

⇒ **R3 的 F5「S2 落地後 a1-verify 保證全紅」= 證偽**;
v5 §7.1 我方「結構斷言照樣綠」= 對,但不完整 —— 問題根本不在斷言。

**真正的問題**:a1-verify 跑完把共用拋棄庫留在「摘要表 5 欄 + 四軸 helper/兩支 trigger 還在」的斷裂態。
直呼 helper 與走真 trigger 路徑(`INSERT order_item_procurement`)都當場
`42703 column "shipped_quantity" … does not exist`。

**三組對照(把成因分乾淨)**:

| 組 | 情境 | `a4a-verify` | `shipped_quantity` 錯誤 |
|---|---|---|---|
| A | 乾淨庫、無 S2 | **65 / 0** | 0 |
| B | S2 已套、**沒跑** a1-verify | **64 / 1** | 0 |
| C | S2 已套、**跑過** a1-verify | **34 / 31** | **23** |

⇒ C 的 31 紅裡 **30 條來自 a1-verify 的斷裂態,不是 S2**。
B 組唯一 1 紅 = `a4a-verify` 突變靶 **N8** 的文字錨被 helper 改寫弄壞成 `syntax error`(⇒ §4 項 23)。
爆炸半徑:`a1-verify.sh:35` 與 `a4a-verify.sh:17` **預設同一個 port 54329**。

### 7.3 處置(S2c-3;R1 #1 修正後的版本)

v1 推薦「a1-verify 收尾重套 **S2a**」——🔴 **R1 #1 抓到它在回滾世界會假綠**:
down migration 還原三軸 helper、砍掉 shipped 欄之後,再去重套 S2a 會造出
「六欄 + 三軸 helper」的新斷裂態,而舊 helper 直呼**照樣成功** ⇒ 活體斷言不會紅。

🔴 **改成版本感知**:

```
a1-verify 9/9 之後:
  1. 取 supabase/migrations/ 裡「版本號 > 20260730150000 且檔內出現
     order_item_quantity_summary」的全部 .sql,按版本序重套
     ⇒ forward 世界會套到 S2a(+S2b);down 世界會連 down 片一起套 ⇒ 兩邊都收斂到當下真相
  2. 活體斷言(§4 項 20 同形):造已知四軸 fixture → 直呼 helper
     → 斷言 rc=0 **且回查四個欄的新值全部正確**
```

判別力來源 = 第 2 步。**restore 選錯檔、少套一支、或 helper 是空函式,那一格都會紅。**

🔴 **殘餘風險(不自宣接受,列給 Sean)**:此案讓 `a1-verify` 依賴「檔名版本序 + 內容 grep」的選檔規則。
規則本身沒有守門 —— 未來若有片動到摘要表卻不提檔名/內容特徵,會被漏選。
症狀是 loud(活體斷言紅),但**診斷會指向錯的地方**。要寫進 `a1-verify.sh` 檔頭的契約債。

---

## §8 誠實邊界

- 🔴 **§7 的兩個結論是用「S2 形狀替身」量的,不是真 S2**。替身複製三個特徵(加欄+CHECK / 四軸 helper / 兩支 trigger)。
  效力範圍 = **任何「加欄 + 改寫 helper」形狀的 S2**;若最終改成不動 helper(另開一支重算函式),§7.2 必須重驗。
- 替身檔留在 scratchpad、**未進 repo、未 commit**(避免有人把它當 S2 實作)。
- **C 組 31 紅只做了成因分類**(23 條帶 `shipped_quantity` 字樣),沒有逐格追因;歸因靠 A/B/C 三組差分。
- 本片**零 writer 仍然成立**:出貨 owner RPC 不在本片 ⇒ 項 10-12 的正測要靠 harness 以 owner 身分造 fixture。
- **多列 INSERT 的跨交易死結(§3.5 第 2 層)本片造不出真 writer 競態**,標 **inconclusive、不假裝補**(同 v5 §7 項 3)。
- 本檔**已過關卡1 R1(FAIL/25+2,全折入),尚未過 R2**。
- §3.3a 對「`shipment_items` 那支今天沒有唯一契約」的判斷是**我方推理**,R1 認同;
  但它是**可證偽的**:若有人構造出一條今天走得通、且只有那支能覆蓋的路徑,§3.3a 就要改。

---

## §9 交棒

| # | 落在 | 內容 |
|---|---|---|
| 1 | 出貨 writer RPC 片 DoD | 自己守 `增量 ≤ instock − shipped`(為訊息與前緣拒絕,**不是為正確性**;正確性在 C9) |
| 2 | 出貨 writer RPC 片 DoD | 多品項同交易 `ORDER BY order_item_id` + `40P01` 重試(§3.5 第 2 層) |
| 3 | 到貨更正片 DoD | 被 C9 擋時的引導訊息:先作廢包裹 → 改到貨 → 重新出貨(Q1=A 的 U1 代價) |
| 4 | 解除 append-only 的片 | §4 項 26/27 的 U/D 負測要從「DISABLE 後構造」升級成常態路徑 |
| 5 | 任何在這兩張表掛 trigger / 改名的片 | 重跑名稱序斷言(A4a 契約債⑥ 同型) |
| 6 | 任何未來動到摘要表的片 | `a1-verify` 的版本感知 restore 選檔規則(§7.3 殘餘風險) |
| 7 | 出貨 UI 片 | 「照這箱內容開一張新的」按鈕(Sean Q-a=C;**不是加值功能,是裝箱打錯量的唯一補救**) |
| 8 | 🔴 **Sean apply 之後**(R1 #23) | `database.types.ts` 重生 → 人工 nullable 校正回貼 → `pnpm typecheck` checkpoint。**S2 的三綠在 apply 前跑不到這一格**,必須明列為 apply 後動作 |
| 9 | 未來任何替換 helper 的片 | md5 指紋的凍結/公告契約(§3.2) |

## §9.1 S1 消融台帳 21 條的回歸標記(`B-131-A` ④)

來源 = `docs/reviews/2026-08-05-b2-s1-ablation-ledger.md`(21 條全 CONFIRMED、誤判 0)。

| # | S1 的病 | S2 回歸? | 動作 |
|---|---|---|---|
| **3** | 八支函式對三角色全有 `EXECUTE` | 🔴 **會** | §4 項 9b |
| **4** | proconfig 只比前綴;owner 可被換 | 🔴 **會** | §4 項 9 / 9b |
| **10** | 約束集合只驗「都在」、沒驗「不得有多餘」 | 🔴 **會** | §4 項 2b |
| **12** | 對不存在 trigger 名的 `IF (SELECT …)` 靜默通過 | 🔴 **會** | §4 項 8 先 `NOT FOUND` fail-closed |
| **14** | 前置閘純計數 | 🔴 **會** | §3.2 段③ + §4 項 8 |
| **20** | 負測紅在別條約束 | 🔴 **會(高)** | §4 項 14 / 14b 的 conname 比對 |
| **21** | 只驗 SQLSTATE 的歸因是錯的 | 🔴 **會** | §4 項 19 |
| **23** | harness 對 RLS/ACL/owner 面 0 命中 | 🔴 **會** | §4 項 9b |
| **24** | fixture 值碰巧相同 ⇒ 區別構造不出 | 🔴 **會(高)** | fixture 必須讓 `quantity / instock / cancelled / shipped` **四值互異**(§4 項 14 的 2+1 設計即為此) |
| **25** | 拿掉 parent guard 的 NKU,`b2s1b` 仍 24/0 全綠 | 🔴 **會(最高)** | §5 靶⑨ **必須真的翻面** |
| **26** | 作廢面缺 `submitted` 態、缺「已出貨作廢後 unvoid」 | 🔴 **會** | §4 項 11 / 12 |
| **2** | X1 不回頭掃既有列 | 🟡 同型 | §3.4 backfill = 等價物,不得省略 |
| **9** | grep 對 `RETURN OLD` / `NEW := OLD` 全盲 | 🟡 條件式 | 本片兩支是 AFTER、回傳值不載重;**日後加 BEFORE 守門即回歸** |
| **1 / 13 / 19** | owner 豁免措辭 / DO 內零實質斷言 / 多欄合併成一格 | 🟡 通則 | 沿用同措辭與「每欄獨立格」紀律 |
| **7 / 8 / 11 / 22** | 空白字串、退回 draft、索引建錯欄、X1 五格缺兩面 | ⬜ 不涉 | 全在 `shipments` 欄與 X1 面 |

🔴 **21 條裡 11 條會回歸,而且全落在「判別力」那一類** —— 沿用 S1 harness 形狀會把同一批假綠原封複製。

---

## §10 送審指引

**關卡1 R1(codex)** ✅ 已跑完:**FAIL / 25 must-fix + 2 nit**,報告 `docs/reviews/2026-08-06-b2-s2-k1-codex-r1.md`,逐條處置見 §0.3。
**關卡1 R2(codex,修後複審)** —— 待跑。硬上限 2 輪;R2 仍 FAIL ⇒ 停、整理決策題給 Sean,不硬闖(`B-130-A` ③)。

R2 的重點應該放在「**折入本身有沒有製造新問題**」,不是重掃 R1 已修的面:
①拆五片之後,封窗合約(全部 commit 前禁止 apply)靠什麼強制?②§7.3 版本感知 restore 的選檔規則有沒有新的假綠面?
③§5 兩個環境拆開後,有沒有哪個靶在兩邊都不紅?④§3.3a 收回「兩支都不可少」之後,`shipment_items` 那支還該不該在本片做?

—— v2 完 ——
