# W7d-1 slice plan v3:出貨側三支 writer 補 40P01 重試 + 轉譯層補登三條 + unvoid 方向覆寫

> 線:M-4b E10 B2 出貨線(worktree `pcm-a4a-chain`、branch `a4a-chain`)
> 上游派令:`B-215-A` ②-①、`B-219-A` ② 佇列 2、`B-220-A` MF-1、`B-223-A`(findings #3 三條)、`B-224-A` MF-6
> 片型:**高風險片**(鐵則 12 ③ = 動 migration / RPC 定義)⇒ 全 9 步、對抗審查不降級
> 內容分級:RPC 非內容,不適用 L1/L2/L3

## §0 審查軌跡

| 輪 | 審查者 | 角度 | 結果 |
|---|---|---|---|
| R1 | codex `gpt-5.6-sol` xhigh(關卡1) | 檔案層:行號、可達性、突變判別力、連動漏列 | **FAIL,15 must-fix** |
| R2 | Fable(adversarial-reviewer) | **框架層**:威脅模型真的存在嗎/重試是對的解法嗎/片界/有沒有更便宜的解 | **FAIL,1 must-fix + 3 consider + 2 nit** |

- 兩輪零留痕(codex `git status --porcelain` 前後 diff 為空;Fable 唯讀 subagent)。
- **R1 有一條我親驗後更正**(它說 `w3c3-verify.sh` 會噴 42883 —— 那支是前綴重放,不會;見 §4.2)。
- **R2 的 must-fix-1 推翻了 v2 的核心設計**(轉譯層改三參),v3 已改採它的替代方案 —— 見 §2.1。
  R2 同時指出:v2 **從來沒有真的論證過**為什麼不用呼叫端後處理,我把 §1.2 那句「修實例不修類」
  **憑感覺套用到了另一個決策上**。這條批評成立,照實記。
- v1/v2 差異已由本檔取代;各節標 `[R1-n]` / `[R2-n]` 標明來源。

---

## §1 為什麼要做(事實基礎,逐條親驗)

### 1.1 出貨側的跨表反序是**固有**的,重試在這裡是**承重件**

`…w3c3_mark_shipped.sql:45-49` 檔頭逐字:「同箱同品項的 `add × ship` 併發可達真 40P01 …
**重試在這裡是承重件、不是第二道**」。

**完整的環(四段;第 2 段 `[R1-2]` 補上)**:

| # | 路徑 | 動作 | 位置 |
|---|---|---|---|
| 1 | add | 鎖 `order_items`(`ORDER BY oi.id FOR NO KEY UPDATE`) | `…w4b….sql:173-176` |
| 2 | add | `INSERT shipment_items` → BEFORE trigger 鎖 **`shipments`**(`FOR NO KEY UPDATE`) | `…s1b_shipment_items.sql:156-160` |
| 3 | ship/void/unvoid | `UPDATE shipments`(該列列鎖) | `…w3c3….sql:180-184` / `…w3c1….sql:117-121` / `…w3c2….sql:151-155` |
| 4 | ship/void/unvoid | AFTER trigger → 對箱內每個品項呼重算 helper 鎖 **`order_items`** | `…s2b….sql:335-344` + helper `:198`;trigger 定義 `:436` 逐字 `AFTER UPDATE OF shipped_at, deleted_at ON public.shipments` |

`1→2` 與 `3→4` 方向相反、共用同一組資源 = 真死結環。

**`[R2-Q1]` 兩位審查者各自獨立構造成功、且逐一排除了候選緩解**:
- `lock_timeout = '5s'` **擋不到** —— `deadlock_timeout` 預設 ≈1s 先發火 ⇒ 出的是 `40P01` 不是 `55P03`。
  🔴 親驗:全 repo 只有 `scripts/a8c1-verify.sh:697,709` 動過 `deadlock_timeout`(測試內),**正式路徑用預設**。
- 「一次一箱」單列 UPDATE 契約無關 —— 環只需要一列。
- 前緣守門有 TOCTOU 窗。
- 40P01 在本線**有實錘史**:`scripts/a8c1-verify.sh:582,739-740` 真構造出過。

⇒ **過得了 `B-296-STOP` ③ 的 R3 之問**(「這個威脅模型在本線發生過嗎」)——不是為不存在的威脅寫程式。

🔴 **但誠實邊界要寫死**:本軸**無生產實例**,而且 —— 親驗 —— **既有五支併發 harness
(`w6a` / `w6b1` / `w6b2` / `w6b3` / `w7b`)沒有任何一支測 `add × ship` 這一對**。
⇒ 這個環在本 repo 內**從未被實際演示過**,只被論證過。本片**不冒領**「已證明真死結會被吸收」。
真併發演示屬 W6 形狀(`…w3c3….sql:48` 逐字),而**目前無人認領** ⇒ §6 立為具名欠款。

🔴 **偵察更正(自報)**:本片派 subagent 掃「orders×order_items 軸」,它回「未發現真反向對」。
**那個結論對本片的問題是錯的** —— 它只看函式體直接觸表,**看不到 trigger 間接取的鎖**(第 2、4 段)。
(`B-215-A` ②-③ 結案:**orders 軸確實沒有反向對**;真正的環在 shipments×order_items 軸,經兩支 trigger 成環。)

### 1.2 出貨側是**三支** writer,不是一支

| writer | 定義 | 改哪個欄 | 現有 handler | `deadlock_detected` |
|---|---|---|---|---|
| `admin_mark_shipment_shipped` | `…w3c3….sql:110` | `shipped_at` | `…:190-192` catch 四類 | **無** |
| `admin_void_shipment` | `…w3c1….sql:62` | `deleted_at` | `…:125-127` catch 四類 | **無** |
| `admin_unvoid_shipment` | `…w3c2….sql:75` | `deleted_at` | `…:160-162` catch 四類 | **無** |

四類 = `check_violation OR unique_violation OR lock_not_available OR raise_exception`(三支逐字相同)。
🔴 只修一支 = **修實例不修類**(`B-295-STOP` ④ R3 教訓)。

**不在本片**:`admin_create_shipment`(`…w3a….sql:83`)= `INSERT`,AFTER **UPDATE** trigger 不發火、
零 `order_items` 取鎖 ⇒ 不在環上。`admin_add_shipment_items` 已有重試(`…w4b….sql:264-269`)。
`admin_cancel_order` = **W7d-2**(§6)。

### 1.3 轉譯層的四個缺陷(全部親驗)

| 來源 | 缺陷 | 事實 |
|---|---|---|
| `B-220-A` MF-1 | 對 **unvoid** 方向寫反 | `…w3c3….sql:85,89` 兩句 C9 人話逐字「①先作廢這個包裹」;`admin_unvoid_shipment` 共用它(`…w3c2….sql:163`),而撞 C9 時那箱**本來就是作廢態** |
| findings #3 MF-3 | 漏登錄 `23514 shipments_shipped_needs_tracking` | CHECK 存在 `…s1a1_shipments.sql:161`,表內無此分支 ⇒ 裸噴 |
| findings #3 MF-5 / `B-224` MF-6 | 漏登錄 `P0001 shipment_items_parent_open` | 守門存在 `…s1b….sql:169`,表內無 ⇒ 裸噴 |
| findings #3 MF-4 | `write_once` 與 `frozen_after_ship` 同一句 | `…w3c3….sql:94-95` 逐字「也**不要**去作廢它」,但 `…s1a2….sql:135-136` 守門自己的訊息逐字「補救 = **作廢重開新包裹**」⇒ 矛盾 |

🔴 **方向缺陷的可達面極窄(`[R2-mf1]` 的量化,親驗)**:

- `unvoid` 的**前緣已經有方向正確的訊息**(`…w3c2….sql:139-146`,`P2B27`,註解自己就寫
  「交棒 2 的引導在這條路上是反過來的…改成對稱的那一半」)⇒ 轉譯層那條錯字面**只在 TOCTOU 窗內可達**。
- `add_items` **打不到 C9** —— 重算 trigger 只掛 `shipments`,`shipment_items` 上沒有。
  🔴 親驗逐字 `…s2b….sql:314-315`:「**只有這一支**(Sean 08-05 Q1=A)。**shipment_items 上刻意不掛**」。
- `void` 方向的 C9 理論上不可達(作廢只讓 shipped 變少)。

⇒ **需要方向感知的,只有 `unvoid` 一個呼叫端、只有兩個 conname、只在競態窗內。** 這決定了 §2.1 的改法。

🔴 **codex 的框架結論不收**:它主張轉譯層對未登錄 SQLSTATE「員工面 fail-open」。
「不認得就原封拋回」是**寫過理由的刻意設計**(`…w3c3….sql:104-107`)。封閉可拋集合 = 枚舉,
而**枚舉寫下即過期**是本線一路在殺的病 ⇒ 只補三個已證實存在的洞;通則屬應用層包裝(§6.1)。

---

## §2 要改什麼(一支新 migration)

🔴 既有 migration 不得改:apply 批已完成(`c591e9b0` 逐字「apply 批 11/11 完成收帳」)⇒ forward-only。
新檔 `supabase/migrations/20260808100000_m4b_e10_b2_w7d1_ship_deadlock_retry.sql`,
**寫檔不 apply**,進下一個 apply 批(`B-219-A` ③)。

### 2.1 🔴 轉譯層**簽章不動**(`[R2-mf1]`,v2 的三參設計已撤回)

v2 打算把 `pcm_b2_shipping_human_error(text,text)` 改成三參 `(p_op, p_sqlstate, p_conname)`。**撤回。**

**撤回理由(R2 的成本比較,我親驗後採納)**:改簽章要付
`DROP`+`CREATE` + `REVOKE`/`OWNER`/`COMMENT` 三件套重做 + `w6b1-ship-vs-unvoid.sh:277` 的舊參 mutant +
`w6b2-cancel-vs-unvoid.sh:120,332,410,454` 四處 regprocedure 字面 + 約 6 格 harness +
`admin_add_shipment_items` 薄 wrapper 重貼 + rollback 的 catalog 手術 +
**op 值域的第四份枚舉抄本**(正是 §1.3 末段拿來駁 codex 的那個病)。
而它買到的,依 §1.3 的量化,**只有 unvoid 在 TOCTOU 窗內的一句訊息**。**不成比例。**

**v3 的改法(兩件事分開)**:

**(a) 轉譯層 `CREATE OR REPLACE`,同簽章、純加法** —— 只做**與方向無關**的三條:
- 補登 `23514 shipments_shipped_needs_tracking`(MF-3):人話大意「這箱的快遞商需要貨運單號才能出貨,
  請填單號後再送一次」。
- 補登 `P0001 shipment_items_parent_open`(MF-5 / B-224 MF-6):「這個包裹剛剛被作廢了,不能再加品項」。
- **MF-4 拆兩分支**:`shipments_write_once` 字面不動;
  `shipments_frozen_after_ship` 改成與 `…s1a2….sql:135-136` 一致的「作廢重開」方向。
  🔴 **誠實邊界**:`frozen_after_ship` 從本片四個呼叫端**都打不到**
  (`mark_shipped` 只動 `shipped_at`/`tracking_number`,不動 `recipient_snapshot`/`carrier_code`/`carrier_note`)。
  拆分是為了消除「同一件事兩份互相矛盾的字面」,**不是**宣稱那條路可達
  ⇒ 不可達寫進 COMMENT 當失效條件(memory `feedback_withdrawal-reason-needs-expiry-condition`),
  **不寫進 harness 當斷言**(對不可達路徑斷言 = 恆真格)。

🔴 `CREATE OR REPLACE` **保留既有 ACL 與 owner**(不像 `DROP`+`CREATE` 會回到 `PUBLIC` 預設)⇒
`[R1-12]` 那條安全風險在 v3 **結構上不存在**。仍加一格**實測**複驗,不靠推論。
🔴🔴 **極性**(關卡2 must-fix,v3 初稿這裡寫反過):W3-3 當初下過 `REVOKE` ⇒ 正確狀態是
**`proacl` 非 NULL**(裡面只剩 owner);**`proacl IS NULL` 代表 PostgreSQL 預設 = `PUBLIC` 有 EXECUTE**,
那是壞掉、不是好的。harness 那格驗**三道**:非 NULL + 零非 owner grantee + owner 仍是 `postgres`
(只驗前兩道時,owner 漂成別人、ACL 只剩新 owner,兩道都會綠)。

**(b) `admin_unvoid_shipment` 在自己的 handler 內覆寫那兩個 C9 的方向** —— 約 5 行,
而它的 body 本來就因為重試迴圈要整支重貼:

```
v_msg := public.pcm_b2_shipping_human_error(v_state, v_con);
IF v_msg IS NULL THEN RAISE; END IF;          -- 不認得就原封拋回,語意不變
IF v_state = '23514' AND v_con IN ('oiqs_shipped_le_instock','oiqs_cancelled_shipped_le_quantity') THEN
  v_msg := '<復原方向的話,與前緣 …w3c2….sql:141-146 同族但不逐字複製>';
END IF;
RAISE EXCEPTION '%', v_msg USING ERRCODE = 'P2B29', CONSTRAINT = 'pcm_b2_w3c2_translated';
```

**為什麼這不是「修實例不修類」**:類 = 「補救動作依操作而異」。
補救知識**本來就屬於呼叫端**(轉譯層說「哪裡壞了」,呼叫端說「接下來怎麼辦」)——
這是把知識放回它該在的那一層,不是打補丁。四個呼叫端裡只有 `unvoid` 的補救與預設不同,
另外三個(ship 對、add_items 與 void 不可達)不需要覆寫。
🔴 **殘餘代價照實列**:`void` 路徑若未來變成 C9 可達,會拿到 ship 味的字面(與 MF-4 同型的潛在矛盾)
⇒ 用 COMMENT 寫失效條件收。**這是我接受的代價,不是沒看到。**

🔴 **不逐字複製前緣那句** —— 逐字複製 = 第三份同義字面,正是本線的復發病。轉譯層這句寫簡短版,
COMMENT 註明與 `…w3c2….sql:141-146` 同族。

### 2.2 三支 writer 補 40P01 有界重試

形狀照抄 `…w4b….sql:167-269` 既有版型:

```
c_max_deadlock_tries constant int := 3;
LOOP
  v_try := v_try + 1;
  BEGIN
    UPDATE public.shipments … ;      -- 原句逐字不動
    GET DIAGNOSTICS v_n = ROW_COUNT; -- 原 rowcount 閘逐字不動
    IF v_n <> 1 THEN RAISE … 'P2B26' … ; END IF;
    EXIT;
  EXCEPTION
    WHEN deadlock_detected THEN
      RAISE NOTICE 'W7D1-RETRY|%|%', '<op>', v_try;
      IF v_try >= c_max_deadlock_tries THEN
        RAISE EXCEPTION '…連續 % 次都遇到資料庫死結,已放棄…', c_max_deadlock_tries
          USING ERRCODE = 'P2B28', CONSTRAINT = 'pcm_b2_<w3c1|w3c2|w3c3>_deadlock_exhausted';
      END IF;
    WHEN check_violation OR unique_violation OR lock_not_available OR raise_exception THEN
      … 原轉譯段(unvoid 那支多 §2.1(b) 的五行)…
  END;
END LOOP;
```

🔴 **設計決策一:迴圈只包寫入,不包前緣讀取。**
①直接迴避 `B-295-STOP` ⑦ 的前置提醒(replica 繞 FK ⇒ 孤兒列讓「重試一次就好」失效)——
該提醒的前提是**重試會重讀資料**,本設計不重讀。**刻意迴避,不是忘記。**
②寫入自帶守門:三支的 WHERE 都含狀態條件 ⇒ 併發改態時是 0 列、走既有 rowcount 閘。

🔴 **設計決策二:`P2B26` 不會被自己的 handler 吃掉**(`raise_exception` = `P0001`,`P2B26` 是自訂碼)。
**R1 獨立確認成立**(附官方錯誤碼附錄)⇒ 不再列為待驗。

🔴 **設計決策三:`idem_claim` 留在迴圈外 = 合約不是偏好。**
`…w2….sql:343` COMMENT 逐字:「必須在**任何業務寫入之前**呼叫,且**絕不得被搬進 W3 的產號重試迴圈裡**」。

🔴 **設計決策四(`[R2-nit1]`):零退避是刻意的,理由寫進 migration 註解。**
40P01 受害者的 subtransaction 回滾會釋放它在迴圈內取的**全部**鎖;重試的 UPDATE 會**天然阻塞**在
倖存者仍持有的鎖上直到對方 commit —— **阻塞本身就是退避**。
前提(R2 親驗、我複核):三支在迴圈**外**不持任何環上的鎖 —— 前緣全是裸 SELECT,
`idem` 鍵表不在環上 ⇒ 無 livelock。
🔴 **反過來,加 `pg_sleep` 退避是有害的**:外層交易還活著、還佔著迴圈外取得的資源,睡越久佔越久,而倖存者的處境不會因此變好。
🔴 **不要寫成「吃掉 `lock_timeout` 預算」**:`lock_timeout` 每次開始等鎖才起算,sleep 不會預先扣掉它(關卡2 nit 更正)。
⇒ 註解要明寫「不要好心加退避」,否則未來有人會補。

🔴 **`[R1-7]` 迭代次數的觀察點 = `RAISE NOTICE`,不是表計數。**
子交易回滾會吃掉迴圈內任何寫入(GUC 賦值、temp table 皆然,R2 已獨立驗證)⇒ 表計數**物理上量不到**。
`NOTICE` 送出即不可撤回 ⇒ harness 數 `W7D1-RETRY|` 出現次數即真實迭代數。
環境風險方向安全:`client_min_messages` 被調高只會讓格子**誤紅**(期望 3 筆拿到 0 筆),不會假綠。

### 2.3 呼叫端連動:**只有三支 writer**,`[R2-mf1]` 之後 wrapper 不動

| caller | 位置 | v3 |
|---|---|---|
| ship | `…w3c3….sql:190` | 隨重試迴圈重貼;translator 呼叫**字面不變** |
| void | `…w3c1….sql:128` | 同上 |
| unvoid | `…w3c2….sql:163` | 同上 + §2.1(b) 的五行覆寫 |
| add_items | `…w4b….sql:311`(薄 wrapper `:294-316`) | 🔴 **完全不動**(簽章沒變) |
| `pcm_b2_add_items_impl` | `…w4b….sql:71` | 🔴 **完全不動** |

---

## §3 守門與判別力

🔴 **`[R1-5]` 新格放新檔 `scripts/w7d1-verify.sh`,`PREFIX_TS` = 本片時戳。**
**不得**加進 `w3c1/w3c2/w3c3-verify.sh` —— 那三支是**前綴重放**
(`w3c3-verify.sh:57` 釘 `20260807190000`、`:66-67` 逐字「前綴外的片不套」)⇒ 永遠載不到本片,新格會恆綠。
🔴 `[R2-nit2]` harness 連線顯式帶 `-c client_min_messages=notice`,把 NOTICE 計數格的環境前提釘死。

> 🔴 **以下是實檔 `scripts/w7d1-verify.sh` 落地後的實際格表**(關卡2 抓到 v3 初稿的表與實檔不符:
> 列了三支不存在的 `BOUNDED` 格、`rowcount` 格當時沒有判別力、`IDEM` 格缺席、原子格數寫成 18)。
> **實跑 `PASS=23 FAIL=0`(21 格 + 覆蓋帳 2)、teardown 殘留 0。**

| 格名 | 守什麼 | 突變 / 構造法 |
|---|---|---|
| `DDL-SYNTAX` | 新 migration 實檔跑得起來(含檔內 fail-closed 斷言) | — |
| `W7D1-SUCCESS-NO-RETRY-{SHIP,VOID,UNVOID}` ×3 | 正向前置:無死結時 NOTICE **0 筆**且動作成功 | — |
| `W7D1-RETRY-ITERATES-{SHIP,VOID,UNVOID}` ×3 | 🔴 承重:注入恆拋 40P01 ⇒ NOTICE **恰 3 筆** + `P2B28` | 注入樁 = BEFORE UPDATE trigger 恆拋 40P01 |
| `TMUT-NO-HANDLER` | 拿掉 handler ⇒ **0 筆 NOTICE + 裸 40P01** | 證上面三格量的是真重試、不是字面 |
| `TMUT-BOUND-IS-LOAD-BEARING` | 上限改 5 ⇒ NOTICE 變 **5 筆** | 證「3」那個常數承重 |
| `W7D1-FRONT-GUARD-INTACT` | 重複出貨仍走**前緣** `already_shipped` | 🔴 只證前緣,**證不到 rowcount 閘** |
| `W7D1-ROWCOUNT-GATE-LIVE` | 前緣放行、UPDATE 改到 0 列 ⇒ `P2B26 rowcount`、`shipped_at` 仍空 | BEFORE trigger 回 NULL 抑制該列 |
| `W7D1-EXHAUST-NO-TRACE` | 耗盡後**零留痕**:冪等鍵表 0 列 + `shipped_at` 仍空 | 證迴圈外的 claim 跟著整筆回滾 |
| `W7D1-TRACKING-TRANSLATED` | 轉譯表對 `shipments_shipped_needs_tracking` 有人話 | 🔴 只證映射,不證端到端 |
| `W7D1-PARENTOPEN-TRANSLATED` | 轉譯表對 `shipment_items_parent_open` 有人話 | 🔴 同上 |
| `W7D1-FROZEN-SAYS-VOID-REOPEN` | 兩句不同 + `write_once` 原句沒被動到 + `frozen` 方向是「作廢重開」 | 三件都驗 |
| `TMUT-FROZEN-MERGED` | 併回同一分支 ⇒ 兩碼拿到同一句 | 證上一格量的是「拆開了沒有」 |
| `W7D1-UNVOID-FRONT-GUARD-FIRST` | 常態路徑由 M4 前緣 `P2B27` 擋下 | 證覆寫路徑**不是**常態路徑 |
| `W7D1-UNVOID-C9-DIRECTION` | 🔴 **實檔函式**在真 TOCTOU 面撞 C9 ⇒ 走實檔覆寫、方向正確 | 🔴 **不換樁**:BEFORE trigger 在前緣讀完後才刪 receipts |
| `TMUT-UNVOID-NO-OVERRIDE` | 拿掉覆寫幾行 ⇒ 回到共用層 ship 味字面 | 證上一格量的是覆寫本身 |
| `W7D1-SHIP-C9-UNCHANGED` | 共用層對 C9 的出貨方向字面逐字沒被動到 | 防改 unvoid 時誤改共用路徑 |
| `W7D1-TRANSLATOR-ACL` | `proacl` **非 NULL** + 零非 owner grantee + owner 仍 `postgres` | 🔴 三道;極性見 §2.1 |
| `CELL-ACCOUNT` / `CELL-KEYSET` | 覆蓋帳 | — |

**原子格數 = 21**(+ 覆蓋帳 2 = `PASS=23`)。此數字為**實跑量出**,不是估。

🔴 **真併發那一格不在本片**:見 §1.1 誠實邊界。本片用注入樁證重試邏輯本身,
**不冒領**「已證明真死結會被吸收」。這句要同時寫進 harness 檔頭與 migration 檔頭。

---

## §4 影響面 / 代價 / rollback

### 4.1 已知代價

1. 三支 writer 各被完整重貼一次(plpgsql 無部分改寫)⇒ 三支 body 各有兩份字面(原片一份、本片一份)。
   **緩解**:新 migration 內對三支各加一道 `position()` 錨釘住「本片這份是最新版」;不假裝解決,開 backlog。
   (v2 記的「impl 有兩份字面」那筆更大的債,在 `[R1-3]`+`[R2-mf1]` 之後**不存在**。)
2. `unvoid` 的覆寫是**呼叫端的知識**:若未來新增第五個會撞 C9 的呼叫端,它要自己決定補救方向。
   ⇒ 轉譯層 COMMENT 寫明這個分工(「本層說哪裡壞了,補救動作由呼叫端決定」)。

### 4.2 機械連動(`B-296-STOP` ⑥ 的義務)

**A. 八支 `NEWEST_TS` 尾端閘要重釘**(`20260808000000` → 新檔時戳):
`w5-line-verify.sh:62` / `w6a-unvoid-race.sh:79` / `w6b1-…:85` / `w6b2-…:103` / `w6b3-…:100` /
`w6c-idem-replay.sh:113` / `w7b-…:185` / `b2s2b-verify.sh:358`(第八支是硬字面、非 `LINE_TIP` 變數)。
R1 獨立確認「未找到第九支」。

**B. 簽章連動 —— `[R2-mf1]` 之後這一整塊消失。**
簽章沒變 ⇒ `w6b1:277` 的兩參 mutant、`w6b2:120,332,410,454` 的 regprocedure 字面、
`w5-line:88` 的 helper 名單、`admin_add_shipment_items` wrapper **全部不動**。

🔴 **保留一條 R1 的更正紀錄**(即使該連動已消失,判斷方法要留):
R1-13 說 `w3c3-verify.sh:153-163` 的兩參呼叫會噴 42883 —— **那是錯的**,它是**前綴重放**
(`:57` `PREFIX_TS="20260807190000"`、`:66-67`),在它的前綴裡兩參版本來就在。
R1 自己在 R1-5 正確指出了前綴重放,兩條結論互相矛盾;我親驗後採前綴重放那條。
⇒ **「審查者給的事實同樣會錯」的又一例**(memory `feedback_verify-subagent-function-behavior-before-decision-question`)。

**C. 收據**:全 17 張 `newest_ts` 過期 ⇒ `bash scripts/w7-coverage.sh record all`(**約 15-25 分鐘,背景跑**)。
順序照 `B-296-STOP` ⑥:**改 harness → 落 migration → 背景開 record all → 邊等邊送審查**。

### 4.3 rollback

本片不 apply、不 push ⇒ 回滾 = `git revert`,DB 面零風險。
若下一批 apply 後才要退:反向 migration = 重貼 apply 前的**三支 writer** 與**兩參轉譯層**的定義。
🔴 `[R2-mf1]` 之後**無 catalog 手術**(無 `DROP FUNCTION`、無簽章變更、無 ACL 重做)——
這正是撤回三參設計換到的東西。無資料變更、無 schema 變更(函式體替換不改 catalog 形狀)。

---

## §5 相關既有紀錄與連動面

| 命中項 | 位置 | 作用 |
|---|---|---|
| W7d 派令 | `B-215-A` ② | 本片交 ①(出貨側)與 ③(偵察結案);②s2b 錨 → W7d-3 |
| replica 繞 FK ⇒ 孤兒列 | `B-295-STOP` ⑦ | §2.2 設計決策一 |
| 收據過期成本與順序 | `B-296-STOP` ⑥ | §4.2-C |
| 威脅模型要先問「發生過嗎」 | `B-296-STOP` ③(W7 的 R3) | §1.1 的可達性論證 |
| findings 三來源 | `docs/reviews/2026-08-08-codex-backfill-findings.md` #3、#7 + `B-224-A` | §1.3 |
| 修實例不修類 | `B-295-STOP` ④ | §1.2(三支一起補);§2.1(b) 說明為何**不**適用於轉譯層 |
| 不可達要寫失效條件 | memory `feedback_withdrawal-reason-needs-expiry-condition` | §2.1(a) MF-4、§2.1(b) 殘餘代價 |
| 存在性守門恆真 | memory `feedback_guard-checks-existence-not-effect` | §3 承重格標註 |
| 不可構造 = no-op | memory `feedback_unconstructible-negative-test-means-noop-guard` | §3 刪 `IDEM-ONCE` |
| 審查者事實也會錯 | memory `feedback_verify-subagent-function-behavior-before-decision-question` | §4.2-B 的更正 |

---

## §6 明確**不在**本片(具名欠款)

- 🔴 **`add × ship` 真併發 harness 無人認領**(§1.1)。既有五支併發 harness 都不是這一對。
  這是本片論證所依賴、卻從未被演示的那個環 ⇒ **立 backlog、指名 W6 家族**,不留在口頭。
- 🔴 **`[R2-consider-2]`**:`…w4b….sql:264-269` 那個**已 apply**的 add 重試迴圈**沒有 NOTICE、
  沒有任何 harness 格觀察它的迭代** —— 依本片自己的 `[R1-7]` 論證,那是一個「從未被證明會迴圈的迴圈」,
  而它在錢邊路徑上。本片不改它(forward-only),但**立 backlog**,否則同類缺口無人記帳。

  **2026-08-09 補正(W7d-2 偵察副產物,`B-307-STOP` ④ → `B-308-A` 裁准落檔)**:
  環的 **A 側(add)確實已經有重試迴圈**,主對話親讀 `…w4b….sql:263-270` 確認 ——
  `EXCEPTION WHEN deadlock_detected` + `c_max_deadlock_tries` + 耗盡碼 `P2B28`
  + `CONSTRAINT 'pcm_b2_w3b2_deadlock_exhausted'`。
  ⇒ **環的兩側(add 與 ship 三支)現在都有重試了**,不是缺口。
  本條要記的缺口**始終只有觀察面**:A 側那個迴圈**沒有 `W7D1-RETRY` 之類的 NOTICE**,
  所以與 ship 三支不同,**沒有任何 harness 能看見它到底有沒有迭代過**。
  (W7d-2 的偵察 subagent 曾把這條標成「A 側是否要補重試,未確認」= **問錯問題**;
  已補則已補,欠的是判別力不是功能。)
- 🔴 **`[R2-consider-1]`**:根治法(讓 add 在鎖 OI **之前**先預鎖 parent shipment ⇒ 全線 S→OI 同序、
  環類根除、重試降回真第二道)本片**不採**,理由=要重貼已 apply 的 impl、且對未來未知的環沒有韌性。
  **這段理由要寫進 migration 檔頭**,否則後人照抄「固有」二字不再質疑。
- ~~**W7d-2** = `admin_cancel_order` 補 handler~~ 🛑 **2026-08-09 撤片**(`B-307-STOP` → `B-308-A` Q1=A 裁准)。
  **撤回理由**:`admin_cancel_order` **不在任何死結環上**。全函式體(`…a8a2….sql:80-490`)只取兩把鎖 ——
  `:190 orders FOR UPDATE` 與 `:370 order_items FOR NO KEY UPDATE`,**從不鎖 `shipments` /
  `shipment_items` / `order_item_procurement`**,而那三張正是本片 §1.1 那個 `add × ship` 環的資源。
  含 trigger 展開後它多出第五張被鎖的表 `oiqs`(經 `order_cancellation_items_summary_recompute_ac`,
  NOT DEFERRABLE),但 oiqs 的三個寫入點全在同一支 recompute helper 家族、且該 helper
  **恆先鎖 `order_items`(`…s2b….sql:198`)再寫 oiqs(`:232`)** ⇒ 方向與 cancel 一致,不成反向對。
  它持 `order_items` 後不再等任何人 ⇒ 與 ship 側只是**單向等待,不是環**。
  四條承重事實由主對話逐條親驗(order_items 零 trigger / oiqs 零 trigger / cancel 恰 2 鎖點 / oiqs 單一 writer 家族)。

  🔴 **失效條件(此撤回不是恆真,是時點觀察)**:上述結論成立的前提=`admin_cancel_order`
  **含 trigger 展開後不取得 `shipments` / `shipment_items` / `order_item_procurement` 家族的任何鎖**。
  **未來任何片讓 cancel 直接、或經新掛的 trigger 間接取得這三張表的鎖,本撤片理由即失效、W7d-2 重開。**
  (memory `feedback_withdrawal-reason-needs-expiry-condition`;判斷方法見
  `reference_function-body-scan-blind-to-trigger-locks` 的四步掃法 —— 只讀函式體會漏掉 trigger 取的鎖。)

  **未做的代價量測留檔備查**(若失效條件觸發、重開時直接用):`…a8a2….sql` 檔內約 30 個 `position()` 錨
  含多行錨把縮排寫死(`E'ORDER BY oi.id\n   FOR NO KEY UPDATE;'`)+ 十步全序錨;
  `scripts/a8a2-verify.sh` 1489 行 / `EXPECTED_TOTAL=74` 格 / `gen_mutant` **28 個 `sub()` 精確替換**
  (`src.count(anchor) != 1` 即 `sys.exit`)/ `MD5_NEW` + `CMT_MD5_NEW` 兩個整體 md5 釘值四處比對。
  ⇒ **包一層 LOOP 推移縮排 = 那 28 個錨當場全失效**,重開時預算要含整批錨重建。

  **副產物已立條**:`…a8a2….sql:567` 的「零全函式 EXCEPTION handler」assert **名不副實**
  (只認 `WHEN OTHERS` 與 `WHEN unique_violation` 兩個字面,`WHEN deadlock_detected` 靜默通過)
  ⇒ backlog **#344**(`B-308-A` Q2=B 裁准,排 W7 假綠家族)。
- **W7d-3** = `s2b` position 結構錨(`B-215-A` ②-②)+ backlog #341-1(`w0b` `KEYS_FROZEN`)。
- **W7 跟片** = harness 假綠家族:`B-220` MF-2/3/nit-4、`B-224` MF-2/7/8、`B-226` W5 三條(teardown 出口 exit 0)、
  `B-227` W3c-1 三條、**`B-298-Q` 我判定的 `W3B2-QTY-SCALE` 空值假綠**、
  `B-222-A` ②-2 裁准的「`b2s2b-verify.sh` 納入跑過帳」。建議開一格全線掃「空值 / exit 0 當成功」的出口。
- **B-221-A** W2 四條、`B-224` MF-4(指紋 scale)= 與 W8 鍵契約併。
- `create_order`(`20260730120100…:181`)也無 40P01 handler(偵察副產物)——不在出貨側環上,**未立片**,回報主視窗。

### 6.1 要往上送的兩條

1. **產品語意題(findings #3 MF-1)**:「出貨」定義是否含 HCT 送單成功。**`B-225-A` 主視窗已直接轉 Sean。**
2. **框架題**:未登錄 SQLSTATE 在員工面的呈現屬應用層包裝,建議另立(理由見 §1.3 末段)。
3. **`[R2-consider-3]`**:「subagent 用『函式體直接觸表』掃法,對 trigger 間接取的鎖全盲」——
   這條教訓收線時要落 memory,否則 W7d-2 掃 cancel 軸時會再漏一次。

---

## §7 驗收條件(逐條 yes/no)

1. 新 migration 檔存在、**未 apply**(DB 零變更)。 ☐
2. 三支 writer 都含 `deadlock_detected` 分支與有界重試(上限 3、耗盡碼 `P2B28`)、且**零退避的理由寫進註解**。 ☐
3. 轉譯層 `CREATE OR REPLACE` **同簽章**;補登兩碼;`write_once` 與 `frozen_after_ship` 已拆且後者含「作廢重開」。 ☐
4. `admin_unvoid_shipment` 的 C9 覆寫落地;**ship 路徑的 C9 字面逐字未被動到**。 ☐
5. `…w4b….sql` 的 wrapper 與 impl **一行未改**(`git diff` 證)。 ☐
6. `scripts/w7d1-verify.sh` 落地、`PREFIX_TS` = 本片時戳、顯式 `client_min_messages=notice`、實跑 exit 0,
   `EXPECT_TOTAL` = 實跑量出的 **21**;teardown 停完才量殘留、量不到 0 就保留 datadir。 ☑ (`PASS=23 FAIL=0`)
6b. `scripts/w7-coverage.sh` 的 `EXPECT_TOTAL` 與 `KEYS_FROZEN` 已加入第 18 支 `RECEIPT-w7d1`。 ☐
6c. `w6a` / `w6b2` 兩支因本片而改的連動已修並實跑全綠(見 §4.2-D)。 ☐
7. 八支 `NEWEST_TS` 閘重釘 + 實跑全綠;`w6b1`/`w6b2`/`w3c3-verify` **皆未動**(簽章沒變)。 ☐
8. `w7-coverage.sh record all` 跑完、`check` 綠。 ☐
9. 三綠 + `.sh` `bash -n`。 ☐
10. §6 的三條具名欠款(add×ship harness、w4b 迴圈無觀察、根治序法不採的理由)**已落 backlog 或檔頭**。 ☐
11. 關卡2 審 diff ≥1 輪,must-fix 全修。 ☐
12. 未 push、未 apply、未動 `STATUS.md` / `docs/handoff/CURRENT.md`。 ☐

— a4a-chain 施工窗,2026-08-08 下午(v3 = R1 十五條 + R2 六條全折入;R2 的 must-fix 推翻了 v2 的核心設計)
