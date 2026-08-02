# A2b1 片級 plan:`order_item_procurement` 跨列總量守門 constraint trigger

> **v4 · 2026-08-03 凌晨 —— 🛑 本片今晚停在 plan 層、零實作。**
> 關卡1 三輪:codex `gpt-5.6-sol` xhigh R1 = NO-GO(12 must-fix + 8 nit,親驗駁回 0)→ 折入升 v2 → R2 = NO-GO(處置稽核 13 真修 / 5 部分 / 1 假修;新增 5 must-fix + 7 nit)→ **R3 換模型 Fable 換角度(框架層)= NO-GO(2 must-fix + 3 consider + 3 nit,全部加法、設計不動)**,已全折入本 v4。
> R2 殘留的兩條 must-fix(R2-1/R2-2 = R1-6/R1-8 原樣重現)本質是「**須 Sean 事前拍板的交易契約**」,夜間無法收斂 ⇒ 依夜跑指令「關卡1 兩輪不收斂 → 停、寫 handoff 等早上」**判停**。四題決策題 = §9(**apply 硬前置**)。R3 正向結果:trigger(非 RPC)守門落點被獨立確認成立(表對全 role 零寫 GRANT = trigger 是地板)、M1-M11 突變無「他機制供觀察」假綠形狀、A2b2/A4a 依 v3 介面可做。
> findings 逐字與逐條處置 = `docs/reviews/2026-08-03-e10-a2b1-k1-codex.md`;收工交接 = `docs/handoff/2026-08-03-nightly-a2b1-chain.md`。
> 片型 **T / 高風險片**(鐵則 12③;completion-map `:106,115`)。授權:Sean 08-03 Q1=A 三線夜跑(STATUS.md:10)。
> 紅線:migration 只寫檔 + 本機 PG17 harness;絕不 apply、絕不 db push、絕不 git push、不碰 .env\*、不動 STATUS/CURRENT。

---

## §0 這一片在鏈上的位置

- 權威 = master plan §5.1 **row 28(:363-370)**;DAG §5.0 `:255-256`。
- **上游已 apply 正式站 = 本 session 親驗**:Supabase MCP `list_migrations` 唯讀實撈,ledger 含 `20260729020000`(A2)/`20260730130000`(A7)/`20260730140000`(A7-t)/`20260730150000`(A1)/`20260801140000`(S1a)/`20260801150000`(S1b)/`20260801160000`(S2)/`20260802150000`(A6),尾段與 repo 目錄一致。
- 本片是 `A2b1→A2b2→A4a→A4b→A5a` 五片解鎖鏈起點(completion-map `:110-112`)。
- **repo 內零讀寫呼叫端**(實查:`apps/`+`packages/` 唯一命中 = 產生的型別宣告)。repo 外 service_role 讀者無法從 repo 證明(誠實列界);該表正式站 0 列(codex R2 唯讀重驗),DDL 鎖窗風險低。graphify 於 worktree 不可用且 .sql 不進圖,以全樹 grep 代替。

## §1 目標(擋掉哪個具體的錯)

正式站現況該表**零 trigger**:員工可對只買 2 件的品項開 5 件採購、也可對「已取消 2 件」的品項照原量開採購 —— 單列 CHECK 看不到別列、更看不到取消(A2 建表註解自點名:`20260729020000:117`)。

守門公式(row 28 R6 delta):**對同一 `order_item_id`,`SUM(allocated_quantity) ≤ order_items.quantity − SUM(order_cancellation_items.cancelled_quantity)`**,兩個 SUM 都直接打真相表;只在「新增或調升(或換 parent)」時 assert;**取消前已寫入的採購事實不動**(§5.1b:452 互為表裡)。

## §2 親讀契約(主對話親驗,檔案:行號)

| # | 契約 | 來源 |
|---|---|---|
| C1 | 守門不得讀 `order_item_quantity_summary`;鎖 parent 後回真相表重算;負測必含「刪掉/竄改摘要列後守門仍正確」 | master plan `:363-370`;A1 row `:361` |
| C2 | **鎖序契約的實況(R2-3 更正)**:row 28 字面「鎖序固定 order_items → order_item_procurement」對 AFTER trigger **物理上做不到** —— DML 先鎖 procurement tuple、trigger 才鎖 parent。本片把 C2 重述為:「**守門互斥靠 parent 列鎖序列化;跨物件取鎖順序的紀律屬 writer**」。⚠️ master plan row 28 與 A4a row `:372` 的鎖序字面需要 Sean 確認修訂(早上議程,今晚不動 master plan) | master plan `:363,:372`;R2-3 |
| C3 | 表現行形狀 = `supplier_id uuid NOT NULL` FK;business key `UNIQUE (order_item_id, supplier_id)` | S1b `20260801150000:137-143` |
| C4 | `cancelled_quantity` 只有 `> 0`、刻意無上限;同品項跨 header 累積 | A7 `20260730130000:215-223,241-244` |
| C5 | `order_items.quantity` 只有 `> 0`、無上限 ⇒ 守門算術全程 bigint 變數 | `20260604120000:146`;§5.1c `:466-468` |
| C6 | 取消真相表應用 role 零寫權、A7-t 擋 TRUNCATE ⇒ SUM 單調不減(第 1 批無復原路徑) | A7 `:267-268`;A7-t |
| C7 | A5a(未來唯一 writer)依賴本守門、不重複實作 | master plan `:379` |
| C8 | A4a 用同一把 parent 鎖 ⇒ **鎖原語必須同為 `FOR NO KEY UPDATE`**(§3.4) | master plan `:372` + 本片連動 |
| C9 | **(R2-8 更正我的假字面)**`order_items` 既有 writer:`admin_update_order_item_workflow` 會 `FOR UPDATE` 鎖列(`20260716130000:101`)再 UPDATE `workflow_status/version/updated_at`(`:138-142`)—— **零 quantity writer** 仍成立(SET 清單字面寫死),但守門 NKU 會與它短暫互斥(FOR UPDATE vs NKU 衝突;皆單列鎖、無環) | `20260716130000:101,138-142` |
| C10 | 函式慣例:裸 `CREATE` 禁 `OR REPLACE` + 完整 ACL allowlist(owner 外零 grantee),不只 named REVOKE | A7-t `:138-142,388-404` |

## §3 設計(v3 = 早上開工的基準;§9 四題拍板後才可實作)

### 3.1 觸發物形狀

```sql
CREATE CONSTRAINT TRIGGER order_item_procurement_allocation_guard_ac
  AFTER INSERT OR UPDATE ON public.order_item_procurement
  DEFERRABLE INITIALLY IMMEDIATE          -- §9 Q2 拍板標的
  FOR EACH ROW EXECUTE FUNCTION public.pcm_a2b1_procurement_allocation_guard();
```

- **AFTER 不是 BEFORE**:攔跨列聚合,AFTER 時 NEW 已在表內、SUM 自然含它。
- **DEFERRABLE INITIALLY IMMEDIATE**:預設逐 statement 發火;合法「先超後補」交易可顯式 `SET CONSTRAINTS … DEFERRED`(延後**非繞過**,COMMIT 時同函式照跑;本機 PG17.10 三態實測:immediate 當場擋 / defer+補回 COMMIT 過 / defer 不補 COMMIT 炸)。⚠️ 是否開放「交易內暫時違規」= **§9 Q2,Sean 拍板才定案**(R2-2)。
- 不掛 DELETE(只減總量);TRUNCATE 不在 row 28 範圍。

### 3.2 函式邏輯全序(fail-closed)

```text
① 隔離閘:current_setting('transaction_isolation') <> 'read committed'
   → RAISE ERRCODE 'P2B02'(gate-first;§9 Q1/Q3 拍板標的)
② skip:TG_OP='UPDATE' 且 NEW.order_item_id = OLD.order_item_id
   且 NEW.allocated_quantity <= OLD.allocated_quantity → RETURN NULL
③ 鎖 parent:SELECT quantity INTO v_qty FROM public.order_items
   WHERE id = NEW.order_item_id FOR NO KEY UPDATE;
   NOT FOUND → RAISE(防衛枝 3.6,不列守門)
④ 重算(v_qty/v_alloc/v_cancelled 全宣告 bigint):
   v_alloc     := COALESCE((SELECT sum(allocated_quantity) FROM public.order_item_procurement
                            WHERE order_item_id = NEW.order_item_id), 0)
   v_cancelled := COALESCE((SELECT sum(cancelled_quantity) FROM public.order_cancellation_items
                            WHERE order_item_id = NEW.order_item_id), 0)
⑤ IF v_alloc > v_qty − v_cancelled → RAISE ERRCODE 'P2B01'
   USING CONSTRAINT = 'a2b1_allocation_within_orderable'(訊息帶三數字)
```

- **③ `FOR NO KEY UPDATE`(R1-1 實測折入)**:FK RI 檢查同 statement 先對 parent 取 `FOR KEY SHARE`;兩筆併發 INSERT 各持 KEY SHARE 再升 `FOR UPDATE` = 鎖升級死結(本機 PG17.10 實跑 `40P01 … while locking tuple in "order_items"`);NKU 與 KEY SHARE 相容、guard 間互斥,同實驗零死結。**措辭更正(R2-7)**:NKU 不是「與 FOR UPDATE 等強」,是「**足夠的衝突集合**」—— 擋 SHARE/NKU/FOR UPDATE 與一般 UPDATE/DELETE 列鎖、不擋純 SELECT 與 KEY SHARE,恰好夠 guard 互斥又不撞 RI。
- bigint(R1-9):危險在**變數宣告**不在表達式(`SUM(integer)` 本回 bigint);M5 = 窄化 `v_cancelled` 為 integer(B10 以 22003 轉紅)。誠實列界(R1-14):bigint 累加器理論可溢位(需 9.2×10^13 列滿額,物理不可達),只宣稱「無 int 中間值」。
- ERRCODE 沿 A7c 慣例(`20260801120000:215`)。**等鎖逾時與 NOWAIT 的 SQLSTATE 都是 `55P03`**(R2-5 更正 v2 的 55P04 錯字面;lock_timeout 觸發訊息 = `canceling statement due to lock timeout`,已實測)。

### 3.3 COALESCE 辨析

C1 禁的是 `COALESCE(摘要快取, 0)`。本片兩個 COALESCE 包**真相表 SUM**:零列 = 真的零。摘要表在函式內零出現;M2 + B8 釘住。

### 3.4 隔離閘(P2B02;§9 Q1 拍板標的)

NKU 序列化只在 READ COMMITTED 健全 —— 本機 PG17.10 兩 session 實測:RR 下等到鎖後 `SUM=3`(看不到兄弟已提交列 ⇒ 雙雙放行)、RC 下 `SUM=6`(正確攔下);同病根 `scripts/a7t-concurrency-probe.sh:139-164`。**提案** = 只允許 read committed(RR/SERIALIZABLE 一律 P2B02;SERIALIZABLE 理論可靠 SSI 自保但選擇不信任、保守拒收)。這是**新的對外交易契約**(R1-6/R2-1)⇒ 不再自稱自決,**§9 Q1 等 Sean**。翻案成本誠實列(R2-1 抓「一行」低估):條件一行 + B9/M4/M12 cells 連動改 + 文件同步 ≈ 30-60 分鐘重跑。

### 3.5 lock_timeout(R2-5/R2-6 折入後的誠實版)

函式頭 `SET lock_timeout TO '5s'`(function-local,實測生效、55P03)。**範圍誠實列界**:只保護③的顯式 NKU 等待;**保護不到**進函式前的 DML tuple 鎖等待與 FK RI 的 KEY SHARE 等待(它們在別的執行脈絡);`lock_timeout` 是**每次取鎖各算**非總上限;函式執行期間會暫時覆蓋呼叫端更嚴的值。守門自身等待有界,其餘由呼叫端 statement_timeout 兜底。

### 3.6 防衛枝(不列守門、無負測、無突變格)

③ NOT FOUND 構造不出來(FK RI 依名序先發火、23503 先擋)。依 memory `feedback_unconstructible-negative-test-means-noop-guard` 不宣稱守門(A6 `[38]` 教訓)。

### 3.7 函式安全面

- 裸 `CREATE FUNCTION`(C10)+ `SECURITY DEFINER` + `SET search_path = public, pg_temp` + `SET lock_timeout = '5s'`;全物件 schema-qualified。
- `REVOKE ALL FROM PUBLIC, anon, authenticated, service_role` + 完整 ACL allowlist 斷言 + 四 role 顯式否定(A7-t `:388-404` 兩層)。
- 驗收斷言:函式 owner = 三讀取表 owner;三表 `relforcerowsecurity=false`;`tgtype` 位元、`tgdeferrable=true`、`tginitdeferred=false`、`tgenabled='O'`;`proconfig` 含 search_path 與 lock_timeout;**同名 constraint trigger 全 schema 唯一**(R2-10:`SET CONSTRAINTS name` 作用於所有同名者)。

### 3.8 鎖面、死結分析與誠實邊界

- DDL:`CREATE CONSTRAINT TRIGGER` 只鎖 `order_item_procurement`(0 列表);不碰 `order_items` DDL 鎖。
- 死結分析:①同 parent 併發 INSERT 的 RI 死結已由 NKU 消除(實測)②A5a 單列 upsert 交易無環 ③**多列 writer 的死結面(R2-4 更正)**:排序鍵必須是**完整 business key `(order_item_id, supplier_id)`** —— 只按 order_item_id 排,同 parent 兩 supplier 列反向更新仍可在 **procurement tuple 鎖**上互鎖(與 trigger 無關的一般多列 UPDATE 死結);contract line 寫進 migration 註解 ④既有 workflow RPC(C9)與守門 NKU 短暫互斥、皆單列 order_items 鎖、無環。PG 偵測到的死結 = abort 一方,fail-closed 可重試。
- 誠實邊界:①owner/superuser `DISABLE TRIGGER`、`session_replication_role=replica`(`tgenabled='O'`)可繞 —— A7-t 同天花板 ②**閘的不對稱矩陣(R2-11)**:隔離閘只作用於有觸發 guard 的 row event —— RR 下調降 UPDATE 被拒,但 DELETE(未掛 trigger)與零列 UPDATE 不觸發、照常成功 ③減量方向不守 ④`order_items.quantity` 改小不觸發重驗(零 quantity writer,C9;第 3 批改單片決定,contract 債)⑤第 2 批 `shipped_quantity` 連動未寫死(master plan `:452` 未點名 A2b1)⇒ contract 債 ⑥27 項驗收貢獻 = 0 ⑦端到端競態行為證明 = A2b2;本片 B12 的 55P03 只證「存在與 NKU 衝突的列鎖」非精確模式(R2-9),與結構錨合起來殺 M1。

### 3.9 break-glass:誤攔當天的合法出路(Fable R3 F2;A7b D8 同形教訓)

守門因 bug 或資料不一致而**錯誤地**擋住合法採購的那一天,合法出路必須事先寫死、不能當天發明(migration 註解明文 + handoff 揭露):
①執行者 = owner(postgres;Sean 經 dashboard SQL editor)②程序 = `ALTER TABLE public.order_item_procurement DISABLE TRIGGER order_item_procurement_allocation_guard_ac;` → 修正資料 → `ENABLE TRIGGER` → 對受影響品項以守門公式**手動重驗**(SUM 兩真相表)③事後對帳 = 停用期間的寫入逐列列出、與 P2B01 訊息裡的三數字比對、結果記入當日 handoff。**這不是繞過授權**:能執行的人本來就在天花板之上(3.8①);把程序寫死是為了災難日不用臨場拼 SQL。

## §4 產物(實作階段;今晚零產出)

| 檔 | 內容 |
|---|---|
| `supabase/migrations/20260803130000_m4b_e10_a2b1_procurement_allocation_guard.sql` | 函式 + constraint trigger + REVOKE + 檔內 fail-closed 結構驗收 + rollback/contract 註解 |
| `scripts/a2b1-verify.sh` | 本機 PG17 harness(a6 樣板):結構 + 行為 cells + 突變,三計數器釘死 |

零 `.ts/.tsx` ⇒ 三綠 = typecheck + lint。收工交接檔 = `docs/handoff/2026-08-03-nightly-a2b1-chain.md`(R2-12:落點具名)。

## §5 harness 設計

- Provision 重用 `scripts/d1t2-rehearsal.sh provision <workdir>`;身分閘三重照 a6(`a6-verify.sh:45-52`)。
- 判定原語照 a6 實檔:`case_ok`(:55)/`expect_red`(:67)/`mut_block`(:82,DB 內取代 + 三重 preflight);每案 `BEGIN…ROLLBACK`;harness 自檢先過。
- 三計數器收尾三道獨立閘;SKIP=0。
- fixture:雙 parent 異質 quantity(P5=5、P3=3);取消向量 2 = 1+1 跨兩 header;EXIT/INT/TERM trap。
- B12 用第二連線(FIFO + `pg_locks` 輪詢 barrier,照 s2c 原語)。
- 兄弟序列:`a2b1 → a6 → a2b1` 計數逐一相同、a6 維持 157/0。

### 5.1 行為 cells(v3)

| 格 | 情境 | 期望 |
|---|---|---|
| B1 | P5 單列 5 恰滿 | 過(邊界) |
| B2 | P5 單列 6 | `P2B01` + constraint name |
| B3 | P5 兩家 3+2 恰滿過;第三家 +1 | `P2B01` |
| B3b | P3 填 3 過;填 4 | `P2B01`(殺 M11) |
| B4 | 先取消 2(1+1 兩 header)→ 開 4 `P2B01`;開 3 過 | delta 本體 |
| B5 | 開滿 5 → 取消 2(INSERT 必成功)→ +1 `P2B01`;−1 過 | 不追溯三段 |
| B5d | 超量合法態只改 metadata(reply_status)必過 | 殺 M6b(`<=`→`<`) |
| B6 | UPDATE 調升界內過(正向格、不宣稱殺突變) | |
| B7 | UPDATE 換 parent 到 P3 造成超量 | `P2B01` |
| B8 | 摘要竄改雙向,守門不受影響 | C1 負測 |
| B9 | a:RR INSERT `P2B02` b:SERIALIZABLE INSERT `P2B02` c:RR 調降 UPDATE `P2B02`(gate-first;殺 M12) | |
| B10 | 兩列取消各 2147483647 後開採購 → `P2B01` 非 22003。🔴 **兩列必須跨兩個取消 header**(`UNIQUE (cancellation_id, order_item_id)`,A7 `:241-244`;同 header 插兩列會撞 unique 假紅 —— Fable R3 F6) | 殺 M5 |
| B11 | 同 parent 多列 VALUES:超 → 整句 abort;恰滿 → 過 | |
| B12 | 交易內 INSERT 後,第二連線 NKU NOWAIT → `55P03`(+結構錨合殺 M1;宣稱收斂見 §3.8⑦) | |
| B13 | a:DEFERRED 超後補 COMMIT 過 b:超不補 COMMIT `P2B01` c:**DEFERRED 超配後 `SET CONSTRAINTS … IMMEDIATE` → 當場炸**(R2-10 佇列回沖) | 三態已預實測 a/b |

### 5.2 突變(v3)

M1 拿掉 NKU 鎖(B12+結構錨)/ M2 cancelled 改讀摘要(B8)/ M3 去 `− v_cancelled`(B4)/ M4 拿掉隔離閘(B9a)/ M5 `v_cancelled` 窄化 integer(B10)/ M6 skip 全放(B5+1)/ M6b `<=`→`<`(B5d)/ M7 `>`→`>=`(B1)/ M8 tag 改名(B2)/ M9 trigger 砍 UPDATE 事件(B5+1、B7)/ M10 `P2B01` 改碼(B2)/ M11 quantity 常數化(B3b)/ M12 閘後移(B9c)+ harness 自檢突變。

## §6 驗收條件(逐條 yes/no;實作階段用)

1. from-zero provision 套完全部 migration 過、檔內 DO 驗收印通過。
2. `a2b1-verify.sh` 三計數器全中、FAIL=0、SKIP=0。
3. 突變各紅指定 cell;還原後函式 md5 = 基準。
4. 兄弟序列零污染。
5. 三綠 typecheck 0 / lint 0。
6. 關卡1 已收斂(= §9 四題 Sean 已答)+ 關卡2 codex 審 diff + code-reviewer 過。
7. 未 push;apply 前 preflight + read-back 清單載於 handoff;`database.types.ts` 預期零 diff(trigger 不改表形狀,apply 時驗證)。

## §7 rollback 與 contract 債

- down migration:`DROP TRIGGER …; DROP FUNCTION …`;下游 = A2b2/A4a/A4b/A5a(A5a 上線後單獨回滾 = 失去守門,必須同停)。名單對齊 A2 `20260729020000:670-675`。
- contract 債(migration 註解明文):①第 2 批 `shipped_quantity` 重審公式 ②第 3 批改單決定 quantity 縮小處置 ③A4a/A8a2 鎖原語同用 NKU ④多列 writer 按**完整 business key `(order_item_id, supplier_id)`** 排序,**且 deferred 交易跨 statement 的 parent 觸達順序同受此約束**(Fable R3 F4:defer 把取鎖點移到 COMMIT、排序契約只約束單 statement 的話,兩筆反向多 statement deferred 交易仍可互鎖;後果 = 40P01 fail-closed 可重試,同級揭露)⑤master plan row 28/A4a 鎖序字面修訂(C2 實況),**修訂範圍含 `:369`「真相非零但摘要列缺失 fail-closed」子句**(Fable R3 F7:直讀真相表變體使該子句語意落空,其負測意圖已由 B8 承接)⑥**死配額列膨脹 SUM(Fable R3 F3,真產品劇本)**:供應商回 `out_of_stock` 後改派第二家,原列 `allocated ≥ 1` 禁歸零、A5a 只 upsert 無 delete ⇒ 守門把死列照算、誤攔改派;方向是過度攔截(fail-closed)非放行,自然家 = 第 3 批採購退貨線(master plan `:452`「差額由第 3 批處理」),**在那之前 A10b/A12b 的 UI 文案要能解釋這種攔截**。

## §8 已定的非決策項(實作紀律,不待拍板)

防衛枝不列守門計數(§3.6)/ `tgenabled='O'` 沿 A7-t 慣例(replica 邊界揭露於 §3.8)/ 裸 CREATE + 完整 ACL allowlist(C10)/ 函式級 lock_timeout 5s(範圍誠實 §3.5)。

## §9 🔴 四題決策題(= 關卡1 收斂條件 = **實作與 apply 的硬前置**;R2-1/R2-2)

> 給 Sean 的白話:這張守門網有四個「網眼要開多緊」的選擇。我全部先選了**最緊**的版本寫進 plan(都可便宜翻案),但 codex 兩輪都堅持:這四題是資料庫對外行為的契約,要你拍了才算數。**你拍完之前,這片不寫任何 code。**

**Q1 隔離閘範圍** —— 守門只在資料庫預設模式(read committed)下才數得準。repeatable read 模式下它會**算錯而放行超量**(已實測);serializable 模式下**不會放行**(資料庫自己的防機制 SSI 會把衝突交易整筆打掉重來)—— B 的風險是「把保證外包給 SSI、我們少一層自己的」,不是放行(Fable R3 F5 更正本段白話)。
A. 【推薦=plan 現案】非 read committed 一律拒收(最緊;現在零人用其他模式,拒了不影響任何人)
B. serializable 放行、只拒 repeatable read(信任 SSI;衝突時錯誤形態是 40001 重試,不是超量入庫)
C. 不加閘(只靠文件約定;RR 下守門靜默失效 —— 不推薦)

**Q2 可否「交易內先超後補」** —— 一筆交易中途暫時超量、結束前補回來,要不要允許?
A. 【推薦=plan 現案】預設不允許、但可顯式宣告後允許(`DEFERRABLE INITIALLY IMMEDIATE`;兩態都有測試)
B. 永遠不允許(`NOT DEFERRABLE`;最緊,但「把 3 件從 A 家搬 2 件去 B 家」這種重排交易若先加後減會被擋)
C. 預設就允許(檢查全推到交易結束;錯誤訊息歸因變差 —— 不推薦)

**Q3 閘與 skip 的順序** —— 在非 read committed 模式下,連「調降採購量」這種只會更安全的動作要不要一起拒?
A. 【推薦=plan 現案】一起拒(行為統一好講清楚;反正沒人在用那些模式)
B. 調降放行(理論上安全,但同一張表在同一模式下有的動作行、有的不行,矩陣難記)

**Q4 master plan 鎖序字面修訂** —— row 28 寫「鎖序固定 order_items → procurement」,但 AFTER trigger 物理上是先碰 procurement 才鎖 order_items;且鎖原語要從 FOR UPDATE 改 FOR NO KEY UPDATE(不改會死結,已實測)。修訂範圍含 `:369`「真相非零但摘要列缺失 fail-closed」子句(直讀真相表後該子句語意落空,負測意圖由 B8 承接)。
A. 【推薦】授權把 row 28 與 A4a row 的字面改成「守門互斥靠 parent 列鎖(NKU);跨物件取鎖紀律屬 writer」
B. 保留原字面、只在 A2b1 migration 註解記差異(字面與實作長期不一致 —— 不推薦)

**各題翻非推薦選項的連動面(Fable R3 F8;拍板時參考)**:Q1=B ⇒ 改閘條件一行 + B9b 期望改「40001 或成功」+ 文件同步 / Q1=C ⇒ 砍 B9 全組 + M4/M12 + §3.4(不推薦)/ Q2=B ⇒ trigger 選項改 `NOT DEFERRABLE` + 砍 B13 三態 / Q2=C ⇒ `INITIALLY DEFERRED` + B13 重寫 + A5a 錯誤歸因設計重談(不推薦)/ Q3=B ⇒ 閘與 skip 對調 + B9c 期望翻面 + M12 改向 / Q4=B ⇒ 零 code 影響、純文件債。任一題翻案 = harness 計數器重釘 + 重跑全綠,估 30-60 分鐘。
