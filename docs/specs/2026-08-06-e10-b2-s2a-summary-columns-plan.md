# E10 第 2 批 · B2-S2a(小線):摘要表加 `shipped_quantity` 欄 + 三條 CHECK **v1**

> 狀態:**起草完、待關卡1;不得開工**。
> 來由 = Sean 2026-08-06 拍板 **Q3=A**(v2 一份 plan 拆兩線)。
> **取代** `docs/specs/2026-08-06-e10-b2-s2-shipped-summary-plan.md` v2 的小線部分(v2 已標作廢)。
> 姊妹檔 = **大線 plan**(重算接線 + harness/runbook 連動),檔名待起草。
> 實跑證據(兩線共用)= `docs/reviews/2026-08-06-b2-s2-precheck-runs.md`。
> 前身審查軌跡 = `docs/reviews/2026-08-06-b2-s2-k1-codex-r1.md` / `-r2.md`。

---

## §0 定位

### 0.1 本線做什麼、不做什麼

| | 內容 |
|---|---|
| **做** | `order_item_quantity_summary` 加 `shipped_quantity` 欄 + C8 / C9 / C6′ 三條 CHECK + 全部受影響 COMMENT + 結構驗收 harness |
| **做(plan 層,不實作)** | **quarantine 目錄機制設計**(Sean Q2=A)—— 隔離路徑、移轉條件、防呆。**機制實作另批。** |
| **不做(移交大線)** | A4a helper 四軸化、`shipments` 重算 trigger、backfill 的值 oracle、break-glass oracle 四軸化、`a4a-verify` / `a1-verify` 修復、port 54329 撞埠 |
| 🔴 **不做(Sean Q1=A 拍板,兩線都不含)** | **`shipment_items` 那支重算 trigger** —— 它今天沒有唯一契約(正常出貨路徑的值全由 `shipments` 那支寫對),隨未來「開放改箱 / 放寬 X3」的片一起做。**不得由任何一線撿回來。** |

### 0.2 🔴 本線最重要的誠實邊界(plan、migration COMMENT、apply 說明三處都要寫)

**小線單獨上線之後,`shipped_quantity` 恆為 0,C9 是恆真的、沒有任何效力。**
真正的效力要等大線的重算接線落地。⇒ **不得對外宣稱「已出貨不得取消已經被 DB 擋住了」。**

### 0.3 前提事實(2026-08-06 親驗,非引述)

- **S1 三支已在正式站**:`supabase migration list` 唯讀親查,`20260805170000` / `170100` / `170200`
  的 Local 與 Remote 欄皆有值。
- **正式站列數實查**(Supabase 唯讀 `execute_sql`):`order_item_quantity_summary` = **0**、
  `shipments` = **0**、`shipment_items` = **0**、`order_item_procurement` = **0**、`order_items` = 42。
  摘要表 0 列的原因是**採購表 0 列**(A4a 惰性建列從未被觸發)。
- **`provision` 吃整個 migrations 目錄**:`scripts/d1t2-rehearsal.sh:53` 是
  `for f in supabase/migrations/*.sql`,唯一硬編碼跳過 `20260723120000`。
  🔴 **這條事實同時是 §3.5 quarantine 設計的關鍵輸入**(見該節)。

### 0.4 從 v2 兩輪 findings 折進本線的(屬小線範圍者)

| 來源 | 內容 | 落在 |
|---|---|---|
| R1 #9 | C8 沒有「只紅它」負測 | §4 項 7 |
| R1 #20 / R2 #18 | C9 負測 fixture:單筆 receipts 得到 instock=0 而非 2;且 `quantity` 與 `shipped` 撞值 | §4 項 5(四值互異 `4/2/1/3`) |
| R1 #22 / R2 #15 | DB COMMENT 清償範圍不足(漏 A1 表 COMMENT、新欄無 COMMENT) | §3.3 全清單 |
| R1 #23 / R2 #4 | 型別重生無人承接、且與封窗形成循環 | §9 項 1(**apply 後的 S2d checkpoint,不列入 pre-apply DoD**) |
| R1 #24 / R2 #22 | 片界估時失真 | §2 |
| R1 #18 / R2 #21 | cut point「安全」未證實、故障注入未具體化 | §6 |
| R1 #26 | 「機器證明」措辭 | §1 |
| R2 #3 | 封窗只有文字沒有物理閘 | §3.5(Sean Q2=A) |
| R2 #2 | down 世界 | §6 回滾 |
| R2 #6 | 行為驗收沒有承接腳本 | §7(`b2s2a-verify.sh`) |
| R2 #23 | row-count gate 沒有可判定門檻 | §3.4 |
| R2 #17 | 行號漂移 | 全檔改用**文字錨 + 區段**,不寫單行行號 |
| R1 #21 | 全樹契約債結清 | ✅ **已完成**(commit `b000a6c`) |

**留給大線、本線不碰**:R1 #1/#2/#3/#4/#5/#6/#7/#8/#10~#17/#19/#25、R2 #1/#5/#7~#14/#16/#19/#20。

---

## §1 三條 CHECK 與蘊含結構

| # | 具名 | 定義 | 角色 |
|---|---|---|---|
| **C8** | `oiqs_shipped_nonneg` | `shipped_quantity >= 0` | 值域;與 C1/C2/C3 同形 |
| **C9** | `oiqs_shipped_le_instock` | `shipped_quantity <= instock_quantity` | 🔴 承重件(分析 §2);**本線落地後恆真、效力等大線** |
| **C6′** | `oiqs_cancelled_shipped_le_quantity` | `cancelled_quantity::bigint + shipped_quantity::bigint <= quantity::bigint` | 🟡 冗餘,Sean Q2=A 知情保留 |

**蘊含**:`C9 ∧ C7 ⇒ C6′`(非負整數上逐點成立)—— 這是**代數證明**;
§4 項 8 的 `generate_series(0,6)` 四重迴圈是**有限域 smoke**,不是證明本身(R1 nit #26)。

⇒ **C6′ 的獨立負測在通電路徑上構造不出來**,這是它冗餘的機器證明,不是漏測。
🔴 驗收**不得**給 C6′ 排「只紅它一條」的負測格 —— 排了必然構造失敗,然後有人會去放寬 C9 讓它可構造。

`::bigint` 沿用 A1 C7 的理由(該檔 grep `**::bigint 不是裝飾**`):兩個 integer 相加先溢位成 `22003`,
負測會紅在錯的地方。**C9 是單欄比較、無相加,不需要 `::bigint`**(分析 §7 明文)。

---

## §2 片界

| 片 | 型 | 內容 | 鐵則 12? | 估時 |
|---|---|---|---|---|
| **S2a-1** | M | migration:加欄 + 三條 CHECK + 全部 COMMENT + 檔內結構驗收 | ③ ⇒ **是** | 30 分 |
| **S2a-2** | 非 M | `scripts/b2s2a-verify.sh`:結構 + 行為 + 突變兩環境(§7) | 否 | 45 分 |

**兩片可各自獨立 commit 且各自全綠**(R2 #5 的修法):
S2a-1 落地後 `b2s2a-verify.sh` 還不存在 ⇒ 沒有東西會紅;S2a-2 落地時 migration 已在,harness 直接可跑。
🔴 **但 S2a-1 不得 apply 到正式站,直到 S2a-2 也 commit** —— 這正是 §3.5 quarantine 要物理保證的事。

**quarantine 機制設計**(§3.5)算在 S2a-1 的 plan 產出內,**機制本身的實作另批**(Sean 指示)。

---

## §3 設計

### 3.1 加欄與三條 CHECK

```sql
ALTER TABLE public.order_item_quantity_summary
  ADD COLUMN shipped_quantity integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT oiqs_shipped_nonneg     CHECK (shipped_quantity >= 0),
  ADD CONSTRAINT oiqs_shipped_le_instock CHECK (shipped_quantity <= instock_quantity),
  ADD CONSTRAINT oiqs_cancelled_shipped_le_quantity
    CHECK (cancelled_quantity::bigint + shipped_quantity::bigint <= quantity::bigint);
```

- `NOT NULL DEFAULT 0` 在 PG11+ **不重寫表**(常數 default 走 catalog);`ADD CONSTRAINT CHECK` **全表掃描驗證**。
- 取 `ACCESS EXCLUSIVE` 並**持有到 COMMIT** ⇒ `SET LOCAL lock_timeout = '5s'` / `statement_timeout = '60s'`。
- 既有列恆過三條:`shipped=0` ⇒ C8 恆真、C9 = `0 ≤ instock`(C2 保證 instock ≥ 0)恆真、C6′ 退化成既有 C6。

### 3.2 backfill:**不需要**,而且理由不是「0 列」

`shipped_quantity` 的真值 = `shipment_items JOIN shipments` 的過濾加總(大線的真相式)。
`ADD COLUMN … DEFAULT 0` 對既有列一律填 0。⇒ **只有在 `shipment_items` 為 0 列時,`0` 才等於真值。**

🔴 **這才是 row-count gate 的真正判準,不只是鎖窗長度**(§3.4)。
`shipment_items` 非 0 列時單獨上小線,會產生「摘要 `shipped=0` 但真相非 0」的**失真**,
而且 **C9 恆真、C6′ 恆真、零錯誤訊息** ⇒ **靜默**。
⇒ 本線**不寫 backfill**;真值的填入由**大線的重算接線**承擔(它會在建 trigger 前跑一次逐品項重算)。

### 3.3 受影響 COMMENT 全清單(R1 #22 / R2 #15;逐一驗新字面)

| 對象 | 現況過期字面(文字錨) | 本線要寫成 |
|---|---|---|
| 新欄 `shipped_quantity` | **不存在**(R2 #15:新欄根本沒有 COMMENT) | 來源 = `shipment_items JOIN shipments`;維護者 = A4a 四軸重算(**大線**);🔴 **本線落地後恆 0、非真值** |
| 表 COMMENT | 「三個 0」「四條比較」 | 四個 0 / 五條比較 |
| 複合 FK 的 COMMENT | 「三個數量」 | 四個數量 |
| A1 契約債 COMMENT(grep `契約債 ①`) | 「第 2 批同一片必須 ①加 shipped ②納入 C6/C7 ③同步改 A8a1/A8a2 守門」 | 🔴 **三項裡只做兩項**:①✅ ②**C6′(C7 不動)**✅ ③**刻意不做**(Sean 08-05「無直送」⇒ `shipped ⊆ instock`,減了是重複扣) |
| `oiqs_instock_cancelled_le_quantity`(C7)的 COMMENT | 同上契約債字面 | 同上 |

🔴 **不得只寫「已清償」而不寫第三項刻意不做** —— 那是把已拍板的偏離藏進「完成」。
🟡 A4a helper COMMENT(「三張真相表 / 四支 trigger」)**屬大線**,本線不碰。

### 3.4 row-count gate:寫死查詢與門檻(R2 #23)

**apply 前必跑,三個判準,任一不過即停:**

| # | 查詢 | 通過門檻 | 不過的處置 |
|---|---|---|---|
| G1 | `SELECT count(*) FROM public.shipment_items` | **必須 = 0** | 🔴 **停,改走大線同批 apply** —— 非 0 代表小線單獨上線會造成 §3.2 的靜默失真 |
| G2 | `SELECT count(*) FROM public.order_item_quantity_summary` | **≤ 10000** | 超標 ⇒ 停,重估 `ACCESS EXCLUSIVE` 鎖窗(三條 CHECK 各一次全表掃描),改排離峰 |
| G3 | `SELECT count(*) FROM public.shipments WHERE shipped_at IS NOT NULL AND deleted_at IS NULL` | **必須 = 0** | 同 G1(有已寄出包裹 = 真相非 0) |

**2026-08-06 實測值**:G1 = 0 ✅、G2 = 0 ✅、G3 = 0 ✅。
🔴 **這組數字是快照,apply 當下必須重跑** —— 採購或出貨功能一旦被員工用起來,三個值都會變。

### 3.5 🔒 quarantine 目錄機制設計(Sean Q2=A;**本線只設計、實作另批**)

**要解的問題**(R2 #3):migration 檔一進 `supabase/migrations/`,任何人跑 `supabase db push` 就會套用,
看不到還沒 commit 的相依片。純文字封窗(「全部 commit 前不准 apply」)**沒有任何強制力**。

#### A. 路徑與移轉

| 項 | 設計 |
|---|---|
| 隔離路徑 | `supabase/migrations-quarantine/`(與正式目錄同層、平行) |
| 進入條件 | 任何「必須與其他片同批才安全」的 migration,**一律先進隔離區** |
| 移轉條件 | 該批**全部**相依片(含 harness、runbook、型別)都已 commit ⇒ 開一顆 **gate commit**,內容**只有** `git mv`,commit message 逐一列出被滿足的相依片 hash |
| 移轉後 | 正式目錄的檔名時間戳**必須仍是最大的**;若隔離期間有別的片進了正式目錄且時間戳更大 ⇒ **改名重排**,不得亂序 apply |

#### B. 🔴 隔離期間 harness 測不到那支 migration —— 這是本設計最大的坑

本輪實測:`provision` 走 `supabase/migrations/*.sql` 的 glob(§0.3)。
⇒ **隔離區的檔案不會被 provision 套** ⇒ 隔離期間所有 harness 都在「沒有那支 migration」的庫上跑
⇒ **綠得毫無意義**,而且不會有任何症狀。

**設計對策(三選一,關卡1 請攻擊哪個對)**:
1. `provision` 加一個 opt-in 參數(如 `PROVISION_INCLUDE_QUARANTINE=1`),harness 顯式帶上。
   —— 最小改動;風險 = 忘記帶就靜默測空。
2. `provision` **預設**連隔離區一起套(按檔名時間戳合併排序)。
   —— 不會忘;風險 = 正式站與拋棄庫的內容不一致,而拋棄庫「多套了」的方向較安全。
3. 隔離區的片**自己**帶一支 preflight,斷言「我已被套用」,harness 第一格就跑它。
   —— 判別力最直接;成本 = 每片都要寫。

**本 plan 傾向 2 + 3**:預設套(不靠人記得)+ 每片自帶存在性斷言(壞了會紅)。**待關卡1 打。**

#### C. 防呆(機制實作批要做的,列在此以免遺漏)

| # | 防呆 | 失效時的症狀 |
|---|---|---|
| D1 | 隔離區非空時,`supabase db push` 的**人工前置檢查清單**一定要先看隔離區 | 靠人記得 ⇒ 弱 |
| D2 | pre-commit / CI 檢查:隔離區有檔案時,**禁止**同一顆 commit 同時動正式目錄的 migration | 混批 |
| D3 | 隔離區 `README.md`:逐檔記「在等哪些片」,gate commit 時一併清掉 | 檔案留在隔離區被遺忘 |
| D4 | gate commit 的 message 必須列出被滿足的相依片 hash,可事後對帳 | 沒證據說相依已滿足 |

🔴 **誠實邊界**:D1-D4 全部**擋不住** owner 直接跑 `psql -f supabase/migrations-quarantine/xxx.sql`。
quarantine 擋的是「**照正常流程操作的人不小心提前 apply**」,不是惡意或刻意繞過。
**不得把它宣稱成「物理上不可能提前 apply」。**

---

## §4 驗收(每條一個可判定 oracle)

> 🔴 **通則**:「→ 成功」的正測 oracle **不得只驗「沒噴錯」**,必須回查該欄新值真的落庫。

| # | 條件 | oracle |
|---|---|---|
| 1 | 欄存在,型別 / NOT NULL / DEFAULT 逐字 | `pg_attribute` + `pg_attrdef` 比對 |
| 2 | C8 / C9 / C6′ 三條具名存在且 `pg_get_constraintdef` **逐字**相符 | 字串全等,非 `LIKE` |
| 3 | 🔴 **雙向**:摘要表的 CHECK 具名集合**恰等**預期全集(A1 七條 + 本線三條 = 10 條) | 偷加第 11 條要紅(S1 消融 #10 的回歸) |
| 4 | 🔴 **既有列違反 C9 時必紅**(R1 #18 修:v2 寫「apply 成功即證」在 0 列時**恆真**) | 先造一列 `shipped=3 / instock=2` 再 apply ⇒ 必 `23514` + conname |
| 5 | **C9 只紅它負測**,fixture **四值互異**:`quantity=4 / instock=2 / cancelled=1 / shipped=3` | 只違反 C9(C7:`2+1≤4` ✅、C6′:`1+3≤4` ✅);SQLSTATE `23514` + **conname** 雙比對 |
| 6 | **C9 正測**(邊界):`shipped = instock` 恰等 ⇒ 放行 | 回查落庫值 |
| 7 | 🔴 **C8 只紅它負測**(R1 #9):`quantity=0 / instock=0 / cancelled=0 / shipped=-1` | 只違反 C8;SQLSTATE + conname |
| 8 | **C6′ 冗餘性有限域 smoke**:`SELECT count(*) FROM generate_series(0,6) q, … WHERE s<=i AND i+c<=q AND c+s>q` = 0 | 非 0 ⇒ §1 作廢。**這格不是實作驗收** |
| 9 | §3.3 全部 COMMENT 的新字面(含「第三項刻意不做」) | `obj_description` / `col_description` 逐字 grep 五個對象 |
| 10 | 🔴 重跑本片必紅 | 第二次 apply 撞 `42701 duplicate_column`,紅在 BEGIN 之後 ⇒ 整支回滾 |
| 11 | row-count gate 三判準可跑且門檻寫死(§3.4) | 三條查詢逐一實跑,輸出入帳 |
| 12 | 🔴 **故障注入**(R1 #18 / R2 #21):在 migration 末段設具名 marker 人為 `RAISE`,驗**欄、三條 CHECK、COMMENT 全部回復原狀** | 交易外回查 `pg_attribute` / `pg_constraint` / `obj_description` 三面指紋 = apply 前快照 |

### 4.1 逐格 ablation 自查(每格問「拿掉被驗物,這格會不會照樣綠」)

| 項 | 拿掉被驗物後 | 判別力 |
|---|---|---|
| 1,2,3,4,5,6,7,9,10,12 | 對應靶會讓它紅 | ✅ 有 |
| 8 | 純代數命題,拿掉任何實作都不變 | ⚠️ **非實作驗收**,已標明 |
| 11 | 這是**流程格**,不是守門格 | ⚠️ 不宣稱判別力,只要求輸出入帳 |

---

## §5 突變靶(兩個獨立環境,逐靶唯一 oracle)

> R2 #11:「每個靶只准紅一格」在同一環境內做不到 ⇒ 拆環境,每靶只在自己的環境跑。

**環境 A(結構突變;只跑結構斷言)**

| 靶 | 動作 | 唯一 oracle |
|---|---|---|
| ①  | C9 定義 `<=` → `<` | 項 2 |
| ②  | 拿掉 C9 | 項 3(集合不等) |
| ③  | 拿掉 C8 | 項 3 |
| ④  | 欄 DEFAULT 0 → 1 | 項 1 |
| ⑤  | 任一 COMMENT 不寫 | 項 9 |

**環境 B(行為突變;只跑行為格)**

| 靶 | 動作 | 唯一 oracle |
|---|---|---|
| ⑥  | 拿掉 C9 | 項 5(負測不再紅) |
| ⑦  | 拿掉 C8 | 項 7 |
| ⑧  | C9 改成 `shipped <= quantity`(換錯欄) | 項 5(fixture 四值互異才抓得到:`3 ≤ 4` 會放行) |
| ⑨  | 故障注入的 marker 挪到 COMMIT 之後 | 項 12(指紋不回復) |

🔴 **每個靶先驗「`sed` 真的改到東西」(`cmp`)**,否則零突變會被當成抓到
(`scripts/a1-verify.sh` 檔頭已是常駐紀律,grep `每個 sed 突變都要驗`)。

---

## §6 Cut point、apply 合約與回滾

**本線只有一支 migration ⇒ 沒有片間 cut point。** 風險全在「小線單獨 apply」這件事本身:

| 狀態 | 結果 | 安全? |
|---|---|---|
| 小線 apply、大線未上 | 摘要多一欄恆 0 + 三條恆真 CHECK | ✅ **在 §3.4 三個 gate 都 = 0 時安全**;G1/G3 非 0 ⇒ ⛔ **靜默失真,禁止單獨上** |
| migration 中途失敗 | 單一 `BEGIN…COMMIT` ⇒ 整支回滾 | ✅ 由項 12 故障注入實證,**不是論證** |

**回滾**(forward-only ⇒ 另立版本號更大的 down migration):
`DROP CONSTRAINT ×3` → `DROP COLUMN shipped_quantity` → COMMENT 還原。

🔴 **回滾的順序約束(R2 #2 的小線版)**:
**大線若已上線,不得單獨回滾小線** —— 砍欄那一刻四軸 helper 會立刻 `42703`,A4a 全鏈死。
⇒ down migration 檔頭必須逐字寫:**先還原大線(helper 回三軸 + 撤 trigger),再跑本片的 down。**

---

## §7 harness:`scripts/b2s2a-verify.sh`(R2 #6)

v2 被抓到「大量行為驗收沒有承接腳本」。本線的 §4 有 12 格、§5 有 9 個靶,
**塞不進 migration 的 `DO` 區塊**(負測要 `BEGIN…ROLLBACK`、突變要改檔重套)。

| 段 | 內容 |
|---|---|
| 0 | 身分閘(抄 `a1-verify.sh` 的 workdir + cluster-id 三重把關)+ provision |
| 1 | 結構斷言(項 1/2/3/9)+ 環境 A 五個靶 |
| 2 | 行為格(項 4/5/6/7)+ 環境 B 四個靶,全 `BEGIN…ROLLBACK` |
| 3 | 項 8 代數 smoke、項 10 重跑必紅、項 11 gate 三查詢、項 12 故障注入 |
| 4 | 收尾零殘留:表結構指紋 = 開頭快照、`/tmp` 無殘留 |

🔴 **本 harness 不得沿用 S1 harness 的形狀**(S1 消融台帳 21 條裡 11 條是「判別力」類的假綠);
逐條對照 `docs/reviews/2026-08-05-b2-s1-ablation-ledger.md` 的 #10 / #12 / #20 / #21 / #24。

---

## §8 誠實邊界

- 🔴 **小線單獨上線後 `shipped_quantity` 恆 0、C9 恆真、零效力**(§0.2)。三處都要寫:plan、migration COMMENT、apply 說明。
- 🔴 **`shipment_items` 非 0 列時小線不得單獨上**(§3.2 / §3.4 G1)—— 會造成靜默失真。
- §0.3 的正式站列數是 **2026-08-06 快照**,apply 當下必須重跑。
- **quarantine 擋不住 owner 直接 `psql -f`**(§3.5-C),它擋的是流程性失誤、不是刻意繞過。
- §3.5-B 的三個對策我**傾向 2+3 但沒有實測**,只有「provision 走 glob」這條事實是實測的。
- 本檔**尚未過關卡1**。

---

## §9 交棒

| # | 落在 | 內容 |
|---|---|---|
| 1 | 🔴 **Sean apply 之後的 S2d checkpoint**(R1 #23 / R2 #4:**不列入 pre-apply DoD**,否則與封窗形成循環) | `database.types.ts` 重生 → 人工 nullable 校正回貼 → `pnpm typecheck` |
| 2 | **大線 plan** | A4a helper 四軸化、`shipments` 重算 trigger、真值 backfill(本線刻意不做,§3.2)、break-glass oracle 四軸化 |
| 3 | **大線 plan** | `a1-verify` 斷裂態 + port 54329 撞埠(precheck-runs §3.3 的地雷牌)、`a4a-verify` 突變靶 N8 文字錨壞死、`proacl IS NULL` 讓「零 grantee」斷言恆綠(R2 #7) |
| 4 | **quarantine 機制實作批** | §3.5 的 A/B/C 三節,含 D1-D4 防呆 |
| 5 | 🔴 **未來「開放改箱 / 放寬 X3」的片** | `shipment_items` 那支重算 trigger(Sean Q1=A:兩線都不做)+ 它的 U/D 負測與 re-parent 格 |

---

## §10 送審指引

**關卡1(codex `codex-adversary`,`-s read-only`)** —— 起草完即送,兩輪上限照舊(新 plan 新額度)。

建議攻擊角度(前身 v2 的兩輪已把「守門完整性 / 假綠 / 折入沒寫機制」挖過,不要重複):

1. **§3.5-B 的三個對策**:「provision 預設連隔離區一起套」會不會讓拋棄庫與正式站的差異變成新的假綠來源?
2. **§3.2 的「不寫 backfill」**:真的沒有任何情境需要它嗎?G1/G3 gate 是充分條件還是只是必要條件?
3. **§4 項 12 故障注入**的指紋三面(欄 / 約束 / COMMENT)夠不夠?有沒有哪個面回滾了但看不出來?
4. **§5 靶⑧(C9 換錯欄)**:fixture `4/2/1/3` 真的抓得到嗎?有沒有別的換欄突變是四值互異也抓不到的?
5. **§2 兩片「各自可綠」**的宣稱:S2a-1 單獨 commit 時,現有的哪一支 harness 會因為多了一欄而紅?

—— v1 起草完 ——
