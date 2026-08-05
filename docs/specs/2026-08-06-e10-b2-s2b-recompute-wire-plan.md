# E10 第 2 批 · B2-S2b(大線):`shipped` 重算接線 + harness / runbook 連動 **v1**

> 狀態:**起草完、未送審;不得開工**。
> 來由 = Sean 2026-08-06 拍板 **Q3=A**(v2 一份 plan 拆兩線)。
> 姊妹檔 = **小線** `docs/specs/2026-08-06-e10-b2-s2a-summary-columns-plan.md`(加欄 + 三條 CHECK)。
> **取代** `docs/specs/2026-08-06-e10-b2-s2-shipped-summary-plan.md` v2 的大線部分(v2 已標作廢)。
> 實跑證據(兩線共用)= `docs/reviews/2026-08-06-b2-s2-precheck-runs.md`。
> 前身審查軌跡 = `docs/reviews/2026-08-06-b2-s2-k1-codex-r1.md` / `-r2.md`。

---

## §0 定位

### 0.1 本線做什麼

| 群 | 內容 |
|---|---|
| **A. 重算接線** | A4a helper 四軸化(md5 前置閘 → `CREATE OR REPLACE`)+ **`shipments` 那一支**重算 trigger + 真值 backfill |
| **B. break-glass 補洞** | `docs/runbooks/a4a-summary-rollback.md` 與 `scripts/a4a-verify.sh` 的漂移 oracle 四軸化 + rollback 依賴清單 |
| **C. harness 判別力修復** | `a4a-verify` 突變靶 N8 文字錨、收尾零殘留閘擴充、`proacl IS NULL` 假綠;`a1-verify` 斷裂態 + port 54329 |
| **D. S1 harness 回歸** | 三支 B2 S1 harness 各自的新格(逐支指定 cell / mutant / 預期計數) |

### 0.2 🔴 本線**不做**(Sean Q1=A 拍板;寫在這裡防下一棒撿回來)

**`shipment_items` 那支重算 trigger —— 兩線都不含。**

理由(v2 §3.3a、codex R1 #5 抓、R2 #19 主張移出):
正常出貨路徑(建箱 → 加品項 → 設 `shipped_at`)的 `shipped` 值**完全由 `shipments` 那支寫對**;
加品項當下 `shipped_at` 必為 NULL ⇒ `shipment_items` 那支算出來的一定是 0。
**它今天沒有任何一件事只有它能做**,卻要多一支 SECURITY DEFINER 函式、多一次每列 INSERT 的鎖、
以及 plan 自己已承認的反序多列 `40P01` 面。

⇒ **交棒未來「開放改箱 / 放寬 X3」的片**:那天要一起補
①`shipment_items` 重算 trigger(事件面 I/U/D)②OLD/NEW 都重算 + 去重後 `ORDER BY order_item_id`
③U/D 兩枝與 re-parent 的負測 ④多列 INSERT 的鎖序與 `40P01` 重試。

### 0.3 🔴 只掛一支的**前提**與它的機器證明(本線最重要的一條)

**前提**:`shipped` 只可能經由 `UPDATE shipments SET shipped_at` 升值,不可能經由 INSERT。

**為什麼成立**(實查,非推理):
- X3(`20260805170200:128`,錯誤訊息 `:168`「包裹已寄出或已作廢,不可再加品項」)擋死
  「對已寄出/已作廢的包裹加品項」。
- ⇒ 想用 INSERT 直接造出「已 `shipped_at` 且有品項」的包裹:
  必須先 `INSERT shipments`(帶 `shipped_at`),再 `INSERT shipment_items`(FK 要求父先在)——
  **第二步必被 X3 擋**。
- ⇒ 若不加品項,X1(`:234`「已離開草稿態但沒有任何品項」)在 **COMMIT 當下**擋死。
- ⇒ **兩條路都不通** ⇒ 已寄出的包裹**只能**由 UPDATE 產生。

🔴 **這是前提、不是觀察 ⇒ §4 必須有一格把它釘住**(項 12),否則哪天 X3 或 X1 被放寬,
`shipped` 會靜默地永遠算少,而且**沒有任何一格會紅**。

### 0.4 與小線的依賴與封窗

- **硬順序:小線 → 大線,不可倒。** 倒了 helper 會寫一個不存在的欄 ⇒ `42703`,
  A4a 全鏈當場死(A5a 採購 upsert、A8a2 部分取消、receipts 任何寫入全爆)。
- 物理保證 = 本線 migration 的**前置閘段③**(pin 小線產物)+ 小線的 quarantine 機制。
- 🔴 **小線若已單獨上線,本線落地前 `shipped` 一直是 0**(小線 §0.2 的誠實邊界),
  本線的真值 backfill 就是把它補正的那一步。

### 0.5 從 v2 兩輪 findings 折進本線的

| 來源 | 內容 | 落在 |
|---|---|---|
| R1 #1 / R2 #1 #2 | a1-verify restore 假綠 + 選檔規則誤選(v2 的修法自己是壞的:實跑會選中 6 支含 A4a 的 5 個裸 `CREATE FUNCTION` ⇒ `42723`) | §3.5 |
| R1 #2 | 活體斷言只驗沒噴錯 | §4 項 20 |
| R1 #6 / R2 #(trigger 閘) | trigger 結構閘要含 `tgfoid/tgconstraint/tgdeferrable/tginitdeferred/tgattr` + `pg_get_triggerdef` | §4 項 8 |
| R1 #7 / R2 #7 | 新函式安全面;🔴 `proacl IS NULL` = PUBLIC 有預設 EXECUTE,而 `aclexplode(NULL)` 回零列 ⇒「零 grantee」恆綠 | §4 項 9b |
| R1 #8 / R2 #10 | 迭代鎖序 `ORDER BY` + 可重現的雙 session barrier | §3.3 / §4 項 19 |
| R1 #10 / R2 #11 | X1 rollback 要真的構造 commit-time 失敗 | §4 項 18 |
| R1 #11 / R2 #9 | 突變矩陣拆結構/行為兩環境、逐靶唯一 oracle | §5 |
| R1 #12 / R2 #(PR4) | PR4 造洞法要「只動 shipped 真相、前三軸不動」 | §4 項 22 |
| R1 #13 / R2 #12 | 真相式允許幾處、逐處錨與消融(runbook 實際有**兩份**) | §1.1 |
| R1 #14 / R2 #(runbook) | rollback runbook 依賴清單、DROP 序、rehearsal | §4 項 21b / §6 |
| R1 #15 / R2 #(收尾) | a4a-verify 收尾 md5 只守五函式 | §4 項 23b |
| R1 #16 #17 / R2 #13 | md5 pin 範圍、維護者、雙對照庫 | §3.2 |
| R1 #19 | backfill 值 oracle | §3.4 |
| R1 #25 / R2 #16 | 三支 S1 harness 的 cell / mutant / 預期計數 | §4 S2b-D |
| R2 #8 | 靶「漏 `shipped_at IS NOT NULL`」在兩環境都沒紅點 ⇒ 需具名草稿箱格 | §4 項 10b / §5 靶⑥ |
| R2 #20 | rollback oracle 候選全集漏 shipment-only 品項 | §4 項 21b |
| R2 #6 | 行為驗收沒有承接腳本 | §7 |
| ~~R1 #3 #4 / R2 #19~~ | ~~U/D 兩枝、OLD/NEW 語意~~ | **Q1=A 移出本線**(§0.2) |

---

## §1 真相式

```sql
COALESCE(sum(si.shipped_quantity), 0)
  FROM public.shipment_items si
  JOIN public.shipments s ON s.id = si.shipment_id
 WHERE si.order_item_id = <品項>
   AND s.deleted_at IS NULL          -- Q3=A:作廢即退量
   AND s.shipped_at IS NOT NULL      -- 未寄出的草稿箱不算
```

### 1.1 允許出現的位置:**四處**(R1 #13 / R2 #12)

v2 先寫「只准一處」(做不到:oracle 必須獨立算才有判別力),再寫「三處」(數錯了)。
**實查**:`docs/runbooks/a4a-summary-rollback.md` 的漂移式出現**兩次**(初始對帳段 + 收尾重驗段),
加上 helper 與 `scripts/a4a-verify.sh` 的 `ORACLE_SQL` ⇒ **共四個文字實體**。

| # | 位置 | 角色 |
|---|---|---|
| 1 | A4a helper 內 | **唯一 writer** |
| 2 | runbook 初始對帳段 | 獨立 checker |
| 3 | runbook 收尾重驗段 | 獨立 checker |
| 4 | `a4a-verify.sh` 的 `ORACLE_SQL` | harness 側 checker |

**守門設計**(R2 #12:光說「逐字同步」沒有判別力):
- 四處各加**邊界標記註解**(`-- SHIPPED-TRUTH-BEGIN` / `-- SHIPPED-TRUTH-END`)。
- 抽出後做**正規化**(去空白、去換行、小寫)再取 md5,四份必須全等。
- **四個獨立突變**:逐一改一處,斷言「同步格紅、且指名是哪一處不同」。

---

## §2 片界(四片,各 ≤45 分)

| 片 | 型 | 內容 | 鐵則 12? | 估時 |
|---|---|---|---|---|
| **S2b-1** | M | migration:md5 前置閘 + helper 四軸化 + `shipments` 重算 trigger + 真值 backfill + 檔內結構驗收 | ③ ⇒ **是** | 45 分 |
| **S2b-2** | 非 M | `scripts/b2s2b-verify.sh`:行為格 + 兩環境突變 + barrier 併發格 | 否 | 45 分 |
| **S2b-3** | 非 M | break-glass:runbook 兩段 oracle 四軸化 + 依賴清單/DROP 序/rehearsal + `a4a-verify` 的 `ORACLE_SQL` 四軸化 | 否 | 40 分 |
| **S2b-4** | 非 M | harness 判別力修復:`a4a-verify`(N8 錨、收尾七函式六 trigger、`proacl` 假綠)+ `a1-verify`(§3.5)+ 三支 S1 harness 新格 | 否 | 45 分 |

🔴 **封窗**:S2b-1 走小線建立的 **quarantine 目錄**,四片全數 commit 後才 gate commit 移入正式目錄。
🔴 **S2b-1 一旦進正式目錄,`a4a-verify` 的 N8 靶會壞**(本輪實測,`syntax error`)
⇒ **S2b-4 必須在 gate commit 之前完成**,否則中間態的 harness 是紅的(R2 #5)。

---

## §3 設計

### 3.1 helper 四軸化

在既有三軸 helper 上加第四軸(§1 真相式),`INSERT … ON CONFLICT DO UPDATE` 的欄位清單同步加 `shipped_quantity`。

🔴 **`search_path` 維持 `public, pg_temp`、不回改成 `''`**:memory 拍板「新函式一律 `''`,
a5a 的舊慣例**不回改**」—— helper 是既有函式,本片只加軸,不趁機改它的執行環境。
**本片新建的那支 trigger 函式用 `SET search_path = ''` + 全限定名**;兩種慣例並存是刻意的,COMMENT 寫明。

### 3.2 md5 前置閘(R1 #16 #17 / R2 #13)

**替換方式 = `CREATE OR REPLACE`**(A4a 原檔的「禁 OR REPLACE」紀律對象是**新建**,本片是蓄意替換)。

| 段 | pin 什麼 | 少了會怎樣 |
|---|---|---|
| ① | **`pg_get_functiondef(helper)` 的 md5**,不是 `prosrc` | 只 hash `prosrc` ⇒ `search_path` / `lock_timeout` / `SECURITY DEFINER` 漂移全部隱形 |
| ② | `proowner` / `prosecdef` / `proconfig` 全陣列 | `pg_get_functiondef` 不含 owner |
| ③ | **小線產物**:`shipped_quantity` 欄 + 三條 CHECK 具名且定義逐字 | 片序不可倒的物理保證(§0.4) |

**指紋維護者**:forward 片閘裡凍結**三軸**指紋、結尾在 COMMENT 公告**四軸**指紋;
down 片閘裡凍結四軸、還原後公告三軸;未來任何再替換 helper 的片照同一契約。**逐字寫進兩支 migration 檔頭。**

🔴 **負測要在「A4a + 小線都套了、本片未套」的庫上跑**(R2 #13):
同一個庫先跑 control 會把 helper 換成四軸,之後 mutant 即使零改動也會因基準已變而被拒 ⇒ 重現假證明。
⇒ **兩個由同一 provision 快照複製出來的獨立庫**,一個跑 control、一個跑 mutant(合法註解字元突變)。

### 3.3 `shipments` 重算 trigger(**只有這一支**)

| 表 | 事件 | 名稱 | 型 |
|---|---|---|---|
| `shipments` | `AFTER UPDATE OF shipped_at, deleted_at` | `shipments_summary_recompute_ac` | CONSTRAINT TRIGGER, **NOT DEFERRABLE**, FOR EACH ROW |

**函式體**:
```
受影響品項 = SELECT DISTINCT si.order_item_id FROM shipment_items si WHERE si.shipment_id = NEW.id
🔴 ORDER BY si.order_item_id 後逐一 PERFORM helper
```
🔴 `ORDER BY` 不是裝飾(R1 #8):未排序的 DISTINCT 迭代,兩張含重疊品項的包裹併發出貨會反序取鎖 ⇒ 真 `40P01`。

**發火序**:既有 X1 `shipments_items_presence_ac` 是 **DEFERRED**(COMMIT 才驗),
新的重算 **NOT DEFERRABLE**(語句結束即跑)⇒ 重算排在 X1 之前。
前提 = 重算讀 `shipment_items` 時品項已在(X3 保證);X1 若在 COMMIT 紅掉則整筆回滾、重算一併蒸發。
🔴 **這是前提不是觀察,§4 項 18 要真的構造它。**

**`NOT DEFERRABLE` 的理由**:R1-19 契約「不新開交易」;且 **CHECK 不可 defer**,
把重算 defer 到 COMMIT 只會讓錯誤更晚出現、不會讓它消失。

### 3.4 真值 backfill(小線刻意不做的那一步;R1 #19)

trigger 建立**之前**、同交易、逐品項呼叫 helper。**兩段 oracle,任一不符即 `RAISE`**:
1. **值漂移**:對每個候選品項,用 §1 的獨立四軸公式重算,與摘要列**逐欄**比對(四軸全比)。
2. **缺列**:`shipment_items` 有列的 `order_item_id` 全集 **⊆** 摘要表 `order_item_id` 全集,差集必須為空。

🔴 候選集合必須含 **shipment-only 品項**(R2 #20):現行 runbook/harness 的候選全集是
`order_item_procurement ∪ order_cancellation_items`(實查 `a4a-verify.sh` 的 `ORACLE_SQL` 第三段),
**沒有 `shipment_items`** ⇒ 只出現在出貨表的品項會被整個看不見。本片要把它加進去(§4 項 21b 同步改 runbook)。

### 3.5 `a1-verify` 斷裂態的處置(R2 #1 #2 把 v2 的修法打掉,這是重寫版)

**v2 的修法**(重套「版本號 > A1 且檔內出現摘要表」的 migration)**實跑證明是壞的**:
命中 **6 支**,含 A4a —— 而 A4a 有 **5 個裸 `CREATE FUNCTION`** ⇒ 重跑必 `42723`,連小線都到不了。

🔴 **改成 manifest 驅動(R2 修法)**:

| 項 | 設計 |
|---|---|
| manifest | `scripts/a1-verify-restore.manifest`:一行一支**明列版本號**的 migration,**禁止用內容 grep 決定集合** |
| 冪等要求 | 進 manifest 的片必須是**可重跑**的(小線的 `ADD COLUMN` 重跑會 `42701` ⇒ **不能**直接重套)⇒ 實務上 restore 應改為**還原 schema 快照**,而非重跑 migration |
| 終態判定 | manifest 同時記「當下終態 = 三軸 or 四軸」,活體斷言**依終態分流**(R2 #2:down 世界收斂回三軸時,硬驗四欄會讓正確的 restore 也紅) |
| 活體斷言 | 造已知 fixture → 直呼 helper → 斷言 rc=0 **且回查四(或三)個欄的新值全部正確**(R1 #2:只驗「沒噴錯」被空函式騙得過) |

🔴 **本節是本線最不確定的一塊**,關卡1 請重點打(§10)。
**候選簡化**:與其讓 `a1-verify` 自我修復,不如讓它**用專屬 port + 跑完即 teardown**,
把「留下斷裂態」從「要修的 bug」變成「不會發生的事」。成本更低、判別力更明確。

### 3.6 port 54329 撞埠

`a1-verify.sh` 與 `a4a-verify.sh` 預設同埠(precheck-runs §3.3 的地雷牌)。
本線一併處理:兩支分埠 **或** §3.5 的「跑完即 teardown」。**擇一即可,不必都做。**

---

## §4 驗收(骨架;每條一個可判定 oracle)

> 通則:「→ 成功」的正測 oracle **不得只驗「沒噴錯」**,必須回查新值落庫。

**S2b-1(migration)**
| # | 條件 |
|---|---|
| 6 / 6b | md5 閘:helper 定義被改過 ⇒ 拒繼續;閘 pin `pg_get_functiondef` 而非 `prosrc`(只改 `SET lock_timeout` 也要紅)。**負測走雙獨立庫**(§3.2) |
| 7 | 閘:小線未套 ⇒ 拒繼續,且 **`RAISE` 而不是 `42703`** |
| 8 | trigger 完整結構:`tgname/tgenabled/tgtype/tgfoid/tgconstraint/tgdeferrable/tginitdeferred/tgattr` + `pg_get_triggerdef` 全等 |
| 9 | helper 替換後 owner / `prosecdef` / `proconfig` **全陣列** |
| 9b | 🔴 新 trigger 函式安全面:owner / secdef / `search_path=''` / **`proacl IS NOT NULL`** + 四角色 `has_function_privilege(...)=false`(R2 #7:`aclexplode(NULL)` 回零列會讓「零 grantee」恆綠) |
| 10 | 正測:建箱掛品項 → `UPDATE shipped_at` → `shipped_quantity` = 該量 |
| 10b | 🔴 **草稿箱格**(R2 #8):掛了品項但**不設** `shipped_at` ⇒ 摘要 `shipped` 仍為 **0** |
| 11 / 12 | Q3=A 退量(含 `submitted` 態作廢)/ unvoid 回升(含「由已出貨作廢態 unvoid」) |
| 12b | 🔴 **§0.3 前提釘死**:`INSERT shipments`(帶 `shipped_at`)+ 加品項 ⇒ **必被 X3 擋**;不加品項 ⇒ **COMMIT 時必被 X1 擋**。兩格都要 |
| 14 / 15 | C9 負測(fixture 四值互異 `4/2/1/3`、receipts **2+1** 刪 `quantity=1` 那筆)/ C9 承重性(DROP 後必須**全綠**) |
| 17 | backfill 兩段 oracle(§3.4),含 shipment-only 候選 |
| 18 | 🔴 X1 在 COMMIT 失敗 ⇒ 交易外回查摘要與品項**兩邊都回滾**(R1 #10:v2 只重述結論) |
| 19 | 🔴 雙 session barrier:兩交易以相反品項序併發出貨,**明訂 fixture / 同步點 / 提交序 / 預期無 `40P01`**;拿掉 `ORDER BY` 必翻面(R2 #10) |
| 20 | A4a 鏈活體:造四軸 fixture → 直呼 helper → rc=0 **且四欄新值全對** |

**S2b-3(break-glass)**
| # | 條件 |
|---|---|
| 21 | runbook **兩段** + `a4a-verify.sh` 的 `ORACLE_SQL` 全部四軸化;§1.1 的四份正規化 md5 全等 + 四個獨立突變 |
| 21b | 🔴 rollback 依賴清單補成 **六 trigger / 七函式** + DROP 序 + 一次 rehearsal;候選全集加 `shipment_items`(R2 #20) |
| 22 | 🔴 PR4 洞實證:DISABLE 六支 → **只動 shipped 真相、前三軸完全不動** → ENABLE → 舊三軸 oracle **通過**、四軸版 **必 RAISE**(R1 #12:v2 引用的「DELETE receipt」會讓舊 oracle 因 instock drift 就 RAISE,測不到 shipped 軸) |

**S2b-4(harness 修復)**
| # | 條件 |
|---|---|
| 23 | `a4a-verify` 突變靶 **N8** 錨同步 + 驗「突變真的翻面」 |
| 23b | 收尾零殘留閘擴成七函式 / 六 trigger / 四軸 oracle / 候選全集 |
| 24 | `a1-verify` 依 §3.5 處置 + 活體斷言(依終態分流) |
| 25a-c | 三支 S1 harness 新格,**逐支明列 cell / 唯一 mutant / 預期 PASS-FAIL-MUT 計數與值 oracle**(R2 #16:只要求事後「數字入帳」的話,少一格也能照抄成成功) |

---

## §5 突變靶(兩環境,逐靶唯一 oracle)

**環境 A(結構)**:靶 = trigger 改 `BEFORE`(項 8 `tgtype`)/ 指向另一支函式(`tgfoid`)/
`UPDATE OF` 改成任意 UPDATE(`tgattr`)/ 閘拿掉(項 6)/ 閘改 pin `prosrc`(項 6b)/
新函式 `search_path` 改 `public`(項 9b)/ 新函式漏 `REVOKE`(項 9b 的 `proacl IS NOT NULL` 那半)。

**環境 B(行為)**:
| 靶 | 唯一 oracle |
|---|---|
| 拿掉 `shipments` 那支 trigger | 項 10(shipped 恆 0 且零錯誤) |
| 真相式漏 `deleted_at IS NULL` | 項 11 |
| 🔴 真相式漏 `shipped_at IS NOT NULL` | **項 10b(草稿箱格)** —— R2 #8:v2 沒有這一格,此靶在兩環境都沒有紅點 |
| 漏 `deleted_at` 事件面 | 項 11 |
| helper 把 NKU 鎖移到讀 SUM 之後 | 項 19 barrier —— 🔴 **S1 消融 #25 的回歸點**(S1 拿掉 NKU 時 harness 全綠),本靶**必須真的翻面** |
| 迭代拿掉 `ORDER BY` | 項 19 |
| backfill 漏掉一個候選品項 | 項 17 差集段 |
| 四份真相式改其中一份 | 項 21 的四個獨立突變 |

🔴 每個靶先驗「`sed` 真的改到東西」(`cmp`)。

---

## §6 Cut point 與回滾

- **順序 `小線 → 本線` 強制**(§0.4);倒置 ⇒ `42703` A4a 全鏈死。
- **本線內四片**:只有 S2b-1 是 migration ⇒ 沒有 migration 間 cut point;
  S2b-1 中途失敗 ⇒ 單一 `BEGIN…COMMIT` 整支回滾,**由故障注入格實證、不是論證**。
- **回滾**:S2b down = DROP trigger ×1 + **對應函式 ×1** + helper 還原三軸(閘 pin 四軸指紋)。
  🔴 `DROP TRIGGER` **不帶走函式**。
  🔴 **回滾順序與 apply 相反**:先還原 helper(本線 down)再砍欄(小線 down),否則砍欄那刻 `42703`。
  🔴 runbook 的依賴清單同步(§4 項 21b),否則撤 helper 後**下一筆 DML 才爆**。

---

## §7 harness:`scripts/b2s2b-verify.sh`(R2 #6)

行為格、兩環境突變、barrier 併發格塞不進 migration 的 `DO` 區塊 ⇒ 獨立 harness(S2b-2)。
形狀抄 `a4a-verify.sh`(身分閘五重 + 三計數器 + 全 `BEGIN…ROLLBACK` + DB 內突變 anchor 三重 preflight),
但**不得沿用它已知的假綠**:`proacl IS NULL`(R2 #7)、突變錨對原始碼做文字改寫(本輪實測 N8)、
收尾只守五函式(R1 #15)。

---

## §8 誠實邊界

- §0.3 的前提(shipped 只能經 UPDATE 升值)有機器證明的路徑(項 12b),但**證明的是今天的 X1/X3**;
  那兩條被放寬的那天,前提就倒了,而且**沒有任何一格會自動紅** ⇒ 已寫進交棒(§9 項 3)。
- §3.5 是本線最不確定的一塊;「跑完即 teardown」這個候選簡化**沒有實測**。
- barrier 併發格在**零 writer** 下只能用 owner 直寫模擬,**不是真 writer 競態** ⇒ 標 inconclusive。
- 本檔**尚未送審**(小線先送、兩輪額度分開)。

---

## §9 交棒

| # | 落在 | 內容 |
|---|---|---|
| 1 | 出貨 writer RPC 片 | 自己守 `增量 ≤ instock − shipped`(為訊息與前緣拒絕,**不是正確性**);多品項同交易 `ORDER BY order_item_id` + `40P01` 重試 |
| 2 | 到貨更正片 | 被 C9 擋時的引導訊息:先作廢包裹 → 改到貨 → 重新出貨 |
| 3 | 🔴 **任何放寬 X1 / X3 的片** | §0.3 的前提會倒 ⇒ 必須同批補 `shipment_items` 重算 trigger,否則 `shipped` 靜默算少 |
| 4 | 🔴 **未來「開放改箱」的片** | §0.2 的四項(trigger + OLD/NEW + U/D 負測 + 多列鎖序) |
| 5 | Sean apply 之後 | `database.types.ts` 重生 → nullable 校正 → `pnpm typecheck`(與小線 §9 項 1 同一個 checkpoint) |

---

## §10 送審指引

**尚未送審。** 小線先跑關卡1;本線起草完待主視窗排序。

建議攻擊角度(前身 v2 兩輪已挖過「守門完整性 / 假綠 / 折入沒寫機制」,不要重複):

1. **§3.5** 是 v2 修法被打掉後的重寫版 —— manifest 驅動 + 終態分流,還是「跑完即 teardown」更對?
   兩個方案各自的失效面是什麼?
2. **§0.3 的前提證明**(項 12b 兩格)真的窮舉了嗎?有沒有第三條路能造出「已 `shipped_at` 且有品項」?
3. **§1.1 的四處正規化 md5**:正規化本身會不會把真正的語意差異抹掉(例如 `AND` 順序調換)?
4. **§2 的封窗**(S2b-4 必須在 gate commit 前完成)—— 四片之間還有沒有別的「先 commit 就會紅」的interlock?
5. **§3.4 backfill 候選全集加 `shipment_items`** 之後,還有沒有第四種只出現在某張表的品項?

—— v1 起草完 ——
