# A4a+A4b 片級 plan:`order_item_quantity_summary` 重算 constraint trigger 與其競態負測

> **v4 · 2026-08-03 —— 關卡1 R3(Fable adversarial-reviewer 換模型換角度)= 1 must-fix + 4 consider + 2 nit 全折後收斂**:F1 回滾 runbook 補災難分流(對帳不等→留檔以真相為準續行,abort 僅留真相表讀不到)+ 演練雙變體;F2 停寫/stale 具體化(REVOKE 佔位契約、COMMENT 標記);F3 漂移 oracle 獨立推導+自身消融;F4 R16 旗標子交易回滾格;F5 排除 harness 的「誰會發現」明寫;F6/F7 措辭與名稱序一次性債。**實作後增補(code-reviewer Fable R1 Critical 折入)**:R8d drift 判別格(旗標造 drift 後直寫 =SUM 正確值仍 P4A01 —— 殺「值比對」退化版)⇒ a4a-verify 釘數 **64/40/15**。
> **v3 · 2026-08-03 —— 關卡1 R2(codex 同模型確認輪)= NO-GO:處置稽核 13 真修/4 部分修/2 假修/1 未修 + 新 9 條(8 must-fix + 1 nit),全數折入或親驗更正**(R2-3 的「完整排序可解」被主對話反推推翻 —— 環③排序關不掉,改誠實列界;R2-1 降為措辭誠實界)。三個新事實:a7t reapply 被自家 migration 集合恰等斷言擋死 / a7t 探針 fixture 累積會提前 23514 / **a7bt 三腳本指向的 migration 已被 git rm(Q5 前提失效、moot)**。家族序跑名單重定(§7 尾)。R3 = 換模型換角度(Fable adversarial-reviewer,框架層)。
> **v2 · 2026-08-03 午后 —— 關卡1 R1(codex `gpt-5.6-sol` xhigh)= NO-GO,19 must-fix,主對話逐條親驗:折入 17、折入變體 2(F3 機制陳述駁回但改良折入、F10 前半因 BEFORE guard 改無閘設計而消解)、整條駁回 0。** findings 逐字 = `docs/reviews/2026-08-03-e10-a4a-k1-codex.md`。v1→v2 六個設計改動:
> **D1(F4/F5)**BEFORE guard 改「txn-local GUC 旗標」制 —— 拒**任何**直改 `received_quantity`(不管值對不對),旗標只由本片 sync/backfill 函式在自己的 UPDATE 前後設清;guard 不讀 SUM ⇒ 無 RR 疑慮、無閘、deferred metadata 流不誤擋。
> **D2(F19)**只有 procurement recompute trigger 是 DEFERRABLE II(與 a2b1 guard 成對、Q2=A 先例內);receipts/cancellation trigger = **NOT DEFERRABLE** ⇒ 不新開任何交易契約。
> **D3(F8/F10)**四支函式的隔離閘 tag **各自具名**(`a4a_iso_rc_procurement/_receipts/_cancellation`)⇒ 突變 kill 靠 tag 歸因、無代打假綠。
> **D4(F1/F2)**「無環」宣稱撤回:①併發**反向 re-parent**(owner-only 操作、零真 writer)存在 a2b1(鎖 NEW)×a4a(排序鎖)交叉環 = fail-closed `40P01` 可重試,誠實列界 ②多列 receipts 跨 parent 的取鎖序物理上依列序 ⇒ writer 契約(按 parent `order_item_id` 排)+ fail-closed。
> **D5(F6)**backfill 同時修復 `received_quantity` drift(走旗標路徑)再重算摘要。
> **D6(F16)**回滾演練的「依賴清零」不再宣稱 pg_depend 可證(plpgsql body 依賴不入 catalog):改為 ①pg_trigger 枚舉四支 trigger 歸零 ②授權時 repo-grep 消費端清單寫死在 runbook ③演練含反例:trigger 在位時 DROP 表 → 下一筆 DML `42P01`(證明順序承重)。
> v1 · 2026-08-03 午后 · 施工視窗①(worktree `a4a-chain`,基底 dev `36cb453`)。
> 片型:A4a = **T / 高風險片**(鐵則 12③:動 DB trigger + 錢相關衍生資料);A4b = 標準片(純本機 harness,零 migration、零 .ts)。
> 授權:Sean 08-03 兩施工視窗照模板放行(`36cb453` handoff);A2b1 鏈既定事項三件(nightly handoff 終章 `:79`)。
> 紅線:絕不 apply、絕不 db push、不 push、不動 STATUS/CURRENT、不碰 .env\*;commit 落 `a4a-chain`。

---

## §0 鏈上位置與上游狀態

- 權威 = master plan §5.1 **row 30(:372-377)/ row 31(:378)**;DAG §5.0 `:256`(`A4a 重算 trigger (T) → A4b 競態負測+漂移 assert (T)`)。
- 鏈狀態:`A2b1 ✅ → A2b2 ✅ → A4a(本片)→ A4b(本鏈第二片)→ A5a`。
- 上游 migration:🔀 **v2 更正(R1-18)**:`20260803130000`(A2b1)**已 apply 正式站**(CURRENT.md:5 逐字「A2b1 migration 已 apply 正式站」,推翻 nightly handoff 的舊字面)⇒ 本片 `20260803140000` 是**單獨一支**待 apply migration(dry-run 清單應恰一支)。本機 harness 由 `d1t2-rehearsal.sh provision` 從零重放全部 migration。
- A4a 開工三件既定事項(nightly handoff 終章):①三表掛 trigger、鎖原語同 NKU(master plan A4a row 已改)②關閉契約債⑥後把 a2b2 S5 期望翻紅 ③A1 §9 回滾演練 = DoD 硬前置(master plan `:373-377`)。

## §1 目標(擋掉哪個具體的錯)

1. **摘要表無人維護**:A1 建了 `order_item_quantity_summary` 但零 writer —— 三個計數器永遠是「無列」;A9c/A11 上線後員工看到的到貨/取消數恆 0。A4a = 唯一 writer(惰性建列,「RPC 記得呼叫」= 第二真相,row 30 R5)。
2. **`received_quantity` 無人維護**(A2 合約債③,`20260729020000:129-136`):receipts 明細與 parent 累計欄物理上可以對不起來 ⇒ 員工據虛增數字通知客人「到貨」。A4a 驗收必含:①receipts INSERT 重算 parent ②重算違反 `received_range` CHECK 時整筆 RAISE。
3. **「只 INSERT receipt」不觸發任何重算**(row 30 R3):只掛 procurement 的話 `instock_quantity` 永遠 0。⇒ receipts 表必掛,且必有「移除該 trigger」突變。
4. **惰性建列的遺失更新競態**(row 30 codex 關卡2 2026-07-31):採購與取消同時首次建列,後寫者把另一軸覆蓋成 0、七條 CHECK 全過。⇒ 鎖 parent NKU 後才重讀真相並 upsert;雙連線負測 = A4b。
5. **契約債⑥的取消側窗口**(A2b1 migration 註解;a2b2 S5 實證為真):取消寫入不取 parent 鎖 ⇒ 「取消未提交 + 採購滿額過」交錯滑過 delta 守門。A4a 對 `order_cancellation_items` 掛同一把 NKU = 關窗;S5 期望翻紅 = 內建提醒兌現。

## §2 親讀契約(本 session 親驗,檔案:行號)

| # | 契約 | 來源 |
|---|---|---|
| K1 | 三表 AFTER I/U/D、同交易重算摘要;先 `FOR NO KEY UPDATE` 鎖 parent 才重讀來源並 upsert(Q4=A 原語) | master plan `:372` |
| K2 | DoD 硬前置:摘要表有真實資料時的回滾程序寫出並演練(六步:停寫停守門→保存對帳→逆序撤消費端→移除 trigger→由真相重算→切換;依賴未清零不得 DROP);無鎖版本必須先被消融證明會壞 | master plan `:373-377`;A1 plan §9 `:383-389` |
| K3 | `received_quantity` 真相 = receipts SUM;寫入端只准 INSERT 明細、不准直接寫本欄;「A4a 落地後直寫會被擋」 | A2 `:118-119,:129-136,:611-613` |
| K4 | receipts 無冪等鍵,冪等責任在未來 writer(非本片) | A2 `:137-143` |
| K5 | 摘要表七條 CHECK(C1-C7 名稱凍結)+ 複合 FK `ON DELETE CASCADE`(quantity 釘死、刪品項連帶刪摘要) | A1 `20260730150000:91-124` |
| K6 | 守門(A2b1/A8a2)不得讀摘要;摘要只准顯示路徑與純 SQL 消費端 COALESCE | master plan A1 row `:361` |
| K7 | 取消明細:`cancelled_quantity > 0` 刻意無上限,「真正的上界 = A1 CHECK + A4a 重算 + A8a2 守門」—— **本片就是把那個上界啟用的那一片** | A7 `20260730130000:215-223,:260-262` |
| K8 | 取消明細 UNIQUE `(cancellation_id, order_item_id)`;跨 header 可累積 | A7 `:241-244` |
| K9 | receipts:`quantity BETWEEN 1 AND 100000`、FK→procurement RESTRICT、append-only 由 ACL 保證(所有 role 零寫 GRANT) | A2 `:190-236` |
| K10 | A2b1 guard trigger = `order_item_procurement_allocation_guard_ac`(DEFERRABLE II);同表 AFTER trigger **按名稱序發火** ⇒ 本片 trigger 命名必須排它之後(錯誤歸因 + B10 可達性都靠這條) | A2b1 migration + PG 文件 |
| K11 | 隔離閘 P2B02(Q1=A):RR 下鎖後 SUM 看不到兄弟提交(A2b1 實測)—— 重算在 RR 下會**靜默寫入過時摘要**,同病根 | A2b1 plan §3.4;memory `project_m4b-a2b1-guard-decisions` |
| K12 | DEFERRABLE INITIALLY IMMEDIATE(Q2=A);「先超後補」交易自 A4a 起必須 defer 兩支(見 §7-B13) | A2b1 plan §3.1 |
| K13 | 函式慣例:裸 CREATE、SECURITY DEFINER、search_path、函式級 lock_timeout 5s、完整 ACL allowlist | A2b1 plan §3.7 / A7-t `:388-404` |
| K14 | A5a(未來 writer)不重複實作摘要重算;A8a1/A8a2 鎖序 = 先 `orders FOR UPDATE`(在 order_items 之前,無環) | master plan `:379,:383` |

## §3 設計

### 3.1 物件清單(四 trigger、四函式 + 一核心 helper)

| 物件 | 表/事件 | 形狀 |
|---|---|---|
| `order_item_procurement_received_quantity_guard_bt` → `pcm_a4a_received_quantity_guard()` | procurement **BEFORE** INSERT OR UPDATE | 🔀 **v2 D1(R1-4/R1-5)旗標制**:INSERT 時 `NEW.received_quantity <> 0`、或 UPDATE 時 `NEW.received_quantity IS DISTINCT FROM OLD.received_quantity`,且 txn-local GUC `pcm_a4a.received_sync` 未設 → RAISE `P4A01` USING CONSTRAINT `a4a_received_quantity_machine_maintained`。**值寫對也擋**(真「禁止直寫」);不讀 SUM ⇒ 無隔離疑慮、無閘;metadata-only UPDATE 不受影響。BEFORE 不能是 constraint trigger = 一般 trigger |
| `order_item_procurement_summary_recompute_zc` → `pcm_a4a_procurement_summary_recompute()` | procurement AFTER I/U/D,CONSTRAINT **DEFERRABLE II**(唯一 deferrable,與 a2b1 guard 成對 = Q2=A 先例內) | 閘(tag `a4a_iso_rc_procurement`)→ 對 NEW(/OLD,re-parent 時兩個、uuid 排序)呼叫核心重算 |
| `order_item_procurement_receipts_received_sync_ac` → `pcm_a4a_receipts_received_sync()` | receipts AFTER I/U/D,CONSTRAINT **NOT DEFERRABLE**(v2 D2) | 閘(tag `a4a_iso_rc_receipts`)→ `FOR NO KEY UPDATE` 鎖 procurement 列(NEW/OLD.procurement_id,雙側時排序)→ 重算該列 received SUM → 設 GUC 旗標 → `UPDATE … SET received_quantity` **僅在 IS DISTINCT 時** → 清旗標(→ 級聯觸發 proc trigger 完成摘要重算;received_range CHECK 在此 UPDATE 當場擋超收 = K3②) |
| `order_cancellation_items_summary_recompute_ac` → `pcm_a4a_cancellation_summary_recompute()` | cancellation_items AFTER I/U/D,CONSTRAINT **NOT DEFERRABLE**(v2 D2) | 閘(tag `a4a_iso_rc_cancellation`)→ 鎖 parent → 核心重算(= 關閉契約債⑥的那把鎖) |
| `pcm_a4a_recompute_order_item_summary(p_order_item_id uuid)` | helper(非 trigger) | `SELECT quantity … FROM order_items WHERE id=$1 FOR NO KEY UPDATE`(NOT FOUND=防衛枝)→ 三 SUM 全打真相表(bigint 變數)→ `INSERT … ON CONFLICT (order_item_id) DO UPDATE` |

三 SUM 真相直讀(不經 `received_quantity` 累計欄):`ordered = SUM(procurement.allocated_quantity)`、`instock = SUM(receipts.quantity) JOIN procurement`、`cancelled = SUM(cancellation_items.cancelled_quantity)`。`received_quantity` 即使有 bug,摘要仍對(且 C5 `instock<=ordered` fail-closed 兜底)。

### 3.2 函式邏輯全序(每支 trigger fn,gate-first)

```text
① 隔離閘:transaction_isolation <> 'read committed' → RAISE P2B02
   USING CONSTRAINT = 該函式自己的 tag(🔀 v3 R2-2 更正:逐表具名
   a4a_iso_rc_procurement / _receipts / _cancellation,與 §3.1 物件表一致;
   generic 單一 tag 字面作廢)
② 求受影響 parent 集合(TG_OP 分派;UPDATE 換 parent = 兩個,uuid 排序取鎖防互鎖)
③ 每個 parent:核心 helper(鎖 NKU → 三 SUM → upsert)
```

(v3 R2-2 補、v4 R3-F6 措辭修:procurement 側的閘在 **immediate 路徑下**的 INSERT/UPDATE 事件被 a2b1 閘搶先(名稱序;交易單獨 defer a2b1 guard 時 I/U 亦可達本閘)⇒ kill cell 的穩定可達路徑 = **DELETE**(a2b1 未掛 DELETE);R9-procurement cell 與 N6-procurement kill cell 都用 RR 下 DELETE 構造。)

### 3.3 級聯與遞迴終止分析

receipt 事件 → 鎖 proc 列 → UPDATE received_quantity → 該 UPDATE 觸發:
(a) BEFORE guard:SUM 相符 → 過;(b) A2b1 guard:skip 枝(allocated 未升)→ RETURN NULL;(c) A4a proc trigger:重算摘要(值已由誰算都一樣,冪等)。proc trigger 自身不寫 procurement ⇒ **深度 2 終止**。SUM 不變(如只改 received_at)→ IS DISTINCT 擋掉 UPDATE → 零級聯(instock 也不變,一致)。

### 3.4 鎖面與死結分析(🔀 v2 D4:「無環」宣稱撤回,改誠實環清單)

- 主取鎖序:`orders`(A8a 系,未來)→ `order_item_procurement` → `order_items`。receipts 路徑 proc→parent;proc 路徑 DML 已持 proc tuple 鎖→parent;cancel 路徑直接 parent。
- **已知環①(R1-1 抓)併發反向 re-parent**:a2b1 guard 先鎖 NEW parent(不排序)、a4a 再排序鎖雙 parent ⇒ T1(A→B)持 B 等 A、T2(B→A)持 A 等 B = `40P01`。**不修**:re-parent 是 owner-only 操作(A5a 只 upsert 固定鍵、零真 writer),PG 偵測 abort 一方 = fail-closed 可重試;修法需動已 apply 的 a2b1 函式,不成比例。
- **已知環②(R1-2 抓)多列 receipts 跨 parent**:row trigger 依列序鎖 parent、物理上不可排序 ⇒ 與反向順序的 cancellation 多列 writer 可互鎖。⇒ **writer 契約**(migration 註解明文):多列 receipts 寫入按 **完整序 `(order_item_id, procurement_id)`** 排(🔀 v3 R2-3 補全);cancellation 多列 writer(A8a1/A8a2)同(A2b1 契約債④同組)。違約後果 = `40P01` fail-closed 可重試,非資料錯。
- **已知環③(v3;R2-3 抓、主對話反推更正其修法)**:同 parent 雙 proc 列 —— T1 多列 receipts 觸 P1+P2(row1 鎖 P1→parent、row2 要 P2),T2 單列 receipts 觸 P2(鎖 P2→等 parent)= 互等。🔴 **排序契約關不掉這條**(T2 只碰 P2、本來就「有序」;成環主因 = T1 先持 parent 再回頭要更多 proc 列,per-row trigger 物理上無法先知全集)。改鎖序 parent-first 又與 procurement DML tuple 鎖(先於 trigger、不可控)反向 ⇒ 兩難無解。⇒ 誠實列界:`40P01` fail-closed 可重試;writer 建議 = 同 parent 的多筆到貨盡量單列 statement 或逐筆小交易。
- receipts 對 proc 列取 **NKU 而非 FOR SHARE**:兩筆併發 receipt 同 proc 列若都拿 SHARE、再各自升級 UPDATE = 鎖升級死結(A2b1 R1-1 同型);NKU 直取 = 序列化零升級。NKU 與 re-parent UPDATE 的 tuple 鎖(NKU)互斥 ⇒ 同時關掉「讀到過時 parent、重算漏單」的競態窗(讀 procurement_id 在鎖後)。

### 3.5 CHECK 網的啟用(對外行為變化,誠實列全)

本片 apply 後,以下寫入從「成功」變「被擋」,錯誤形狀 = `23514`(A1 具名 CHECK)或 `P4A01`:

| 動作 | 之前 | 之後 | 依據 |
|---|---|---|---|
| 取消合計 > quantity | 成功(A7 刻意無上限) | 23514 `oiqs_cancelled_le_quantity`/C7 | K7:設計上就是本片啟用這個上界 |
| 到貨後取消到 instock+cancelled > quantity | 成功 | 23514 C7 | Q17=B「已到貨不可取消」的 DB 層體現 |
| receipts 合計 > allocated | 成功(等式無強制) | 23514 `order_item_procurement_received_range` | K3② |
| 直寫 received_quantity(不論值對錯) | 成功 | P4A01 | K3「會被擋」逐字;🔀 v3 R2-1 誠實界:旗標 = **同權能行為者的路徑判別**(區分 sync 路徑 vs 手滑/繞路),非不可偽造能力 —— 能設旗標者(owner/SECDEF)本在天花板之上(§3.7①,A7-t 同級) |
| RR/SERIALIZABLE 下寫三表 | 成功 | P2B02(tag 依表各自具名,v2 D3) | K11,Q1=A 先例延伸 |
| quantity=INT_MAX 品項,取消累計跨過 INT_MAX(v2 補,R1-7) | 成功 | **22003**(bigint SUM 指派給 integer 摘要欄,先於具名 CHECK)| fail-closed 但歸因是原生溢位;病理邊界、誠實列出 |

正式站三張來源表全 0 列 ⇒ apply 當下零既有資料受影響;受影響者只有未來 writer(全部尚未建)。

### 3.6 migration 檔內容(`supabase/migrations/20260803140000_m4b_e10_a4a_quantity_summary_recompute.sql`)

函式×5 + trigger×4 + REVOKE/ACL + **防禦性 backfill**(🔀 v2 D5:先逐 proc 列走旗標路徑修復 `received_quantity` = receipts SUM,再對三表現存 parent 逐一重算摘要 —— 正式站 0 列 = no-op,但「先有資料/先有 drift 再 apply」的世界也正確)+ 檔內 DO fail-closed 結構驗收(tgtype/deferrable/enabled/proconfig/ACL/**名稱序斷言**:同表 constraint trigger 中 a2b1 guard 名 < 本片名/🔀 v2 R1-17 補、v3 R2-8 更正:**函式 owner = 五張表 owner 對齊** + 五表 `relforcerowsecurity=false`(order_items + procurement + receipts + cancellation_items + summary —— 核心函式實際讀寫五表),照 a2b1 migration `:281,:292` 兩層)+ **翻面版 A2 誠實負測**(受 K3 `:613` 指示:在本片 DO 內斷言「receipt INSERT 後 parent received_quantity 已被維護」+「直寫被 P4A01 擋」;**不改已 apply 的 A2 檔** —— 漂移守門紅線,意圖由本片 DO 承接)+ rollback/contract 註解。
break-glass(A2b1 §3.9 同形):單一交易 DISABLE→修資料→ENABLE→重驗 DO→COMMIT,完整 SQL 寫檔頭。

### 3.7 誠實邊界

①owner/superuser DISABLE TRIGGER、replica mode 可繞(A7-t 同天花板;GUC 旗標同理 owner 可手設 —— 天花板之上)②TRUNCATE 三表不觸發 row trigger:cancellation 有 A7-t 攔;procurement/receipts 零寫 GRANT、僅 owner 可為 —— 不加攔截、列契約債 ③`order_items.quantity` 改動:摘要列存在時被複合 FK 物理擋下(NO ACTION);無摘要列時不觸發重算 —— 第 3 批改單片契約債(A2b1 債②同組)④🔀 **v2 更正(R1-7)**:~~bigint 溢位不可構造~~ 錯 —— quantity=INT_MAX 品項可讓取消累計跨過 int4 上限,錯誤形狀 = 22003 指派溢位(先於具名 CHECK);fail-closed 但歸因不佳,病理邊界(quantity 實務 ≤ 十萬級)⇒ 變數紀律照 bigint、harness 補一格邊界 pin(R15)、不另發明防護 ⑤`27 項驗收貢獻 = 0`(資料層)⑥摘要被 owner 直接竄改後、下一次來源表事件才自癒;事件之間的讀者看到假值 —— 顯示層固有天花板(守門本來就不讀它,K6)⑦(v2 補)已知死結環兩條見 §3.4,皆 fail-closed 可重試。

## §4 產物

| 檔 | 內容 |
|---|---|
| `supabase/migrations/20260803140000_m4b_e10_a4a_quantity_summary_recompute.sql` | §3.6 |
| `scripts/a4a-verify.sh` | 結構 + 行為 cells + 突變(a2b1 樣板、d1t2 provision、port 54329、LC_ALL=C) |
| `scripts/a4a-rollback-rehearsal.sh` + `docs/runbooks/a4a-summary-rollback.md` | §6(DoD 硬前置) |
| `scripts/a4b-concurrency-probe.sh` | §8(A4b 片) |
| 兄弟修訂:`scripts/a2b1-verify.sh` / `scripts/a2b2-concurrency-probe.sh` / `scripts/a7-behavior-probe.sql` / `scripts/a7t-behavior-probe.sql` / `scripts/s1b-verify.sh` | §7(逐格連動,Sean 拍板後動;s1b/a7t 為實作期追加,見 §7 表尾兩列) |

## §5 a4a-verify harness 設計(✅ 實作完成;釘死計數 = **TOTAL 65 / CELL 40(A11+B29,執行推導)/ MUT 10(真突變逐次執行計數)/ SKIP 0** —— 🔀 演進:63 → +R8d(code-reviewer Critical)= 64 → +H4b 刪列向 oracle 消融、MUT 改執行計數(codex K2-1/K2-3)= 65/40/10;回滾演練 19/19、a2b1 修訂後 69/0、a2b2 修訂後 37/0、a7 探針 36/36、a7t 探針 12/12、s1b 48/0)

判定原語照抄 a2b1(`case_ok`/`expect_guard`/`mut_block` 三重 preflight/身分閘五重/EXIT trap/BEGIN…ROLLBACK 零留痕)。fixture:雙 parent(P5=5、P3=3)+ 一列 procurement(alloc 3)供 receipts 掛。

行為 cells(草案):
R1 採購 INSERT → 摘要列惰性建立(三軸+quantity 逐值)/ R2 **只 INSERT receipt** → received_quantity 與 instock 同步(row 30 指定案例)/ R3 分兩批到貨累計正確;第二批超 allocated → 23514 `received_range` 整筆 abort(K3②③)/ R4 取消 INSERT → cancelled 重算 / R5 採購 UPDATE 升降 → 摘要跟動 / R6 三表 DELETE 各自回算 / R7 換 parent UPDATE → 兩側摘要皆正確 / R8 直寫 received_quantity:**任何改動皆 P4A01**(v2 D1;v4 實作字面校準:等值 no-op 寫入無語意效果、旗標制刻意放行 —— R1-4 的洞是「drift 下寫 SUM 值滑過」,改動判定已封死)、INSERT 帶非 0 P4A01、metadata-only UPDATE 過 / R9 RR+SERIALIZABLE 對三表寫入各 P2B02(**tag 逐表精確**,v2 D3)/ R10 DID:defer 兩名(guard+proc recompute)「先超後補」COMMIT 過;不補 COMMIT 紅在 **P2B01**(名稱序歸因)/ R11 超量取消 → 23514(§3.5 啟用證明)/ R12 摘要竄改後下一事件自癒 / R13 漂移 oracle:混合活動後全表掃描三等式(= A4b 重用的函式;🔀 v4 R3-F3:**oracle SQL 獨立推導** —— 逐軸 correlated subquery,不重用 helper 的 JOIN 形狀,防「兩邊等錯恆綠」;**oracle 自身配一格消融**:竄改摘要 → oracle 必紅,紅不了 = harness 自檢 FAIL)/ R14 B12 同型:交易內 receipt 持 parent NKU,第二連線 NOWAIT 55P03 / R15(v2 R1-7)INT_MAX 邊界 pin:quantity=INT_MAX、取消跨過上限 → 紅在 22003(釘死錯誤形狀,cell 內停用取消 trigger 建 fixture 後還原)/ R16(🔀 v4 R3-F4)sync abort 後旗標零殘留:同交易內先觸發超收 23514(savepoint 接住)→ 直寫 received_quantity → 仍 P4A01(依賴「GUC 隨子交易回滾」語意 —— 本 session 已實測 AFTER_CAUGHT_EXC=CLEAN;migration 註解言明此依賴)。

突變(草案;各紅指定 cell):
N1 DISABLE receipts trigger → R2(row 30 指定突變)/ N2 重算去 cancelled 軸 → R4 / N3 核心去 NKU → R14+結構錨(行為級消融 = A4b SA2)/ N4 receipts sync 去 UPDATE → R2+R13 / N5 BEFORE guard 改動判定弄恆假 → R8a(🔀 v4 字面校準:N5 殺的是「判定失效」;「值比對」退化版由 **R8d drift 判別格**殺 —— 旗標造 drift 後直寫 =SUM 正確值仍 P4A01,code-reviewer R1 Critical)/ N6 隔離閘逐支拿掉 ×3 → R9 對應表的格(**kill 靠各自 tag,無代打**,v2 D3/R1-8)/ N7 trigger 事件剪枝(去 DELETE)→ R6 / N8 upsert 改只 INSERT(不 DO UPDATE)→ R5 / + harness 自檢突變。覆蓋率分母 = 四支 trigger + 五支函式,由結構格 A1-A11 逐名枚舉 + 突變逐格對應;🔀 v4 誠實列界(code-reviewer Minor):**無「每物件至少一突變」的機械閘**,分母核對靠本節清單與 review 人工比對。

## §6 回滾演練(DoD 硬前置;master plan `:373-377` 六步逐一落地)

`docs/runbooks/a4a-summary-rollback.md` = 摘要表已有真實資料時的程序(全名、可複製 SQL;🔀 v4 R3-F1/F2 重寫兩步):
①停寫停守門 —— **具體形式(F2)**:今日 = 三表零寫 GRANT、無 writer RPC ⇒ 本步為 no-op 佔位 + **A5a 上線時必須回寫本 runbook 補 `REVOKE EXECUTE` 具體 SQL**(契約行);本機演練 = 單一交易 ②保存摘要快照 + 對帳 —— 🔴 **對帳分歧不是 abort 是分流(F1:災難日的正典輸入就是「摘要壞了」)**:相等 → 直行;**不等 → 逐列記錄差異(快照表留檔)→ 以真相重算為準續行**,abort 只留給「真相表自身讀不到」;abort 路徑附守門 re-enable 指令(不留 trigger 停用殘態)③逆序撤消費端 —— 🔀 **v2 D6(R1-16)**:~~pg_depend 實查~~ 不可行(plpgsql body 的表引用不入 catalog、trigger 掛在來源表非摘要表)⇒ 改三層:(a)`pg_trigger` 枚舉本片四支 trigger 必須歸零才准 DROP 表(b)runbook 內寫死授權時 repo-grep 的消費端清單(今日 = 僅本片;A9c 等未來消費端上線時**必須**回寫本 runbook,PostgREST select 字串對 DB 完全不可見)(c)演練含反例:trigger 在位時 DROP 表 → 下一筆來源 DML `42P01` → 還原(證明順序承重、DROP 不會被 DB 自己擋)④DROP 本片四 trigger + 五函式(= A4a 單獨回滾終點;摘要表凍結保留、**stale 標記 = `COMMENT ON TABLE` 寫明「A4a 已撤、值凍結於 <時點>、不得信任」**——dashboard 看得到的具體承載,F2)⑤由真相重算驗證:凍結值 = 真相,**或已依②分流記錄差異並以真相為準**(F1 連動)⑥若續走 A1 §9 全回滾:依賴已清零 → `DROP TABLE` + 撤 UNIQUE 才合法;演練含 forward 重上(重放 A1+A4a)→ backfill 重建 → 漂移 oracle 綠。
`scripts/a4a-rollback-rehearsal.sh` 對 provisioned harness 實跑上述全序、逐步斷言,**且必含兩個變體(F1)**:(a)健康資料直行 (b)**先竄改摘要製造 drift → 分歧分流真的走到、差異真的留檔、續行到終點** —— 災難分支被演練過才算演練。**演練綠 = A4a 收工條件之一,先於 commit**。

## §7 兄弟 harness 連動矩陣(A4a 落地使既有格的可達性/期望改變;**測法變更,§9 問 Sean**)

| 格 | 現況 | A4a 世界 | 提案 |
|---|---|---|---|
| a2b1 B10(兩筆 int-max 取消殺 M5) | 取消可插 | 首筆即紅 23514(CHECK 網)⇒ 格不可構造 | cell 內 `ALTER TABLE … DISABLE TRIGGER`(本片取消 trigger;BEGIN…ROLLBACK 內、零留痕)—— 保留 M5 判別力;同時兼作名稱序行為 pin(若序錯會紅在 22003/23514) |
| a2b1 B13a/b/c(DID 三態,單名 defer) | defer guard 即可 | A4a immediate 先紅 23514 C4 ⇒ 三格全破 | `SET CONSTRAINTS` 帶**兩個名字** —— 這同時就是未來 writer 的真實生產契約,寫進兩片 migration 註解 |
| a2b1 M1(committed 去 NKU + B12 觀察翻面) | 鎖消失可觀察 | A4a proc trigger 仍鎖 parent ⇒ 翻面觀察不到、M1 假紅 | M1 情境內 committed DISABLE 本片 proc trigger(沿用 M1 既有還原紀律 + enabled 斷言) |
| a2b1 M12(B9c 翻面 = 「無錯誤」) | RR 調降不再紅 | A4a 自己的 P2B02 仍紅 ⇒ 翻面判定失義 | 翻面斷言改「**紅但 tag = a4a 的**」(SQLSTATE 同、CONSTRAINT_NAME 異 = mutant 生效的精確證據) |
| a2b1 B8(摘要竄改雙向;v2 R1-9) | 摘要列不存在,cell 直接 INSERT 假列 | 取消 fixture 已讓 A4a 建列 ⇒ INSERT 撞 23505 | B8 改 **UPDATE 竄改**(列已在)+ 保留 DELETE 方向;斷言不變(守門不受竄改影響) |
| a2b1 M2(guard 改讀摘要 ⇒ B8 翻面;v2 R1-9) | 摘要缺列 ⇒ mutant 讀 0 放行 | 摘要被 A4a 維護正確 ⇒ mutant 讀到真值、不翻面 | M2 的 setup 在取消 fixture 後**先 UPDATE 竄改摘要 cancelled→0** 再攻擊 ⇒ mutant 讀假值放行 = 翻面可觀察 |
| a2b1 M4(拿掉 a2b1 隔離閘 ⇒ B9a 翻面;v2 R1-10) | RR INSERT 不再紅 | A4a proc 閘仍 P2B02(a4a tag)⇒ 不翻面 | 翻面斷言改 tag 區分(同 M12 修法) |
| a2b1 M5(v_cancelled 窄化 ⇒ B10 改紅 22003;v2 R1-11) | setup 可插 int-max 取消 ×2 | setup 首筆即紅 23514 | setup 內 DISABLE 本片取消 trigger(交易內、ROLLBACK 還原);attack 端 guard 名稱序先發火 ⇒ 22003/P2B01 判定不變 |
| a2b1 M6/M9/M11(mutant 應「放行」;v2 R1-11) | 放行 = 無錯誤 | A4a 重算 → C4 23514 攔下 ⇒「放行」觀察不到 | 翻面斷言 = **精確 `23514` + CONSTRAINT_NAME = `oiqs_ordered_le_quantity`**(🔀 v3 R2-7 加嚴:「非 P2B01」太鬆,語法錯/ACL 錯都會被誤判成翻面);= guard 讓位、第二張網精確接手的唯一形狀 |
| a2b2 S3(guard 消融 → 超量真的發生) | 唯一防線是 guard 鎖 | C4 CHECK 第二張網攔下 23514 ⇒「超量入庫」造不出來 | 消融段同時 committed DISABLE 本片 proc trigger(隔離受測物 = guard 的鎖),還原後雙雙 re-enable + md5/enabled 斷言 |
| a2b2 S5(契約債⑥窗口實證,期望 = 超量成立) | 洞存在 | 取消 INSERT 取 parent NKU ⇒ B 被擋、A commit 後 B 紅 P2B01 | **期望翻紅**(既定事項②,Sean 已拍):S5 改斷言「B 阻塞於 A(`pg_blocking_pids`)→ A commit → B P2B01 → 終態無超量」 |
| a7-behavior-probe 探針 25(大數量 1000000 讀回)+ 探針 32 後半(`:548-550` 斷言取消 SUM **可** > quantity = 證無上限) | 無上限可插、超量態可成立 | 25 紅 23514(fixture quantity 小);32 的「SUM > quantity」狀態不可構造 ⇒ 恆紅 | 25 = fixture 該品項 quantity 提為 **1000001**(🔀 v4 字面校準:1000000 的取消要落在數量**之內**,恰等會讓探針 32 的 +2 攻擊構造不出「跨過上界」;單價/金額歸零滿足 line_balances)(斷言原文不動,反 clamp 判別力保留);32 後半 = **語意翻面且必須真打**(🔀 v3 依 R2 Q2 意見加嚴):實際執行一次超量取消攻擊、精確斷言 `23514` + `oiqs` constraint name,不是只改敘述 —— 探針 32 自己的錯誤訊息 `:545` 逐字預告「依 A4a 重寫」,本次兌現 |
| a7t-verify reapply(🔀 v3 R2-4,主對話親核 migration `:267-291`) | 可重放 A7-t | migration 檔內 DO 斷言兩表 trigger **名稱集合恰等**(恰 2 支)⇒ A4a 取消 trigger 在場時 reapply 必炸,且不可改已 apply 的 migration 檔 | **排除出家族序跑**(同 a7-verify 待遇、Q4=A 同類);a7t 行為覆蓋改 standalone 跑 `a7t-behavior-probe.sql`;⚠️ 附帶記債:a7t 的「集合恰等」斷言把該表 trigger 集合凍死 ⇒ **任何**後續片在取消表掛 trigger 都會讓 reapply 失效,A7 線要重新設計 reapply |
| a7t-behavior-probe fixture(🔀 v3 R2-5,主對話親核 `:112-118,:148-155,:232-239`) | 品項 qty=2、跨案例累積取消可到 3 | A4a 重算 → C6/C7 23514 在 setup 提前炸 | fixture 三品項 qty 全提 **100**(🔀 v4 字面校準:原寫「10 級」,實作取 100 讓跨案例累積有寬裕頭寸、line_total 依平衡重算;逐案例核不破壞既有語意)—— **與 Q2=A 同形**(fixture 適配、斷言不動),事後回報制 |
| ~~a7bt×3~~(🔀 v3 R2-6,主對話親核 `a7bt-negative-state.sh:58` + `ls migrations` 0 命中) | §7 v2 曾列入家族序跑 | **三支腳本指向的 `20260731120100_m4b_e10_a7b_t_refund_job_guards.sql` 已被 git rm(A7c 換路)⇒ 今日本來就跑不動**,與 A4a 無關 | 排除出家族序跑、記債歸 A7c 線;**Q5 前提失效 ⇒ 該題 moot**(C3/C5/C7 停 trigger 手法留檔,A7c 重建 T 線時取用) |
| a7-verify reapply(v2 R1-12/13;**主對話已實測**) | 宣稱可重放 A7 | **與 A4a 無關、今日已壞**:`DROP order_cancellations` 被 A7b `orj_cancellation_fk` 擋(交易內試探實錘),錯誤又被 `2>&1 >/dev/null` 吞掉;即使修好,reapply 也會刪掉 A4a 取消 trigger 不重建 | **不納入本片家族序跑**(既有 harness 債,修它 = A7 線範圍);a7 行為覆蓋改為 standalone 跑 `a7-behavior-probe.sql`(自建 `pcm_a7_probe_allowed` 標記),探針 25/32 依上列修訂 |
| a7t-verify reapply 計數(v2 R1-14) | 斷言 n=6(4 trigger+2 函式) | A4a 取消 trigger 使 n=7 → 硬 exit | 期望改 7 + **具名 allowlist**(A4a trigger 名字寫死,不是裸 +1) |
| a7bt-negative-state C3/C5/C7(v2 R1-15) | fixture 靠「超量取消形狀合法」(C3 註解逐字引 A7 `:215-219` 無上限) | fixture 階段先紅在 oiqs 23514,到不了受測退款守門 | fixture 段 cell 內 DISABLE 本片取消 trigger 塑形 → 攻擊面(refund 表寫入)不觸 A4a ⇒ 受測守門原樣可達;逐格重跑驗證 |
| a1 / a6 | 寫入面已盤點 | 預期不破(a1 只直寫摘要)| 不改;全家族序跑驗證,任何紅 = 停下逐格分析,不盲改期望 |
| s1b(🔀 v4 增補;原列「不改」的字面已為假,code-reviewer Important)| 借 d1t2 seed 品項當 fixture(41 筆全 qty=1) | **a2b1(08-03 晨)落地起既有債**:拆兩家 1+1 與 business_key 突變攻擊被 P2B01 先擋(s1b 從不在 a2b1 家族名單、無人發現);家族序跑抓到 | 自建 qty=5 fixture 訂單(仍為真 FK 目標)+ trap 清除;**全部斷言原文不動** = Q2=A 同形 fixture 適配 |
| a4a-rollback-rehearsal ↔ s1b 交互(🔀 v4 增補,家族序跑實錘)| — | 演練 forward 重放 A1 會把 S1b 修訂過的採購表 COMMENT 蓋回 A1 版 ⇒ s1b 註解斷言紅 | 演練快照 `obj_description` → forward 後還原+回讀斷言;runbook §6 記為 A1 重放已知蓋寫 |

收尾零污染紀律(🔀 v3 家族名單更正):`a4a → a2b1 → a2b2 → a7-behavior-probe(standalone,修訂版)→ a7t-behavior-probe(standalone,修訂版)→ s1b → a1 → a6 → a4a(再一次)` 全序跑(共用 port 54329 ⇒ 一律序跑、不併行),計數器逐一比對釘死值。排除名單與理由:a7-verify(reapply 被 A7b FK 擋、07-31 起既有壞損)/ a7t-verify(reapply 被自家 migration 集合恰等斷言擋)/ a7bt×3(migration 已 git rm)—— 三者皆與 A4a 無關、記債歸 A7/A7c 線。🔴(v4 R3-F5,「縮驗證面前先答誰會發現」總閘)排除期間 **A7/A7-t 守門的突變級覆蓋歸零**:A7-t 四支 trigger 若被弄壞,唯一發現者 = standalone probe 的正向格與 from-zero provision 的檔內 DO —— 此降級明寫進兩處記債,A7 線重建 reapply 時恢復。

## §8 A4b 片(row 31;✅ 實作完成 `scripts/a4b-concurrency-probe.sh` = **33/0、CELL 6、MUT 2**(🔀 codex K2-2 補 SA3b:committed 去 sync 的 proc NKU → 終態 received=1≠3 —— barrier 可被 tuple 鎖代打,承重只能由終態證明);SA2 消融實錘 = 無鎖版終態 (0,0,1) 覆蓋 A 的 ordered、SA2b 純對照 4→2;K2 修法後八支重跑全綠 + 終輪家族序跑,結果見 §10-4)

`scripts/a4b-concurrency-probe.sh`(FIFO 雙 session + `pg_blocking_pids` barrier,照 a2b2 原語、同 provisioned workdir、七道身分閘):

| 情境 | 內容 | 期望 |
|---|---|---|
| SA1 遺失更新關閉 | A 開 txn 首次採購(建列);B 併發首次取消同品項 → B 阻塞於 A;A commit → B 續 → 兩軸皆正確(row 30 指定雙連線負測) | 後寫者不再覆蓋另一軸 |
| SA2 消融 | committed 把核心 helper 的 NKU 拿掉(等長同形)→ 重跑 SA1 交錯 → **一軸被覆蓋成 0 真的發生**(斷言打**終態**,非「B 有無阻塞」—— mutant 下 B 改在摘要 PK 上短暫等待,阻塞觀察無判別力;R1-3 折入變體)→ 還原 → 又正確 | 「無鎖版本必須先被證明會壞」(:377) |
| SA2b 純對照(v2 補,R1-3) | 同交錯改「**取消 vs 取消**」雙連線(不涉 procurement ⇒ a2b1 的鎖完全不在場)→ mutant 下累計取消漂移(2+2 只剩 2)→ 還原後 4 | 把 helper NKU 的承重從 a2b1 鎖的陰影下完全隔離出來 |
| SA3 receipts 競態 | 兩連線對同 proc 列併發 INSERT receipt → 序列化、received_quantity = 兩批和、不多不少 | proc 列 NKU 承重 |
| SA4 漂移 assert | 混合併發活動全部結束後,全表掃描:∀proc received=SUM(receipts);∀summary 三軸=真相;有活動必有列 | row 31「重算比對」(全掃描代抽樣:資料量小、判別力更強) |
| S5 翻紅 | 在 a2b2 腳本內完成(§7)| 契約債⑥關閉的行為證明 |

## §9 🔴 決策題(問 Sean;全部屬「測法變更要先問」——memory `feedback_decide-process-questions-yourself` 08-01 深夜例外;v2 依 R1 findings 擴充)

> ✅ **2026-08-03 Sean 拍板:Q1=A / Q2=A / Q3=A / Q4=A / Q5=A(逐字「a,a,a,a,a」)** ⇒ 測法修訂 12 處照 §7 提案、a7 探針 25/32 依提案改、隔離閘延伸分表具名 tag、a7-verify 既有壞損只記債不修、a7bt 三格 fixture 段暫停取消 trigger。以下保留原題備查。

Q1 兄弟 harness 測法修訂 **12 處**(§7 表全列:a2b1 的 B8/B10/B13/M1/M2/M4/M5/M6/M9/M11/M12 + a2b2 的 S3)照提案執行?
Q2 a7 探針 25 fixture quantity 提為 1000000 + 探針 32 後半語意翻面(斷言「上界已啟用」)?
Q3 隔離閘延伸(P2B02 套到 receipts/cancellation 寫入,tag 逐表具名)= Q1=A 先例同形延伸,照做?
Q4 a7-verify reapply 既有破損(A7b FK 擋 DROP、錯誤被吞;**與 A4a 無關、今日已壞**):本片只記債+改跑 standalone probe,修復留給 A7 線後續片?
Q5 a7bt-negative-state C3/C5/C7 三格 fixture 段 cell 內暫停 A4a 取消 trigger 塑形(攻擊面不變)?

## §10 驗收條件(逐條 yes/no)

1. from-zero provision 套完全部 migration(含 A4a)、檔內 DO 全過。
2. `a4a-verify.sh` 三計數器全中、FAIL=0、SKIP=0;突變各紅指定 cell、還原後 md5 = 基準。
3. `a4a-rollback-rehearsal.sh` 六步全綠(DoD 硬前置)。
4. §7 全家族序跑零回歸、首尾 a4a 兩次計數相同(零污染)。✅ **終輪紀錄(2026-08-03,codex 關卡2 修法後口徑)**:from-zero provision(含 A4a 檔內 DO)→ a4a **65/0**(首)→ 演練 **19/0** → a4b **33/0** → a2b1 **69/0** → a2b2 **37/0** → a7 探針 **36/36** → a7t 探針 **12/12** → s1b **48/0** → a6 **157/0** → a2b1 **69/0**(回歸)→ a4a **65/0**(尾,= 首)→ a1-verify all **61/0**(自建自拆殿後)。
5. A4b:SA1-SA4 **與 SA2b** 全綠(v3 R2-9:逐字列入,防收工合法略過)、SA2/SA2b 消融證鎖承重、S5 翻紅。
6. 三綠(零 .ts ⇒ typecheck + lint)。
7. 關卡1 codex 收斂 + §9 Sean 已答;關卡2 codex 審 diff + code-reviewer 過。
8. 未 push、未 apply;apply-DoD(等 Sean):**單獨一支** db push(v2 R1-18 更正:A2b1 已 apply ⇒ dry-run 清單應恰 `20260803140000` 一支),read-back 清單載於收工 handoff。

## §11 rollback 與 contract 債

- down = DROP 四 trigger + 五函式(§6 ④;摘要表歸 A1 §9)。下游:A4b/A5a 依賴本片;A5a 上線後單獨回滾 A4a = 摘要凍結 + received 凍結,A5a 須同停。
- contract 債(migration 註解明文):①未來 cancellation writer 多品項按 `order_item_id` 排序 + deferred 跨 statement 同受約束(A2b1 債④同形)②「先超後補」交易必須 defer 兩支 constraint(§7-B13)③TRUNCATE procurement/receipts 不觸發重算(owner-only 天花板)④第 2 批 `shipped_quantity` 落地時重算函式與 CHECK 網同片擴充(A1 債承接)⑤第 3 批改單片處理 quantity 縮小與死配額列(A2b1 債⑥同組)⑥(🔀 v4 R3-F7)**名稱序是一次性斷言不是常駐守門**:錯誤歸因與多格可達性押在「a2b1 guard 名 < 本片名」上,但斷言只在本片 migration DO 跑一次 —— 未來任何在 procurement 表掛 trigger 或改名的片,必須重跑名稱序斷言(與 a7t「集合恰等」同型債)⑦(v4 R3-F2)A5a 上線片必須回寫 rollback runbook 的「停寫」步驟為具體 REVOKE SQL。
