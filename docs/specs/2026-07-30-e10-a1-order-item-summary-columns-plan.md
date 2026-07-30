# E10 第 1 批 · A1「訂單品項數量摘要」片級 plan **v2**

> 🔴 **v1 已作廢**(設計 = 在 `order_items` 加三欄)。作廢原因見 §0。
> 真權威 = `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md` §5.1 row 26 + §5.1c + §1 原則 2/3/4,
> **但 §5.1 row 26 的落點字面已被 Sean 2026-07-31 拍板推翻**(見 §0),master plan 需同步改。
> 片型 = **高風險片**(鐵則 12 ③ DB 結構、動 live `order_items`)⇒ 關卡1 + 關卡2 皆跑 codex,不降級。
> 鐵則 8 = master plan v2 已由 Sean 2026-07-29 最終批准;本片落點變更由 Sean 2026-07-31 另行拍板。
> Migration 版本號 = `20260730150000`。

---

## §0 v1 為什麼作廢(本片最重要的一段)

v1 把三個數量欄加在 `order_items`,並在 §5 主張「原則 3 未被違反」。**那個主張是錯的。**

- `order_items` 對登入客人有**表級 SELECT**:`20260604120000_m3_s2a_orders_order_items.sql:191`
  逐字 `GRANT SELECT ON TABLE order_items TO authenticated`,配 own-order RLS policy(`:197-203`)
- `public` schema 經 Data API 對外曝露
- ⇒ **migration apply 當下,任何登入客人打 API 就讀得到 `ordered_quantity` / `instock_quantity`**,
  與前台有沒有寫渲染程式碼**完全無關**

而 Sean 的要求逐字是「**我不會讓客人知道進度,只會有狀態顯示**」。v1 的設計做不到這件事。

🔴 **v1 還犯了一個更根本的錯**:它把「前台不顯示」寫進欄註解,並稱之為「機制優先律」。
**COMMENT 沒有任何強制力**,那是留言不是機制(codex 關卡1 逐字抓出)。

**Sean 2026-07-31 拍板(Q1=B → Q3=A,最終 = C 案)**:三個數字**全部放只有員工看得到的新表**。
⇒ 「客人看不到進度」從**約定**升級為**物理保證**(客人對新表零權限、RLS zero-policy)。
決策全文與理由 = memory `project_m4b-a1-summary-columns-decisions`。

---

## §1 這片在做什麼

建一張 **service_role-only 的摘要表** `public.order_item_quantity_summary`,一個訂單品項最多一列:

| 欄 | 意思 | 真相來源(本片不接線) |
|---|---|---|
| `ordered_quantity` | 已向供應商訂了幾件 | A2 `order_item_procurement.allocated_quantity` 之和 |
| `instock_quantity` | 已到貨幾件 | A2 逐批到貨明細的 `received_quantity` 之和 |
| `cancelled_quantity` | 已取消幾件 | A7 `order_cancellation_items` |

並把 master plan §5.1c 的四條不變式做成**同表 CHECK**。

**本片只挖格子、不接線**:表建完是**空的**,repo 內沒有任何路徑會寫它。唯一 writer = A4a 重算 trigger(尚未施工)。

---

## §2 為什麼是「新表 + 去正規化 quantity」,不是別的形狀

### 2.1 為什麼不留在 `order_items`
見 §0 —— 客人讀得到,做不到 Sean 的要求。

### 2.2 為什麼三欄一起搬,不是只搬兩欄(Sean 原本的 B 案)
四條不變式全都要跟 `order_items.quantity` 比。只要三欄不在同一張表,
「`instock + cancelled <= quantity`」就**跨表**,CHECK 表達不了 ⇒ 只能用 A7-t 那種
DEFERRED CONSTRAINT TRIGGER 補 ⇒ **直接繼承 backlog #307 的已知併發漏洞**。
三欄同表 ⇒ 四條全是普通 CHECK、零 trigger、零併發債。

### 2.3 為什麼要把 `quantity` 複製進新表
不變式要比 `quantity`,而它在 `order_items`。複製一份進來、用**複合 FK 釘死**:

```
FOREIGN KEY (order_item_id, quantity) REFERENCES order_items (id, quantity)
```

⇒ 兩邊的 `quantity` **物理上不可能不一致**(不一致就沒有對應的父列、FK 直接拒絕)。
這不是「兩份真相」,是「一份真相 + FK 保證的投影」。
🔴 同款手法在本 repo 已有先例:A3 用複合 FK 擋跨單、A7 `order_cancellation_items` 的兩道複合 FK
(`20260730130000` 逐字「冗餘欄,存在的唯一理由 = 讓下方兩道複合 FK 能夾住…」)。

**代價**:`order_items` 要加一個 `UNIQUE (id, quantity)`(FK 的被參照側必須有唯一索引)。
既有的 `order_items_order_id_id_key` 是 `(order_id, id)`(`20260725130100:76-77` 實查),**不能用**。
⇒ 本片對 live `order_items` 的唯一改動 = 加這個唯一約束。動 live 表加唯一索引的先例同上檔。

### 2.4 為什麼摘要列由 A4a 惰性建立、不在建表時回填
若要求「每個 order_item 都有一列」,`create_order` 就得多插一列 ⇒ **改動金流路徑的 RPC**。
改成惰性(有採購或取消活動才建列、**無列 = 概念上三個 0**,讀取端 `LEFT JOIN` + `COALESCE`)⇒

- `create_order` **零改動**
- **無回填**、**不對 `order_items` 跑任何 UPDATE** ⇒ 歷史凍結欄不可能被動到
- 不變式在「有列」時由 DB 強制;「無列」時三值皆 0、不變式恆真(`0 + 0 <= quantity`,而 `quantity > 0` 由
  `order_items` 既有 CHECK 保證)

🔴 **代價要誠實寫下**:「無列 = 全 0」這個約定**沒有 DB 強制力**,靠讀取端 `COALESCE`。
⇒ 列為 **A4a / A9c / A11a-c 的契約債**(寫進 migration COMMENT 與 master plan,不靠口頭)。

---

## §3 Migration 設計

### 3.1 骨架
顯式 `BEGIN;` + `SET LOCAL lock_timeout='5s'` + `SET LOCAL statement_timeout='60s'` + 結尾 `COMMIT;`
—— 同 A7 / A7-t;D0-1 拍板 A:**照舊寫法,不得順手改**。

### 3.2 順序
```
① ALTER TABLE order_items ADD CONSTRAINT order_items_id_quantity_key UNIQUE (id, quantity);
② CREATE TABLE order_item_quantity_summary (...含七條 CHECK 與複合 FK...);
③ ENABLE ROW LEVEL SECURITY;  REVOKE ALL ...;  GRANT SELECT TO service_role;
④ COMMENT(表 / 欄 / 契約債);
⑤ DO $$ ... $$ 結構驗收(fail-closed)
```

🔴 **關於「半套用」的正確描述(v1 寫錯、codex 抓)**:本檔是**顯式單一交易**,中途任一句失敗 =
**整批 rollback**,不會留下半套用 schema。repo 內真正發生過的風險是另一種:
**COMMIT 成功但 Supabase CLI 的 migration ledger 未登記**(見 `20260716120000:42-43` 與
memory `project_supabase-migration-version-drift`)⇒ rollout SOP 必須三方回讀
(schema / 資料 / `supabase migration list`),**不得盲目重跑**。

### 3.3 鎖的持有時間(codex 關卡1 must-fix)
① 的 `ADD CONSTRAINT ... UNIQUE` 取得 `ACCESS EXCLUSIVE` 並**持有到 COMMIT**。
`lock_timeout='5s'` 限制的是**本 migration 等鎖**,**不限制**結帳交易等待本 migration。

- 現況資料量 = `order_items` 數十列(**apply 前當場重查、不寫死**)⇒ 唯一索引建構為毫秒級
- ✅ **併發量測已實作 = `scripts/a1-lock-probe.sh`**,自帶消融(人工持鎖 2 秒 → 量到 ~1990 ms)。
  🔴 **第一版是假證明,已撤回**:它在背景啟動 migration 後**立刻**量 INSERT,
  沒有任何機制保證量測時鎖已被取得 ⇒ 那個「18 ms ⇒ 實質未被阻塞」的結論**證明不了任何事**。
  🔴 **現在唯一可主張的**:**持鎖窗上限 ≈ migration 整個交易的時長(本機實測數十 ms 量級)**
  —— 鎖在第一句 `ALTER TABLE` 取得、持有到 `COMMIT`,交易總時長就是上限,這個量測不需要 barrier。
  🔴 **barrier 版量到低值時不可反推**:「沒觀察到阻塞」≠「沒有阻塞」,腳本自己會印出這句。
  ⚠️ 本機單機、單一併發連線、隔離庫資料量,**不等於正式站**。
- 🟡 **row-count gate 是 apply 時的人工前置,不是程式**(誠實標記,不假裝已自動化):
  執行者在 apply 前查 `SELECT count(*) FROM public.order_items`,**超過 10,000 列就停下重新評估**
  (屆時應改走 `CREATE UNIQUE INDEX CONCURRENTLY` + `ADD CONSTRAINT … USING INDEX` 的線上流程)。
  已寫進下方 §3.4 runbook 的步驟 2。

### 3.4 Rollout runbook(關卡1 + 關卡2 皆列為 must-fix)

🔴 **問題**:正式庫 ledger 目前停在 `20260730130000`(A7)。
`supabase db push` 會**依序套用兩支**:先 A7-t(`20260730140000`)再 A1(`20260730150000`),
而**每支各自是一個交易** ⇒ 若 A1 因 `lock_timeout` 失敗,**A7-t 已 commit 且已登記 ledger**
⇒ 批次只套一半,不是「整批回滾」。這是 CLI 的正常行為,不是意外。

**Sean 二選一(不由我代決,列入早上決策題)**

**路線 A(建議)—— A7-t 先單獨套、read-back 後再套 A1**
1. `supabase migration list` 確認 remote 最新 = `20260730130000`
2. 🔴 **row-count gate**:`SELECT count(*) FROM public.order_items` —— 超過 10,000 列停下重新評估
3. `supabase db push --linked --dry-run` —— **pending 清單必須恰為預期的那幾支**,不符就停
4. 把 A1 檔案移到 **scratch 目錄**(不是 repo 內)並記下 `shasum`;`db push --linked` 只套 A7-t;
   放回後 `shasum -c` 驗檔案未被動過(中斷時憑此復原)
5. A7-t read-back:四支 trigger 存在、`tgenabled='O'`、函式指紋相符
6. 再 `--dry-run` 確認 pending 只剩 A1 → `db push --linked` 套 A1
7. A1 read-back(見下)

**路線 B —— 兩支一起套,接受「可能只成功一半」**
1-2 同上;3. **先 `--dry-run` 確認 pending 恰為兩支** → 人工 checkpoint → 一次 `db push --linked` 套兩支
4. 🔴 **失敗停損 —— 必須做三方狀態矩陣,不能只看 ledger**(R3 抓):
   本檔 §3.2 已載明 repo 真正踩過「**COMMIT 成功但 ledger 未登記**」。那種狀態下
   `migration list` 會把 A1 顯示成 pending,照「補套失敗那支」重跑 ⇒ **撞既有表與約束**。
   ⇒ 逐項查:①ledger 有無這一版 ②A7-t 的 schema 物件在不在 ③A1 的 schema 物件與資料在不在
   - **ledger 無 + schema 無** ⇒ 才可以重試那一支
   - **schema 有 + ledger 無** ⇒ **停下處理 ledger 漂移**(`migration repair`),**不得重跑 migration**
   - **兩者都有** ⇒ 那支其實成功了,不要動
5. 兩支各自 read-back

**apply 後獨立驗證(不採信 migration 自述;兩條路線都要)**
- `order_item_quantity_summary` 存在、**0 列**、RLS 開、`pg_policy` 0 條
- ACL 矩陣:`anon` / `authenticated` **八種權限全 false**(🔴 含 PG17 的 `MAINTAIN`);
  `service_role` 只有 SELECT;`relacl` 無 PUBLIC entry;`attacl` 全 NULL
- 七條 CHECK `convalidated = true` 且 `pg_get_constraintdef` 與本機一致
- 複合 FK 的 `confrelid` / `conkey` / `confkey` / `confdeltype='c'` 正確
- `order_items`:新唯一鍵存在;**既有約束與 trigger 逐字未變**
- 三方回讀:schema / 資料 / `supabase migration list`(ledger 未登記是本 repo 真正踩過的坑)

---

## §4 表定義與不變式

```sql
CREATE TABLE public.order_item_quantity_summary (
  order_item_id      uuid    PRIMARY KEY,
  quantity           integer NOT NULL,   -- 去正規化,靠複合 FK 釘死 = order_items.quantity
  ordered_quantity   integer NOT NULL DEFAULT 0,
  instock_quantity   integer NOT NULL DEFAULT 0,
  cancelled_quantity integer NOT NULL DEFAULT 0,
  CONSTRAINT order_item_quantity_summary_item_fk
    FOREIGN KEY (order_item_id, quantity)
    REFERENCES public.order_items (id, quantity) ON DELETE CASCADE,
  ...七條 CHECK...
);
```

### 4.1 七條 CHECK(名稱凍結,probe / 斷言 / rollback 三處引用同一組)

| # | 約束名 | 定義 | 獨立性 |
|---|---|---|---|
| C1 | `oiqs_ordered_nonneg` | `ordered_quantity >= 0` | 🟡 **冗餘** |
| C2 | `oiqs_instock_nonneg` | `instock_quantity >= 0` | ✅ 獨立 |
| C3 | `oiqs_cancelled_nonneg` | `cancelled_quantity >= 0` | ✅ 獨立 |
| C4 | `oiqs_ordered_le_quantity` | `ordered_quantity <= quantity` | ✅ 獨立 |
| C5 | `oiqs_instock_le_ordered` | `instock_quantity <= ordered_quantity` | ✅ 獨立 |
| C6 | `oiqs_cancelled_le_quantity` | `cancelled_quantity <= quantity` | 🟡 **冗餘** |
| C7 | `oiqs_instock_cancelled_le_quantity` | `instock_quantity::bigint + cancelled_quantity::bigint <= quantity::bigint` | ✅ 獨立 |

🔴 **冗餘性是本 plan 主動承認的,不是被抓到才改**(codex 關卡1 must-fix):

- **C1 被 C2 + C5 蘊含**:`ordered >= instock >= 0`
- **C6 被 C2 + C7 蘊含**:`cancelled <= instock + cancelled <= quantity`

⇒ **C1 / C6 在行為層物理上無法單獨觸發**,任何「讓 C1 單獨紅」的嘗試都會先撞 C5(或同時撞)。
**本 plan 因此明確放棄對 C1/C6 的行為獨立性宣稱**,只做:
① 結構存在性 + 定義逐字比對 ② 刪除它們的結構突變必須被結構斷言抓到。
保留它們的理由 = master plan §5.1c 四條不變式的字面完整性 + 讀者可讀性(不必自己推導)。

🔴 **C7 的 `::bigint`**(codex 關卡1 must-fix):兩個 `integer` 相加可能先溢位成 SQLSTATE **22003**,
根本到不了具名 CHECK ⇒ 負向 probe 會「紅在錯的地方」而被誤判通過。轉 `bigint` 後不可能溢位。

### 4.2 契約債:第 2 批必須回頭改
`shipped_quantity` 在第 1 批不存在 ⇒ 完整式 `cancelled <= quantity - shipped` 退化為 C6。
第 2 批建包裹模型的**同一片**必須:① 加 `shipped_quantity` ② 納入 C6/C7 ③ 同步改 A8a1/A8a2 可取消量守門。
🔴 落點 = migration COMMENT **+ master plan §5.1 A8a1/A8a2 兩列**(只寫 COMMENT = 沒有強制力,見 §0)。

---

## §5 ACL(這一片真正的安全機制)

樣板 = A2/A3/A7:
```sql
ALTER TABLE public.order_item_quantity_summary ENABLE ROW LEVEL SECURITY;   -- zero policy
REVOKE ALL ON TABLE public.order_item_quantity_summary FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.order_item_quantity_summary TO service_role;
```

⇒ 客人(`anon` / `authenticated`)對本表**零權限**、RLS 開且**零 policy**。
**「客人看不到進度」在此從約定升級為權限層阻擋。**
🔴 **但不要說成無條件的物理保證**(R3 nit,措辭收斂):ACL + RLS 證明的是
**`anon` / `authenticated` 這兩個角色的直接查表與同角色 PostgREST embed 被擋住**。
它**擋不住**:表 owner、`SECURITY DEFINER` 函式、以及**未來 A9c 用 service_role 查完之後
把欄位放進送到前台的 DTO**。⇒ **A9c 必測**:客人端 `ORDER_LIST_SELECT` 不變、
storefront DTO 零摘要欄、admin selector 只在 server/admin 端使用、相關 view/RPC 的 EXECUTE ACL 重驗。
寫入一律走 owner RPC / owner trigger(SECURITY DEFINER 由表擁有者執行、不需 role 權限)。

---

## §6 驗收(`scripts/a1-verify.sh` + `scripts/a1-behavior-probe.sql`)

### 6.0 環境誠實描述(codex 關卡1 must-fix)
`scripts/d1t2-rehearsal.sh provision` **不是**「套全部 migration」——
它含 fitments 相容 stub 插序與跳過項(#299:`product_fitments_effective` 在 repo 內無建立來源)。
harness 註解必須逐字寫明實際 bootstrap 內容與跳過了什麼,不得描述成「純 migration 零起重建」。

### 6.1 外層 oracle(codex 關卡1 must-fix:突變不得能修改判官)
`order_items` 的**約束清單**、**完整 ACL 矩陣**、**trigger 定義**三份基準,
由**外層 shell** 在套用 A1 之前抓取存檔;突變只作用在 migration 檔與 DB 物件上,**改不到基準檔**。
比對由外層做,不依賴 migration 內的 DO block。

### 6.2 結構驗收(migration 內 DO block;每條各自可被單獨打紅)
- 新表存在、RLS `relrowsecurity = true`、`pg_policy` 對本表 **0 列**
- **完整 ACL 矩陣**(不是抽查):`anon` / `authenticated` / `service_role` 各驗
  **八種**表級權限 —— SELECT / INSERT / UPDATE / DELETE / TRUNCATE / REFERENCES / TRIGGER /
  🔴 **MAINTAIN**(PG17 新增,正式站亦為 PG17)。期望 = 只有 `service_role.SELECT` 為 true、其餘 23 格 false。
  🔴 **少了 MAINTAIN 就是一個真的假綠**:2026-07-31 實測 `GRANT MAINTAIN … TO authenticated` 之後
  `has_table_privilege(…,'SELECT')` **仍為 false** ⇒ 七格矩陣對它完全無感。
- **PUBLIC 直接授權必須排在角色矩陣之前**:`GRANT … TO PUBLIC` 會讓 anon/authenticated 因**繼承**而 true
  ⇒ 排在後面的話,第一個轉紅的是 `A1-ACL:anon.SELECT`,而**把 PUBLIC 那條斷言整個刪掉仍然全綠**。
  順序在這裡是正確性的一部分,不是風格。
- 另驗 `pg_attribute.attacl` 全 NULL(無 column 級授權)、`relacl` 無自訂 grantee
- 七條 CHECK 存在、`convalidated = true`、**`pg_get_constraintdef` 正規化後逐字比對**
- 複合 FK:**逐字比對 `pg_get_constraintdef`** + **另一道不依賴字串的實體斷言**
  (`confrelid` OID、`conkey`/`confkey` 的欄序 attnum、`confdeltype = 'c'`)
  🔴 為什麼要兩道:`pg_get_constraintdef` 把被參照表印成**未加 schema 的** `order_items`
  ⇒ 指到別 schema 的同名表會渲染出**一模一樣**的字串
- 三欄 `integer` / `NOT NULL` / `DEFAULT 0`(**逐欄各驗一次**,不是驗一欄推論三欄)
- 新表 **0 列**、新表 **0 trigger**
- 🔴 **「本片 0 新函式」由外層 harness 的 `pg_proc` 差集證明**,不在 migration 內驗
  —— migration 拿不到「套用前」基準,只查 trigger 數的話,一支**沒掛 trigger 的**新函式會全綠。
  配一條「在 migration 裡偷加函式」的突變證明差集抓得到
- `order_items`:`order_items_id_quantity_key` 存在;**其餘約束與 trigger 定義與基準逐字相同**
  (比對名稱 + `tgenabled` + `pg_get_triggerdef`,不是只比數量)

### 6.3 行為 probe(`scripts/a1-behavior-probe.sql`,**實作為 14 案例**)
🔴 **每個負向案例用 `GET STACKED DIAGNOSTICS` 同時斷言例外型別與 `CONSTRAINT_NAME`** ——
只斷言「有 RAISE」會把三種假通過全收下:紅在別條 CHECK / 紅在既有約束 / 整數溢位在到達 CHECK 前就炸掉。
🔴 探針**自建自清**:自己插合成 `order_item`(quantity=3 一筆、quantity=int 上限一筆),全程包在交易裡、結尾 `ROLLBACK`,
另跑獨立的零殘留複驗。不依賴 seed 資料的 quantity 剛好夠大。

**負向 · CHECK(6 條)**
| 案例 | 值 | 期望 constraint |
|---|---|---|
| N1 | `instock=-1` | `oiqs_instock_nonneg` |
| N2 | `cancelled=-1` | `oiqs_cancelled_nonneg` |
| N3 | `ordered=4`(quantity=3) | `oiqs_ordered_le_quantity` |
| N4 | `ordered=1, instock=2` | `oiqs_instock_le_ordered` |
| N5 | `ordered=3, instock=2, cancelled=2` | `oiqs_instock_cancelled_le_quantity` |
| N6 | 三值皆 `2147483647`、quantity 同值 | `oiqs_instock_cancelled_le_quantity` |

🔴 **N5 是核心**:三值**各自合法**,只有相加違規 ⇒ 證明 C7 不是被前六條遮蔽的裝飾品。
🔴 **N6 有實測依據**(2026-07-31 本機 PG17.10 實跑,非理論):`order_items.quantity` 只有 `> 0`、**無上限**
⇒ 三值同取 int 上限是合法輸入。**有 `::bigint` → 23514 命中 C7;拿掉 → 22003 `integer out of range`,根本到不了那條 CHECK。**

**負向 · FK(2 條)**:F1 品項存在但 `quantity` 報假值(證明去正規化被釘死)/ F2 不存在的 `order_item_id`。

**正向邊界(6 條,證明合法值不被過度限制誤拒)**
P1 全 0 / P2 `ordered=quantity` / P3 `instock=ordered=quantity` /
🔴 **P4 `cancelled=3 > ordered=0`**(還沒下單就被全部取消 —— master plan 允許,任何人偷加 `cancelled <= ordered` 會在此轉紅)/
P5 `instock+cancelled=quantity` / P6 混合合法態。

**真結帳回歸(harness §5 段)**:套用 A1 後**實際呼叫現行 9 參數 `create_order`**(fixture 配方沿用 `scripts/n3-verify.sh` §4.1),
斷言建單成功 + `order_items` 正常 +1 + **摘要表未被觸碰**(惰性建列成立)。
🔴 誠實:fixture 是造出來的 ⇒ 這是**煙霧測試**,不是「結帳真的能用」。

### 6.4 突變(結構套件與行為套件**分開跑**)
🔴 每個 mutant 指定**唯一預期的第一失敗 ID**;紅在別的地方 = 判 FAIL。
🔴 **「每條斷言都有專屬突變」這句話一度不成立**(關卡2 R2 抓):FK 的實體斷言
(`confrelid`/`conkey`/`confkey`)與「自訂 grantee」斷言**都被前面的斷言先攔下**,把它們整段刪掉
仍會全綠。已補兩條專屬突變:①**FK 指向別 schema 的同名表**(調 `search_path` 讓
`pg_get_constraintdef` 印出一模一樣的字串 ⇒ 逐字比對騙得過,只有 `confrelid` 抓得到)
②**授權給第三個 role**。另補「拿掉主鍵」——原本 56 條全綠也擋不住「一個品項兩列」。
🔴 行為突變一律**先剝掉 migration 內的結構驗收 DO block** 再套用 —— 否則逐字比對會先擋下,
行為探針的判別力永遠沒被證明(codex 關卡1 must-fix)。

**結構突變 S(條數以 `scripts/a1-verify.sh` 實跑輸出為準,不在本檔寫死 —— 迴圈展開後條數會隨欄數/約束數變動)**
- 逐條刪除七條 CHECK → `A1-C-MISSING:<名>`
- C5 改 `>=`(關鍵字全在、邏輯反了)/ C7 拿掉 `::bigint` → `A1-C-DEF-MISMATCH:<名>`
- 三欄各自 `DROP NOT NULL` / `DROP DEFAULT` / 改 `bigint`(9 條)+ `quantity` 被給 DEFAULT → `A1-COL:<欄>`
- 多一欄 → `A1-COL-SET`
- 額外第八條 CHECK(恆真 / 過度限制 `cancelled<=ordered`)→ `A1-C-EXTRA`
- `GRANT SELECT` 給 `authenticated` / `anon`、`GRANT UPDATE` 給 `service_role`、授權給 `PUBLIC` → `A1-ACL:…`
- **column 級** `GRANT SELECT (ordered_quantity)` → `A1-ACL-COLUMN`
- 關 RLS → `A1-RLS-OFF`;加 policy → `A1-RLS-POLICY`
- FK 退化成單欄 / FK 改 `NO ACTION` → **兩者皆 `A1-FK-SHAPE`**
  (逐字比對整條 FK 定義,`ON DELETE CASCADE` 是該字串的一部分 ⇒ 不需要獨立的 DELRULE 斷言)
- 摘要表被塞一列 → `A1-ROWS`
- `order_items` 被加 trigger → `A1-OI-TRIGGER-DRIFT`
- 🔴 **既有唯一鍵 / 新唯一鍵改名** → `A1-OI-CONSTRAINT-DRIFT` / `A1-OI-UNIQUE-MISSING`
  (原設計用 `DROP CONSTRAINT`,**實測被相依 FK 擋在 DDL 階段**、紅在 "cannot drop constraint … because"
   = 判別力沒被證明 ⇒ 改用 `RENAME`,不必 `CASCADE` 連帶動到別人的 FK)

**行為突變 B(實作 5 條)**
| # | 突變 | 期望探針落點 |
|---|---|---|
| B1 | C5 改 `>=` | `A1-PROBE-WRONG-CONSTRAINT:N1` |
| B2 | C7 弱化成只比 `instock <= quantity` | `A1-PROBE-FAIL:N5` |
| B3 | C7 拿掉 `::bigint` | `integer out of range` |
| B4 | 偷加 `cancelled <= ordered` | `A1-PROBE-OVER-RESTRICT:P4` |
| B5 | FK 退化成單欄 | `A1-PROBE-FAIL:F1` |

🔴 **B1 的落點是 N1 不是 N4**(實測):C5 反向後,N1 的 `instock=-1, ordered=0` 對 `instock >= ordered` 也不成立
⇒ 探針按序執行,N1 先撞上。硬寫 N4 就是在猜。

**探針自身突變**:把 N5 的期望 constraint 改成假名 → 探針必須自己轉紅(A7 教訓:突變 runner 會自己假綠)。

**對照組**:未突變版本必須全綠。

### 6.5 harness 自身的三道 fail-open 守門(施工中實際踩到才加的)
1. **sed 退出碼 + 產物健全性**:sed 出錯會產生空檔,而 `psql` 對空檔**回傳 0** ⇒ 「apply 成功」是假的,
   探針接著紅在「表不存在」卻仍被計為一次有效突變。⇒ 驗 sed 退出碼 + 產物非空 + 仍含 `CREATE TABLE`。
2. **`cmp` 守門**:每個 sed 突變都要證明「真的改到東西」。實測攔下一次跨行 sed(sed 逐行處理、匹配不到)
   造成的「零突變卻宣稱抓到」。
3. **孤兒 postmaster**:`all` 模式原本直接 `rm -rf $WORK`,把**正在跑的 postmaster 的資料目錄**砍掉 ⇒
   它不會死、繼續佔著 port 54329 ⇒ 下一次 `pg_ctl start` 撞 `Address already in use`,
   還會連帶害到共用同一 port 的 a7 / a7t harness(實測踩到)。⇒ 先 `pg_ctl stop` 再刪,且刪前確認 port 已釋放。

---

## §7 27 項綠燈宣稱
**本片不宣稱任何項變綠**(原則 4)。第 4 項與第 19 項要等 A4a + 讀取路徑 + UI 到位。

---

## §8 誠實邊界
- 本機拋棄式 PG17.10,**非 Supabase**;`auth.uid()` 是 shim
- **C locale ≠ 正式站 `en_US.UTF-8`**(#305)—— 本片七條 CHECK **全是整數比較、零字元類**
  ⇒ 本次不受該落差影響(此為本片可主張、A2/A3 不可主張的差別)
- 正式站唯一接觸 = **唯讀 SELECT**(查 `order_items` 列數、既有約束與 ACL 渲染);apply 是 Sean 手動
- **零 TapPay 接觸面、零金額欄位改動**
- 併發測試量到的是本機單機數字,**不等於正式站**(Supabase pooler、實際併發量皆不同)

---

## §9 Rollback(全名,無 placeholder)

```sql
BEGIN;
  DROP TABLE IF EXISTS public.order_item_quantity_summary;   -- 連帶七條 CHECK 與複合 FK
  ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_id_quantity_key;
COMMIT;
```
- **不加 `CASCADE`**:若有東西依賴本表,寧可讓 DROP 失敗、人工看清楚,不要靜默連帶刪除
- **dependency preflight**:執行前先查 `pg_depend` 有無其他物件依賴本表 / 該唯一約束
- 🔴 **只允許在 A4a 之前使用**。A4a 上線後本表有真實資料,DROP 會讓訂購/到貨/取消數一起消失。
- 🔴🔴 **「之後另寫 forward repair」不是災難當天可執行的東西**(R3 抓)⇒ 已改成
  **A4a 的 definition of done 硬前置**(已寫進 master plan A4a 列):A4a 上線前必須先寫出並演練
  「摘要表已有真實資料時的回滾程序」—— 停寫與停守門 → 保存並對帳摘要 → 逆序撤下消費端 →
  移除/替換 trigger → 由真相重算 → 切換;**依賴未清零前不得 DROP**。
  🔴 本片只保證「A4a 之前可回滾」,**不宣稱之後也可以**
  ⇒ 屆時必須改寫成 forward repair migration,不得照抄本段

---

## §10 收工前逐條
- [x] 三綠(typecheck 8/8 · lint 10/10;未動 `.ts/.tsx` ⇒ 不需 build)
- [x] `scripts/a1-verify.sh all` **60/0** + 結構/行為突變各自全紅 + 對照組綠 + 真結帳回歸綠
- [x] `scripts/a1-lock-probe.sh` 消融成立(2 秒人工持鎖量到 ~1990ms);**可主張結論 = 持鎖窗上限約 32ms**
- [x] master plan 的**連動段落**全部同步(原則 2 / 軸矩陣 A9c·A11 / A2b1 / A4a / A8a1 / A8a2 / §5.1c),
      不是只改 A1 那一列
- [x] `scripts/a7-verify.sh` 37/0、`scripts/a7t-verify.sh` 27/0 **零回歸**
- [ ] 關卡2 codex findings 全處理
- [x] master plan 連動段落全部同步
- [ ] STATUS 七欄同 commit 更新
- [ ] **不 push、不 apply**
