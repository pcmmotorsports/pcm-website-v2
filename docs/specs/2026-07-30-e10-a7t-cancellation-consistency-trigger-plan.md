# A7-t Slice Plan — 取消帳本主從一致 CONSTRAINT TRIGGER

> **v2(縮減版)· Sean 2026-07-30 拍板開工。** v1 經關卡1 兩輪對抗審查(codex `gpt-5.6-sol` xhigh **NO-GO 19 must-fix + 2 nit** / Fable **NO-GO 7 must-fix + 6 nit + 1 uncertain**)後**縮小範圍重寫**,不是修補。
> 日期:2026-07-30 深夜 · Milestone M-4b · branch `dev`
> 上游拍板 = Sean 2026-07-30 §12 **Q1=A**「空明細 header 要在 DB 層擋死」
> 本輪 Sean 拍板 = **Q1(退款同型洞)=C 已查 ⇒ 漏洞同樣存在,但目前無 application writer ⇒ 暫不可達、本片不修** / **Q2(TRUNCATE 逃生門)=A 不留** / **Q3=A 現在做完** / **收法=A 縮回小版本**
> 施工權威 = `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md`(A7-t 掛**第 24 列**、**不新增 DAG 列號**,契約見 `:398-404`)
> 前片 plan = `docs/specs/2026-07-30-e10-a7-order-cancellations-plan.md` v5 · 前片交接 = `docs/handoff/2026-07-30-a7-cancellations-handoff.md`
> 實測證據(**皆在 repo、可重跑**)= `scripts/a7t-verify.sh`(結構+行為+突變)· `scripts/a7t-concurrency-probe.sh`(併發四情境、自建自拆)

---

## 0. 片型與範圍

| 項 | 值 |
|---|---|
| 片型 | **高風險片**(鐵則 12③ DB 結構)⇒ 關卡2 審 diff 不降級 |
| 鐵則 8 | 命中(動 schema)⇒ **本 plan v2 已經 Sean 批准開工** |
| 內容分級 | **不適用** —— DDL 非內容分級對象(codex nit;v1 標 L1 是混淆)。片內固定錯誤文案屬 L1 |
| 產出 | ①`supabase/migrations/20260730140000_…sql` ②`scripts/a7t-behavior-probe.sql`(**獨立檔、獨立交易**)③`scripts/a7t-verify.sh` ④`scripts/a7t-concurrency-probe.sh` |
| 不動 | `20260730130000`(已 apply production —— **一個 byte 都不動,含註解**;關卡2 codex 指出改註解也會造成檔案與正式站跑過的內容分叉)· `order_refunds` 那五支 trigger · `orders` / `order_items` · 任何 app 層 code · `.env*` · 並行 session 的手機目錄 UX 十餘檔 |

---

## 1. 一句話

`order_cancellations` 現在可以存在**一列 header、零列明細**的紀錄 = 「這張單取消了,但沒取消任何東西」。
A7(M 型)刻意不放 trigger、把這道防線整條留給本片;master plan 全檔無其他片承接(`:349` 逐字)。

---

## 2. 🔴 範圍縮減:砍掉的東西與**為什麼砍**

v1 為了關卡1 抓到的併發漏洞,規劃了鎖 parent + 隔離級閘 + 併發負測。**v2 全部砍掉。**

### 2.0 併發漏洞是真的,但**在本系統的觸發前提不存在**

實測確認(`scripts/a7t-concurrency-probe.sh` 案例 A-D,**6/0**):兩交易各刪一列明細時,`REPEATABLE READ` 下兩邊都放行、**零明細 header 真的落地**;
`FOR UPDATE` 鎖 parent **補不住**(快照過期,鎖修得了併發執行、修不了快照);`READ COMMITTED` 序列化 commit 擋得住;`SERIALIZABLE` 由 PG 自己擋。

**但這條路要求「有人 DELETE 或 UPDATE 取消明細」。實查:**

| 查什麼 | 結果 |
|---|---|
| 兩表寫入授權 | 只有 `GRANT SELECT ... TO service_role`(`20260730130000:202-203, 267-268`)—— **沒有任何 role 有 INSERT/UPDATE/DELETE** |
| **production writer 路徑**(`apps/` + `packages/`,排除測試與本片探針)對兩表的 `DELETE`/`UPDATE` | **零命中** |
| master plan 的寫入片 | A8a1 寫 header(`:361`)、A8a2 寫 items(`:362`)、A9g 只讀(`:368`)—— **無任何片刪改既有列** |
| 資料模型 | 取消是**留存的事實**(header FK 用 `ON DELETE RESTRICT`,`:71`);多次部分取消 = **累積新 header**,不回頭改舊列 |

⇒ **append-only 工作負載構不出該漏洞**(純 INSERT 時,他交易看不到未提交的 header,FK 也擋)。
⇒ 為一條目前不存在、且設計上不該存在的路徑蓋防禦工事 = 成本花在不會發生的事上。

🔴🔴 **措辭必須精確(關卡2 codex 兩條 must-fix,兩條都成立、已折入)**:
1. **「零寫入 GRANT」不等於「無人能刪改」** —— table owner、superuser、以及
   **A8a1/A8a2 那種 SECURITY DEFINER owner RPC 都不受表級 GRANT 限制**。
   正確講法是「**目前沒有任何 application writer 實作**」,不是「物理上不可能」。
   ⇒ 本片的立場是**條件性**的:**A8a1/A8a2 日後只要寫下第一個 `UPDATE`/`DELETE`,漏洞當天可達。**
2. **「全 repo 零命中」是錯的** —— 本片自己的 `scripts/a7t-behavior-probe.sql` 就有
   `DELETE FROM public.order_cancellation_items`(案例 3/4/5/8)。該宣稱只在
   **production writer 路徑**這個範圍內成立,不得不加限定地講。

### 2.1 退款側同型洞(Sean Q1=C 的答案)

獨立調查結論:`order_refunds` / `order_refund_items` **同樣 append-only、同樣零寫入端、同樣零規劃中的 DELETE/UPDATE**,
消費端 RF5/RF6/RF2b **皆未實作**。其 trigger 含 `DELETE` 是**防禦性完備寫法**,非對應某個會刪明細的流程
(`20260725130100:182-184` 註解逐字只說「刪明細後 sum 會失衡」)。
⇒ **依現行規劃永遠不可觸發 ⇒ 不修。**
⚠️ 誠實邊界:該調查有一條證據是**引用本 plan 自己的「不動 order_refunds」宣告**,屬循環論證、**已剔除不採用**;
結論由三條硬證據支撐(零授權 / app 層零命中 / 規劃零 DELETE),其中授權那條主對話已親查。

### 2.2 ⇒ 改為**合約債**(機制優先律:寫在會被讀到的地方,不只寫在本 plan)

> **日後任何片若要 DELETE 或 UPDATE `order_cancellation_items` 或 `order_refund_items` 的既有列,
> 必須先補上「trigger 內鎖 parent」+「隔離級 fail-closed 閘」;否則兩邊的主從一致防護都會靜默失效。**
> 依據:`REPEATABLE READ` 下兩交易各刪一列 ⇒ 雙雙放行(實測);鎖 parent 不足以補。

落點:
- ✅ 本片 migration 的函式 COMMENT(本 commit 已落)
- ✅ master plan §5.1 的 **A8a2** 列與 **A7b** 列(本 commit 已落)
- 🔴 **backlog #307 尚未寫入** —— `docs/phase-1-backlog.md` 在施工期間裝著並行 session 的未 commit 內容,
  已刻意撤出本片 commit。**不得寫成既成事實**;承接動作見
  `docs/handoff/2026-07-30-a7t-consistency-trigger-handoff.md` §2。
- 🔴 **STATUS.md / CURRENT.md 同上,本 commit 不含**。

### 2.3 另外兩條也降級為「縱深、不加碼」

`DISABLE TRIGGER` 與 `TRUNCATE` **都只有 table owner 做得到**,而 owner 本來就能直接 `DROP TRIGGER`。
⇒ 這兩道擋的是**自己人誤操作**、不是攻擊面。TRUNCATE 攔截照做(便宜、Sean 拍 Q2=A 不留逃生門);
`tgenabled` 則是**驗收層**的真破口(見 §4.3),必做。

---

## 3. 保留的東西(全部便宜且真的有用)

| # | 做什麼 | 為什麼保留 |
|---|---|---|
| 1 | 兩支 DEFERRED CONSTRAINT TRIGGER 擋空明細 header | Sean Q1=A 的本體 |
| 2 | 兩支 `BEFORE TRUNCATE` 攔截 | row-level trigger 對 TRUNCATE 完全不觸發 ⇒ 明細歸零而 header 留著、防護靜默失效(`20260725130100:255-257`)。Sean 拍 Q2=A **不留逃生門** |
| 3 | 驗收加逐支 `tgenabled = 'O'` | 🔴 實測:`DISABLE TRIGGER` 後 `tgenabled='D'`、**`pg_get_triggerdef` 完全不提**、數量仍計 1 支 ⇒ 數量+名稱+定義字面**三層全綠而空 header 逃脫** |
| 4 | 兩支函式 `REVOKE EXECUTE FROM PUBLIC` + 驗 `proacl` | 🔴 實測:新函式 `proacl = NULL`、`has_function_privilege('public', ..., 'EXECUTE') = t` ⇒ SECURITY DEFINER 函式**預設對所有人開放** |
| 5 | migration 內先驗既有資料無壞列 | trigger **不回溯驗證**;apply 前若已有零明細 header,建成後所有斷言仍綠、壞資料永久留下。(現況兩表 0 列 ⇒ 預期空轉,但沒有這道閘就只是運氣) |

---

## 4. 設計

### 4.1 不變式 = **恰一條**

`order_cancellations` 無金額/數量彙總欄(`20260730130000:68-118` 逐欄核過)⇒ `order_refunds` 的 ②(header 金額 = Σ 明細)**無對應物**。
③(不超原始數量)由 **A1 的 CHECK + A4a 重算 + A8a2 守門**承接(`20260730130000:222-224` 逐字轉移;master plan `:352/:355/:362/:424-431` 實查確認有人接)。

⇒ **本片恰驗一條:每個存在的 `order_cancellations` 列,至少有一列 `order_cancellation_items` 指向它。**

🔴 **關聯條件必須正確**(codex):函式若誤寫成算**全表** items,只要別的 header 有明細,空 header 就會過關
⇒ 驗收必配「A 空 / B 有明細」混合案例,並把「拿掉 `WHERE cancellation_id = v_x`」列為突變。

### 4.2 兩支函式

**`public.pcm_assert_cancellation_has_items()`** — `plpgsql` / `SECURITY DEFINER` / `SET search_path = public, pg_temp`(逐項對齊 `20260725130100:186-190`)

```
依 TG_TABLE_NAME 與 TG_OP 決定要驗哪些 cancellation_id:
  order_cancellations        → ARRAY[NEW.id]
  items + DELETE             → ARRAY[OLD.cancellation_id]
  items + UPDATE             → ARRAY[OLD.cancellation_id, NEW.cancellation_id]   ← 兩個都驗
  items + INSERT             → ARRAY[NEW.cancellation_id]
FOREACH:
  header 已不存在(同交易內被刪)→ CONTINUE
  count(*) FROM order_cancellation_items WHERE cancellation_id = v_x   ← 關聯條件不可省
  = 0 → RAISE EXCEPTION
RETURN NULL
```

UPDATE 驗 OLD+NEW 的理由逐字沿用 `20260725130100:200-201`:把明細從 A 改掛到 B 時,只驗 NEW 會讓 A 變零明細而無人檢查。

**`public.pcm_cancellation_ledger_block_truncate()`** — 無條件 `RAISE`。

兩支皆 `REVOKE ALL ON FUNCTION ... FROM PUBLIC`(§3-4)。

### 4.3 四支 trigger

| 表 | trigger | 事件 |
|---|---|---|
| `order_cancellations` | `order_cancellations_items_presence_ac` | `AFTER INSERT OR UPDATE` · `DEFERRABLE INITIALLY DEFERRED` · FOR EACH ROW |
| `order_cancellation_items` | `order_cancellation_items_presence_ac` | `AFTER INSERT OR UPDATE OR DELETE` · 同上 |
| `order_cancellations` | `order_cancellations_block_truncate_bt` | `BEFORE TRUNCATE` · FOR EACH STATEMENT |
| `order_cancellation_items` | `order_cancellation_items_block_truncate_bt` | `BEFORE TRUNCATE` · FOR EACH STATEMENT |

**必須兩支 presence trigger** —— `20260725130100:182-184` 逐字:只掛子表則「插了 header 但一列明細都沒插」永不觸發任何事件。
**DEFERRED 是必要的** —— `:265` 逐字:RPC 先插 header 再插明細,IMMEDIATE 會誤擋合法流程。

### 4.4 本片 migration 的自身結構驗收(fail-closed)

**實際守門(關卡2 兩輪折入後的版本,與 code 同版)**:

1. **既有資料閘**:🔴 **先 `LOCK TABLE` 兩表(固定順序、SHARE ROW EXCLUSIVE)再驗**零明細 header = 0 筆
   —— 只查不鎖有 TOCTOU:窗內 owner writer 可插入孤兒並 commit,trigger 之後才建成 ⇒ 壞列永久留存。
   實測背書 = `scripts/a7t-concurrency-probe.sh` 案例 **E**(E1 證明鎖真的擋住、E2 證明取得鎖後看得到孤兒)。
2. 每表 trigger **名稱集合恰好相等**(不是「包含」、也不是只數數量)
3. **逐支綁 `tgrelid` + `tgname`** 斷言:
   - `tgenabled = 'O'` —— 🔴 `DISABLE` / `ENABLE REPLICA` 之後數量、名稱、`pg_get_triggerdef` **三者完全不變**
   - `tgtype`(21 / 29 / 34,**本機 PG17.10 實測值**,非推算)
   - `tgfoid = '<schema>.<fn>()'::regprocedure::oid` —— 🔴 只比函式名會被**同名異 schema 的 no-op** 騙過
   - `tgdeferrable` / `tginitdeferred` —— 🔴 原版用全庫 `tgname` 計數,別表放同名誘餌就數得回來
   - `tgqual IS NULL` —— 🔴 一個 `WHEN (false)` 能讓上面全部通過而 trigger 永不執行
4. 兩支函式(**全部綁 `regprocedure`**,擋同 schema overload 誘餌):
   - **本體 `md5(prosrc)` 指紋逐字元釘死** —— 🔴 原版只搜兩段字串,可以「保留字串、邏輯反了」
   - **完整 ACL allowlist**:`aclexplode(proacl)` 裡 **owner 以外零 grantee** —— 🔴 只問四個具名 role 會漏掉自訂 grantee
   - presence 函式另驗 `prosecdef` 與 `proconfig` 釘死 `search_path`
5. 函式用 **`CREATE`(非 `CREATE OR REPLACE`)** —— 🔴 `OR REPLACE` 會保留既有函式的 owner 與 ACL
6. `SET LOCAL lock_timeout`(沿用 A7-1 樣板)

🔴 **本段證明什麼、不證明什麼**:證明「四支存在、綁對、啟用、無 WHEN、屬性與 ACL 收斂、函式本體與審查版逐字元相同」。
**不證明行為對** —— 行為在 `scripts/a7t-behavior-probe.sql`。兩者缺一,本片不得宣稱「空明細 header 已擋住」。

### 4.5 A7-1 **不改**(關卡1 兩邊獨立確認)

交接檔 `:22,35-37` 與 `20260730130000:529` 都寫「A7-t 落地後必須回頭改 A7-1 的 trigger=0 斷言」。**那是錯的**:

- 全新環境按版本序執行,A7-1 早於本片 ⇒ 執行當下 trigger 確實是 0 ⇒ **斷言正確且應通過**(Fable 另查 `d1t2-rehearsal.sh:53` provision 亦按序套)
- `a7-verify.sh:59` 逐字 `DROP TABLE IF EXISTS` 兩表 ⇒ trigger 隨表滅 ⇒ 重套後仍 0
- 第三條路徑獵殺(Fable):A7-1 已在 production ledger(88 支)⇒ `db push` / `--include-all` 不重跑;`.github/workflows/` 三檔無任何 migration 步驟

⇒ 那是**該時點**的斷言,不是**永遠**的斷言。改一支已 apply 的 migration 會讓檔案與正式站跑過的東西不符,且會弄壞它在全新重建路徑上本來正確的行為。
⇒ **處置**:A7-1 **一個 byte 都不動,連註解也不改**。
🔴 我一度改了它的註解,被關卡2 codex 抓出來:那與本節自己的論證矛盾(已 apply 的檔就是不該動),
   且會讓檔案與正式站跑過的內容產生**靜默稽核分叉**(Supabase CLI 只比版本號、不比內容 ⇒ 不會有人發現)。
   ⇒ 已 `git checkout` 還原。supersession 只寫在**本片 migration 檔頭、本 plan、交接檔**三處
   —— 那三處都是接手者一定會讀到的地方。

---

## 5. 驗證

### 5.1 探針**獨立檔、獨立交易**(不進 `a7-behavior-probe.sql`)

理由(codex must-fix):既有探針 7/8/19/20/29 都是**刻意的零明細 header**;任何 `SET CONSTRAINTS ... IMMEDIATE` 會引爆它們的 pending 事件 ⇒ 既有 36 條當場全崩。
它們在**交易中段本來就合法**(DEFERRED 的本義),不是「production 非法」—— v1 的措辭錯了,**A7-2 一個字不改**。

### 5.2 怎麼讓 DEFERRED trigger 真的被觸發

規劃期實測(含消融對照;結論已固化進 `scripts/a7t-behavior-probe.sql` 的案例設計與註解):

- `SET CONSTRAINTS ... IMMEDIATE` **對 CONSTRAINT TRIGGER 生效**,可在交易中段強制檢查 ⇒ 保留「整份 ROLLBACK、零殘留」架構,**不需要真 COMMIT**
- **用具名**(實測可行),只針對本片兩支,不波及 FK 與 `order_refunds` 那些
- **負向案例**:RAISE → `ROLLBACK TO SAVEPOINT` **會自動還原 DEFERRED**,不必顯式復位
- 🔴 **正向案例**:不會 rollback ⇒ IMMEDIATE **外漏**,下一個兩段式合法流程在插 header 當下被誤擋(實測)
  ⇒ **硬紀律:正向案例後必須顯式復位**,且**配一條「拿掉復位則某正向案例轉紅」的守門**,否則這條紀律自己沒有守門
- 🔴 **PL/pgSQL 不支援 SAVEPOINT**(codex 抓到我實測的限制:我是在 psql 頂層測的)
  ⇒ 探針**必須寫成頂層多語句腳本**,不能塞進單一 `DO` block

### 5.3 判定紀律(升級 A7-2 的既有版本)

A7-2 認「兩句成功 NOTICE 都出現」。codex 抓到那仍可假綠:**案例被註解掉或提早 RETURN,尾端 NOTICE 照樣印**。
⇒ 本片改成:輸出**精確案例數 + 逐案唯一 marker**,harness 核對**集合與數量**,並要求**零非預期錯誤**。

### 5.4 驗收條件(可 yes/no)

1. 正向:header + 明細(**兩段式**,先 header 後 items)→ 強制檢查不 RAISE
2. 正向:同交易內先零明細、後補上 → 不 RAISE(DEFERRED 的合法修復路徑)
3. 正向:刪二留一 → 不 RAISE
4. 負向:只有 header → RAISE,且訊息是本片自己那句
5. 負向:刪最後一列明細 → RAISE
6. 負向:明細從 A 移掛到 B、A 變零明細 → RAISE(證 UPDATE 驗 OLD)
7. 負向:**A 空 / B 有明細**混合 → RAISE(證關聯條件)
8. 負向:TRUNCATE 兩表任一 → RAISE
9. 既有資料閘:塞一筆零明細 header 再跑 migration → 建 trigger **之前**就 RAISE
10. 突變全紅,至少含:只建 header 那支 / 只建子表那支 / 改 `INITIALLY IMMEDIATE` / 子表 trigger 拿掉 DELETE / UPDATE 只驗 NEW / 函式改無條件 `RETURN NULL` / 拿掉 `WHERE cancellation_id` / **`DISABLE TRIGGER`** / **把 EXECUTE GRANT 回 PUBLIC** / 刪 TRUNCATE 攔截 / **拿掉正向案例的復位** / 把其中一支換成無害 trigger(數量仍對)
11. **零突變對照組必須綠**(沒有對照組,全紅毫無意義)
12. `scripts/a7-verify.sh` 既有 **37/0 不得退化**(接線後複跑)
13. 三綠:typecheck + lint(未動 `.ts/.tsx` ⇒ 不跑 build)

### 5.5 harness 接線(codex must-fix)

`a7-verify.sh` 的 21 條結構突變跑在「A7-1-only」狀態上。若接線後那個 DB 帶著本片的 trigger,
§3.6(trigger=0)會**排在 ACL 斷言之前先炸** ⇒ 21 條全紅但**判別力歸零**,而 FAIL 數仍是 0。
⇒ **s1 階段維持 A7-1-only**;本片的 apply / 斷言 / 突變**獨立成段**,寫在新的 `scripts/a7t-verify.sh`。
⇒ `reapply()` 的 `DROP TABLE` 殺得掉 trigger **殺不掉函式** ⇒ 本片函式用 `CREATE OR REPLACE`(同 `20260725130100:185`),新 harness 的重置段補 `DROP FUNCTION IF EXISTS`。

---

## 6. 連動面

| 檔 | 動作 |
|---|---|
| `20260730130000:526-537` | 🔴 **一個 byte 都不動,連註解也不改**(§4.5)。supersession 只落在本片 migration 檔頭 / 本 plan / 交接檔三處 |
| `docs/handoff/2026-07-30-a7-cancellations-handoff.md:22,35-37` | 加更正註記(仍在發錯誤施工指令) |
| `docs/handoff/CURRENT.md` | 同上 + 本片收尾 |
| `scripts/a7-verify.sh` | **不動**(維持 A7-1-only);本片另開 `a7t-verify.sh` |
| `scripts/a7-behavior-probe.sql` | **一個字不動**(§5.1) |
| master plan `:349`(第 24 列) | 補「A7-t 已完成」;**不新增 DAG 列號、不動 69 片計數**(`:398-404` 契約) |
| master plan `:362`(A8a2)/ `:350`(A7b) | 寫入 §2.2 合約債 |
| `docs/specs/...a7-...plan.md:207-209` | 指向本 plan、標明債已結案;不改歷史敘述 |
| backlog | 新增 **#307** 合約債條目(🔴 #306 已被並行 session 用掉,原擬編號撞號)|
| `STATUS.md` 7 欄 | 收工同 commit |

---

## 7. 誠實邊界(不放寬)

- 本機 PG 17.10 **非 Supabase**;`auth.uid()` 是 shim。
- **C locale ≠ 正式站 `en_US.UTF-8`**(backlog #305)。本片 trigger 是 `count(*)` 與 uuid 比對,**零字元類、零 range、零 collation 依賴** ⇒ #305 對本片結論可轉移。此為逐項檢查後的斷言,非通則。
- 本機證明「SQL 邏輯與 trigger 觸發時機正確」,**不證明** Supabase CLI ledger 原子性、真實併發、正式站鎖競爭。
- 🔴 **本片對併發的立場是「不防」而非「已防」**:漏洞真實存在(實測),只是觸發前提在現行規劃內不成立。合約債 §2.2 是它唯一的承接。
- 本片**不 apply production、不 push**(等 Sean)。
- **零 TapPay 接觸面**:本片產出全為 SQL 與驗證腳本,不碰 `packages/adapters`、不呼叫任何外部 API。

---

## 8. Rollback

純新增:2 函式 + 4 trigger,零 DML、對既有表零 ALTER。
回滾 = **新開一支 forward migration**:先逐表 `DROP TRIGGER` ×4,再 `DROP FUNCTION` ×2。**不手改 migration ledger**(codex)。
🔴 **回滾只允許在 writer 上線前**(關卡2 兩輪,採納並收斂措辭):
依 **application writer inventory**:目前 `apps/` + `packages/` 對兩表零寫入端、
master plan 的寫入片(A8a1/A8a2)尚未實作 ⇒ 沒有生產路徑會觸發這四支 trigger,此時回滾零風險。
⚠️ **不用「零寫入 GRANT ⇒ 零風險」推導** —— owner / superuser / SECURITY DEFINER RPC 不受 GRANT 限制(§2.0)。
**但 A8a1/A8a2(owner RPC)一上線,回滾就等於重新打開「零明細 header」那條路,而且沒有替代防線。**
⇒ forward rollback migration 必須自帶 preflight,且**順序與本片 §0 相同**:
**①先固定順序 `LOCK TABLE` 兩表**(否則查完到 DROP 之間仍有窗)②斷言 `admin_cancel_order` 尚未存在
③斷言兩表零列;任一不成立就 `RAISE`,改走「先停 writer 再回滾」。

— END v2 —
