# A9b2-M — 供應商單號大小寫不敏感搜尋鍵(產生欄 + 索引)plan v1

> **狀態:自寫 plan、不回核(主視窗 `E-136-A:13` 明示小 migration 片照 A9v 慣例)。高風險片(鐵則 12③ DB 結構)⇒ 關卡2 codex 正牌不降級;apply = Sean 手動停點。**
> **真權威 = A2 migration `supabase/migrations/20260729020000_m4b_e10_a2_order_item_procurement.sql:150-155` 逐字:**
>
> > 依供應商單號跨單搜尋(A9b2 的讀取路徑;UX §2 #7 到貨登錄要靠它找單)。
> > 🔴 A9b2 的搜尋語意在此定死:**對 upper(trim(輸入)) 做等值比對**。
> > 供應商單號常被抄成大小寫不一(有人打 so-123、有人打 SO-123),只做原值等值會漏單;
> > 改用 ILIKE/contains 又會全表掃。⇒ 建 upper() 函式索引,搜尋端照同一個表達式查。
>
> **片界來源 = 主視窗 `E-136-A` 裁定**:搜尋路徑 **C 案**、A9b2 拆 **M(本片)→ A** 兩片、A10c2 UI 第三片。

---

## §1 為什麼需要這一片(不是新決策,是執行既有拍板)

母 plan `:431`(row 39)要求 A9b2「**走 adapter 投影、不開 DB RPC**」。
但 PostgREST 的 filter **無法對欄位套函式**(寫不出 `upper(supplier_order_no) = X`),
於是「upper() 等值」這個已拍死的語意在 adapter 上只剩三條路,兩條有硬傷:

| 寫法 | 大小寫 | 吃得到索引 | 硬傷 |
|---|---|---|---|
| `.eq('…supplier_order_no', X)` | ❌ | ❌(索引建在 `upper()` 上、原值等值用不到)| **正是 A2 說會漏單的行為** |
| `.ilike('…supplier_order_no', X)` | ✅ | ❌ 全表掃 | 🔴 PostgREST **無 ESCAPE 機制** ⇒ 輸入的 `_` / `%` 變萬用字元、搜尋 **fail-open**;而這畫面是「到貨登錄找單」= 登錯單的入口 |
| **產生欄 + 一般索引 + `.eq()`** | ✅ | ✅ | 多一支 migration(=本片)|

⇒ **C 是唯一同時滿足「大小寫不敏感 + 無萬用字元洞 + 吃得到索引」的寫法**,
且把語意留在 DB 側 = 與 A2 已宣告的意圖一致,不是在應用層另立一套。

### 1.1 為什麼欄的表達式是 `upper(x)` 而**不是** `upper(btrim(x))`

A2 的字面是「upper(**trim(輸入)**)」—— `trim` 是**輸入側**的事,不是欄側。
儲存值已由 CHECK `order_item_procurement_supplier_order_no_nonempty`(`:95-102`)保證
**前後零空白、且不含 U+200B/200C/200D/FEFF 零寬字元** ⇒ 欄側再 trim 是冗餘。
🔴 **trim 的責任因此明確落在 A9b2-A 的 `normalizeSupplierOrderNoSearch`**(domain 單一來源),
本片的 migration 檔頭會寫死這句,避免下一個人以為欄會幫他 trim。

## §2 實查現況(全部量自本 repo 檔案,附行號)

| 事實 | 來源 |
|---|---|
| `supplier_order_no text`、可 NULL、有非空白+零寬字元 CHECK | A2 `:95-102` |
| 既有函式索引 `…_supplier_order_no_upper_idx` on `upper(supplier_order_no)` WHERE not null | A2 `:154-156` |
| 該索引的**唯一**其他引用 = S1b 的 DO 斷言(`:79` / `:91`)—— **排在本片之前、不受影響** | S1b `20260801150000` |
| 表級 `GRANT SELECT ON TABLE order_item_procurement TO service_role`(表級 ⇒ **新欄自動被涵蓋**)| A2 `:168` |
| `anon` / `authenticated` **零授權**—— 真出處 = A2 `:167` 的 `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`;動機在表 COMMENT A2 `:113-114`(service_role only,單號洩漏 = 客人繞過 PCM)| A2 `:167` + `:113-114` |
| A5a 的 `v_before public.order_item_procurement%ROWTYPE` + `SELECT * INTO` | A9h-M `:130` / `:314` |
| 全樹對本表的 INSERT / UPDATE **一律帶明確欄位清單**(零 `VALUES` 無清單、零整列賦值)| A2 `:398/412/…`、A4a `:308/379`、A5a `:354/:383`、A9h-M `:386/:415` |

⇒ **加一個產生欄不會打壞任何既有寫入路徑**:`%ROWTYPE` 會自動長一格、
明確欄位清單的 INSERT/UPDATE 不受影響、產生欄本來就不可被 SET。

## §3 要做什麼

| # | 內容 |
|---|---|
| **M1** | `ALTER TABLE … ADD COLUMN supplier_order_no_upper text GENERATED ALWAYS AS (pg_catalog.upper(supplier_order_no)) STORED` + COLUMN COMMENT(寫死 §1.1 的 trim 責任歸屬)|
| **M2** | 新 partial 索引 `…_supplier_order_no_upper_col_idx` on `(supplier_order_no_upper) WHERE supplier_order_no_upper IS NOT NULL` |
| **M3** | 🔴 **DROP 舊函式索引** `…_supplier_order_no_upper_idx` —— 它與 M2 覆蓋同一組值、留著是重複維護 + 「哪一個才是搜尋路徑」的歧義。實查零其他消費端(§2 第 3 列)|
| **M4** | 檔內 fail-closed 驗收(見 §4)|

**不做**(刻意):不動 `supplier_order_no` 本身、不動 CHECK、不動任何函式/trigger、
不改 `database.types.ts`(型別重生在 apply 之後、屬 A9b2-A)、**零資料寫入**。

🔴 **本片交給 A9b2-A 的硬前置(階段 C MF3)**:本欄的大寫化是 **PG `upper()`**、輸入側是 **JS `toUpperCase()`**,兩者不保證等價(JS 恆做 full case mapping,`ß`→`SS`;PG 隨 collation provider 而異),而來源 CHECK 不限 ASCII ⇒ 這類單號存得進來。A9b2-A 必須照 A9b1 `packages/domain/src/order/order-number-search.ts:72-77` 先擋非 ASCII 再 `toUpperCase()`,否則 `.eq()` 靜默回零筆 = A2 `:151` 指名要防的漏單。差別:A9b1 的兩種格式天生只含 ASCII、擋掉零損失,**供應商單號沒有格式限制** ⇒ A9b2-A 擋掉時要一併決定「這種單號怎麼搜」,不能默默回 invalid。合約已寫進本片的 COLUMN COMMENT。

## §4 驗收

### 4-1 檔內 DO(結構驗;任一不符整支回滾)

> 🔴 **行為證據刻意不放檔內 —— 這是本片的取捨,不是既有慣例。**
> ⚠️ **原稿寫「照 A4a `:666` 立下的慣例」,那句是錯的**(階段 C MF2 抓到):A4a `:645` 逐字是
> 「行為探針(條件式,**照 A2/D0 慣例**:無合適品項時 NOTICE 略過)」、`:671-697` 真的 INSERT
> 一列採購 + receipts 再刪;我引的「行為證據由 `scripts/a4a-verify.sh` 提供」在 `:667`,而且
> 只在**無合適資料時的略過分支**裡。A2 `:629` 同樣有檔內探針。⇒ **PCM 慣例其實是「有檔內探針」。**
> 本片仍不放,理由是本片自己的成本效益:為了驗一個 `upper()`,不值得讓 apply 在正式站插一列
> 真採購列、觸發 A2b1 配額守門與 A4a 重算再刪掉。行為證據改由施工端在拋棄式叢集實測並記錄(§4-2)。

1. **4a 欄存在且真的是 STORED 產生欄**(`attgenerated = 's'`)—— 只驗「欄在」會被普通 text 欄騙過。
2. **4b 生成表達式逐字** = `upper(supplier_order_no)`(`pg_get_expr`;字面**當場量自 PG17**,
   deparse 會拿掉 `pg_catalog.` 前綴)。🔴 4a 對「表達式寫成 `lower()`」完全全盲(那一樣是 `'s'`)。
   這條的字面斷言之所以夠強,是因為**產生欄的表達式就是引擎逐字執行的東西**,中間沒有
   「宣告 vs 行為」的接線層 —— 不要照抄應用層字面守門的結論。
3. **4c 新索引存在且定義逐字相符**。🔴 **兩段式**:先按名字查 `pg_class` 存在、再取 `pg_get_indexdef`
   (`'…'::regclass` 在索引不存在時會自己先炸,我的斷言連開口機會都沒有 —— 突變 M3 實測到才改)。
4. **4d 舊函式索引已消失**(M3 步驟真的生效)。
5. **4e service_role 對新欄有 SELECT**(`has_column_privilege`)。⚠️ 誠實界見 §4-3。
6. **4f 🔴 anon / authenticated 對新欄零 SELECT** —— 供應商單號洩漏 = 客人繞過 PCM(A2 表 COMMENT 逐字)。
   新欄是**單號的衍生值**,洩漏面與原欄等價,不能因為「只是個索引鍵」就漏掉這道。
7. **4g 原欄的 nonempty CHECK 定義未被弱化**(本欄「不必 trim」的唯一支撐)。
   🔴 **原本只驗「同名 CHECK 存在」,關卡2 codex nit 1 抓到那是恆真族** —— 同名但被弱化成
   `CHECK (true)` 照樣綠,而那時前後空白進得了庫、本欄又不 trim ⇒ `' SO-123 '` 永遠搜不到。
   終版兩段:①**四個零寬字元逐字元各恰 1 次**(不是數總數 —— 見 §4-3)②剝零寬後的定義逐字相符。
   🔴 **同時刪掉三條沒有判別力的**(標準與本檔其他地方一致):
   `convalidated`(被②嚴格蘊含,§4-3 M9)、「同名 CHECK 存在」(同樣被②蘊含)、
   「`supplier_order_no` 原欄存在」(**在本檔內恆真** —— 產生欄的表達式就引用它,沒有原欄
   `ALTER TABLE` 根本建不起來,DO 在同交易之後才跑;階段 C MF1)。

### 4-2 行為證明(拋棄式 PG17 叢集,交易內做完 ROLLBACK;**實跑輸出**)

重跑:`./scripts/d1t2-rehearsal.sh provision <workdir>` 後對 `postgresql://postgres@127.0.0.1:54329/postgres` 跑探針。

```
NOTICE:  ① INSERT so-123 -> upper 欄 = [SO-123]  (期望 SO-123)
NOTICE:  ② UPDATE ab/9_x -> upper 欄 = [AB/9_X]  (期望 AB/9_X)
NOTICE:  ③ UPDATE NULL  -> upper 欄 = [<NULL>]  (期望 <NULL>)
```

🔴 第 ② 格是**刻意挑的**:`_` 原樣保留 = ILIKE 萬用字元洞的反面(`.ilike('ab/9_x')` 會一併命中
`ab/9-x`、`ab/9Zx`;產生欄 + `.eq()` 不會)。

### 4-3 突變證(**十顆全紅、各紅各的、訊息互異、零留痕**)+ 對照組

| # | 突變 | 實測紅在 |
|---|---|---|
| M1 | 表達式改 `lower()` | 4b ✅ |
| M2 | 拿掉 `GENERATED`(改普通 text 欄)| 4a ✅ |
| M3 | 不建新索引 | 4c ✅ |
| M4 | 不 DROP 舊索引 | 4d ✅ |
| M5 | `REVOKE SELECT ON TABLE … FROM service_role` | 4e ✅ |
| M6 | `GRANT SELECT (新欄) … TO anon` | 4f ✅ |
| M7 | CHECK 換成 `CHECK (true)` | 4g-① 零寬字元逐字元計數 ✅ |
| M8 | CHECK 收窄 regex、**保留 4 個零寬字元** | 4g-② 定義逐字 ✅ |
| M9 | CHECK 原文重加為 `NOT VALID` | 4g-② 定義逐字(**不是** convalidated —— 見下)|
| M10 | CHECK 的零寬字元集改成 `U&'\200B\200B\200B\200B'`(**總數仍 4**)| 4g-① 逐字元計數 ✅ —— 🔴 **舊的「數總數」寫法對這顆會全綠** |
| **對照組** | **無突變** | **全綠** ✅(證明 harness 不是恆紅)|

### 🔴 四處是實測/審查改掉原設計的地方

**① M3 逼出 4c 改兩段式。** `'…'::regclass` 在索引不存在時**自己先炸**
(`relation does not exist`)⇒ 整支照樣 fail-closed,但紅的是 PG 裸錯誤、我的斷言連開口機會都沒有。
改成「先按名字查 `pg_class` 存在、再取 `pg_get_indexdef`」。

**② M5 逼出 4e 的誠實界。** 原本的突變是**欄級** `REVOKE SELECT (supplier_order_no_upper)`,實測**全綠**
—— **PostgreSQL 的欄級 REVOKE 撤不掉表級授權**。⇒ 4e 抓得到的是「service_role 對本表根本沒 SELECT」,
**抓不到**「表級 GRANT 沒涵蓋新欄」(後者構造不出負測)。誠實界已寫進 migration 的 4e 註解;
**不得把 4e 當成「已驗證表級涵蓋新欄」的證據** —— 那件事的真證據是 §4-2 旁那次 `has_column_privilege` 實測。

**③ M9 證出 `convalidated` 那條是 no-op、已刪。** `pg_get_constraintdef` 對 NOT VALID 的 CHECK
會**在尾巴補上 `' NOT VALID'`**(實測 `d2 = d || ' NOT VALID'` 為 true)⇒ 4g-② 的逐字比對
**已嚴格蘊含**它,寫不出「只紅 convalidated、不紅逐字」的負測。照
memory `feedback_unconstructible-negative-test-means-noop-guard` 把它拿掉,並在 migration 留一段說明,
免得下一個人以為那裡多守了一層。

**④ 階段 C 的 nit 逼出「零寬字元逐字元各驗一次」。** 原本只數「四字元集合的出現總次數 = 4」——
把 CHECK 改成 `translate(x, U&'\200B\200B\200B\200B', '')` 照樣是 4、剝零寬後字串也相同
⇒ 兩條都綠,而 U+200C/200D/FEFF 已經不再被擋。終版改成四個字元**各**驗出現次數 = 1。

## §5 驗證方式

- 拋棄式 PG17 叢集(`scripts/d1t2-rehearsal.sh provision`,port 54329)套用**全部** migration → 本片 → 檔內 DO 全過。
- 交易模擬 `BEGIN → 套用 → 驗 → ROLLBACK` 零留痕。
- 三綠 `--force`(本片零 `.ts`/`.tsx` ⇒ build 仍跑、確認 monorepo 未被波及)+ 全套 Δ 實數對帳(**預期 Δ=0**:零應用層檔案改動)。
- 🔴 關卡2 = **codex 正牌 `-m gpt-5.5`**(鐵則 12③ 不降級)+ sha256 前後比對。
- **不 apply、不 db push**;commit 押 `nine-code-retire` 分支。

## §6 鐵則與誠實邊界

- **鐵則 12③ 觸發**(DB 結構改動:ADD COLUMN + 表重寫 + DROP INDEX)⇒ 關卡2 不降級。
- 鐵則 8:單檔 migration,但動表結構 ⇒ 仍走全 9 步。L 分級不觸發(零使用者可見內容)。
  ⚠️ **鐵則 8 的批准權在 Sean,`E-136-A` 是 AI 主視窗、不等於 Sean 批准**(階段 C nit)。
  代償 = **零 apply、零 db push,apply 本身就是 Sean 的手動停點**;路線決策(C 案)也已在
  `E-233-STOP` 攤成三選一送出過。不讓「主視窗明示」單獨扛。
- 🔴 **4b 的字面斷言只在寫入當下成立**:STORED 的既有列值**不會**隨 collation / ICU 版本升級重算
  (舊的 `upper()` 函式索引同族風險、非本片新增)。跨版升級後若大寫規則變了,要重算的是**資料**、
  不是斷言 —— 4b 對那種漂移全盲,已寫進 migration 檔頭。
- 🔴 **ADD COLUMN … STORED 會整表重寫、取 ACCESS EXCLUSIVE 鎖**。訂單量 100-300 筆/月
  (memory `project_m4b-admin-preview-decisions`)⇒ 本表列數以千計、重寫時間可忽略;
  仍照 A9v 慣例夾 `lock_timeout = '5s'`,搶不到鎖就整支回滾、不卡線上。
- 🔴 **apply 前 A9b2-A / A10c2 一律掛 flag 預設 off**(主視窗 `E-136-A:3`):
  產生欄未 apply 時 `.eq()` 會 PostgREST 42703 ⇒ 整個訂單列表進錯誤態(與 D0/A10c1 同族)。
  **不做「`.eq` 舊欄暫接」** —— 那是知情引入會漏單的行為。
- 🔴 **本片零 app 行為改動** ⇒ 全套測試 Δ 預期 = 0。若實測非 0,是我漏看了什麼,停下查。
- 本片 apply 併入 **E 線批**(A9h-M + channel 閘 + A9v + 本片,apply 序照時間戳;`E-136-A:4`)。

— E 窗,2026-08-07
