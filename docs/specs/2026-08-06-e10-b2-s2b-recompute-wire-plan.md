# E10 第 2 批 · B2-S2b(大線):`shipped` 重算接線 + harness / runbook 連動 **v2**

> 狀態:**v2;關卡1 已跑五輪、findings 全折入** —— codex R1(FAIL 21+4)、codex R2(FAIL 19+1)、
> Fable R3 換模型換角度(FAIL 9+4)、Fable 複驗(FAIL 6+4)、Fable 二複驗(FAIL 1+2)。
> must-fix 數列 **21 → 19 → 9 → 6 → 1 = 收斂**(非打轉),合計 **56 must-fix + 15 nit**。
> 🔴 **仍不得開工,但閘已換**:不再是「等 R3」,而是**等主視窗批准開工**(`B-237-STOP` §⑨1)。批准後第一片是 `S2b-4a`,不是 migration。
> 🔴 **v2 不是重寫,是增補**:v1(`ba2ff35` 起草 + `b69dd37` 自查)在 **S2a 小線收工之前**寫成,
> 因此不含小線 S2a-2/S2a-3/S2a-4 三片產出的四項輸入。v2 只加不刪,v1 各節編號原樣保留。
> 增補來源 = 主視窗 `B-138-A`;逐條落點見 **§0.6**。
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
| **C. harness 判別力修復** | `a4a-verify` 突變靶 N8 文字錨、收尾零殘留閘擴充(此二者 = `S2b-4a`)、`proacl IS NULL` 假綠(= 項 9b,片 `S2b-1`);`a1-verify` 斷裂態 + port 54329(= `S2b-4b`)|
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
- 物理保證 = 本線 migration 的**前置閘段③**(pin 小線產物)。
  🔴 **v2 修正(codex 關卡1)**:v1 這裡還寫「+ 小線的 quarantine 機制」——
  **那套機制已被 Sean 拍板 Q3=C 作廢、從未實作**(小線 plan §3.5 標「不實作」)。
  小線最終的做法是 **migration 直接進正式目錄、只押在 `a4a-chain` 分支不併 dev**。
  ⇒ 本線**沒有 quarantine 目錄可用、也沒有 gate commit 可等**(封窗改寫見 §2 末)。
- 🔴 **`shipped` 在本線落地前是 0 —— 但那不是 DB 強制的**(v1 寫成「一直是 0」太滿,codex 抓)。
  **逐字引小線 migration `:157` 的欄註解**:「**不是 DB 強制它恆 0**…而且 A4a **不會把非 0 值清回 0**…
  owner / SECURITY DEFINER 路徑寫入非 0 時,C8/C9/C6′ 當下就有效力」。
  ⇒ 本線的 preflight / backfill / 項 29 **都不得假設「非 0 不可能」**;那是可達狀態,只是沒有常規 writer。

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

### 0.6 🔴 v2 增補:`B-138-A` 五項輸入的逐條落點

主視窗指定五項輸入。**逐項先查 v1 有沒有,查完的結果如下**(0 命中 = v1 真的沒有,不是我沒找到):

| # | 輸入 | v1 狀態 | v2 落點 |
|---|---|---|---|
| 1 | **三筆契約債**(停寫擴出貨側 / divergence 第四軸 / gate 同批擴) | ❌ 全缺(`停寫`、`divergence` 在 v1 內 **0 命中**) | §0.6a + §4 項 26 / 27 / 28 |
| 2 | **Fable F1 負測情境**(stale-high instock ⇒ 超出貨靜默提交、事後紅在無辜到貨更正) | ❌ 缺(`stale-high`、`超出貨` **0 命中**) | §0.6b + §4 項 29 + §5 靶 |
| 3 | **S2 重算必同掛 `shipments AFTER UPDATE OF shipped_at`** | ✅ **已涵蓋** = §3.3 表格 | 不需增補;v2 補上出處 |
| 4 | **9c 註解指紋「目前沒有守門」,S2b 自建** | ❌ 缺(`9c`、`註解指紋` **0 命中**) | §0.6c + §4 項 30 + **§4.30 設計** + **S2b-5**。🔴 **本線交付工具、債未結清** —— CI 化之前仍是「要記得跑的一格」,不是常駐守門(v2-R3 誠實化) |
| 5 | **S2a 磨出來的工法寫進驗收** | ❌ 缺(`具名集合`、`從零 provision` **0 命中**) | §2.2(片級 DoD)+ §4 通則 + §5 突變紀律 |

輸入 3 的出處(v1 只寫了結論、沒寫來源,v2 補上):
memory `project_m4b-b2-shipments-db-decisions:37` —— 「S2 重算 trigger 必須同時掛
`shipments AFTER UPDATE OF shipped_at, deleted_at`,**只掛 shipment_items 會讓 shipped 恆 0 零錯誤**」。
與 v1 §3.3 的表格一致;**該表的 `deleted_at` 事件面不是可選的**,它是同一條拍板的一部分。

#### 0.6a 三筆契約債(S2a-4 產出;來源 = 我自己在小線留下的字面)

| 債 | 出處(逐字可查) | 內容 | 不補會怎樣 |
|---|---|---|---|
| ① **停寫只涵蓋採購側** | `docs/runbooks/a4a-summary-rollback.md:19-22` | rollback 步驟①目前只 REVOKE A5a 一個寫入口 | 本線新增的**重算 trigger** 讓「改 `shipments.shipped_at`」成為第二條會寫到摘要表的路徑 ⇒ 災難日快照與拆除期間 `shipped_quantity` 仍會被改 |
| ④ **runbook Forward 重建清單沒有 S2b** | `docs/runbooks/a4a-summary-rollback.md:251`(Forward 那一行)+ `:267` 的契約債字面「未來任何動到 `order_item_quantity_summary` 的 migration,**同一片必須把自己加進本行**」 | 清單現為 A1 → A4a → S2a | 🔴 **災難重建完成後,helper 仍是三軸、`shipments` 重算 trigger 不存在** —— 而且**零告警**(這正是小線靶⑪ 釘住的那個地雷,本線若不把自己加進去就是重犯) |
| ② **divergence 只對帳三軸** | `docs/runbooks/a4a-summary-rollback.md:63-68` | 對帳表只有 ordered / instock / cancelled | **shipped 漂移會在對帳裡全綠而漏掉** —— 而本線正是讓 shipped 變成被維護的第四軸的那一片 |
| ③ **gate 只認兩張表** | `docs/runbooks/a4a-summary-rollback.md:243-246`(v2 修正行號:我自己的編輯讓它從 240-241 漂走了) | apply 前置閘把「無出貨真值」定義成恰好 `shipments`/`shipment_items` 的列數 | 🔴 **本線 scope 明定不新增出貨真值表** ⇒ 這筆債**本線不會觸發**,降級為「明文記錄 + 一格斷言集合未變」(項 28) |

🔴 **v2 修正(codex 關卡1 打掉我原本的「三筆全部本線結清」)**:逐筆的觸發者其實不同 ——

| 債 | 誰觸發 | 本線處置 |
|---|---|---|
| ① | **本線**(新增重算 trigger ⇒ 多一條寫入摘要表的路徑) | ✅ 本線結清(項 26) |
| ② | **本線**(shipped 成為被維護的第四軸) | ✅ 本線結清(項 27) |
| ③ | **不是本線**(本線 scope 明定不新增出貨真值表) | ⚠️ 降級:明文記錄判定 + 一格斷言集合未變(項 28),**不改 gate 的五路徑與零參數 libpq 設計** |
| ④ | **本線**(本線就是那支「動到摘要表的 migration」) | ✅ 本線結清(項 31) |

🔴🔴 **債①的前提今天就是假的(v2-R3;Fable 翻案條件④,我實查確認)**:runbook 步驟①寫「只 REVOKE 採購側(A5a)那一個寫入口」,
但 **`admin_cancel_order` 對 `service_role` 有 EXECUTE**(`20260804180000:271` 與 `20260805100000:497` **兩處**)——
它寫 `order_cancellation_items` → 觸發 A4a → **寫摘要表**(四軸化後那一列含 `shipped` 欄)。
⇒ 「A5a 是唯一 service_role 寫入口」**不成立**;照本 plan 做完,項 26 的 oracle 會全綠、人人以為停寫完整,
而**災難快照窗口內摘要表仍被取消線改動**。⇒ 本線正在改寫 runbook 步驟①那一段,**至少要同批把這筆記成債**
(新增 **債⑤**:停寫必須涵蓋取消線的 `admin_cancel_order`;是否本線結清由 §9 交棒 9 承接)。

🔴 **債①的正確形狀(codex 抓;我原本寫錯)**:本線**不新增任何能 UPDATE `shipments` 的 writer**
(`service_role` 對 `shipments` 現況只有 SELECT;owner 不是可以 REVOKE 的入口)⇒
「REVOKE 一個出貨側 writer」**沒有可指定的 actor**。**停寫動作的正確對象 = 本線新增的那支重算 trigger**
(`ALTER TABLE public.shipments DISABLE TRIGGER shipments_summary_recompute_ac`),
而不是去 REVOKE 一個不存在的 RPC。

#### 0.6b Fable F1:stale-high instock 的負測情境

**事實鏈(逐一實查,非推理)**:
1. A4a helper 的 `ON CONFLICT DO UPDATE SET` 只列四欄
   (`20260803140000_m4b_e10_a4a_quantity_summary_recompute.sql:183-187`,**親讀確認無 `shipped_quantity`**)
   ⇒ 既有 `shipped_quantity` 值**原樣保留**,重算不會清它。
2. 小線加的 **C9 = `shipped_quantity <= instock_quantity`**,而重算每次都要一併通過它。
3. ⇒ **instock 一旦下降到殘留 shipped 值以下,合法的「到貨更正」交易會紅在 `23514`** ——
   紅的是**無辜的那一筆**,真正的錯誤(超出貨)早在更早的交易就靜默提交了。

**為什麼 plan 必須列它**:這是本線把 shipped 接上真值之後**營運面第一個會遇到的形狀**,
而它的症狀(紅在無辜交易)會把人引去查錯的地方。§4 項 29 要把整條時序**實跑構造出來**,
不是在註解裡描述它。

#### 0.6c 9c:註解蓋寫目前**沒有任何守門**

出處:`docs/reviews/2026-08-06-b2-s2a2-reviews.md:82`(Fable F2)與 `:112`(交棒表第 2 列)。
逐字結論 = 「9c 那一格**只服務突變靶**,不要拿它當蓋寫守門;
『註解被日後 migration 蓋寫』**目前沒有任何守門**,S2b 那片要自己建,
**不得因為看到這一格就以為已經有了**」。

🔴 **本線正是「日後的 migration」**:S2b-1 會 `CREATE OR REPLACE` helper,
若它(或未來任何一片)對摘要表下 COMMENT,就會蓋掉小線 §3 寫的七物件註解 —— **而且零告警**。
⇒ §4 項 30 要在本線建立蓋寫守門,**設計上不得沿用 9c 那一格的形狀**。
🔴🔴 **但要說清楚本線交付到哪裡(v2-R3;Fable:原本的結清語氣會讓下一棒直接登記「9c 已清」)**:
本線交付的是**一格可重跑的守門**,**不是常駐機制** —— CI 沒有 PG service(實查),在 CI 化(§9 項 7)之前
它仍然只是「有人記得跑才有效」。**債④…不,是這筆 9c 債,本線只結清一半:工具有了,常駐沒有。**
⇒ 落點決定:**不另開第三支孤兒腳本**,把指紋格**掛進 S2b-2 的 `b2s2b-verify.sh` 常設格**(Fable 建議),
少一個「要記得跑」的東西;S2b-5 因此改為「在 `b2s2b-verify.sh` 內新增該格 + 兩組期望值 + 三發負測」。

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

### 1.1 允許出現的位置:**五處**(R1 #13 / R2 #12;🔴 v2 修正:v1 數成四處,漏了 backfill 的 oracle)

v2 先寫「只准一處」(做不到:oracle 必須獨立算才有判別力),再寫「三處」(數錯了)。
**實查**:`docs/runbooks/a4a-summary-rollback.md` 的漂移式出現**兩次**(初始對帳段 + 收尾重驗段),
加上 helper 與 `scripts/a4a-verify.sh` 的 `ORACLE_SQL` ⇒ **共四個文字實體**。

| # | 位置 | 角色 | 🔴 **述詞整行凍結**(v2-R3 二複驗:從「凍 RHS」改成「凍**整行**」) |
|---|---|---|---|
| 1 | A4a helper 內 | **唯一 writer** | `WHERE oi.id = p_order_item_id` 那一行的**整行字面**(參數名 **`p_order_item_id`**,實查 `20260803140000:140` 函式簽章 + `:156`)|
| 2 | runbook 初始對帳段 | 獨立 checker | 述詞整行字面(外層別名 `u.order_item_id`,實查 `runbook:76-78`)|
| 3 | runbook 收尾重驗段 | 獨立 checker | 述詞整行字面(外層別名 `u.order_item_id`,實查 `runbook:152-154`)|
| 4 | `a4a-verify.sh` 的 `ORACLE_SQL` | harness 側 checker | 述詞整行字面(`s.order_item_id`,實查 `a4a-verify.sh:150`)|
| 5 | 🔴 **本片 migration 內 §3.4 backfill 的值 oracle** | backfill 的獨立 checker(**v1 漏列**) | 由本片決定;🔴 **必須在片內寫死成 harness 的字面常數**,不得執行期自讀檔案再跟自己比(= 恆綠) |

🔴🔴 **為什麼凍「整行」不是凍「RHS」(v2-R3 二複驗 must-fix)**:
「扣掉關聯述詞那一行」會讓**那一行變成兩半都照不到的盲區** —— 本體 md5 不含它,而 RHS 抽取規則
遇到 `… = u.order_item_id AND <走私條件>` 時,取「= 右邊全部」會紅、取「第一個識別字 token」就綠,
**plan 沒說是哪一種** ⇒ 有人把額外條件寫在述詞同一行(修關聯時最自然的落點),**零告警**。
⇒ **改成凍結整行字面**(自然涵蓋 RHS,且抽取規則無歧義)。
🔴 **配一條行數斷言**:標記區內**匹配述詞 pattern 的行恰一行**,`≠1` 即紅
(否則有人另起一行加條件,整行比對仍全等)。

🔴 **這一欄怎麼用**:守門逐處比對「該處述詞行**逐字等於**上表凍結值」——
**不是**「存在一條等式」(那是恆真族)。述詞合法變更時**必須回來改這張表**,與 `MIG_SHA_FROZEN` 同契約。
🔴 **第 1-4 列的值本 plan 已逐字實查**(行號如表);**第 5 列尚不存在**,開工時寫死、
且**必須是 harness 內的字面常數**。

🔴 **嵌入時的別名地雷(v2-R3 複驗 nit)**:本體含 `JOIN public.shipments s`,而 `a4a-verify.sh` 的 `ORACLE_SQL` 與 runbook 對帳段**外層已經用 `s` 當摘要表別名** ⇒ 內層遮蔽會讓外層關聯參照吃到 `42703`。**嵌入處的外層別名不得用 `s` / `si`**(改名即可,寫在這裡省一輪撞牆)。

🔴 **第 5 處為什麼不能省、也不能重用 helper**(codex 關卡1):
backfill 的 oracle 必須**獨立於 writer** 才有判別力(helper 寫錯時它要能看出來)⇒ 它是第五個文字實體。
v1 寫「恰四處」而 §3.4 又要求獨立 oracle ⇒ 照 v1 實作出來的東西**必然違反自己的守門**:
不是四份 md5 守門把正確的 backfill 判成不同步,就是被迫讓 oracle 重用 writer、失去獨立性。
⇒ **§4 項 21 / §5 的靶也一律改成五份**(v2-R2:只改標題不改下游 = 第五處無人守)。

**守門設計**(R2 #12:光說「逐字同步」沒有判別力):
- **五處**各加**邊界標記註解**(`-- SHIPPED-TRUTH-BEGIN` / `-- SHIPPED-TRUTH-END`),**標記區內含關聯述詞那一行**(本體 md5 時才把它扣掉,不是不標)。
- 🔴🔴 **v2-R3 收斂(Fable 翻案條件②:五份 md5 全等照稿不可實作)**:五個實體的**關聯述詞字面本來就不同**
  (helper 用參數 `p_order_item_id`、`a4a-verify.sh:150` 用 `s.order_item_id`、runbook 用 `u.order_item_id`)——
  去空白/小寫的正規化**抹不掉識別字差異**,執行者只能被迫放寬正規化(=喪失判別力)或把標記區縮到瑣碎。
  **決定:把守門拆成兩半,不再追求「整段五份全等」**:
  ① **本體(比 md5)**= 真相式**扣掉關聯述詞那一行**之後的部分(`FROM … JOIN … WHERE s.deleted_at IS NULL
     AND s.shipped_at IS NOT NULL` 與 `sum(si.shipped_quantity)`)—— 這才是會出錯的地方,**五份必須全等**。
  ② **關聯述詞 = per-site **整行**字面凍結(v2-R3 二複驗:從凍 RHS 再改成凍整行)**。
     🔴 我原本寫「存在一條把 `si.order_item_id` 綁到當前品項的等式」—— **那是恆真族**:
     恆等式 `si.order_item_id = si.order_item_id`(等於加總**全店**出貨)、或綁到錯的外層欄位,
     都滿足「存在等式」⇒ 守門綠、oracle 全錯。**這正是本 plan §2.2 自己列的「只驗存在不驗效果」,
     我在寫進 W 規則之後的下一輪親手又犯一次。**
     **正確修法**:§1.1 的位置表本來就寫死五處 ⇒ **每一列各自凍結該處關聯述詞的 RHS 識別字字面**
     (per-site 字面比對,完全可實作),見**本節上方位置表**的 `RHS 凍結` 欄。
     **配一發突變**:把任一處的述詞改成恆等式 ⇒ **該處必紅**(§5 新增靶)。
  🔴 **為什麼不併實體**(Fable 提的另一案:runbook 兩段與 ORACLE_SQL 共用單一 SQL 片段、五處縮成三處):
  那要新增一個「共用片段」的產生/注入機制,而 runbook 是**災難日給人讀的文件**、不該變成需要組裝的模板。
  拆兩半的成本更低、判別力落點更精確。
- **五個獨立突變**:逐一改一處,斷言「同步格紅、且指名是哪一處不同」。
  🔴 **v2-R2 修正**:v2 只把 §1.1 的標題改成五處,標記/md5/突變/驗收全留在四份 ⇒ **第五處(backfill oracle)可以漂移而守門仍綠**。

🔴 **自查型 3(oracle 自指恆綠)——本節有這個風險,先堵住**:
標記字串 `SHIPPED-TRUTH-BEGIN` **也出現在本 plan 自己身上**(就是上面那一行)。
⇒ 若 harness 用「全樹 grep 找標記」來定位那四處,**會多命中 plan 檔**,
而且「找到 5 份、其中 1 份不同」會被讀成「同步失敗」或被隨手排除,兩種都壞。

**修法:harness 明列五個位置,禁止用全樹 grep 決定集合。**

| # | 檔案(寫死) | 段 |
|---|---|---|
| 0 | 本片的 migration | **§3.4 backfill 的值 oracle**(第 5 個實體) |
| 1 | 本片的 migration | helper 函式體 |
| 2 | `docs/runbooks/a4a-summary-rollback.md` | 初始對帳段 |
| 3 | `docs/runbooks/a4a-summary-rollback.md` | 收尾重驗段 |
| 4 | `scripts/a4a-verify.sh` | `ORACLE_SQL` |

**負測**:把 plan 檔也丟進集合 ⇒ 該格必須紅在「集合大小 ≠ 5」,而不是紅在 md5 不等。

---

## §2 片界(**v2 重切:四片 → 八片 → v2-R2 再拆 4b/4c = 九片**,各 ≤45 分)

🔴 **v1 的四片估時在加了項 26-30 之後全部不成立**(codex 關卡1 R1;鐵則 4 是硬規則)。
**重切原則**:①**不切 migration** —— 把它拆成多支會製造「helper 已四軸化但 trigger 未建」的半套視窗,
風險大於片長;改成把**不屬於 migration 的東西移出去**(項 30 移到獨立片 S2b-5)。
②其餘依「一片一個可獨立驗收的產物」切。主視窗 `B-140-A` 裁定:重切屬施工判斷,不送 Sean。

| 片 | 型 | 內容 | 鐵則 12? | 估時 |
|---|---|---|---|---|
| **S2b-1** | M | migration:md5 前置閘 + helper 四軸化 + `shipments` 重算 trigger + 真值 backfill + 檔內結構驗收 + 🔴 **同批改寫小線那幾句已過期的註解**(「大線 B2-S2b,**尚未施工**」「**完全不碰本欄**」,`20260806100000_…:157`)—— v2-R3 補:§4.30 的 expected-after 依賴它,原本沒列進任何片的範圍 | ③ ⇒ **是** | 45 分 |
| **S2b-2a** | 非 M | `scripts/b2s2b-verify.sh` **建檔 + 行為格**(項 10 / 10b / 11 / 12 / **12b / 12c** / **14 / 15** / **18** / 20;逐項以 **§4.99 認領表**為準) | 否 | 40 分 |
| **S2b-2b** | 非 M | 同檔:**兩環境突變矩陣** + barrier 併發格(項 19)+ **項 29 stale-high** | 否 | 45 分 |
| **S2b-3a** | 非 M | 真相式**五處**同步守門(§1.1)+ runbook 兩段 oracle 四軸化 + `a4a-verify` 的 `ORACLE_SQL` 四軸化 | 否 | 40 分 |
| **S2b-3b** | 非 M | rollback 依賴清單 / DROP 序 / rehearsal(項 21b)+ **項 22**(PR4 造洞)+ 債①②③④(項 26 / **26b** / 27 / 28 / **31**);逐項以 **§4.99 認領表**為準 | 否 | 45 分 |
| **S2b-4a** | 非 M | `a4a-verify` 判別力修復:**N8 錨(項 23,全部)+ 收尾零殘留閘補 trigger 面(項 23b 可構造半)**。🔴 `proacl` 假綠**不在本片** —— 那是項 9b、認領給 `S2b-1`(它是本線新建函式的安全面,S2b-1 之前不存在);23b 其餘三塊的落點見 §4.99 施工裁決 | 否 | 40 分 |
| **S2b-4b** | 非 M | `a1-verify` 改**專屬 port + 跑完即 teardown**(§3.5a)—— 只此一事 | 否 | 40 分 |
| **S2b-4c** | 非 M | 三支 B2-S1 harness 各自的新格(項 25a-c) | 否 | 40 分 |
| **S2b-5** | 非 M | 🔴 **註解蓋寫守門格**:在 `b2s2b-verify.sh` 內新增指紋格 + expected-before/after 兩組凍結值 + 三發負測(項 30 / §4.30)。**本線只交付這一格 + 片級 DoD,不改 CI**(理由見 §4.30) | 否 | 40 分 |

🔴 **v2-R2 再拆的兩片**(codex R2:2b/3b/4b/5 仍各含多個獨立產物):
`S2b-4b` 原本同時做 a1-verify 重構、撞埠、三支 S1 harness ⇒ 拆成 **4b(a1-verify + 埠)** 與 **4c(S1 harness)**。
`S2b-2b` 與 `3b` 維持不拆:2b 的突變矩陣與 barrier **共用同一組 fixture**,拆開會讓 fixture 定義出現兩份;
3b 的四筆債**共用同一次 rehearsal**(項 21b),拆開等於跑兩次災難演練。**理由寫在這裡,不是省略。**

**DAG(誰擋誰)**:S2b-1 → 2a → 2b(harness 要先有行為格才談突變);3a → 3b(先四軸化才談依賴清單);
4a / 4b / 5 與上列並行,但 **4a 必須在 gate commit 之前**(封窗,見本節末)。

### 2.1 鐵則 11 的片級 DoD(自查型 4 命中:v1 **整份沒有**片級三綠 DoD)

| 片 | commit 前必跑 | 預期 |
|---|---|---|
| S2b-1 | `pnpm typecheck` / `pnpm lint` / `pnpm build` | 各自全綠 |
| 其餘七片 | 上述三項 + `bash -n <改到的每支 .sh>` + **實跑該 harness** | `bash -n` RC=0;harness 計數器**與具名 key 集合都在開工前先凍結**(W1),實跑數字與集合逐字相符 |

🔴 **環境事實(不是預先允許紅燈)**:本 worktree 根的 `node_modules/.bin` 沒有 `tsc` / `eslint`
⇒ `pnpm typecheck` / `pnpm lint` 會在**尾段那兩個非 turbo 步驟**報 `command not found`。
**處置 = 修環境或用 `node_modules/.pnpm/` 下的實體跑同一檢查並取得 RC=0**,
**不得**把「那兩步會紅」寫成可接受狀態 —— 小線 R2 抓到 v2 犯過這條(DoD 宣稱全綠、誠實邊界又承認會紅)。

### 2.2 🔴 v2 增補:S2a 磨出來的工法,**寫進片級驗收、不是建議**

小線四片被四輪三模型審出 31+19+16 條 must-fix,以下五條是**每一條都真的抓到過假綠**的工法。
本線的 harness(S2b-2)與所有守門一律照辦;**驗收時逐條 yes/no,答不出來視為 no**。

| # | 工法 | 為什麼(實錘出處) |
|---|---|---|
| W1 | **凡「跑了 N 格 / 紅了 N 格 / PASS=N」的斷言,一律改成具名集合逐字比對**,禁只比總數 | 同一支腳本上**中了三次**(紅格數量、PASS 總數、`_r` 只驗列數)。只凍結總數時「刪一格 + 重複另一格」照樣湊得回來。`docs/reviews/2026-08-06-b2-s2a2-reviews.md:44` |
| W2 | **pre 狀態 = 「只重放時間戳早於本檔的 migration 前綴」**,禁「已套過再 DROP」捷徑,**也禁「全部減本檔」** | 🔴 v2 原本把字面寫鬆成「排除本檔的從零 provision」(codex 關卡1 抓)。**正確字面逐字引自 `scripts/b2s2a-verify.sh` 永久警語①**:「pre-S2a 基準庫 = **只重放時間戳早於本檔的 migration 前綴**(不是「全部減本檔」—— 後者在日後新增更晚的 migration 之後會把它們一起套進「pre-S2a」,定義靜默漂移)」。兩個理由各自獨立:DROP 捷徑**不還原 COMMENT** ⇒ 刪 COMMENT 的突變全綠(B-231 §⑤2 實錘);「全部減本檔」則會被**更晚的** migration 污染。⇒ 本線 DoD 要驗「S2a 在、S2b 不在」 |
| W3 | **守門用 `raise SystemExit` 不用 Python `assert`** | `PYTHONOPTIMIZE=1` 會把 `assert` **整句移除** ⇒ 字面對帳與突變錨守門集體失效。實測:assert 版印 `GUARD-BYPASSED`、raise 版印 `GUARD-FIRED` |
| W4 | **codex 一律背景跑**(`< /dev/null`,輸出導檔) | 前景會被 10 分鐘 tool timeout 砍在輸出 findings **之前**,看起來像審完了 |
| W5 | **每發突變先證「真的改到東西」;比對象 = 與突變檔<u>同構</u>的那個對照物,不是「一律 mut0」** | 🔴 v2 原本寫死「比 mut0」(codex 關卡1 抓:mut0 只存在於「先剝 migration 自驗段」那一族;runbook / COMMENT / 項 30 那些突變**沒有 mut0,也不該剝掉受測 guard**)。**正確規則**:①migration 突變 → 比 **mut0**(比原檔恆不同,因為一律先剝自驗段 ⇒ 守門恆真,小線 R1 實錘);②文件 / runbook / 腳本突變 → 比 **原檔**(小線靶⑪⑭⑮ 就是這樣,且正確)。③兩族共同:`cmp` 的 **rc=2 是讀不到檔、判紅**,不得用 `&&…||…` 把它歸進「有差異」那一支 |

🔴 **W1 的推論**:本線 §4 的「預期 PASS-FAIL-MUT 計數」(v1 §2.1)**不夠** ——
計數對了但跑的是別的格照樣綠。⇒ 一律同時凍結**具名 key 集合**。

🔴 **適用範圍與 N/A 規則**(codex 關卡1 nit:否則無 Python 的片字面上必須判 no):
| 工法 | 適用 | N/A 時怎麼記 |
|---|---|---|
| W1 / W5 | **每一片**(只要有斷言或突變) | 無 N/A |
| W2 | 只有**需要 pre 狀態基準庫**的片(S2b-2a/2b、4b) | 其餘片在 DoD 欄寫 `W2: N/A(本片不建基準庫)` |
| W3 | 只有**守門用 Python 寫**的片 | 寫 `W3: N/A(本片無 Python 守門)`;**若改用 shell,等價要求 = 守門不得只靠 `set -e` 之外的隱含中止** |
| W4 | **審查流程**,不是產品驗收 ⇒ 不進片級 DoD | 落點改為 §10 送審指引;片級 DoD **不列 W4** |

🔴 **封窗(v2 重寫;codex 關卡1:v1 依賴的 quarantine 機制已作廢)**:
沒有 quarantine 目錄、也沒有 gate commit —— 小線最終是 **migration 直接進正式目錄、只押分支**。
⇒ 原本「等 gate commit」的緩衝**不存在**,`S2b-1` 一 commit,`a4a-verify` 的 N8 靶就會壞
(本輪實測 `syntax error`),而且**沒有任何閘可以等**。

**替代封窗(三選一,本線採 A)**:
| 案 | 做法 | 取捨 |
|---|---|---|
| **A(採用)** | **S2b-4a 排在 S2b-1 之前做** —— 先把 `a4a-verify` 的 N8 錨改成不會被本線打壞的形狀,再落 migration | 順序約束一條,零新機制;代價 = 4a 要先做,DAG 上 4a → 1 |
| B | S2b-1 落地後允許 `a4a-verify` 紅一段時間 | ❌ **不採**:違反鐵則 11(中間態不得留紅),且「暫時的紅」會被下一棒當成既有狀態 |
| C | 重建 quarantine 機制 | ❌ **不採**:Sean 已拍板 Q3=C 不做,重開等於推翻拍板 |

⇒ **DAG(v2-R2 補邊;codex R2 抓到兩條漏邊)**:
```
S2b-4a → S2b-1 → 2a → 2b
            │      │
            ├→ 3a ─┴→ 3b        (3b 需要 3a 的四軸化,也需要 2a 建好的 harness)
            └────────→ 5        (5 需要 1 已套 + 2a 建好的 harness)
4b → 4c                          (唯一與主鏈並行的支線)
```
- `S2b-1 → 3a`:**3a 要讀 migration 內第五處真相式**(§1.1 的 backfill oracle),沒有 1 就沒有那份文字。
- `S2b-1 → 5`:**5 的 expected-after 負測需要本線已套**(否則只驗得到 expected-before 那一半)。
- 🔴 **`2a → 3b`(v2-R3 複驗補)**:項 31③ 的新 rehearsal 格**寫進 `b2s2b-verify.sh`**,而那支檔案由 2a 建立。
- 🔴 **`2a → 5`(同上)**:S2b-5 的指紋格也寫進同一支檔案。
- `4b → 4c`:兩者都會動 harness 的埠與 teardown 慣例,先定案再套到三支 S1。
🔴 **prose 修正**:先前寫「4a / 4b / 5 與上列並行」與邊清單 `S2b-1 → 5`、`2a → 5` **自相矛盾**
⇒ 正確說法 = **只有 `4b → 4c` 這條支線與主鏈並行**;`4a` 在主鏈最前(封窗案 A),`5` 在 `2a` 之後。

---

## §3 設計

### 3.1 helper 四軸化

在既有三軸 helper 上加第四軸(§1 真相式),`INSERT … ON CONFLICT DO UPDATE` 的欄位清單同步加 `shipped_quantity`。

🔴 **`search_path` 維持 `public, pg_temp`、不回改成 `''`**:memory 拍板「新函式一律 `''`,
a5a 的舊慣例**不回改**」—— helper 是既有函式,本片只加軸,不趁機改它的執行環境。
**本片新建的那支 trigger 函式用 `SET search_path = ''` + 全限定名**;兩種慣例並存是刻意的,COMMENT 寫明。

### 3.1a 🔴 migration 的 timeout(自查型 2 命中:v1 **完全沒設**)

```sql
SET LOCAL lock_timeout = '5s';        -- 我等鎖的上限
SET LOCAL statement_timeout = '60s';  -- 單一語句的上限(backfill 迴圈受它管)
```

🔴 **語義要寫對,不要重蹈小線 R2 的坑**:
- `lock_timeout` 限制的是「**本交易等別人多久**」,**不限制**「本交易拿到鎖之後別人被擋多久」。
- 「別人被擋多久」= **本交易持鎖到 COMMIT 的總時長**,受 `statement_timeout` 與 backfill 迴圈長度支配。
- ⇒ **承重的是 `statement_timeout` 與「交易總時長上限」,不是 `lock_timeout`。**
  正式站候選集合今日為 0 列(§0.4)⇒ backfill 是 no-op;非 0 時**必須先量**(§10 攻擊角度 5)。

### 3.1b 🔴 鎖序全圖(自查型 1 命中:v1 只談 trigger 內的 `ORDER BY`,**沒有跨路徑分析**)

小線 R2 的死結就是「新加的鎖與既有 writer 順序相反」。本片雖然沒加新鎖原語,
但**必須把跨路徑的取鎖順序寫出來**,否則無法宣稱沒有死結面。

| 路徑 | 取鎖順序(實查) |
|---|---|
| **P1 加品項**(`INSERT shipment_items`) | S1b parent guard 取 `shipments` 該列 **NKU**;之後只**讀** `order_items`(**不鎖**)|
| **P2 出貨**(`UPDATE shipments SET shipped_at`) | `UPDATE` 先取 `shipments` 該列鎖 → 本片 trigger → helper 逐一取 `order_items` **NKU**(`ORDER BY order_item_id`)|
| **P3 取消**(A8a2) | `orders` **FOR UPDATE** → `order_items` NKU |
| **P4 採購 / 到貨**(A4a 既有四支) | `order_items` NKU |

**結論**:**沒有任何路徑先取 `order_items` 再取 `shipments`** ⇒ 這對表之間**無環**。
P1 對 `order_items` 是無鎖讀 ⇒ 不入序。

🟡 **誠實邊界(本片證不到的)**:P2 與 P3/P4 會爭同一批 `order_items` NKU。
P2 內部由 `ORDER BY` 保證升序;**A8a2 多品項時的取鎖順序本片未驗**
⇒ 若它不是升序,P2×P3 仍可能 `40P01`。**列為 §9 交棒項 6,不宣稱已擋。**

### 3.2 md5 前置閘(R1 #16 #17 / R2 #13)

**替換方式 = `CREATE OR REPLACE`**(A4a 原檔的「禁 OR REPLACE」紀律對象是**新建**,本片是蓄意替換)。

| 段 | pin 什麼 | 少了會怎樣 |
|---|---|---|
| ① | **`pg_get_functiondef(helper)` 的 md5**,不是 `prosrc` | 只 hash `prosrc` ⇒ `search_path` / `lock_timeout` / `SECURITY DEFINER` 漂移全部隱形 |
| ② | `proowner` / `prosecdef` / `proconfig` 全陣列 | `pg_get_functiondef` 不含 owner |
| ③ | **小線產物(完整契約,不是只有欄名)**:`shipped_quantity` 欄的**型別 / NOT NULL / DEFAULT 0** + 三條 CHECK **具名且 `pg_get_constraintdef` 逐字** + **`convalidated` 為真** + **七個具名 COMMENT 物件都在** | 片序不可倒的物理保證(§0.4)。🔴 **v2 修正(codex 關卡1)**:v1 把它縮成「欄 + 三條 CHECK」⇒ **部分套用或舊版的 S2a 也能過閘**,S2b 就在錯的 catalog 上接線。七物件清單與 §4.30 同源 |

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

🔴 候選集合必須含 **shipment-only 品項**(R2 #20)。
🔴 **v2 修正(codex 關卡1:v1 把兩個位置混為一談,實查如下,逐處不同)**:

| 位置 | 現行候選全集(實查) | 缺什麼 |
|---|---|---|
| `docs/runbooks/a4a-summary-rollback.md:76-78` 與 `:152-154` | procurement ∪ cancellation ∪ **summary** | 只缺 `shipment_items` |
| `scripts/a4a-verify.sh:155` | procurement ∪ cancellation | 缺 **summary 與 `shipment_items` 兩者** |

⇒ v1 那句「現行 runbook/harness 的候選全集是 procurement ∪ cancellation」**對 runbook 是過期敘述**。
本片要做的是:runbook 兩處補 `shipment_items`;`a4a-verify.sh` 補 **summary + `shipment_items`**。
🔴 **summary-only 品項為什麼不能省**:真相活動已全刪、但摘要殘留非 0 的列,
若不在候選集合內就**不會被重算、也不會報漂移** —— 那正是 §0.6b 那個殘留形狀的近親。

### 3.5 🔴 **已作廢(v2-R3)**:`a1-verify` 斷裂態的 manifest 設計 —— **已被 §3.5a 推翻,不得實作**

> 🔴 **讀到這裡請跳到 §3.5a(專屬 port + 跑完即 teardown)。** 本節整段(manifest 驅動、冪等要求、
> 終態判定、活體斷言依終態分流)**全部作廢**,保留僅為追溯與「為何不是這套」的對照。
> Fable R3:被推翻的節不就地標作廢,順序閱讀的人會照它實作。

#### 3.5-作廢 原文(R2 #1 #2 把 v2 的修法打掉,這是重寫版)

**v2 的修法**(重套「版本號 > A1 且檔內出現摘要表」的 migration)**實跑證明是壞的**:
命中 **6 支**,含 A4a —— 而 A4a 有 **5 個裸 `CREATE FUNCTION`** ⇒ 重跑必 `42723`,連小線都到不了。

🔴 **改成 manifest 驅動(R2 修法)**:

| 項 | 設計 |
|---|---|
| manifest | `scripts/a1-verify-restore.manifest`:一行一支**明列版本號**的 migration,**禁止用內容 grep 決定集合** |
| 冪等要求 | 進 manifest 的片必須是**可重跑**的(小線的 `ADD COLUMN` 重跑會 `42701` ⇒ **不能**直接重套)⇒ 實務上 restore 應改為**還原 schema 快照**,而非重跑 migration |
| 終態判定 | manifest 同時記「當下終態 = 三軸 or 四軸」,活體斷言**依終態分流**(R2 #2:down 世界收斂回三軸時,硬驗四欄會讓正確的 restore 也紅) |
| 活體斷言 | 造已知 fixture → 直呼 helper → 斷言 rc=0 **且回查四(或三)個欄的新值全部正確**(R1 #2:只驗「沒噴錯」被空函式騙得過) |

### 3.5a 🔴 v2 收斂:**選「專屬 port + 跑完即 teardown」,不做 manifest + 快照**

codex 關卡1 判 must-fix:v1 同時留下兩套互斥方案 = 把技術決定丟給開工的人,
項 24 因此沒有唯一的輸入 / 觀察 / pass。主視窗 `B-140-A` 裁定由我收斂。**拍板如下。**

**採用**:`a1-verify.sh` 改成**自建專屬 port 的拋棄庫 + 跑完即 teardown**,
不再嘗試把共用庫從斷裂態修回去。連同 §3.6 的撞埠一併解決(同一個動作)。

**為什麼不是 manifest + schema 快照**(逐條,不是偏好):
1. **manifest 的冪等前提在本 repo 不成立**。v1 自己已經寫出來:小線的 `ADD COLUMN` 重跑會 `42701`
   ⇒ 進 manifest 的片必須可重跑,而我們的 migration **不是**。v1 只好再退到「改成還原 schema 快照」——
   那已經不是 manifest 方案,是第三套。
2. **「終態分流」是新增的活動元件**。manifest 要記「當下終態 = 三軸 or 四軸」,活體斷言依終態分流 ⇒
   **多一個會過期的字面**,而它一過期就是靜默的(斷言依錯的終態放行)。teardown 沒有終態。
3. **S2a 已實證的工法優先**。「從零 provision + 專屬 port + 每案例 `CREATE DATABASE … TEMPLATE` 複製」
   在小線跑出過實績(`scripts/b2s2a-verify.sh`,四輪審查、17 發突變靶);manifest + 快照**零實績**。
4. **把 bug 變成不會發生的事**,而不是變成要維護的修復程序 —— 修復程序自己也需要被驗證,
   而「驗證修復程序」這件事在小線已經證明會長出一整層新的假綠面。

**代價(誠實列)**:每跑一次 `a1-verify` 要重建一次基準庫 ⇒ **變慢**。
本線接受這個代價;若日後慢到不可接受,正確的解法是**快取 template 庫**,不是回頭做 manifest。

### 3.6 port 54329 撞埠(**v2-R2 定案埠值**)

實查:`scripts/a1-verify.sh:35` 是 `PORT="${PORT:-54329}"`、`scripts/a4a-verify.sh:17` 是
`postgresql://postgres@127.0.0.1:${PORT:-54329}/postgres` —— **兩支預設同埠**。
🔴 codex R2 抓:v2 只寫「兩支分埠**或** teardown,擇一即可」—— **teardown 不解決撞埠**
(兩支併行起跑時,先起的那支還沒 teardown,後起的照樣撞)⇒ **兩件都要做,不是二選一**。

**定案(避開 B 家族已占用的 54329 / 54331 / 54342 / 54351 / 54353 / 54355)**:
| 腳本 | 專屬預設埠 |
|---|---|
| `scripts/a1-verify.sh` | **54361** |
| `scripts/a4a-verify.sh` | **54363** |
| `scripts/b2s2b-verify.sh`(本線新建) | **無預設,硬性要求顯式帶 `PORT`**(比照小線;v2-R3 修正:原本同時寫「預設 54365」與「硬性顯式帶」= 互斥。建議值 54365 寫在用法註解裡,**不是預設值**) |
兩支都保留 `PORT=` 環境變數覆寫;`b2s2b-verify.sh` 比照小線**硬性要求顯式帶 `PORT`**。

### 3.6a 🔴 **已作廢(v2-R3)** —— 下面這段是 v1 原文,**擇一即可的結論已被 §3.6 推翻(兩件都要做)**,保留僅為追溯

> 🔴 **讀到這裡請跳回 §3.6。** 「只加不刪」的編修策略讓被推翻的指令留成活字 ——
> Fable R3 抓到本節與 §3.6 正面矛盾;順序閱讀的執行者會照這段做出相反實作。


`a1-verify.sh` 與 `a4a-verify.sh` 預設同埠(precheck-runs §3.3 的地雷牌)。
本線一併處理:兩支分埠 **或** §3.5 的「跑完即 teardown」。**擇一即可,不必都做。**

---

## §4 驗收(骨架;每條一個可判定 oracle)

> 通則:「→ 成功」的正測 oracle **不得只驗「沒噴錯」**,必須回查新值落庫。

**群組 A:migration 與其結構閘(片 = S2b-1)** 🔴 v2-R3:本群組**只含 migration 檔內做得到的**;項 10-20 的行為格**不在這裡跑**(§7 明說塞不進 `DO` 區塊),它們的片歸屬見下方認領表
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
| 12c | 🔴 **§0.3 前提釘死的第二半(v2-R3 補;Fable 翻案條件③)**:v1/v2 只 pin 了 X3 / X1,**漏了 append-only 三支** —— 實查 `20260805170200:115-126` 的 `shipment_items_block_delete_bd` / `_block_update_bu` / `_block_truncate_bt`,**它們才是「改/刪已寄出箱品項」的唯一擋點**。少了這一格:未來任何片放寬 append-only(「整箱作廢重開」的替代方案很自然會想改它),**shipped 真值變動不經 `shipments` UPDATE ⇒ 本線 trigger 不發火 ⇒ 摘要靜默漂移**,而 12b / 25b 全綠。⇒ 本格斷言三支都在且結構逐字;**§9 交棒 3(放寬 X1/X3 的片)一併改成「放寬 X1/X3 <u>或 append-only 三支</u>」** |
| 12b | 🔴 **§0.3 前提釘死**:`INSERT shipments`(帶 `shipped_at`)+ 加品項 ⇒ **必被 X3 擋**;不加品項 ⇒ **COMMIT 時必被 X1 擋**。兩格都要 |
| 14 / 15 | C9 負測(fixture 四值互異 `4/2/1/3`、receipts **2+1** 刪 `quantity=1` 那筆)/ C9 承重性(DROP 後必須**全綠**) |
| 17 | backfill 兩段 oracle(§3.4),含 shipment-only 候選 |
| 18 | 🔴 X1 在 COMMIT 失敗 ⇒ 交易外回查摘要與品項**兩邊都回滾**(R1 #10:v2 只重述結論) |
| 19 | 🔴 雙 session barrier(**v2-R2 把值真的寫出來**;codex:v2 只寫「明訂」而沒給值 = 可被任意實作)。**fixture**:品項 `I1`、`I2`(UUID 由 provision 固定,寫進 harness 常數);包裹 `P1` 含 `I1,I2`、`P2` 含 `I2,I1`(刻意反序)。**同步點**:兩 session 各自 `BEGIN` 後,先各自 `UPDATE shipments SET shipped_at` **各自的包裹**,在 helper 迴圈**第一次取鎖之後**用 advisory lock 卡住,兩邊都到位才放行。**提交序**:S1 先 `COMMIT`、S2 後。**預期**:兩者皆成功、**無 `40P01`**;摘要表 `I1`/`I2` 的 `shipped` 各等於真值。**翻面**:拿掉 helper 迴圈的 `ORDER BY order_item_id` ⇒ **必出 `40P01`**。🔴 若翻面測不出 `40P01`(例如被別的鎖序意外救了),該格判**紅**、不得算過 |
| 20 | A4a 鏈活體:造四軸 fixture → 直呼 helper → rc=0 **且四欄新值全對** |

**群組 B:break-glass(片 = S2b-3a / 3b,逐項見認領表)**
| # | 條件 |
|---|---|
| 21 | runbook **兩段** + `a4a-verify.sh` 的 `ORACLE_SQL` 全部四軸化;**§1.1 拆兩半的守門**:①**本體**(扣掉關聯述詞後)五份 md5 全等 ②**關聯述詞**逐處**整行**字面比對凍結值 + 「述詞行恰一行」的行數斷言。突變 = **五發改本體**(逐處一發)+ **一發把述詞改恆等式**(v2-R3 複驗修正:原寫「五份正規化 md5 全等 + 五個獨立突變」是拆兩半前的字面,照它做會撞回不可實作) |
| 21b | 🔴 rollback 依賴清單補成 **五 trigger / 六函式** + DROP 序 + 一次 rehearsal;候選全集依 §3.4 的表**逐處**補(runbook 補 `shipment_items`;`a4a-verify.sh` 補 summary + `shipment_items`)。🔴 **v2 修正**:v1 寫「六/七」是算錯 —— 實查 catalog(port 54355 `s2a_ctl`)A4a = **4 trigger / 5 函式**(`pcm_a4a_*`),本線在 Q1=A 下只加 **1 trigger / 1 函式** ⇒ **5 / 6**。照 v1 的數字做,rehearsal 會永遠紅、或被湊數誤拆 S1 的無關物件 |
| 22 | 🔴 PR4 洞實證:DISABLE **五支**(v2-R2 修正:與項 21b 同一組數字,實查 A4a 4 + 本線 1)→ **只動 shipped 真相、前三軸完全不動** → ENABLE → 舊三軸 oracle **通過**、四軸版 **必 RAISE**(R1 #12:v2 引用的「DELETE receipt」會讓舊 oracle 因 instock drift 就 RAISE,測不到 shipped 軸) |

**群組 C:harness 修復(片 = S2b-4a / 4b / 4c,逐項見認領表)**
| # | 條件 |
|---|---|
| 23 | `a4a-verify` 突變靶 **N8** 錨同步 + 驗「突變真的翻面」 |
| 23b | 收尾零殘留閘擴成**六函式 / 五 trigger** / 四軸 oracle / 候選全集(數字理由同項 21b)。🔴 **本項已拆片(見 §4.99 施工裁決)**:`S2b-4a` 只交付「收尾閘補 trigger 面」(四支,今天就在);六函式/五 trigger 的**第 6/第 5 支**歸 `S2b-1`(它建的物件)、四軸 oracle 與候選全集歸 `S2b-3a`(與項 21 同一處文字)。**單讀本列會高估 4a 的範圍** |
| 24 | `a1-verify` 依 **§3.5a 拍板(專屬 port + 跑完即 teardown)** 處置 + 活體斷言。🔴 **v2-R2 修正**:v1/v2 這裡原寫「依終態分流」,那是**已被淘汰的 manifest 方案**的一部分(codex R2:被淘汰方案仍是驗收契約)。teardown 之後**沒有終態可分流** —— 每次都是從零 provision 的已知狀態,活體斷言直接驗四欄新值 |
| 25a-c | 三支 S1 harness 新格(**v2-R2 把「逐支明列」真的列出來**;codex:上輪只落了要求字面)。**25a** `scripts/b2s1a1-verify.sh`(`shipments`):新 cell = 「`AFTER UPDATE OF shipped_at` 那支重算 trigger 存在且結構逐字」;mutant = 改 `tgtype` 成 BEFORE;預期計數 = 現值 +1 格 +1 靶。**25b** `scripts/b2s1a2-verify.sh`(guards):新 cell = 「X1/X3 仍在且本線未放寬它們」(§0.3 前提的回歸點);mutant = 拿掉 X3;+1 格 +1 靶。**25c** `scripts/b2s1b-verify.sh`(`shipment_items`):新 cell = 「本表**沒有**重算 trigger」(Q1=A 的負向釘死);mutant = 加一支;+1 格 +1 靶。🔴 三支的**具名 key 集合**都要同批更新(W1),不是只加計數。✅ **三個檔名已實查存在**(`ls scripts/b2s1*`,2026-08-06):`b2s1a1-verify.sh` / `b2s1a2-verify.sh` / `b2s1b-verify.sh`(另有 `b2s1-concurrency-probe.sh`,非 harness、不在本項) |

---

**v2 增補(B-138-A;逐項落在哪一片)**
| # | 片 | 條件 |
|---|---|---|
| 26 | S2b-3b | 🔴 **債①停寫(v2 重寫)**:停的對象是**本線新增的重算 trigger**,不是 REVOKE 一個不存在的 writer。rollback 步驟①(`runbook:19-22`)補 `ALTER TABLE public.shipments DISABLE TRIGGER shipments_summary_recompute_ac`。**驗收**:①停用後改 `shipped_at` ⇒ 摘要表 `shipped_quantity` **不變**(trigger 沒跑)②拿掉該步驟時這一格**必須翻面**(改了 `shipped_at` 摘要就跟著動)|
| 26b | S2b-3b | 🔴 **停寫的對稱恢復(codex 關卡1:v1 只有停、沒有復)**:runbook 必須有對應的 **`ENABLE TRIGGER`** 步驟,且排在 rollback 文件的**步驟⑦(最後)**、與既有 GRANT 恢復同一節。**驗收**:恢復後改 `shipped_at` ⇒ 摘要重新跟動。🔴 少了這一步,災難重建成功後**出貨側永久停寫,而三軸對帳仍可能全綠** |
| 27 | S2b-3b | 🔴 **債②divergence 第四軸**:對帳表(`runbook:63-68`)加 `snap_shipped` / `truth_shipped` 兩欄。驗收 = 造一筆**只有 shipped 漂移、前三軸完全正確**的資料,舊三軸版對帳**回 0 列**(證明它真的瞎)、四軸版**回 1 列且指名該品項**。🔴 這一格與 §4 項 22 的 PR4 造洞法**共用同一個 fixture 紀律**:只動 shipped 真相、前三軸不動 |
| 28 | S2b-3b | 🔴 **債③(v2 降級為斷言,不改 gate)**:本線 scope 明定**不新增出貨真值表** ⇒ 債③不觸發。**「出貨資料面集合」的定義(本線據此判定)= 「任何持有 `shipped_quantity` 或等價已寄出數量、且會被 §1 真相式讀到的表」,今日恰為 `shipments` 與 `shipment_items` 兩張。** 驗收 = 一格靜態斷言:**資料面集合的 before / after 相等**(不是只看「新建 table」——codex R2:以 `ALTER` 擴既有表、或改真相來源時,新建集合仍為空而該格照樣綠)。具體 = 把「§1 真相式讀到的表 + 持有已寄出數量的欄」在本線前後各枚舉一次,兩份集合逐字相等;且 `gate` 模式的兩個 `count(*)` 查詢**逐字未變**。🔴 **不得改動 gate 已定型的五路徑與零參數 libpq 設計**(那是小線四輪審出來的) |
| 29 | S2b-2b | 🔴 **stale-high 殘留:本線把它「關閉」的正向證明(v2 重寫)**。codex 關卡1 指出 §0.6b 的因果鏈**只適用尚未四軸化的舊 helper** —— 本線之後每次呼叫 helper 都會**同時重算 instock 與 shipped**,殘留會被當筆校正掉 ⇒「先靜默超出貨、後紅無辜交易」在**本線落地後的正常路徑上不可構造**。🔴🔴 **v2-R3 補:三格必須各自 pin provision 基準**(Fable 翻案條件⑤ —— 不寫死基準,執行者在全前綴庫上照做會卡死)。
| 格 | 跑在哪個庫 | 為什麼 |
|---|---|---|
| (a) | **pre-S2b 基準庫**(A1 + A4a 三軸 + S2a,**不含本線**) | 三軸 helper **不碰 shipped** ⇒ 殘留留得住;post-S2b 走正常路徑時 helper 同筆重算 instock 為真值,步驟②當場紅、「紅在無辜」**構造不出來** |
| (b) | 同一個庫**套上本線之後** | 「第一次呼叫 helper」**實際上就是 migration 內的 backfill**(§3.4),寫明以免執行者另外去找一個呼叫點 |
| (c) | **post-S2b 全前綴庫** | 這一格量的是本線落地後的常態行為 |
🔴 (a) 用 owner 直寫構造殘留是**刻意的**,不算 §8.1 第二列的「模擬」——
它模擬的不是併發,是「stale-high 快取」這個**本來就會由 A4a 時序產生**的狀態。

⇒ 驗收改成三格:**(a) 前態可達**:🔴 **v2-R2 修正構造法(codex 抓:直寫 `shipped=3 / instock=2` 會當場被 C9 以 `23514` 擋下)**。正確構造 = 逐字照小線 C9 註解(`20260806100000_…:139-142`)描述的機制:①讓 `instock` 處於 **stale-high**(快取 3、真值 2)②在該狀態下寫 `shipped=3` —— **通過 C9,零違規提交**(這就是「靜默超出貨」)③下一筆 A4a 重算把 `instock` 修正成 2 ⇒ **該筆重算紅在 `23514`**。**驗收要斷言紅的是步驟③那筆、不是步驟②** —— 「離真凶任意遠」正是這個形狀的病徵;**(b) 本線自癒**:套上本線後第一次呼叫 helper ⇒ `shipped` 被重算成真值、殘留消失,**且該筆交易不紅**;**(c) 負向安全格**:若真值本身就 > instock(真的超出貨),helper **必紅在 `23514` / `oiqs_shipped_le_instock`**,且斷言紅的是**這一筆**。🔴 **措辭修正(v2-R3;Fable nit)**:本線關閉的是「**stale-high 讓超額出貨靜默提交**」那個機制,
**不是**「紅在無辜到貨更正」這個症狀 —— 合法出貨後、更正把 instock 壓到已出貨量以下,那筆更正**仍然會紅**
(那就是項 29(c) 本身,而且是正確行為)。**營運端的引導訊息仍必要**(§9 交棒 2),不得因本線而撤掉。
🔴 (a)(b)(c) 三格**都必須跑出預期觀察值才算過**;不接受「構造不出來也算完成」(codex:那是同一項無論結果如何都能登記完成) |
| 30 | **S2b-5**(獨立片) | 🔴 **註解蓋寫的常駐守門(9c 交棒;§0.6c)—— v2 重設計,見下方 §4.30**;含 **expected-before / expected-after 兩組凍結值** |
| 31 | S2b-3b | 🔴 **債④:把本線加進 runbook 的 Forward 重建清單**(`runbook:251`)+ 更新該行下方「6 欄 / 10 條 CHECK」的數字 + **同批擴小線的守門**。🔴🔴 **v2-R2 修正:我上一版把這條寫反了**(codex 關卡1 R2 抓)。實查 `scripts/b2s2a-verify.sh:1086-1091`:項13 是**硬比字串** `"20260730150000,20260803140000,20260806100000"` ⇒ **runbook 漏掉本線時它照樣綠;把本線加進去反而會先紅**。既有守門**擋不住債④,方向還相反**。🔴🔴 **v2-R3 再修(Fable 翻案條件①:上一版的修法照稿仍不可實作)**:實查 `b2s2a-verify.sh:1082`,
`REH_OUT` **只量摘要表的欄數與 CHECK 數**;而**本線不加欄、不加 CHECK** ⇒ 「本線落地後的新數字」**不存在**,
rehearsal 對 S2b 產物**結構上全盲**。且 `rehearse()` **跳過 A4a**,而本線閘①要求 A4a helper 存在(§3.2)
⇒ 把 S2b 加進 Forward 清單後,若照原樣重放,S2b 會因為 helper 不在而 abort。
⇒ **本片的正確做法**:①runbook 加本線 + 更新該行下方數字 ②`b2s2a-verify.sh` 的**凍結清單字串**同批更新
(否則項13 必紅)——**但不要求它去驗 S2b 的產物**,它的職責到清單為止 ③**債④真正的守門建在本線自己的
`b2s2b-verify.sh`**:新增一格 rehearsal,重放 runbook 清單(**A4a 也重放**,本線需要它)後斷言
**helper 是四軸(`pg_get_functiondef` md5 = 四軸凍結值)且 `shipments_summary_recompute_ac` 存在**
—— 這兩樣才是本線的產物、才量得到 ④**負測**:把本線從 runbook 拿掉 ⇒ 該新格必紅
🔴🔴 **v2-R3 複驗再補兩句(缺了就照稿仍會紅在錯的地方)**:
**(i)** `rehearse()` 是**重放清單內每一支**、只硬編跳過 A4a ⇒ S2b 進清單後它會被重放,
而閘①因 A4a 被跳、helper 不在而必 `RAISE` ⇒ 項13 紅在 `REPLAY-FAIL`。
**必須同批把 S2b 也加進 `rehearse()` 的跳點**(照 A4a 跳點 + 清單對帳同型,含 `S2B_SEEN` 旗標)。
**(ii)** 新 rehearsal 格說「A4a 也重放」——**在任何已 provision 的庫上會直接 `42723`**
(A4a 有 5 個裸 `CREATE FUNCTION`,`b2s2a-verify.sh` 跳過它的註解自述原因就是「要先做步驟④拆除」)⇒
**必須先照 runbook 的 DROP 序拆掉 5 trigger / 6 函式(項 21b 那份清單)再重放**,
否則翻案條件①在新地方原樣重生 |

### §4.30 🔴 項 30 的設計(v1 把它塞在 migration 結尾,那是錯的)

**codex 關卡1 打掉 v1 的寫法,兩條都成立**:

1. **migration 結尾的斷言只保護「它自己這一支」。** 下一支 migration 在它 COMMIT **之後**覆寫 COMMENT,
   不會觸發任何東西 ⇒ 宣稱結清「日後蓋寫」那筆債是假的,實際仍然零告警。
2. **「摘要表七物件」這個集合不實。** 實查 `scripts/b2s2a-verify.sh` 的 `fp_sql()`:
   七個物件裡**第七個是 `COL:shipment_items.shipped_quantity`**(小線那句 forward-override),
   **不在摘要表上**。照 v1 的字面實作會漏守它。

**v2 的設計**:

| 面 | 內容 |
|---|---|
| **形狀** | 不是 migration 內的一行斷言,而是**外部 oracle**:🔴 **v2-R3 改落點** —— 不另開 `summary-comment-guard.sh` 這支孤兒腳本,改成 **`scripts/b2s2b-verify.sh` 的一個常設格**(Fable:少一個要記得跑的東西),在**整條 migration 前綴全部套完之後**對真實 catalog 取指紋 |
| **守什麼** | **六個摘要表物件 + 一個 `shipment_items.shipped_quantity`**,逐物件列名(禁寫「七物件」這種會過期的集合描述);清單與 `b2s2a-verify.sh` 的 `fp_sql()` **同源**,兩處不一致即紅 |
| **期望值放哪** | 🔴 **凍結常數放在守門腳本自己裡面**,不放在被守護的 COMMENT 裡(codex nit:寫進受指紋保護的物件會**自我引用**,期望值無法穩定,實作者會退化成 live 自算 = 恆綠) |
| **🔴 兩組期望值,不是一組** | codex 關卡1 must-fix:小線那句受保護的註解**逐字寫著**「維護者 = A4a 四軸重算(**大線 B2-S2b,尚未施工**)」與 A4a「**完全不碰本欄**」(`20260806100000_…sql:157`)。**本線落地後這兩句就是假的** ⇒ 若守門仍要求等於小線指紋,等於**把已知假字面凍結起來**,功能接線正確而 catalog 仍宣稱沒有 writer。⇒ 必須明訂 **expected-before(小線值)** 與 **expected-after(本線改寫後的值)**,並在本線 migration 內**同批改寫那幾句註解**;守門依「本線是否已套」分流 |
| **何時跑** | **本線只交付:每片 commit 前的 DoD**(逐片列在 §2.1)。🔴🔴 **v2-R2 誠實化(codex 抓)**:v2 原寫「落點含 CI」——**實查 `.github/workflows/ci.yml` 完全沒有 postgres service、沒有 migration 前綴 provision**,真 catalog oracle **在 CI 裡沒有可執行載體**。硬寫「含 CI」等於寫一個沒有 bootstrap、沒有命令、沒有 expected 分流輸入的空條。⇒ **CI 化移出本線、列為交棒(§9 項 7)**,由「CI 起 PG service」那一片一起做。**因此本線不改 CI ⇒ S2b-5 的鐵則 12 欄維持「否」是正確的**(v2 曾一度自相矛盾) |
| **蓄意改註解時** | 同批更新腳本內的凍結常數,並在 commit body 寫明改了哪一句、為什麼 —— 與小線 `MIG_SHA_FROZEN` 的契約同形 |

🔴 **expected-before / after 的分流判準(v2-R2 補;codex R2:只寫「本線是否已套」會被餵綠)**:
分流**不得**依受守的 COMMENT 本身、也不得依 live 指紋(兩者都是被守護物 ⇒ 自我引用)。
**判準 = catalog 內是否存在本線的產物**:`shipments_summary_recompute_ac` 這支 trigger 在 ⇒ after,不在 ⇒ before。
它與 COMMENT 文字**完全無關**,改不動註解就改不動分流。

**負測(三發,都要)**:
- ⓐ 在**本線 migration 內**插一句蓋寫 COMMENT ⇒ 守門**必紅**。
- ⓑ 🔴 **模擬「下一支 migration」**:守門已是外部腳本、**沒有「檔內守門之後」這個位置**(codex R2 抓:
  v2 沿用了 migration 內設計的措辭,對外部 oracle 無唯一可實作語意)。正確作法 =
  **在守門腳本跑完之後**,對同一個庫再套一支只含一句蓋寫 `COMMENT` 的 throwaway migration,
  然後**重跑守門腳本** ⇒ **必紅**。這才是「日後蓋寫」的真實形狀。
- ⓒ 🔴 **把 expected-after 誤填成 expected-before**(即本線已套、卻仍拿小線的值比)⇒ 守門**必紅**。
  這一發專打上面那條「凍結已知假字面」——沒有它,兩組期望值的分流可能整條沒接上。

🔴 **「守門是最後可變更點」這個要求(v2-R2 改寫)**:守門已移出 migration ⇒ 檔內順序斷言**不適用**。
等價要求改成:**守門腳本必須在「該次要驗的 migration 前綴全部套完之後」才跑**,
且腳本自己要斷言「ledger 尾 = 預期的那一支」——否則它可能在半套狀態下取到會過的指紋。

🟡 **誠實邊界**:本守門擋的是「**蓋寫後沒有人回來更新凍結值**」,
**不是**「禁止蓋寫」—— 有意的蓋寫照樣可以發生,只是必須有人回來改常數。
這是 fail-visible,不是 fail-closed;寫清楚以免下一棒以為註解被鎖死了。

---

### §4.99 🔴 片級認領表(v2-R2/R3 補:codex「片級認領未閉合」+ Fable「群組標頭仍是 v1 片名」)

**每一項恰好被一片認領,沒有孤兒、沒有雙重認領。** 執行者以本表為唯一 scope 來源。

| 片 | 認領的驗收項 |
|---|---|
| **S2b-4a** | 23(全部)、23b(**僅可構造半**,見下方 🔴 施工裁決)|
| **S2b-1** | 6、6b、7、8、9、9b、17、**小線過期註解的同批改寫**、🔴 **23b 的「第 6 支函式 / 第 5 支 trigger」登記進 `a4a-verify.sh`(含 A1 的「四支」計數改五)** —— 見下方施工裁決 |
| **S2b-2a** | 10、10b、11、12、12b、**12c**、14、15、18、20 |
| **S2b-2b** | 19、**29**、§5 兩環境突變矩陣、🔴 **S2b-1 消融重證**(見下方) |
| **S2b-3a** | 21(五份真相式同步,拆兩半見 §1.1)、🔴 **23b 的四軸 oracle + 候選全集補 `shipment_items`**(與 21 的 `ORACLE_SQL` 四軸化是同一處文字,拆開會改兩次同一行)—— 見下方施工裁決 |
| **S2b-3b** | 21b、**22**、26、26b、27、28、31 |
| **S2b-4b** | 24(§3.5a 收斂版)+ §3.6 埠 |
| **S2b-4c** | 25a、25b、25c |
| **S2b-5** | 30(§4.30;落在 `b2s2b-verify.sh` 的常設格) |

🔴 **S2b-2b 追加格:S2b-1 的消融重證(主視窗 `B-147-A` ③ 掛入;推論轉觀察)**
S2b-1 交付時的行為實證第⑤條(**停用 `shipments_summary_recompute_ac` 後 shipped 不再跟動**)
是在**修關卡2 findings 之前**的那座拋棄庫上證的;修完之後的新庫上只重跑了 ①-④,
⑤ 因「同一交易內有 pending trigger events 不能 `ALTER TABLE`」構造不出來。
S2b-1 當時的說法是「修的是閘不是函式本體,所以消融結論不變」—— **那是推論,不是觀察**。
⇒ **2b 必須在最終庫上重證它**:獨立交易開頭先 `DISABLE TRIGGER`,再跑完整出貨串,斷言 shipped 凍在 0。
🔴 不掛進格子清單的話,它會以「上一座庫證過」的姿態活到收線。

🔴🔴 **S2b-4a 施工裁決(2026-08-06 開工當下,施工判斷,`B-140-A` 授權切片;已報 `B-239-STOP`)**
—— 本表原把 **23b 整項**給 4a,但 4a 依封窗案 A **排在 S2b-1 之前**,而 23b 的頭條數字是 **S2b-1 之後**才存在的物件:

| 23b 的四塊 | 4a 能不能做 | 落點 |
|---|---|---|
| **六函式 / 五 trigger** | ❌ 第 6 支函式與第 5 支 trigger **由 S2b-1 建**;4a 現在寫死它們 ⇒ harness 立刻紅到 S2b-1 落地為止 = **§2 明文否決的案 B** | **S2b-1**(建物件的片負責把自己登記進守門;`a4a-verify.sh` 內已留 🔴 註記指路) |
| **收尾閘補 trigger 面** | ✅ 可構造(四支今天就在) | **4a 已交付** |
| **四軸 oracle** | ❌ 且**本表自己雙重認領**:§2 片表的 `S2b-3a` 描述已含「`a4a-verify` 的 `ORACLE_SQL` 四軸化」 | **S2b-3a**(項 21,原本就在那) |
| **候選全集補 `shipment_items`** | ❌ shipped 軸在 S2b-1 之前無真值來源,現在補 = 恆真斷言 | **S2b-3a**(與四軸 oracle 同一處文字,拆開會改兩次同一行) |

🔴 附帶更正(**已就地改掉,不是只在這裡註記**):§2 片表 `S2b-4a`(`:277`)與 §0.1 群組 C(`:26`)
原本都把 **`proacl` 假綠**算進 4a;它其實是**項 9b**、本表認領給 **S2b-1**
(正確:那是**本線新建函式**的安全面,S2b-1 之前根本不存在)。兩處字面已同批改寫、
§4 項 23b 本體(`:557`)也補了「已拆片」標記 —— **不留活字,照 `B-237-STOP` §③5 自己立的規矩辦**。

🔴 **v2-R3 移動的三項**:項 14 / 15 / 18 原本掛在「S2b-1(migration)」群組下,但它們是**行為格**
⇒ 改認領給 **S2b-2a**;項 22(PR4 造洞)原本**沒有片標**⇒ 認領給 **S2b-3b**(與 21b 共用同一次 rehearsal)。

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
| **五份**真相式的**本體**改其中一份(含 backfill oracle 那一份) | 項 21 的**五發本體突變** |
| 🔴 **第 5 處**的述詞改成恆等式(`si.order_item_id = si.order_item_id`) | 項 21 的**述詞整行字面格**。🔴 **指定打第 5 處**(v2-R3 二複驗):它是唯一開工才定值的一列,若被實作成「執行期自讀再跟自己比」就是恆綠 —— 打 2/3/4 那些已有具體凍結值的處**驗不到這個縫**。沒有這一發,半②就是恆真族 |

**v2 增補靶(對應項 26-30)**
| 靶 | 唯一 oracle |
|---|---|
| 拿掉債①的出貨側停寫動作 | 項 26(停寫後改 `shipped_at` 竟然成功) |
| 對帳表退回三軸 | 項 27(只有 shipped 漂移的 fixture ⇒ 舊版回 0 列) |
| 註解蓋寫守門的凍結值改成「自己算自己」(live 自算) | 項 30(蓋寫負測不再轉紅)—— 🔴 小線 R1 實錘過同型:對照組自己算出來再跟自己比 = 恆綠 |
| 把蓋寫 COMMENT 插在守門**之後** | 項 30 的「守門必須是最後可變更點」那一半 —— 🔴 這一發專打 v1 的錯設計 |
| helper 的 `ON CONFLICT` 漏掉 `shipped_quantity` 欄 | 項 20 活體斷言(四欄新值全對);🔴 **這一發專打 §0.6b 的病根** |

🔴 **突變紀律(§2.2 W5;v2-R2 修正:本段原本一律寫「比 mut0」,與 §2.2 的分族規則自相矛盾)**:
每個靶先驗「`sed` 真的改到東西」,**比對象 = 與突變檔同構的那個對照物**:
**migration 突變比 mut0**(只剝不改的基準);**runbook / 腳本 / COMMENT 突變比原檔**(它們沒有 mut0,
也不該剝掉受測 guard)。兩族共同:`cmp` 的 **rc=2 是讀不到檔、判紅**,
不得用 `&&…||…` 把它歸進「有差異」那一支。

---

## §6 Cut point 與回滾

- **順序 `小線 → 本線` 強制**(§0.4);倒置 ⇒ `42703` A4a 全鏈死。
- **本線內九片**(v2-R2:四片 → 八片 → 再拆 4b/4c = 九片):只有 S2b-1 是 migration ⇒ 沒有 migration 間 cut point;
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
- 本檔狀態:**v2 關卡1 五輪全跑完、findings 全折入(56 must-fix + 15 nit),等主視窗批准開工**(權威狀態見檔頭)。
  v1 曾寫「尚未送審 / 小線先送」、v2 曾寫「R2 待跑 / R3 待跑 / 複驗待跑」—— 都是各自時點的事實,**現已全部不適用**。

**v2 增補的誠實邊界**
- 🔴 **v1 寫在小線收工之前** ⇒ 它引用的「小線現況」是**當時**的;小線最終落地的是
  `cdf7e89`(harness 7 格 4 靶 + runbook 情境表 + gate 五路徑),v1 §0.4 / §2 的封窗敘述**未逐字重核**。
  ⇒ **關卡1 請把「v1 對小線的引用是否已過期」當成一個獨立攻擊角度**(§10 角度 6)。
- 🔴 **項 29(v2-R2 更新;舊敘述已作廢)**:v2 曾寫「可能構造不出來」——**那是錯的**。
  逐字照小線 C9 註解(`:139-142`)的機制,殘留是**經由 stale-high instock** 構造出來的,不是直寫。
  三格(前態可達 / 本線自癒 / 真超出貨必紅)**都必須跑出預期觀察值**,無「構造不出來也算過」這個選項。
- 🔴 **項 26(v2-R2 更新;舊敘述已作廢)**:停寫對象已改成**本線新增的 trigger**(`DISABLE TRIGGER`),
  它有**明確的 oracle**(停用後改 `shipped_at` ⇒ 摘要不動;拿掉該步驟 ⇒ 摘要跟動)⇒ **不是 inconclusive**。
  v2 舊句「只能證明 REVOKE 生效、標 inconclusive」與新設計直接衝突,已作廢。
- 🔴 **仍為 inconclusive 的只剩項 19(barrier)**:零 writer 下只能用 owner 直寫模擬併發,
  不是真 writer 競態 ⇒ 照 §8.1 標註並在兩處出現;**若它最終是本線唯一的併發證據,依 §8.1 末條進 STOP**。

### 8.1 🔴 `inconclusive` 的 stop rule(codex 關卡1 must-fix:v1 一面列必驗、一面標 inconclusive,沒說算不算過)

**規則(本線一律照這條,不由執行者自由心證)**:

| 情況 | 算不算通過 | 要做什麼 |
|---|---|---|
| 該格**跑出預期觀察值** | ✅ 通過 | 照常入帳 |
| 該格**因為缺少真 writer / 真併發而只能用 owner 直寫模擬** | ⚠️ **通過,但必須標 `inconclusive` 並寫明「它證不到什麼」** | 在 harness 輸出與 commit body **兩處**都出現該字樣;**不得**在 STOP 或報告裡簡化成「已驗」 |
| 該格**構造不出來** | ❌ **不算通過** | 必須寫出「**哪一道守門擋住了它**」並附**實跑輸出**;寫不出來 ⇒ 停,回報。(小線實錘:`gate` 負測第一次沒觸發是因為 seed 插了 0 列,**不是**因為不可能) |

🔴🔴 **v2-R3 補洞(Fable):第二列原本是「自我宣告制、無舉證義務」,而第三列要舉證
⇒ 構造失敗可以被重新標籤成「只能模擬」洗成通過。** 修法兩條:
① **第二列同樣要舉證** —— 必須附「**真路徑嘗試的實跑輸出 + 被什麼擋住**」,與第三列同一份舉證標準;
   差別只在:第二列的阻擋原因是「今天沒有那個 writer / 沒有真併發」,第三列是「有守門擋著」。
② **預授權清單寫進規則本體、且是封閉的**:目前**只有項 19(barrier)**預先獲准使用第二列。
   任何新的「我這格也只能模擬」聲請 ⇒ **一律進 STOP 由主視窗裁定**,不得由執行者自行認定。

🔴 **`inconclusive` 不是豁免**:它只允許「這一格今天證不到全部」,
**不允許**「因此這一格可以不做」或「因此可以宣稱已擋住」。
🔴 **項 19(barrier)與項 26(停寫)兩格若最終都只能是 inconclusive**,
那本線就**沒有任何一格**真的證明了併發面 ⇒ **這件事本身要進 STOP 讓主視窗知道**,
由它決定是否把併發驗證移到「出貨 writer RPC 片」(§9 交棒 1)一起做。

---

## §9 交棒

| # | 落在 | 內容 |
|---|---|---|
| 1 | 出貨 writer RPC 片 | 自己守 `增量 ≤ instock − shipped`(為訊息與前緣拒絕,**不是正確性**);多品項同交易 `ORDER BY order_item_id` + `40P01` 重試 |
| 2 | 到貨更正片 | 被 C9 擋時的引導訊息:先作廢包裹 → 改到貨 → 重新出貨 |
| 3 | 🔴 **任何放寬 X1 / X3 <u>或 append-only 三支</u> 的片**(v2-R3 複驗補:原本只寫 X1/X3,而 `shipment_items_block_update_bu` / `_delete_bd` / `_block_truncate_bt` 才是「改/刪已寄出箱品項」的唯一擋點) | §0.3 的前提會倒 ⇒ 必須同批補 `shipment_items` 重算 trigger,否則 `shipped` 靜默算少 |
| 9 | 🔴 **停寫涵蓋面(債⑤ 的承接者)** | runbook 步驟①「A5a 是唯一 service_role 寫入口」**今天就是假的**:`admin_cancel_order` 對 service_role 有 EXECUTE(`20260804180000:271`、`20260805100000:497`),經 A4a trigger 寫得到摘要表。**本線只把它記成債、不結清**(結清要動取消線的 ACL,超出本線 scope)⇒ 由「停寫涵蓋面盤點」那一片承接。v2-R3 複驗:原本債⑤ 寫「由 §9 交棒 9 承接」但表內根本沒有第 9 列,**懸空** |
| 4 | 🔴 **未來「開放改箱」的片** | §0.2 的四項(trigger + OLD/NEW + U/D 負測 + 多列鎖序) |
| 5 | Sean apply 之後 | `database.types.ts` 重生 → nullable 校正 → `pnpm typecheck`(與小線 §9 項 1 同一個 checkpoint) |
| 7 | 🔴 **「CI 起 PG service」那一片** | §4.30 的註解蓋寫守門**本線交付的是 `b2s2b-verify.sh` 的一個常設格**(每次跑該 harness 都會跑,不再是孤兒腳本),**但仍未常駐化** —— 實查 `.github/workflows/ci.yml` 沒有 postgres service、沒有 migration 前綴 provision ⇒ 真 catalog oracle 在 CI 裡無載體。**在它常駐化之前,這道守門只是「一支要記得跑的腳本」**,誠實邊界已寫明,不得對外宣稱已常駐 |
| 6 | 🔴 **取消線(A8a2)** | **多品項取消時的 `order_items` 取鎖順序**(§3.1b 的誠實邊界):若非升序,與本片的出貨重算仍可能 `40P01`。**本片證不到,不宣稱已擋** |

---

## §10 送審指引

**v2 狀態:關卡1 已跑五輪、收斂收線** —— codex R1(FAIL 21+4)、codex R2(FAIL 19+1)、**Fable R3 換模型換角度**(FAIL 9+4,五條翻案條件我親驗全成立)、Fable 複驗(FAIL 6+4)、**Fable 二複驗(FAIL 1+2)**。**五輪 findings 全折入,合計 56 must-fix + 15 nit;must-fix 數列 21 → 19 → 9 → 6 → 1 = 收斂,關卡1 收線。** 小線已收工(`cdf7e89`)。
🔴 下面「建議攻擊角度」1-5 是**開第五輪之前**寫給審查者的,五輪已把 1/3/4 折成定案(§3.5a 收斂、§1.1 拆兩半改凍整行、九片 DAG)。**保留僅為追溯,再開輪次不要照它重跑**。
🔴 **W4(codex 一律背景跑、`< /dev/null`、輸出導檔)的落點在這裡**,不在片級 DoD ——
它是審查流程紀律,不是產品驗收條件。
🔴 **審查期間整個工作樹凍結**(2026-08-06 實錘:我在 codex 跑 R1 時去改 runbook,
污染了零留痕比對基準,那一輪的零留痕判定失效;memory `feedback_freeze-artifact-before-adversarial-review` 的變體)。

建議攻擊角度(前身 v2 兩輪已挖過「守門完整性 / 假綠 / 折入沒寫機制」,不要重複):

1. **§3.5** 是 v2 修法被打掉後的重寫版 —— manifest 驅動 + 終態分流,還是「跑完即 teardown」更對?
   兩個方案各自的失效面是什麼?
2. **§0.3 的前提證明**(項 12b 兩格)真的窮舉了嗎?有沒有第三條路能造出「已 `shipped_at` 且有品項」?
3. **§1.1 拆兩半之後**(本體比 md5 / 述詞比 per-site RHS 字面):正規化會不會把真正的語意差異抹掉(例如 `AND` 順序調換)?述詞那一半的 per-site 凍結有沒有新的恆真面?
4. **§2 的封窗**(採案 A:`4a` 排在 `1` 之前)—— **九片**之間還有沒有別的「先 commit 就會紅」的 interlock?
5. **§3.4 backfill 候選全集加 `shipment_items`** 之後,還有沒有第四種只出現在某張表的品項?

—— v2:v1 起草 + `B-138-A` 五項輸入增補 + 關卡1 **五輪**(codex ×2、Fable ×3)共 **56 條 must-fix + 15 條 nit 全折入**;關卡1 收線,等主視窗批准開工 ——
