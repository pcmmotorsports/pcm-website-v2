# E10 第 2 批 · 出貨模型 DB 地基 片級 plan **v5.4(停損版 + 兩輪審查 + 施工前自檢 + 關卡2 findings 重工折入)**

> 🏁 **2026-08-06 終案標記 —— 本檔的「shipped 強制點未定案」字面已失效**
> Sean 2026-08-05 拍板 **Q1=A / Q2=A**:承重 = 摘要表 CHECK `oiqs_shipped_le_instock`(C9);
> 出貨 writer RPC **只做訊息層前緣拒絕、不是正確性來源**;可取消量公式**不減 shipped**。
> 出處:`docs/specs/2026-08-05-shipped-enforcement-analysis.md` §10 + memory `project_m4b-b2-shipments-db-decisions`。
> 🔴 **失效字面(刻意只給文字錨、不給行號** —— 行號會隨增修位移,清單必然過期;
> 用 `grep -n` 定位,**共 3 處**):
> ①`這題**還沒有被正確分析過**` ②`本題狀態 = **重新開放、尚未定案**`
> ③`「shipped 該在哪一層被強制」= 未定案`
> —— 那份獨立分析**已完成**且已拍板。§7 表的項 2 與項 6 已就地改述(該表內 grep `🏁`)。
> 原文保留為當時紀錄、未竄改。後續施工 = `docs/specs/2026-08-06-e10-b2-s2-shipped-summary-plan.md`。

> **狀態:兩輪 Fable 審查都跑完、findings 全數折入。**
> **卡在 §5.1 的兩題(Q-a / Q-b)等 Sean 拍板** —— 這兩題會改變 X1 的實作形狀,**拍板前不得開工**。
> - **判定輪**(Fable):**FAIL / 13 must-fix / 7 nit** → 報告 `docs/reviews/2026-08-05-b2-v5-fable-r3.md`
> - **確認輪**(Fable, fresh context):**FAIL / 4 must-fix**(全屬 plan 字面)+ nit
>   → 報告 `docs/reviews/2026-08-05-b2-v5-1-fable-confirm.md`;**四條已於 v5.2 修完**(§0.36)
> - 🔴 **兩輪合計 6 條的判別力已由本機 PG17.10 拋棄庫實測**,不是紙上論證(逐條標「實測」)
> worktree `/Users/sean_1/pcm-a4a-chain`,branch `a4a-chain`。
> 真權威:`docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md`(**MP**)。
> 驗收基準:`docs/specs/2026-08-01-admin-completion-map.md` §2 第 8-11 項(**本批一格不動**)。
>
> **輪次史**:v2 → K1 R1 codex FAIL 30 → v3 → K1 R2 codex FAIL 26 → v4
> → **R3 換模型(adversarial-reviewer / opus)FAIL,8 條結構性** → **執行停損** → v5。
> 停損核准:主視窗 `B-31-A` ① Q1=A。
>
> **v5 = v4 的真子集**:只做 **S1a-1 + S1a-2 + S1b**(兩張表 + 表級/trigger 守門),
> **零摘要整合、零 A4a 觸碰、零 RPC**。S2 整片移出本批。

---

## §0 停損與 v4 → v5 變更對帳

### 0.1 停損理由(用 R3 的話,不是「太難」)

> §0.1 用來砍掉 `shipped ≤ instock` 的理由**事實錯誤**(F6)⇒
> 「**shipped 該在哪一層被強制**」這題**還沒有被正確分析過**;
> 現在把它焊進摘要表,只是把**第四個錯誤前提固化**。

三次分析全被證偽,**本片不再自行分析第四次**:

| 代 | 主張 | 怎麼倒的 |
|---|---|---|
| v2 | 三桶互斥(`ordered/instock/cancelled` 不重疊) | R1 證偽 |
| v3 | `shipped ⊆ instock` ⇒ 既有 C7 已擋住 | 前提「instock 單調不減」為假(receipts trigger 含 DELETE,`20260803140000:415-418`) |
| v4 | 改 C6 成 `cancelled + shipped ≤ quantity`、`shipped ≤ instock` 移出摘要表 | **F6**:移出的理由(「會讓無關的摘要列變非法」)事實錯誤 —— A4a 重算是 **row-level、只重算受影響的那個品項**(`20260803140000:258-287` 親讀),**不存在無關的列** |

⇒ 本題狀態 = **重新開放、尚未定案**,由主視窗另委獨立分析(`B-31-A` ②)。
🔴 **v5 不得依 v2/v3/v4 任何一版結論施工**;MP 內三處汙染字面已由主視窗劃線作廢(`B-29-STOP` 五)。

### 0.2 v4 砍掉什麼

| v4 項目 | v5 處置 |
|---|---|
| **S2 整片**(摘要 `+shipped_quantity`、C6′ 改寫、C8、A4a 核心加第四軸、兩支重算 trigger、backfill、A1 契約債 COMMENT) | **整片移出本批**,承接者見 §7 |
| §3.2「24 格窮舉表」 | **廢除該詞**,改成 §3.2 三張各自宣告涵蓋面的表(F1) |
| §0.3 E 堆 `lock_timeout` 承接死結 | **刪除該宣稱**(F4:`lock_timeout` 只管非環狀等待 55P03,死結是 deadlock detector raise 40P01)⇒ §5.4 誠實改寫 |
| §9.3 probe A-G 段 | 隨 S2 移出;probe 檔留磁碟不 commit(§9) |
| §4 的 43 條驗收 | 重寫為由 §3.2 三張表逐格衍生 + 既有 harness 全綠(F5) |

### 0.3 R3 七條 must-fix 的處置(本批內解決)

| # | R3 findings(摘要來源:`B-29-STOP` 四) | v5 修法 | 落在 |
|---|---|---|---|
| **F1** | 24 格表只涵蓋 8 條守門裡的 1 條(X1);X2/X3/A2 是**狀態轉移**守門不在狀態積裡,X4-X7 掛在**四個不在軸上的欄** ⇒ 這張表結構上不可能證明完整性 | 拆成**三張各自宣告涵蓋面**的表:A 欄×階段可變性(接轉移守門)/ B 狀態積 24 格可達性(**只**接 X1 與可達性)/ C 守門↔不變式對照(接其餘) | §3.2 |
| **F2** | 有可到達但沒列的格 | 重新枚舉 24 格,補上 **`hct_status ≠ draft` 且零品項** 那一族(共 4 格,含作廢面);X1 條件擴成「離開草稿態必有品項」一次擋 10 格 | §3.2-B、X1 |
| **F9** | 已出貨 + 送單失敗 = 不可逃逸死鎖 | X8 凍結集**縮到 3 欄**(`recipient_snapshot`/`carrier_code`/`carrier_note`);`hct_*` 三欄與 `tracking_number` 出貨後仍可寫(重送、回填),由 X4/X5/X6/A5/A9 恆時接住 | §3.2-A、X8 |
| **F10** | 選錯快遞商無補救路徑 | 補救 = **作廢重開**(Q3=A 任何狀態可作廢;`shipment_items` 的 UNIQUE 只鎖 `(shipment_id, order_item_id)` ⇒ 同批品項可進新包裹)。寫進欄 COMMENT + 驗收正測 | §4 項 21 |
| **F11** | 缺 `tracking_number` 軸:已出貨但永遠沒單號是合法狀態 | 新增恆時 **A8**:`shipped_at` 非空且 `carrier_code <> 'other'` ⇒ 單號必須非空白 | §3.2-C |
| **F12** | X1 未指定 INSERT 面 ⇒ 一筆 INSERT 帶 `shipped_at` 就繞過 | X1 明寫 `AFTER INSERT OR UPDATE`,**INSERT/UPDATE 兩面各一條負測** | §4 項 9-10 |
| **F13** | trigger 名稱序未定,而本 repo 名稱序是明文契約 | 依 `20260803140000:48-52` 的明文契約 + 既有後綴慣例定死全部 10 支名稱;並**斷言四支 BEFORE UPDATE 讀寫欄集不相交**(⇒ 名稱序只影響歸因,不影響結果)+ 兩格歸因驗收釘死 | §3.3 |

🔴 **F11 的事實面我親查後要更正主視窗一階**(`B-31-A` 說「這是會寄到客人信箱的面」):
`order_shipped` 確實在 DB CHECK allowlist(`20260717020000:315`),**但寄送端今日 fail-closed throw**
(`packages/use-cases/src/sweep-email-outbox.ts:113`,`order_shipped` 無模板直接 throw)
⇒ **今日寄不出去,風險窗在 E4 模板落地那天**。要求不變(軸現在就補),緊迫性降一階。
附帶連結:`order_shipped` 的 `dedup_key`「該批穩定識別」待 E4 定(`20260717020000:301`/`:349`)——
**本批交付的 `shipment_reference` 正是那個識別的候選**,已寫進 MP DoD(§7)。

### 0.35 R3-Fable 判定輪 13 must-fix + 7 nit 的逐條處置(v5.1)

**判定 FAIL,結構性 6 條。**完整報告 `docs/reviews/2026-08-05-b2-v5-fable-r3.md`。
🔴 **其中四條我用本機 PG17.10 拋棄庫實測復現過**(不是照單全收),實測結果寫在對應的設計欄位裡。

| # | finding | v5.1 處置 | 落在 |
|---|---|---|---|
| 1 | **X1 函式讀 `shipment_items`,但該表 S1b 才建** ⇒ S1a-2 的 X1 負測會紅在 `42P01` 而非 `P0001`(**實測**:`CREATE FUNCTION` 引用不存在的表會成功,執行時才爆) | **X1 整條移入 S1b** | §2、§3.2-C、§4 |
| 2 | **項 13「證明 DEFERRED 生效」是假綠**:建→加品項→設 `shipped_at` 這個序在 IMMEDIATE 下也全綠 | 改成唯一可構造的判別序:**先 submitted(零品項)→ 再加品項**;並指定突變靶(改 IMMEDIATE 必須紅) | §4 項 31 |
| 3 | **X1 函式若信 `NEW` 會誤殺合法終態**:同交易暫態 submitted 再改回 draft | 函式**重讀現況列**(形狀抄 `20260730140000:167-177`)+ 新增暫態正測 | §3.2-C、§4 項 32 |
| 4 | **X8 作廢面零實作零測試**:A 表宣告涵蓋已作廢,X8 條件只寫 `OLD.shipped_at` | 條件補 `OR OLD.deleted_at IS NOT NULL` + 新增已作廢面 15 欄矩陣 | §3.2-C、§4 項 11b |
| 5 | **F2 自己補的作廢面 2 格無驗收** | 新增 `D≠∅` 送單面負測 | §4 項 30b |
| 6 | **A3 式漏 `COALESCE`**(**實測**:`('other', NULL)` 直接 `INSERT 0 1` 寫進去,CHECK 對 NULL 放行) | 加 `COALESCE`;實測四格紅綠都附上 | §3.2-C |
| 7 | **§3.3「讀寫欄集不相交」字面為假**(X8 與 X2 同讀 `shipped_at`)⇒ **第五個假設,而且栽在我自己寫的紀律隔壁** | 結論不變,改掛真前提(守門不寫 `NEW`)+ 驗收改斷言 —— 🔴 **v5.2 再修一次**:P3 刪除(由 P1 推得)、新增 **P1b 禁 `RETURN NULL`**,現行前提集 = **P1 / P1b / P2** | §3.3、§4 項 16 |
| 8 | **§6 S1a-1 回滾漏獨立函式** | 改成通則:**每片都要逐支 `DROP FUNCTION`**,三片各自列出 trigger 與函式數 | §6 |
| 9 | **trigger 函式面合約零字**(SECDEF / `search_path` / `REVOKE EXECUTE`)—— 表是 zero-grant,invoker 身分**跑不動** | 新增 §3.2-C-2 整節 + 驗收項 18 | §3.2-C-2 |
| 10 | **A7+X3 deferrability 未定**:若 INITIALLY DEFERRED,合法主流程會在 commit 被誤殺 | 明文 `NOT DEFERRABLE`(對齊 `20260803140000:417`)+ catalog 判別格 | §3.2-C、§4 項 21 |
| 11 | **DEFERRED × 外部呼叫**:writer 在同交易送新竹再 commit,X1 失敗 ⇒ **外部已收單、庫內蒸發** | 落 MP DoD 第 7 條(外部呼叫移出交易 **或** 送單前 immediate 檢查) | §7 |
| **12** | **裝箱數量打錯無補救**(草稿期即 append-only) | 🔴 **需 Sean 拍板** | §5.1 Q-a |
| **13** | **HCT 證據欄可覆蓋 vs 留痕意旨** | 🔴 **需 Sean 拍板** | §5.1 Q-b |

**7 條 nit 全清**(不 dangle):`pg_catalog.coalesce` 非法(**實測 42883**)→ 改 `COALESCE`;
項 15 的 `deleted_at` 格要與 `void_reason` 成對;15 欄矩陣補齊格數;cut point ② 字面改實;
`customer_user_id` 補 index;A4 空字串維持(**與 `orders` 樣板同水位,收緊屬新決策、不在本片自行改**);
送審行數漂移(任務書 446 vs 實檔,資訊面、非 plan 缺陷)。

### 0.36 確認輪(Fable, fresh context)4 條 must-fix 的處置(v5.2)

確認輪的裁決:§0.35 的 11 列 **10 列已修、1 列沒修完**(F2 的 `failed` 面),
四個突變靶 **三真一未釘死**。四條新 must-fix 全部落在「**修法自己的判別力**」這一層 —— 這是新的一層,
不是前輪的重複(§5 判停條件:findings 開始重複前輪才是方向問題)。

| # | finding | v5.2 處置 | 落在 |
|---|---|---|---|
| 1 | **X1 的第三個承重件沒說出口**:X1 只掛 `shipments`,靠 **A6 品項數單調不減** 才夠用;而 §5.1 Q-a 備選② 正好會打倒它(送單後把品項刪光 ⇒ X1 不發火、零錯誤)。備選②的成本因此漏列一半 | X1 加**前提③**;Q-a 備選② 補上真實成本(要改雙支 + items 凍結條件含 `hct_status`);**新增第三案**(writer 層一鍵複製重開) | §3.2-C、§5.1 |
| 2 | 🔴 **P1 的斷言量不到 `RETURN NULL`**:BEFORE 守門回 `NULL` ⇒ **該筆 UPDATE 被靜默取消**(**本機實測:`UPDATE 0`、零錯誤、值未變**)⇒ 所有「→ 成功」正測若只驗「沒噴錯」就是**假綠** | 新增 **P1b(禁 `RETURN NULL`)**;P1 的 grep 補 `=` 賦值形;**新增項 16b 通則**:所有「→ 成功」格必須回查新值落庫 | §3.3、§4 項 16/16b |
| 3 | **X1 的 `failed` 面零驗收**(項 30/30b 全踩 `submitted`)⇒ 條件誤寫成 `= 'submitted'` 會全綠 | 新增**項 30c**(`failed` × D∅/D≠∅ 兩格)+ 突變靶⑥ | §4 項 30c |
| 4 | **項 3 的 A3 格沒寫死**「`other` 無 note」⇒ 實作者若造成 `''`,突變靶④ 全綠、`COALESCE` 修法變裝飾 | 項 3 改成**五格逐字寫死**(含 `('other', NULL)`),並註明判別力只在那一格 | §4 項 3 |

**nit 全清**:契約債⑥ 的**反身性**(S1b 自己就是掛 trigger 的片 ⇒ 本批內就要重跑名稱序斷言);
P3 刪除(由 P1 推得、留著像多一道保險);§3.2-C-2 補 RLS 前提(owner 豁免 + 非 FORCE)
與「全部掛 SECDEF 比先例寬」的知情選擇;突變靶③ 的 fixture 必須 `hct_status='draft'`。

### 0.37 施工前可實作性自檢(v5.3;`B-109-A` 建議的等待期自查,**不是審查輪**)

方法 = **把三片 DDL 真的寫出來、在拋棄式 PG17.10 實跑**(角度 = §10.3,兩輪審查都沒碰過)。
報告:`docs/reviews/2026-08-05-b2-v5-2-implementability-selfcheck.md`。

**結論:三片 DDL 全部建得起來,20 個行為格全部如設計預測,沒有「寫不出來」的東西。**
抓到 **1 條 must-fix(驗收層)** + 2 條要釘進 plan 的事實:

| # | 發現 | 處置 |
|---|---|---|
| **MF** | 🔴 **§4 的 RLS 斷言在本機 harness 上零判別力**:拋棄庫 owner = superuser(`d1t2-rehearsal.sh:40`)、`rolbypassrls=true` ⇒ 實測 **FORCE RLS 開與不開都成功**(兩個假綠);換 NOSUPERUSER owner 才分得出來(`ok` vs `42501`)。而正式站 `postgres` **不是** superuser | 項 9 改寫(明文要求非 superuser owner + 附兩行做法)、新增項 9b(斷言 `relforcerowsecurity = false`)、**做法回寫給 `a6-verify.sh`/`s1a-verify.sh`**(§7 DoD 8) |
| 事實1 | **`WHEN` 與 `DEFERRABLE INITIALLY DEFERRED` constraint trigger 可以併用**(v5 原本只是假設) | 已實跑確認;並確認 `WHEN` 在**列操作當下**求值 ⇒ 暫態格能過靠的是**函式重讀**,不是 `WHEN` |
| 事實2 | **parent guard 的 `NOT DEFERRABLE` 是主流程能不能跑的先決條件**:突變成 `INITIALLY DEFERRED` 後,合法主流程在 commit 被誤殺(實測) | 已寫進 §3.2-C 的 A7+X3 列;症狀 loud、dev 期會發現 |

🔴 **自檢沒涵蓋的面**(誠實列,見報告 ⑥):`d1t2-rehearsal.sh provision` 真實相容性、
既有 harness 互動(項 34 仍未跑)、A4/A7 的真 schema fixture(本次用極簡 stub)、
產號 helper、**以及 Q-a 若拍備選② 時 X1 的雙支形狀(未驗)**。

### 0.4 v5 自查新增(不算 R3 findings,誠實分開列)

| # | 缺口 | 修法 |
|---|---|---|
| **A9** | v4 全文沒有 `hct_status` 的**值域** CHECK(X4/X5 只管配對)⇒ `hct_status='banana'` 合法 | `CHECK (hct_status IN ('draft','submitted','failed'))` |
| **F8 具名** | R3 F8:X3 對 `shipments` 取的 NKU 鎖是**未具名承重件**(宣告用途只是「禁事後加貨」,實際同時撐住未來 shipped 重算) | 本批就**具名**:寫進 trigger COMMENT「此 NKU 同時是未來 shipped 重算的承重件,改成非鎖讀法會讓 shipped 靜默少算」 |

### 0.5 主視窗認錯三條(`B-31-A` ⓪)對 v5 的連動

F6 / F4 / F3 打到的是**主視窗的裁決**,不是執行。三條的共同形狀 =
**「已被蘊含 / 不依賴 X / 可證安全」的論證必須把前提列成明文斷言**。
⇒ v5 全文凡出現這類論證,一律附「前提 + 誰保證 + 前提倒了誰會發現」三欄(§3.2-C、§5)。

---

## §1 現況事實(只留 v5 直接依賴的;每條附出處)

| 主題 | 事實 | 出處 |
|---|---|---|
| **A4a 重算是 row-level** | receipts trigger 依 `TG_OP` 只取 `NEW/OLD.procurement_id`,再 `FOREACH` 逐 proc 鎖 ⇒ 只重算受影響品項 | `20260803140000:277-296`(我親讀;主視窗與 R3 引同段為 `:258-287`) |
| **receipts trigger 含 DELETE** | `AFTER INSERT OR UPDATE OR DELETE` ⇒ `instock` 可下降(非單調) | `20260803140000:415-418` |
| **A4a 有 break-glass `DISABLE TRIGGER`** | 誤攔當天的合法出路,整段單一交易 + 重驗 | `20260803140000:82-121` |
| **名稱序是明文契約** | 「同表同事件 constraint trigger 按名稱序發火,deferred 佇列亦保序」(本機 PG17.10 實測);契約債⑥ = 該斷言只在 apply 時跑一次、非常駐 | `20260803140000:48-53` |
| **守門鎖 parent 一律 NKU** | 「鎖原語 = FOR NO KEY UPDATE(A2b1 同一把鎖;Q4=A 契約、40P01 實測)」 | `20260803140000:20`(契約句)/ `:294`(實作) |
| **快照白名單樣板** | `orders_ship_addr_whitelist` CHECK | `20260604120000:125` |
| **`order_shipped` 在 outbox allowlist** | `event_type` CHECK 含 `order_shipped` | `20260717020000:315` |
| **但寄送端 fail-closed** | 無模板 ⇒ `throw`,不寄 | `sweep-email-outbox.ts:113` |
| **建表/ACL/RLS 樣板** | `suppliers` 全套:touch trigger、block delete/truncate、RLS enable、`REVOKE ALL FROM PUBLIC,anon,authenticated,service_role` → 只 `GRANT SELECT TO service_role` | `20260801140000:66-133` |
| **產號合約** | 字母表 `23456789BCDFGHJKMNPQRSTVWXYZ`、6 碼、**刪除後永不重用** | MP §5.4a / §8.5 |
| **快遞三選** | 新竹(串 API)/ 順豐(自填單號)/ 其他 | `docs/reference/hct-logistics-api-reference.md:9` |
| **既有 constraint trigger 後綴慣例** | `_ac`(一般)/ `_zc`(必須排最後的重算);一般 trigger `_bi`/`_bu`/`_biu`/`_bd`/`_bt` | 全樹 grep `CREATE (CONSTRAINT )?TRIGGER` |
| **presence trigger 先例** | `order_cancellations_items_presence_ac` | `20260804*` 家族 |

**已拍板約束**:U1 併箱(`shipments` 無 `order_id`)/ Q1=B 只認同客人 / Q10=A 獨立編號 /
Q19=A 無後綴 / U7 **無 `delivered`** / Q2=A 單號可改 / Q3=A 作廢退量 / Q4=C 固定選項+其他 /
Sean 08-05 **無直送**。

---

## §2 片界(**三片**;S2 已移出)

| 片 | 型 | 內容 | 鐵則 12? | 估時 |
|---|---|---|---|---|
| **S1a-1** | M | `shipments` 建表 + **全部恆時 CHECK**(A1/A3/A4/A5/A8/A9 + X4/X5/X6/X7)+ block delete/truncate + ACL/RLS + 結構驗收 | ③ ⇒ **是** | 35 分 |
| **S1a-2** | T | `shipments` 的 **BEFORE UPDATE 守門族**(X2 write-once / X8 出貨後·作廢後凍結三欄 / A2 永不可改)+ touch + 名稱序與歸因斷言 | ③ ⇒ **是** | 35 分 |
| **S1b** | M+T | `shipment_items` 建表 + UNIQUE + `(order_item_id)` index + append-only(block delete/update/truncate)+ **parent guard(X3 + A7 合一支、一次 NKU)** + **X1 presence(DEFERRED constraint trigger,掛 `shipments`)** + ACL/RLS | ③ ⇒ **是** | 45 分 |

**片序 S1a-1 → S1a-2 → S1b,三支同批 apply**(§8)。三片各 ≤45 分 ✅(鐵則 4)。

🔴 **X1 為什麼在 S1b 而不是 S1a-2(R3-Fable must-fix,結構性;v5.1 修)**:
X1 的函式要 `SELECT … FROM public.shipment_items`,而該表 **S1b 才建**。
**實測**(本機 PG17.10 拋棄庫):`CREATE FUNCTION` 引用不存在的表**會成功**,
錯誤要到**執行時**才以 `42P01 relation does not exist` 爆出來
⇒ 若 X1 留在 S1a-2,該片的 X1 負測會紅在 `42P01` 而不是 `P0001`(**測到的是缺表,不是守門**),
正測更是跑不起來。⇒ **X1 整條(trigger + 函式 + 驗收項)移入 S1b**,跨片依賴消失。

🔴 **中間態安全性**:S1a-1 交付後表可建可驗可回滾(可變性未鎖,但**零 writer、零品項表**);
S1a-2 交付後 `shipments` **的可變性守門完整,但「已寄出必有品項」尚未生效**(X1 在 S1b);
S1b 才有品項表與 X1。**全程零 writer** ⇒ 每個 cut point 都安全(§8)。

---

## §3 設計

### 3.1 兩張表

```
public.shipments                                                        ── S1a-1 / S1a-2
  id                  uuid PK DEFAULT gen_random_uuid()
  shipment_reference  text NOT NULL UNIQUE          -- 6 碼、永不重用(MP §5.4a)
  customer_user_id    uuid NOT NULL REFERENCES customers(user_id) ON DELETE RESTRICT
                                                  -- INDEX (customer_user_id):FK RESTRICT 檢查 + 未來「按客人查包裹」都要它
  recipient_snapshot  jsonb NOT NULL                -- Q1=B:本包裹實際寄達的收件資料
  carrier_code        text NOT NULL                 -- 'hct' | 'sf' | 'other'
  carrier_note        text                          -- 僅 other 填(A3 雙向配對)
  tracking_number     text                          -- Q2=A 可改;A8 出貨時必有(hct/sf)
  shipped_at          timestamptz                   -- X2 write-once
  deleted_at          timestamptz                   -- Q3=A soft delete,可 unvoid
  void_reason         text                          -- X7 與 deleted_at 雙向配對
  hct_request_id      text                          -- A5 partial unique
  hct_raw_response    jsonb
  hct_status          text NOT NULL DEFAULT 'draft' -- A9 值域;U7 無 delivered
  created_at / updated_at  timestamptz NOT NULL DEFAULT now()

public.shipment_items                                                   ── S1b
  id                uuid PK DEFAULT gen_random_uuid()
  shipment_id       uuid NOT NULL REFERENCES shipments(id)   ON DELETE RESTRICT
  order_item_id     uuid NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT
  shipped_quantity  integer NOT NULL CHECK (shipped_quantity > 0)
  created_at        timestamptz NOT NULL DEFAULT now()
  UNIQUE (shipment_id, order_item_id)          -- 🔴 只鎖箱內去重 ⇒ 作廢重開(F10)走得通
  INDEX  (order_item_id)
```

🔴 **`recipient_snapshot` 欄 COMMENT 必寫**:「可與該包裹所含訂單的 `orders.shipping_address_snapshot`
**不一致**;Sean 2026-08-05 Q1=B 知情選擇。」
🔴 **`carrier_code` 欄 COMMENT 必寫**:「出貨後凍結(X8);選錯的補救路徑 = **作廢重開新包裹**,
留 `void_reason` 稽核。不得為了改快遞商而拆 X8。」

### 3.2 覆蓋論證(取代 v4 的「24 格窮舉表」)

> 🔴 **F1 的病根**:一張以「狀態積」為軸的表,**結構上不可能**證明「轉移守門」與「不在軸上的欄」的完整性。
> ⇒ 拆成三張表,**每張各自宣告它能證明什麼、不能證明什麼**;完整性由三張表的並集 + §3.2-D 的封閉性論證承擔。

#### A. 欄 × 生命週期可變性矩陣(涵蓋面:**所有轉移守門** X2 / X8 / A2;共 15 欄全列)

| 欄 | 草稿 | 已寄出 | 已作廢 | 守門 | 不凍結的理由(F9/Q2=A) |
|---|---|---|---|---|---|
| `id` | ✋ | ✋ | ✋ | A2 | — |
| `shipment_reference` | ✋ | ✋ | ✋ | A2 | — |
| `customer_user_id` | ✋ | ✋ | ✋ | A2 | 改客人會讓已裝箱品項跨客人(A7 只在 INSERT 面驗) |
| `created_at` | ✋ | ✋ | ✋ | A2 | — |
| `recipient_snapshot` | ✅ | ✋ | ✋ | X8 | — |
| `carrier_code` | ✅ | ✋ | ✋ | X8 | 補救 = 作廢重開(F10) |
| `carrier_note` | ✅ | ✋ | ✋ | X8 + A3 | — |
| `tracking_number` | ✅ | **✅** | ✅ | A8 | Q2=A 明文拍板單號可改;A8 保證出貨時非空(hct/sf) |
| `hct_request_id` | ✅ | **✅** | ✅ | A5 + X4 + X6 | **F9**:已出貨後送單失敗必須能重送 |
| `hct_raw_response` | ✅ | **✅** | ✅ | X6 | 同上,外部回應必須能回填 |
| `hct_status` | ✅ | **✅** | ✅ | A9 + X4 + X5 | 同上;凍結它 = 資料永遠停在 `failed` 的謊 |
| `shipped_at` | ✅ 設一次 | ✋ 不可清 | ✋ | X2 | 撤銷出貨唯一路徑 = `deleted_at` |
| `deleted_at` | ✅ | ✅ | **✅ 可清(unvoid)** | X7 | Q3=A 作廢可逆 |
| `void_reason` | 隨 `deleted_at` | 同 | 同 | X7 雙向 | — |
| `updated_at` | 自動 | 自動 | 自動 | touch trigger | 唯一由 trigger 寫的欄 |

🔴 **X8 凍結集 = 恰好 3 欄**(`recipient_snapshot`/`carrier_code`/`carrier_note`)。
這**不是**退回 v3 被 R2 抓的「名叫 allowlist 卻只禁三欄」——差別是:**本表 15 欄逐欄具名**,
每個「不凍結」都附理由與**接住它的恆時守門**;凍結集的邊界由本表定義,不由 trigger 內的欄清單定義。
**驗收要求**:S1a-2 的 harness 逐欄跑一次(凍結欄必紅 / 非凍結欄必綠)⇒ 未來加欄漏改 trigger 會被抓到。

🔴 **X8 用 `OLD` 判階段,不用 `NEW`**:同一句 `UPDATE` 設 `shipped_at` **並且** 改 `carrier_code`
= 建立當下一次寫完,**合法**;`OLD.shipped_at IS NOT NULL` 才進入凍結。已附驗收正測(§4 項 12)。

#### B. 狀態積可達性表(涵蓋面:**只有 X1 與業務可達性**;共 24 格全列,不宣稱涵蓋其他守門)

軸:`shipped_at`(S空/S非空)× `deleted_at`(D空/D非空)× `hct_status`(draft/submitted/failed)× 品項(0/≥1)。

| 族 | 格數 | 判定 |
|---|---|---|
| 品項 ≥1(任意 S/D/hct) | 12 | **全合法**。D空+S空+draft = 裝箱中;D空+S空+submitted/failed = 已送新竹(X5 另強制 `carrier='hct'`);D空+S非空 = 已寄出;D非空 = 已作廢(Q3=A 任何狀態可作廢) |
| 品項 0 且 `hct='draft'` 且 S空 | 2 | **合法**:剛建立的空包裹(D空)/ 作廢的空包裹(D非空) |
| 品項 0 且(S非空 **或** `hct≠draft`) | **10** | **全非法 ⇒ X1 擋** |

🔴 **F2 的缺口在第三族**:v4 的 X1 只擋 `shipped_at` 非空那 6 格,
**漏掉 `S空 + hct≠draft + 品項0`** 那 4 格(D空 2 格 + D非空 2 格)——
即「**送單給新竹、箱子裡零品項**」,可達且無人擋,送出去的內容與實際不符,
而 X3 只在「已寄出/已作廢」後才擋加品項 ⇒ 送單後還能繼續塞貨。
⇒ **X1 條件擴成:`shipped_at IS NOT NULL OR hct_status <> 'draft'` ⇒ 至少一列品項。** 一條擋滿 10 格。

> **誠實標記**:R3 原文已隨視窗斷線遺失,磁碟上只剩 `B-29-STOP` 的一行摘要
> (「兩個可到達但沒列的格」)。上表是我**自行重新枚舉 24 格**的結果,得到 **4 格**,
> 與該摘要一致並多出作廢面 2 格。**若 R3 指的是另外兩格,本表不構成已涵蓋的證明** —— 送審時請 R3 重列。

#### C. 守門 ↔ 不變式對照(涵蓋面:**恆時守門**,含四個不在軸上的欄)

| 代號 | 不變式 | 實作 | 紅在 | 前提 / 前提倒了誰會發現 |
|---|---|---|---|---|
| **X1**(S1b) | 離開草稿態(已寄出 **或** 已送單)的包裹必有品項 | `shipments` **DEFERRABLE INITIALLY DEFERRED** constraint trigger,**`AFTER INSERT OR UPDATE`**(F12)、`WHEN (NEW.shipped_at IS NOT NULL OR NEW.hct_status <> 'draft')`。🔴 **函式體必須「重讀該列現況」再判,不得只信 `NEW`**(見右欄) | `P0001` | 前提①:品項與包裹可跨語句 ⇒ **必須 DEFERRED**。前提②(**R3-Fable 抓,v5.1 新增**):`WHEN` 在**列操作當下**求值、檢查卻在 commit 才跑 ⇒ 同一交易內「暫時設 submitted 再改回 draft、且零品項」是**合法終態**,若函式信 `NEW` 會被**誤殺**。⇒ 函式重讀 `shipments` 現況列,若已回到「`shipped_at IS NULL` 且 `hct_status='draft'`」則放行(形狀抄 `20260730140000:167-177`,親讀確認的行號)。倒了 = §4 項 32 正測紅。🔴 **前提③(v5.2 新增,確認輪 must-fix —— X1 的第三個承重件,原本沒說出口)**:**X1 只掛 `shipments`、不掛 `shipment_items`** ⇒ 只在「包裹列被寫」時發火。這之所以夠用,**唯一理由是 A6(`shipment_items` append-only)保證品項數單調不減** —— 送單那一刻驗過就永遠成立。**若未來開放草稿期刪品項(§5.1 Q-a 備選②),「送單後把品項刪光」不會觸發 X1** ⇒ F2 那族缺口原封重開、**零錯誤訊息**。⇒ Q-a 若拍備選②,**X1 必須改雙支**(`shipments` + `shipment_items`;先例 `20260730140000:214-226` 就是雙支 presence) |
| **X2** | `shipped_at` write-once | BEFORE UPDATE:`OLD.shipped_at IS NOT NULL AND NEW.shipped_at IS DISTINCT FROM OLD` | `P0001` | 撤銷走 `deleted_at`;倒了 = §4 項 10 負測綠 |
| **X3** | 已寄出/已作廢後禁加品項 | `shipment_items` parent guard(見 A7 合一支) | `P0001` | 見 A7 |
| **X4** | `submitted` ⇒ `hct_request_id` 非空 | `CHECK (hct_status <> 'submitted' OR hct_request_id IS NOT NULL)` | `23514` | R1 抓過、v3 未真解 |
| **X5** | `submitted/failed` ⇒ `carrier_code='hct'` | `CHECK (hct_status = 'draft' OR carrier_code = 'hct')` | `23514` | — |
| **X6** | 非 hct 不得帶 hct 證據欄 | `CHECK (carrier_code = 'hct' OR (hct_request_id IS NULL AND hct_raw_response IS NULL))` | `23514` | — |
| **X7** | `deleted_at` 與 `void_reason` 雙向配對且理由非空白 | `CHECK ((deleted_at IS NULL) = (void_reason IS NULL) AND (void_reason IS NULL OR pg_catalog.btrim(void_reason) <> ''))` | `23514` | R2 抓 `'   '` 通過 |
| **X8** | 已寄出**或已作廢**後凍結**寄給誰、走哪家**(3 欄) | BEFORE UPDATE,凍結集 = §3.2-A 的 ✋ 欄;🔴 **階段條件逐字 = `(OLD.shipped_at IS NOT NULL OR OLD.deleted_at IS NOT NULL)`**(v5.1 修:R3-Fable 抓 v5 只寫了 `OLD.shipped_at`,**作廢面零實作零測試**,而 A 表宣告它涵蓋已作廢欄) | `P0001` | 前提:`hct_*` 與 `tracking` 是外部軌跡不是出貨事實(F9)。倒了 = §4 項 13 正測紅;作廢面倒了 = §4 項 11b 負測綠 |
| **A1** | reference 格式 + 唯一 | `CHECK (shipment_reference ~ '^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$')` + UNIQUE | `23514`/`23505` | — |
| **A2** | `id`/`reference`/`customer_user_id`/`created_at` 永不可改 | BEFORE UPDATE | `P0001` | — |
| **A3** | carrier 值域 + `(carrier_code='other') = (btrim(COALESCE(carrier_note,'')) <> '')` **雙向** | `CHECK` | `23514` | 🔴 **v5.1 修(R3-Fable must-fix,本機 PG17.10 實測證實)**:v5 原式漏 `COALESCE` ⇒ `carrier_note IS NULL` 時 `btrim(NULL) <> ''` 為 **NULL**,整式為 NULL,**CHECK 對 NULL 放行** ⇒ `('other', NULL)` 直接寫得進去(實測 `INSERT 0 1`)。加 `COALESCE` 後實測四格:`('other',NULL)`/`('other','   ')`/`('hct','x')` 各紅 23514、`('other','自送')`/`('hct',NULL)` 各綠。與 X7 已修的是**同型 NULL 坑** |
| **A4** | `recipient_snapshot` exact key `{name,phone,line}` + 值皆 string | `CHECK`(照抄 `orders_ship_addr_whitelist`) | `23514` | — |
| **A5** | `hct_request_id` partial UNIQUE(`WHERE ... IS NOT NULL`) | partial unique index | `23505` | 判別力正測:兩列皆 NULL 必須成功 |
| **A6** | `shipment_items` append-only;兩表永不硬刪 | block DELETE/UPDATE/TRUNCATE trigger | `P0001` | — |
| **A7 + X3** | 併箱同客人 **且** parent 仍可加貨 | `shipment_items` **AFTER INSERT constraint trigger、🔴 明文 `NOT DEFERRABLE`**:一次 `FOR NO KEY UPDATE` 鎖 parent → 兩段判斷、兩個 `CONSTRAINT` 名歸因 | `P0001` | 🔴 **F8 具名**:此 NKU 同時是未來 shipped 重算的承重件;改成非鎖讀法會讓 shipped **靜默少算**。逐字寫進 COMMENT。🔴 **`NOT DEFERRABLE` 不是格式要求(v5.1 修,R3-Fable 抓 v5 未定 deferrability)**:若 INITIALLY DEFERRED,合法主流程「加品項 → 設 `shipped_at` → commit」會在 commit 當下看到 parent 已寄出而**誤殺**(commit 時無從分辨先後)。對齊 A4a `20260803140000:417` 的 `NOT DEFERRABLE` 慣例 |
| **A8** | **已寄出且非 other ⇒ 追蹤號非空白**(F11) | `CHECK (shipped_at IS NULL OR carrier_code = 'other' OR pg_catalog.btrim(COALESCE(tracking_number,'')) <> '')`(🔴 v5.1 修:`COALESCE` **不可** schema-qualify —— `pg_catalog.coalesce` 實測 `42883 function does not exist`,apply 當場炸;`pg_catalog.btrim` 合法) | `23514` | 🔴 **前提:單號在交寄當下已存在**(標籤先印才交寄)。若未來實務不成立(HCT 單號延後回填)⇒ 承接改法 = 改 DEFERRED **或** 加 `no_tracking_reason` 欄,**不得靠刪掉這條 CHECK**。倒了 = 員工當天出不了貨(§4 項 20 正測會紅) |
| **A9** | `hct_status` 值域(v5 自查) | `CHECK (hct_status IN ('draft','submitted','failed'))` | `23514` | U7:**無 `delivered`** |

**ACL**:兩表 RLS enable + zero-policy;`REVOKE ALL FROM PUBLIC, anon, authenticated, service_role`
→ 只 `GRANT SELECT TO service_role`(照 `20260801140000:126-133`)。

#### C-2. 🔴 trigger 函式面合約(v5.1 新增;R3-Fable must-fix:v5 全文零字)

上表每一支 trigger 背後的函式都必須逐項釘死,**不是格式潔癖,是兩個實際後果**:

| 項 | 規格 | 為什麼 |
|---|---|---|
| `SECURITY DEFINER` | 全部守門函式 | 兩張表是 **zero-grant**(只 `GRANT SELECT TO service_role`)⇒ X1/A7 要 `SELECT shipment_items` / `shipments`,以 invoker 身分**跑不動** |
| `SET search_path = public, pg_temp` | 明文釘死 | 對齊最近的守門 trigger 片(A4a `20260803140000:144` 等五處、A7-t `20260730140000:146-147`)。🟡 **repo 內兩種慣例並存**:`suppliers` 用 `pg_catalog, public`(`20260801140000:69`/`:104`)。**本片選前者並在結構斷言中比對逐字**,不發明第三種 |
| `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated, service_role` | 每支都要 | PG 新建 function **預設 `GRANT EXECUTE TO PUBLIC`**;SECURITY DEFINER + PUBLIC = **多一個以 owner 權限起跑的入口**(理由逐字沿用 `20260730140000:205-212`)。trigger 由表擁有者觸發,**不需要任何 role 的 EXECUTE** |
| 結構斷言 | `prosecdef` / `proconfig` 逐字 / owner / `proacl` | 落進 S1a-1 與 S1b 的檔內 `DO $verify$`;缺一條 = 未來有人重建函式時靜默降級 |

🔴 **這一節自己的前提(v5.2 補;確認輪指出原文零字提 RLS)**:
`SECURITY DEFINER` 之所以能在 zero-policy RLS 的表上讀得到,前提是
**①函式 owner = 表 owner(`postgres`)②兩表沒有 `FORCE ROW LEVEL SECURITY`**
(table owner 預設**豁免** RLS;加了 FORCE 連 owner 都要過 policy,而本片是 zero-policy ⇒ 讀不到)。
⇒ **S1a-1 的結構斷言要順便釘「兩表 `relforcerowsecurity = false`」。**
前提倒了的症狀是**誤殺(loud)不是漏放**:守門讀到零列 ⇒ X1 會把合法包裹判成無品項 ⇒ 開發期就會炸。
🔴 **SECDEF 的範圍收窄(v5.3 定案,施工前改)**:**只有「要讀別的表」的守門掛 `SECURITY DEFINER`**
—— 即 **X1**(讀 `shipment_items`)與 **A7+X3**(讀 `shipments`/`orders`/`order_items`)。
`touch` 與 block delete/truncate、以及只比對 `OLD`/`NEW` 的 X2/X8/A2 **一律不掛**。
理由:①對齊既有先例(`suppliers` 的 block/touch 函式就沒掛,`20260801140000:66-70`/`:101-105`)
②每一支 SECDEF 都是一個以 owner 權限起跑的入口,少一支就少一個
③**它們不讀任何表,掛了也沒有得到任何東西**。
(v5.2 曾寫「全部掛、圖規格一致」——那是我發明的一致性,不是先例;施工前改回較窄的那個。)

#### D. 封閉性論證(三張表憑什麼合起來是完整的)

1. **每一欄**都在 A 表出現且標了三階段可變性 ⇒ 沒有「不在軸上的欄」被漏掉(F1 的第二半)。
2. **每一條守門**都在 C 表出現且標了不變式與紅在哪 ⇒ 守門集合有唯一清單。
3. **狀態積 24 格**在 B 表全列且每格有判定 ⇒ 可達性面完整(F2)。
4. 🔴 **本論證的前提**:守門集合 = C 表那 15 條。**誰保證沒有第 16 條該有而沒有的?**
   **沒有人保證** —— 這是本片承認的殘餘風險,處置 = §4 的**逐欄/逐格衍生驗收 + 突變矩陣**
   (每條斷言有專屬突變、只紅自己那條),讓「守門被拿掉」可被觀察;
   **不宣稱「已窮舉」**。這是 v4 最大的字面 vs 事實偏離,v5 明文不再犯。

### 3.3 trigger 名稱與發火序(F13)

依 `20260803140000:48-53` 明文契約(同表同事件按名稱序發火,deferred 佇列亦保序)+ 既有後綴慣例:

| 表 | 事件 | 名稱(字母序 = 發火序) |
|---|---|---|
| `shipments` | AFTER I/U(constraint, DEFERRED) | `shipments_items_presence_ac`(X1;**由 S1b 建**,見 §2)—— 名稱形狀抄既有先例 `order_cancellations_items_presence_ac`(`20260730140000:214-215`,同為 `AFTER INSERT OR UPDATE` presence 守門) |
| `shipments` | BEFORE UPDATE | `shipments_frozen_after_ship_bu`(X8) → `shipments_immutable_guard_bu`(A2) → `shipments_touch_updated_at_bu` → `shipments_write_once_bu`(X2) |
| `shipments` | BEFORE DELETE / TRUNCATE | `shipments_block_delete_bd` / `shipments_block_truncate_bt` |
| `shipment_items` | AFTER INSERT(constraint) | `shipment_items_parent_guard_ac`(A7+X3) |
| `shipment_items` | BEFORE U / D / TRUNCATE | `shipment_items_block_update_bu` / `_block_delete_bd` / `_block_truncate_bt` |

🔴 **明文斷言(取代「名稱序不重要」的默認)—— v5.1 已更正前提,原字面為假**

> **v5 原文寫的是「四支的讀寫欄集不相交」。R3-Fable 抓到那句字面就是假的**:
> X8 要判階段必須讀 `OLD.shipped_at`,X2 也讀 `shipped_at` ⇒ **兩者讀集重疊**。
> 🔴 這正是 §0.5 我自己立的紀律(「可證安全的論證必須把前提列成明文斷言」)**沒有套到 §3.3 自己身上**
> —— 本片假設層栽的**第五次**,而且是栽在寫紀律的那一段隔壁。

**結論不變,但要掛在真正的前提上**(三條,缺一則名稱序就會影響結果):

| # | 真前提 | 誰保證 |
|---|---|---|
| P1 | 四支守門**都不寫 `NEW`**,只 `RAISE` 或原樣 `RETURN NEW` | 結構斷言:函式體 grep **`NEW.<欄> :=` 與 `NEW.<欄> =` 兩種賦值形都不得出現**(v5.2 修:只 grep `:=` 會漏掉 `=`) |
| **P1b** | 🔴 **四支守門一律 `RETURN NEW`,禁 `RETURN NULL`**(v5.2 新增,確認輪 must-fix) | 結構斷言:函式體 grep 無 `RETURN NULL`。**理由見下方紅框** |
| P2 | `touch` 是唯一寫 `NEW`(只寫 `updated_at`)的一支,而 **`updated_at` 不被任何守門讀** | 同上 + §3.2-A 欄表 |
| ~~P3~~ | ~~守門讀的都是原始傳入值~~ **由 P1 直接推得,不是獨立前提**(確認輪 nit;留著會讓人以為多一道保險) | — |

⇒ **在 P1 / P1b / P2 成立下,名稱序不影響結果,只影響同時違反多條時的歸因。**

> 🔴 **P1b 為什麼是 must-fix 而不是潔癖(本機 PG17.10 實測)**:
> BEFORE UPDATE trigger 回傳 `NULL` ⇒ **該列的更新被靜默取消**。
> 實測:`UPDATE s SET carrier='sf' WHERE id=1` 在守門 `RETURN NULL` 之下回 **`UPDATE 0`、零錯誤**,
> 事後查值仍是舊值。⇒ **一支「看似只是不擋」的守門,可以把合法寫入整個吞掉而不留任何痕跡。**
> **連動修驗收**:§4 每一條「→ 成功」的正測,**oracle 不得只驗「沒有噴錯」**,
> 必須**回查該欄新值真的落庫**(`UPDATE 0` 與 `UPDATE 1` 在只看錯誤的測試裡完全一樣)。
🔴 **讀集重疊(X8 與 X2 同讀 `shipped_at`)是允許的** —— 重疊的是**讀**,不是寫;
會出事的是「前一支改了後一支要讀的值」,而 P1 直接排除它。
**歸因由驗收釘死**(§4 項 16):同時違反 X8+A2 → 必紅在 `frozen_after_ship`;
同時違反 A2+X2 → 必紅在 `immutable_guard`。未來有人改名 ⇒ 該格紅。
🟡 **契約債(對齊 A4a 契約債⑥)**:此斷言只在 apply 時跑一次、非常駐守門;
**未來任何在這兩張表掛 trigger / 改名的片必須重跑**。逐字寫進 migration 檔頭。
🔴 **反身性(v5.2 補,確認輪 nit)**:**S1b 自己就是「在 `shipments` 上掛 trigger 的片」**(X1)
⇒ 這條契約債從**本批內部**就已經被觸發一次。**S1b 的驗收必須重跑 S1a-2 立的名稱序斷言**,
不是留給未來的片。(這正是 A4a 契約債⑥ 那個坑的同型:立了債卻在同一批就先欠自己一次。)

---

## §4 驗收(由 §3.2 三張表逐格衍生;每條一個可判定 oracle)

### S1a-1(建表 + 恆時 CHECK)
1. 欄數與**約束名稱集合雙向**比對(多一條少一條都紅)。
2. **A1 負測**:`ABC` / 含 `0O1ILAEU` / 7 碼 / 小寫 → 各 `23514`;reference 重複 → `23505`。
3. **A3 負測(🔴 v5.2 修:格子要逐字寫死,不可寫成「`other` 無 note」讓實作者自行解讀)**:
   `carrier_code` 值域外 → `23514`;
   **`('other', NULL)` → `23514`**;**`('other', '   ')` → `23514`**;**`('hct', 'x')` → `23514`**;
   **判別力正測**:`('other','自送')` / `('hct', NULL)` → 各成功。
   理由:突變靶④(拿掉 `COALESCE`)**只有 `('other', NULL)` 那一格抓得到** ——
   若實作者把「無 note」造成 `''`,突變④會全綠、這條修法變裝飾(五格紅綠皆本機實測)。
4. **A4 負測**:快照缺鍵 / 多鍵 / 值非 string → 各 `23514`。
5. **A5 負測**:`hct_request_id` 重複 → `23505`;**判別力正測**:兩列皆 NULL → 成功。
6. **A9 負測**:`hct_status='delivered'`(U7 無此值)/ `'banana'` → 各 `23514`。
7. **X4/X5/X6/X7 負測**:`hct+submitted+request_id NULL` / `sf+submitted` / `sf+request_id 非空` /
   `deleted_at` 空但有 `void_reason` / 反向 / `void_reason='   '` → 各 `23514`。
8. **A6 負測**:owner DELETE / TRUNCATE / service_role DELETE → 各被擋。
9. 🔴 **RLS zero-policy + ACL 正反面 —— 必須在「非 superuser owner」之下跑,否則整格零判別力**
   (v5.3 修;施工前自檢實測,見 `docs/reviews/2026-08-05-b2-v5-2-implementability-selfcheck.md` ④):
   `scripts/d1t2-rehearsal.sh:40` 的拋棄庫 owner = **superuser `postgres`**,實查 `rolbypassrls=true`
   ⇒ **RLS 對 owner 路徑整個被繞過**。實證:同一筆寫入在該 owner 之下
   **FORCE RLS 開與不開都成功**(兩個假綠);換成 NOSUPERUSER owner 才分得出來(`ok` vs `42501`)。
   而**正式站的 `postgres` 不是 superuser**(memory `reference_supabase-postgres-not-superuser-cannot-revoke`)
   ⇒ 本機與正式站在這一面行為根本不同。
   **做法(已實測可行、兩行)**:harness 內 `CREATE ROLE <x> NOSUPERUSER NOBYPASSRLS` +
   `ALTER TABLE …/ALTER FUNCTION … OWNER TO <x>`,再跑 RLS 正反面。
   🔴 repo 先前把這件事列為**未驗**(`scripts/a6-verify.sh:1425-1428`、`s1a-verify.sh:264`)
   —— 本片是第一個有可複製做法的,**做法要回寫給那兩支**(落 §7 DoD 第 8 條)。
9b. 檔內 `DO $verify$` 通過;**兩表 `relforcerowsecurity = false`**(§3.2-C-2 前提②:
   加了 FORCE 連 owner 都要過 policy,而本片 zero-policy ⇒ 守門讀不到、誤殺;實測症狀 = `42501`,loud)。

### S1a-2(`shipments` BEFORE UPDATE 守門族;🔴 X1 已移至 S1b,見 §2)
10. **X2 負測**:已出貨包裹把 `shipped_at` 清成 NULL / 改成別的時間 → 各 `P0001`。
11. **X8 逐欄矩陣 · 已出貨面(§3.2-A 的 15 欄各一格,**15 格不得少列**)**:
    改凍結 3 欄(`recipient_snapshot`/`carrier_code`/`carrier_note`)→ 各 `P0001`;
    改 `tracking_number`/`hct_status`/`hct_request_id`/`hct_raw_response` → 各成功;
    改 `deleted_at`(🔴 **必須與 `void_reason` 成對給**,否則會紅在 X7 的 `23514`、量錯東西)→ 成功;
    改 `id`/`reference`/`customer_user_id`/`created_at` → 各 `P0001`(A2 面,與項 14 同源但這裡是欄矩陣的完整性);
    `updated_at` → 由 touch 自動改、不由外部指定。
11b. 🔴 **X8 逐欄矩陣 · 已作廢面(v5.1 新增,R3-Fable must-fix)**:對**已作廢(未曾出貨)**的包裹
    重跑同一份 15 欄矩陣 → 凍結 3 欄各 `P0001`。**沒有這一格,`OLD.deleted_at` 那半條件零覆蓋。**
12. **X8 階段判定正測**:同一句 UPDATE **同時**設 `shipped_at` 並改 `carrier_code` → **成功**
    (證明用 `OLD` 判階段,不是 `NEW`)。
13. 🔴 **F9 逃逸路徑正測**:已出貨 + `hct_status='failed'` → 重送(改 `hct_request_id` +
    `hct_raw_response` + `hct_status='submitted'`)→ **必須成功**;同一列改 `recipient_snapshot` → **必須紅**
    (證明 X8 縮小凍結集沒有整條拆掉)。
14. **A2 負測**:改 `id` / `reference` / `customer_user_id` / `created_at` → 各 `P0001`。
15. 🔴 **歸因格 ×2**(F13):同時違反 X8+A2 → 紅在 `shipments_frozen_after_ship_bu`;
    同時違反 A2+X2 → 紅在 `shipments_immutable_guard_bu`。
16. **名稱序 + §3.3 的 P1 / P1b / P2 前提斷言**(v5.2 改):
    catalog 查四支 BEFORE UPDATE 名稱序;
    **函式體 grep `NEW.<欄> :=` 與 `NEW.<欄> =` 兩形皆不得出現(P1)**;
    **grep 無 `RETURN NULL`(P1b)**;`touch` 是唯一寫 `NEW` 的一支且只寫 `updated_at`(P2);
    檔頭契約債逐字存在。
16b. 🔴 **「成功」正測的 oracle 紀律(v5.2 新增,確認輪 must-fix;本機實測支撐)**:
    §4 **所有**寫成「→ 成功」的格子,判定條件一律是
    **①無例外 **且** ②回查該欄新值 = 期望值**(至少一格明文斷言 `ROW_COUNT = 1`)。
    理由:守門 `RETURN NULL` 會讓 UPDATE 變成 `UPDATE 0`、**零錯誤**
    ⇒ 只驗「沒噴錯」的正測會在寫入被靜默吞掉時**照樣全綠**。
    **本條是驗收的通則,不是單一格**;突變靶:任一守門改 `RETURN NULL` → 對應正測必須紅。
17. **Q3=A 正測**:draft / submitted / 已出貨 三種狀態各自作廢 → 皆成功;**unvoid** → 成功。
18. **函式面合約斷言**(§3.2-C-2):四支函式的 `prosecdef` / `proconfig` 逐字 / owner / `proacl` 全釘。

### S1b(品項表 + X1)
19. 欄數/約束名稱集合雙向;`UNIQUE (shipment_id, order_item_id)` 重複 → `23505`;
    `(order_item_id)` index 存在(**catalog 斷言,不用 `EXPLAIN`** —— 小 fixture 上 planner 會選 Seq Scan ⇒ 假紅)。
20. **X3 負測**:已寄出 / 已作廢的包裹再加品項 → 各 `P0001`(兩個 `CONSTRAINT` 名歸因正確)。
21. 🔴 **X3 deferrability 判別格(v5.1 新增)**:catalog 斷言 `shipment_items_parent_guard_ac`
    的 `tgdeferrable = false`;**正測**:同一交易「加品項 → 設 `shipped_at` → commit」→ **必須成功**
    (若誤設 INITIALLY DEFERRED,這格會在 commit 被誤殺 ⇒ 這格就是那個錯誤的偵測器)。
21b. 🔴🔴 **parent guard 的鎖原語必須被「兩 session barrier」證明是承重的(v5.4 新增,codex K2 #25)**
    —— 本條是 v5.3 **真正缺的規格深度**,不是實作沒做到:v5.3 §4 從頭到尾沒有任何一條要求併發面,
    ⇒ harness 全部單 session,而**單 session 對鎖原語零判別力**。
    🔴 **實測證據(夜跑視窗消融)**:把 `FOR NO KEY UPDATE` **整句移除**後重跑整支 `b2s1b-verify.sh`
    → **PASS=24 / FAIL=0,全綠**。承重件被拔掉,驗收毫無反應
    (memory `feedback_race-test-without-barrier-proves-nothing` 的同型)。
    **要求的 oracle(兩 session、有 barrier)**:
    ① session A:`BEGIN` → `INSERT shipment_items`(觸發 guard、對 parent 取 `FOR NO KEY UPDATE`)→ **不 commit**;
    ② session B:`BEGIN` → `UPDATE shipments SET shipped_at=…` 同一列 → **必須被擋住(阻塞)**;
    ③ 斷言 **`pg_blocking_pids(B) = {A}`** —— 釘死「擋住 B 的就是 A」,不是「B 剛好慢」;
    ④ A commit 後 B 解除阻塞。
    🔴 **這格的判別力來源要明講(否則會量錯東西)**:`shipment_items` 的 FK 會對 parent 自動取
    **`KEY SHARE`**,而 `KEY SHARE` 依 PG 列鎖衝突矩陣**只與 `FOR UPDATE` 衝突、不與 `NO KEY UPDATE` 衝突**
    ⇒ 若 guard 改用普通 `SELECT`,B 的 `UPDATE`(取 `NO KEY UPDATE`)**不會被 FK 的 KEY SHARE 擋住**。
    ⇒ 「B 被擋住」這個觀察**只可能由 guard 那句顯式 `FOR NO KEY UPDATE` 提供**
    (memory `feedback_negative-test-observation-supplied-by-another-mechanism` 要求的「排除他源」)。
    **突變靶⑦**:guard 的 `FOR NO KEY UPDATE` 改成普通 `SELECT` → **本格必須紅**(B 不再被擋)。
21c. 🔴🔴 **barrier 方向乙(v5.4 新增,codex K2-R2 must-fix 2)—— 方向甲單獨不夠**:
    方向甲證明的是「guard 執行時 parent 上有 NKU」,但一個「**先普通讀舊值、之後才另外取鎖**」的寫法
    在方向甲之下**照樣全綠**(stale-pass 沒被封死)。⇒ 反向再測一次:
    ① session A:`BEGIN` → `UPDATE shipments SET tracking_number=…`(取 NKU)→ 持有 **12 秒**;
    ② session B:`BEGIN` → `INSERT shipment_items` 同一 parent → **必須被擋在 guard 自己那句讀取上**;
    ③ `pg_blocking_pids(B) = {A}`;
    ④ 🔴 B 的正確結局是**在 5 秒被 guard 自己的 `SET lock_timeout='5s'` 中止**,不是等到 A 收工 ——
      這一格同時把「會等」與「不會無限等」兩件事一起釘住(A 持鎖 12 秒 > 5 秒門檻,兩者可分辨)。
    **突變靶⑦ 對本格同樣必須紅**(拿掉鎖原語後 B 不再被擋)。
    🔴 **本格的誠實邊界(寫進驗收,不要事後才說)**:它證明的是
    「`FOR NO KEY UPDATE` 那個子句提供了阻塞」,**不是**「任何改寫都不可能先讀舊值再補鎖」——
    後者屬 code review 的範圍,測試構造不出來。
22. **A7 負測**:同箱塞入另一位客人的品項 → `P0001`。
23. **A7 判別力正測(Q1=B)**:同客人、**兩張收件地址不同的訂單**併入同一箱 → **必須成功**。
24. 🔴 **F10 補救路徑正測**:包裹 A 選錯 carrier → 已出貨 → 作廢(留 `void_reason`)→
    **同一批 `order_item` 加進新包裹 B、設正確 carrier、出貨 → 必須全部成功**。
    (證明「作廢重開」真的是可走的補救路徑,不是紙上說法。)
    🔴 **本格的地位在 2026-08-05 升級了(v5.2 補)**:Sean 拍板 shipped 強制點 **Q1=A** 時,
    **明文接受的 U1 更正流程就是「出貨後要改到貨帳 ⇒ 先作廢包裹 → 改 → 重新出貨」**
    (`origin/dev` `b92f62b`,分析檔 §10)。⇒ 這格不再只是 F10 的補救證明,
    **它是 Sean 已拍板的正式作業流程在 DB 層的唯一驗收** —— 它紅掉 = 那條拍板的流程走不通。
25. **A6 負測**:`shipment_items` 的 owner DELETE / UPDATE / TRUNCATE → 各被擋。
26. **A8 負測**(F11):`hct` / `sf` 包裹設 `shipped_at` 但 `tracking_number` 為 NULL / `'  '` → 各 `23514`。
27. **A8 判別力正測**:`other` 包裹無單號出貨 → **必須成功**(A3 已強制 `carrier_note` 說明送法)。

#### S1b · X1 專段(整條從 S1a-2 移來;🔴 判別序已修)
28. **X1 負測 · INSERT 面**(F12):**一筆 INSERT 直接帶 `shipped_at`、零品項** → commit 時 `P0001`。
29. **X1 負測 · UPDATE 面**:先建草稿 → UPDATE 設 `shipped_at`、零品項 → commit 時 `P0001`。
30. **X1 負測 · 送單面 D∅**(F2):`hct_status='submitted'`、`shipped_at` 空、零品項 → commit 時 `P0001`
    (INSERT 面與 UPDATE 面各一格)。
30b. 🔴 **X1 負測 · 送單面 D≠∅**(v5.1 新增,R3-Fable must-fix:F2 自己補的作廢面 2 格原本零驗收):
    **已作廢**且 `hct_status='submitted'`、零品項 → commit 時 `P0001`。
30c. 🔴 **X1 負測 · `failed` 面 ×2(v5.2 新增,確認輪 must-fix)**:
    `hct_status='failed'`、零品項,**D∅ 與 D≠∅ 各一格** → commit 時 `P0001`。
    理由:項 30/30b 全踩 `submitted` ⇒ 若實作者把 X1 條件誤寫成 `hct_status = 'submitted'`
    而不是 **`hct_status <> 'draft'`**,F2 那族的 `failed` 兩格會**全綠**、缺口原封不動。
    `failed` 面可達:草稿直接改 `failed`(X4 只管 submitted、X5 只要 `carrier_code='hct'`)。
31. 🔴 **X1 正測 · 真判別序(v5.1 修:原項 13 是假綠)**:
    ~~建包裹 → 加品項 → 設 `shipped_at` → commit~~ **那個順序在 IMMEDIATE 下也全綠**,
    量不到 DEFERRED。**改成:同一交易先讓包裹離開草稿態(設 `hct_status='submitted'`,此時零品項)
    → 再加品項 → commit → 必須成功。** 只有 DEFERRED 會綠。
    (為什麼不用 shipped-first:X3 會擋「對已寄出包裹加品項」⇒ 唯一可構造的判別序是 submitted-first。)
    **突變檢查**:把 X1 改成 IMMEDIATE,本格**必須紅** —— 紅不了就代表這格還是量錯東西。
32. 🔴 **X1 暫態正測(v5.1 新增)**:同一交易 設 `hct_status='submitted'` → **改回 `'draft'`** →
    零品項 → commit → **必須成功**(終態 = L1 合法)。
    這格證明 X1 函式**重讀現況列、不信 `NEW`**;信 `NEW` 的寫法會在這裡誤殺。
33. RLS/ACL 同標準。

### 全批
34. 🔴 **既有 harness 全綠**(F5;v4 的 43 條驗收沒有任何一條要求這個):
    `a1-verify.sh` / `a2b1-verify.sh` / `a4a-verify.sh` / `a5a-verify.sh` / `a6-verify.sh` /
    `a8a1-verify.sh` / `a8a2-verify.sh` / `a7-verify.sh` 逐支跑,`PASS = EXPECTED_TOTAL`、`FAIL = 0`。
    **預期不受影響**(本批只新建兩張表、零觸碰既有物件),但**要跑出來、不靠推論**。
35. **突變矩陣**:**有配靶的那些**斷言各有專屬突變、**只紅自己那條**;消融**等長同形**。
    🔴 **v5.4 措辭更正(codex K2-R2 must-fix 12,兩輪才收斂)**:v5.3 原文寫「**每條**斷言各有專屬突變」,
    那句與事實不符 —— 三支 harness 合計 **160 條 PASS**,而突變靶只有 **17 個**。
    **有配靶的**(15 個,清單見下)= 鎖原語、DEFERRED 與重讀現況、X8 凍結集逐欄(含 carrier_note 與
    `OR OLD.deleted_at`)、fixture 合法性、回查 oracle、A3 的 COALESCE、`pcm_b2_is_blank`、
    X5 專屬格、TRUNCATE 歸因、a1 的索引定義。
    🔴 **明文列出「沒有配靶」的**(不要讓讀者以為都有):欄數與約束名稱集合、trigger 名稱集合、
    ACL/RLS 矩陣、`expect_constraint` 的歸因斷言、S1b 兩個索引的定義全等 ——
    它們靠的是 catalog 全等比對(改壞就不等),不是消融證明。
    ⇒ 🔴 **160 條全綠 ≠ 完整 mutation coverage,兩者不得互相代言**(這正是本批重工的起因)。
    🔴 **本輪指定的四個突變靶**(R3-Fable 打出來的,必須各自被抓到):
    ①X1 改 IMMEDIATE → 項 31 紅 ②X1 函式改成信 `NEW` → 項 32 紅
    ③X8 條件砍掉 `OR OLD.deleted_at IS NOT NULL` → 項 11b 紅
    (🔴 **該格 fixture 的 `hct_status` 必須是 `draft`**,否則會先紅在 X5 的 `23514`、歸因錯人)
    ④A3 拿掉 `COALESCE` → 項 3 紅(**判別力只在 `('other', NULL)` 那一格**,見項 3)
    ⑤(v5.2 新增)任一守門改 `RETURN NULL` → 對應的「→ 成功」正測必須紅(項 16b)
    ⑥(v5.2 新增)X1 條件寫成 `= 'submitted'` 而非 `<> 'draft'` → 項 30c 必須紅。
    ⑦(**v5.4 新增**)parent guard 的 `FOR NO KEY UPDATE` 改普通 `SELECT` → **項 21b 必須紅**
    (v5.3 之下此突變**全綠**,實測 24/0 —— 見項 21b)。
    🔴 **實跑歸屬(v5.4 更正)—— v5.3 這一句與事實不符**:它寫「③⑥ 由 `b2s1b-verify.sh` §F 實跑證」,
    但實查三支 harness,**靶③ 一個都沒實作**(⑥ 確實在 `b2s1b` §F)。更正後的實際歸屬:
    ①②⑥ → `b2s1b-verify.sh` §F;④⑧⑨⑩⑪⑫ → `b2s1a1-verify.sh` §F;
    **③⑤⑬⑭⑮ → `b2s1a2-verify.sh` §F**(③ 為 v5.4 補實作,fixture 用「draft + 已作廢」避免歸因到 X5);
    **⑦ → `b2s1b-verify.sh` §8/6**(v5.4 補實作:兩 session barrier + `pg_blocking_pids` 釘死「擋你的是誰」,
    附 apply/還原雙檢查 —— 該突變改的是真函式,兩個 session 都要看得見,不還原就污染整個庫)。
    v5.4 另新增的實作層靶:**⑧**X5 專屬格 **⑨**TRUNCATE 歸因 **⑩**`pcm_b2_is_blank` 退回 `btrim`
    **⑪**索引改建在錯欄位 **⑫**`expect_landed` 的回查 oracle(守門改 `RETURN NULL`)
    **⑬**carrier_note 移出 X8 凍結集 **⑭**拿掉 touch trigger **⑮**fixture 退回「零品項已出貨」。
    v5.4-c(`B-126-A`)再加兩靶:**⑯**同名 trigger 改掛 `BEFORE INSERT`(tgtype 19→7)⇒ 前置閘的三元組必紅;
    **⑰**SECDEF 加第三段 GUC(`statement_timeout`)⇒ **全陣列比對紅、舊的 `proconfig[1]` 比對不紅**
    —— 靶⑰ 同時是「新舊兩種寫法判別力差」的直接證據。
    🔴 **v5.4-c 另補:身分閘自身的判別力**(Fable 確認輪 F1,must-fix)。閘的判準抽成
    不連線的純函式 `gate_decide addr port`,自檢**兩向直測**(壞位址須拒、好位址須放)
    + `gate_wiring_check` 對原始碼斷言接線存在。四個消融實測全部咬得住:
    ①`gate_decide` 恆放 ⇒ 自檢紅 ②恆拒 ⇒ 閘直接拒跑(fail-closed、更早)
    ③刪掉閘的呼叫點 ⇒ 接線格紅 ④閘改成不用純判準(內聯 case)⇒ 接線格紅。
    🔴 ④ 第一版曾**假綠** —— 接線檢查的 `grep` pattern **比對到自己那行原始碼**;
    加行首縮排錨點才修好。**斷言拿自己的原始碼當證據,是消融才抓得到的。**
36. 三片 harness 在 `d1t2-rehearsal.sh provision` 拋棄庫實跑。
37. **三個 cut point 故障注入**:逐一模擬「前 N 支成功、第 N+1 支失敗」,每種答出
    ①ledger 應有哪幾筆 ②schema 實況 ③續跑命令 ④是否安全。
    🔴🔴 **本項 2026-08-05 重工批【未做】,明文記在這裡而不是靜靜跳過**(codex K2-R4 must-fix 4):
    三支 harness 驗的是**三片全套之後的終態**,而本項要的是**逐片中間態**。
    而且 `b2s1a1-verify.sh` 現在**已經依賴 S1b**(合法 fixture 要插 `shipment_items`)
    ⇒ 它連「只套到 S1a-1 的庫」都跑不起來,**結構上就不可能代言 cut point ①**。
    ⇒ 本項需要各自 provision 的獨立驗收,**154 條全綠不涵蓋、也不宣稱涵蓋**;
    §8 的 cut point 表目前只有**論證**(零 writer + 零品項表 ⇒ 安全),**沒有實跑證據**。
    **apply 前必須先補這項**,或由 Sean 知情接受「靠論證不靠實跑」。
38. **零留痕**:全程 `git status --porcelain` 比對;拋棄庫 teardown 後無殘留 cluster。

---

## §5 風險與誠實邊界

1. 🔴 **做完員工一件事都不能做**。完成地圖第 8-11 項**全部維持 ❌**、一格不動。
   本批交付的是**兩張空表**,零 writer、零讀模型、零 UI。
2. 🔴 **「shipped 該在哪一層被強制」= 未定案**(§0.1)。本批**完全不碰**摘要表、A4a、任何 RPC
   ⇒ 不製造第四個錯誤前提。承接 = 主視窗委的獨立分析(`B-31-A` ②)+ 之後的 S2 片。
3. 🔴 **`shipped ≤ instock` 本批零強制力**,而且**連承接欄都還不存在** —— 比 v4 更早的階段。
   誠實形狀:本批不宣稱清償 A1 契約債的任何一部分。
4. 🔴 **死結:`lock_timeout` 接不到**(F4,主視窗 `B-31-A` ⓪ 認錯)。
   死結由 deadlock detector 在 `deadlock_timeout` raise **40P01**;`lock_timeout` 只管**非環狀等待**(55P03)。
   本批 `shipment_items` parent guard 會鎖 parent(NKU)⇒ 多包裹交易理論上仍可反序持鎖;
   **處置 = 40P01 fail-closed 可重試 + 呼叫端重試,誠實寫進函式 COMMENT,不宣稱已防**。
   🟡 本批**零 writer** ⇒ 實務不可達;真正的鎖序紀律屬出貨 writer RPC 那片。
5. 🔴 **Q3=A 的流程風險 DB 層擋不住**:員工可在貨已寄出後於系統內作廢包裹。
   Sean 知情選擇;`void_reason` + 稽核是唯一事後追溯手段。**不得宣稱「作廢有防呆」。**
6. 🔴 **A8 的前提是實務假設**(標籤先印才交寄)。前提倒了 = 員工當天出不了貨(§4 項 27 會紅),
   承接改法已寫明(§3.2-C),**不得靠刪 CHECK 解決**。
7. 🟡 **X1 用 DEFERRED** ⇒ 錯誤在 commit 當下才報,訊息位置不直覺。已知代價。
8. 🟡 **§3.2-D 的殘餘風險**:守門集合的完整性沒有人保證,只有突變矩陣讓「守門被拿掉」可被觀察。
9. **零 app 層改動** ⇒ 不重 gen `database.types.ts`;首個消費端那片負責。

### 5.1 ✅ 兩題已拍板(Sean 2026-08-05,`B-111-A`):**Q-a=C / Q-b=A**

> **兩題都是「DB 維持現行嚴格設計」** ⇒ **X1 維持單支、`hct_*` 維持覆蓋、兩張表形狀一字不動。**
> - **Q-a=C**:資料庫不放寬(品項入箱後不可改刪),補救做成**出貨畫面的「照這箱內容開一張新的」按鈕**
>   ⇒ **交辦給未來的出貨 UI 片**(§7 DoD 9),本批不做。
>   🔴 轉發時已附「Q1=A 已接受鄰近代價、差別在頻率」的脈絡,**Sean 知情拍的**。
> - **Q-b=A**:同箱重送只留最新一次,欄位設計不變。
> ⇒ **本節以下的備選表保留為當時的比較紀錄,`已拍板、不再開放`;不得再依備選② 施工。**

> 兩題都是**災難日會真的發生**的事,而且都不是「加個守門」能解的——它們是業務取捨。
> 依 R3 紀律(涉不可逆/流程變更 ⇒ 停下標明),**當時列在這裡等拍板,不寫預設答案**。

**Q-a|裝箱數量打錯,唯一補救是不是「整箱作廢重開」?**
現行設計:`shipment_items` **草稿期就 append-only**(A6)+ `UNIQUE (shipment_id, order_item_id)`
⇒ 裝箱時把「出 2 件」打成「出 3 件」,**改不了、刪不掉、也不能再插一列**
⇒ 唯一出路 = 整箱作廢重開(燒一個 `shipment_reference`、留一筆作廢紀錄)。
這在**裝箱當下**是最高頻的人為錯誤。
🔴 **`docs/specs/2026-08-01-admin-completion-map.md` 的拍板清單裡沒有這一條** ⇒ 沒被問過。

| 案 | 內容 | 真實成本(v5.2 修:備選②的成本原本漏列一半) |
|---|---|---|
| **①維持** | 草稿期就 append-only,打錯只能整箱作廢重開 | 稽核最乾淨、DB 零改動;代價 = 燒一個 `shipment_reference` + 一筆作廢紀錄 |
| **②草稿期開放改/刪** | `shipped_at IS NULL` 且 `deleted_at IS NULL` 時允許 UPDATE/DELETE | 🔴 **不只是放寬 A6**:X1 的**前提③會被打倒**(§3.2-C)—— X1 只掛 `shipments`,靠 A6 的「品項數單調不減」才夠用;開放刪之後「送單 → 把品項刪光」**不觸發 X1、零錯誤**。⇒ 必須同批 **①X1 改雙支**(子表那支要 `AFTER INSERT OR UPDATE OR DELETE`,先例 `20260730140000:214-226`)**②`shipment_items` 的凍結條件要含 `hct_status <> 'draft'`**(不只看 `shipped_at`) |
| **③(確認輪提的第三案)writer 層「一鍵複製重開」** | DB 維持①,由出貨 UI/RPC 提供「照這箱內容開一張新的」 | 稽核 = ①(完全不動 DB 不變式);成本 ≈ ②但**落在 writer 片、不在本批**;天然保留原箱的 `hct_*` 證據。**本片推薦優先評估這案** |

**Q-b|HCT 證據欄可以被覆蓋/清空,與 UX §4 #17「留痕」的意旨相不相斥?**
F9 的逃逸路徑(重送)會**抹掉前一次外部呼叫的痕跡**。
🔴 **v5.2 收窄題目範圍(確認輪指出)**:原本我把「草稿期換快遞商」也算進來,
但那一路**已經有免費的留痕出路** —— 走 F10 的作廢重開,原箱連同 `hct_*` 原樣留著。
⇒ **真正會抹掉證據的只剩 F9 重送這一條。**

| 案 | 內容 | 成本 |
|---|---|---|
| **①維持** | `hct_*` 只保留最新一次 | 欄位最省;代價 = 重送後查不到前一次送了什麼 |
| **②append-only 履歷子表** | 另立 `shipment_hct_attempts` | 稽核最完整;**多一張表、本批範圍外** |
| **③(確認輪提的第三案)`hct_raw_response` 改 jsonb 陣列 append** | 不加表,每次呼叫 append 一筆 | 折衷:留痕但不動表數;代價 = 欄位語意變成「歷次」、讀取端要改 |

與 MP `:206`(UX §4 #17:「請求識別值 + 原始回覆 + 三段狀態;只允許安全重試」)字面對照後,
**該條沒明說要保留歷次** ⇒ 不算字面衝突,但「**重送安全**」的意旨與「證據被覆蓋」存疑。

---

## §6 回滾

**反向逐支**:S1b → S1a-2 → S1a-1。forward-only ⇒ 另立版本號更大的 down migration。

- **本批交付當下兩表 0 列、零 writer** ⇒ 回滾是乾淨的(這是停損版比 v4 好回滾的地方:
  v4 要動摘要欄,有真實資料就回不去)。
🔴 **通則(v5.1 修,R3-Fable must-fix)**:`DROP TABLE` **不帶走獨立函式** ⇒ **每一片的回滾都要逐支
`DROP FUNCTION`**,不是只有 S1a-2 那行要寫。v5 原文只在 S1a-2 那行提了這件事,S1a-1 那行就漏了
—— 而 S1a-1 自己就建了 block delete/truncate 兩支函式。

- **S1b** → DROP trigger ×4(`shipment_items` 上:parent_guard_ac / block_update_bu / block_delete_bd
  / block_truncate_bt)+ 🔴 **`shipments` 上的 `shipments_items_presence_ac`(X1,本片建的、掛在另一張表)**
  + **對應函式 ×3**(`append_only` / `parent_guard` / `items_presence` —— 🔴 **不是 ×5**:
  `shipment_items` 上的三支 block trigger **共用同一支 `append_only` 函式**,trigger 數 ≠ 函式數;
  v5.3 原文寫 ×5 是把 trigger 數當函式數,codex K2 nit 1 抓到、實查 migration `:320-321` 確為 3 支)
  + index + TABLE。**X1 最容易漏**:它屬 S1b,卻不長在 `shipment_items` 上。
- **S1a-2** → DROP trigger ×4(frozen_after_ship_bu / immutable_guard_bu / touch_updated_at_bu
  / write_once_bu)+ 對應函式 ×4。
- **S1a-1** → DROP trigger ×2(block_delete_bd / block_truncate_bt)+ **對應函式 ×2** + TABLE
  + partial unique index。
- 🔴 **`shipment_reference` 的「永不重用」在 DROP 之後不成立** ⇒ **一旦有真實包裹就不 DROP**;
  真要 DROP 必須把舊值**持久化進留存表**並讓產號重試迴圈實際查它(匯出成檔案沒有約束力)。

---

## §7 MP 回寫與 DoD 交棒

v4 §7 的 10 處已完成;主視窗另已清 MP 三處汙染字面(`:283`/`:466`/`:562`,`B-29-STOP` 五)。
**v5 新增要落 MP §5.2 的 DoD**(`B-31-A` ③:現在就寫,不留到下一線):

| # | 落在 | 內容 |
|---|---|---|
| 1 | MP §5.2 項 2 DoD | 🔴 **S2 那片開工第一件事 = 實跑 `scripts/a1-verify.sh`,依實跑結果決定同批要改什麼**(F5 的動作保留、理由改寫,見下方 🔴 更正) |
| 2 | MP §5.2 項 2 DoD | 🏁 **2026-08-05 Sean 拍板 Q1=A 已定案,本條改述**:`shipped ≤ instock` 的**承重強制點 = 摘要表 CHECK `oiqs_shipped_le_instock`(C9)**,由 A4a row-level 重算維護;出貨 writer RPC **只做訊息層前緣拒絕、不是正確性來源**。~~強制點由出貨 writer RPC 承接~~。獨立分析已完成(`docs/specs/2026-08-05-shipped-enforcement-analysis.md` §10),此前置條件已滿足;施工歸屬 = B2-S2 片 |
| 3 | MP §5.2 項 2 DoD | 三組併發 barrier 負測(2×unvoid / INSERT×unvoid / cancel×unvoid)+ 冪等重放 oracle —— 本批造不出來(零 writer),**標 inconclusive,不假裝補** |
| 4 | MP §5.2 / E4 段 | `order_shipped` 的 `dedup_key`「該批穩定識別」(`20260717020000:301`/`:349`)⇒ **候選 = `shipment_reference`**(本批交付);E4 落地時不必另發明識別 |
| 5 | MP §5.2 / E4 段 | 🔴 **通知 fail-closed 要求**:`order_shipped` 模板落地時,`tracking_number IS NULL` 只可能是 `carrier_code='other'`(A8 保證)⇒ 模板必須分流,**不得寄出「已出貨但無單號」的通用信** |
| 6 | MP 第 2 批段 | 本批**只交付兩張表**;摘要整合、C6/C7、契約債清償**全數延到下一線**。🏁 ~~且「shipped 該在哪一層被強制」未定案~~ **該題已於 2026-08-05 由 Sean 拍板 Q1=A/Q2=A 定案**(C9 承重),下一線 = B2-S2 片 |
| 9 | MP §5.2 項 3(出貨輸入 UI)DoD | ✅ **Sean 2026-08-05 拍 Q-a=C 的產物**:出貨畫面要有**「照這箱內容開一張新的」按鈕**(裝箱打錯量的唯一補救;DB 端刻意不放寬 ⇒ **這個按鈕是該情境的完整解,不是加值功能**)。行為 = 讀原箱品項 → 開新箱帶入同樣品項與收件資料 → 原箱走作廢(留 `void_reason`)。**本批不做,但不得在 UI 片被當成 nice-to-have 砍掉。** |
| 8 | 回寫 `scripts/a6-verify.sh` + `s1a-verify.sh` | 🔴 **「RLS 斷言要有判別力」的可複製做法**(v5.3;施工前自檢實測):那兩支把「正式站 owner 是否 superuser/BYPASSRLS」列為**未驗**(`a6-verify.sh:1425-1428`、`s1a-verify.sh:264`),但實測顯示只要在 harness 內 `CREATE ROLE … NOSUPERUSER NOBYPASSRLS` + `ALTER TABLE/FUNCTION … OWNER TO`,該族斷言就從恆真變成有紅有綠。**本片是第一個有做法的,不要讓它只留在本片。** |
| 10 | MP §5.2 項 2 DoD | 🔴 **多列 INSERT 的鎖序交棒(v5.4 新增,codex K2 nit 5)**:parent guard 是 `FOR EACH ROW`,一句 `INSERT … VALUES (…),(…)` 會**依輸入列序**逐一對不同 `shipment_id` 取 `FOR NO KEY UPDATE` ⇒ 兩個交易以**相反順序**併箱多張包裹時仍可能真 `40P01`。本批**造不出來也不宣稱擋得住**(零 writer)。⇒ writer RPC 片必須二選一:**①每交易只處理單一 `shipment`**;或 **②同交易多箱時先 `ORDER BY shipment_id` 再插入**,並配 `40P01` 重試。**不得假設「guard 用了 NKU 就沒有死結面」** |
| 7 | MP §5.2 項 2 DoD | 🔴 **DEFERRED × 外部呼叫的交棒缺口(R3-Fable must-fix,v5.1 新增)**:出貨 writer 若在**同一個交易裡**呼叫新竹 API 再 commit,X1 是 **commit 當下**才驗 ⇒ 失敗時**外部已收單、庫內紀錄隨 rollback 蒸發**(對外不可回收,錢/物流面)。⇒ writer 片必須二選一:**①外部呼叫移到交易之外(先 commit 再送單,失敗走重送)**;**②送單前先做一次 immediate 的品項存在檢查**(X1 仍留著當最後一道)。**不得放著讓 DEFERRED 當唯一防線。** |

### 7.1 與獨立分析(C9 方案)的相容性自核(`B-103-A` 要求)

獨立 Fable 分析 `docs/specs/2026-08-05-shipped-enforcement-analysis.md`(dev `e49e8bc`,**我親讀**)
推薦 **E1 = 摘要表 CHECK `oiqs_shipped_le_instock`(C9)**,由 A4a row-level 重算維護。

✅ **與 v5 兩張表零衝突**:C9 掛在摘要表、由重算函式讀 `shipment_items JOIN shipments`,
v5 已備妥它需要的一切(`(order_item_id)` index、`deleted_at`/`shipped_at` 可判定、品項 append-only)。
**v5 不需要為 C9 改任何形狀。**

🔴 **但要交棒一條給 S2 片(我自核時發現的,分析文未涵蓋)**:
分析 `:98` 的前提 P3 寫「`shipped>0` **必經 `shipment_items` 事件** ⇒ 必有列」。
在 v5 的 **X3**(已寄出/已作廢後禁加品項)之下,這句要改述:
- 加品項事件保證的是「**摘要列已存在**」(惰性建列)✅ 前提這一半成立;
- 但**真正讓 `shipped` 升值的是 `shipments.shipped_at` 那一筆 UPDATE** ——
  因為「INSERT 一張已 `shipped_at` 的包裹再加品項」會被 X3 擋死、永遠 commit 不了
  ⇒ 包裹**只可能**經由 UPDATE 變成已寄出。
- ⇒ **S2 的重算必須同時掛 `shipments` AFTER UPDATE OF `shipped_at`,`deleted_at`;
  只掛 `shipment_items` 會讓 `shipped` 永遠是 0(且零錯誤訊息)。**
  v4 §3.3 本來就規劃了兩支 trigger,此處是把**理由**釘死,避免未來有人「精簡成一支」。

🔴 **更正 R3 的 F5(我親讀 harness 後複驗不成立;`B-31-A` ③ 稱這條「實查很值錢」,但它的機制講錯了)**

R3 的字面是「S2 落地後 `scripts/a1-verify.sh` **保證全紅**」。我讀了該 harness:

| 事實 | 出處 |
|---|---|
| `MIG` = **只有 A1 那一支 migration** | `scripts/a1-verify.sh:33` |
| provision 走 `d1t2-rehearsal.sh provision` 建拋棄庫 | `:88-92` |
| `drop_a1()` = `DROP TABLE order_item_quantity_summary` + drop `order_items_id_quantity_key` | `:113-119` |
| 對照組 = drop → **單獨重套 A1** → grep `'A1 結構驗收全數通過'` → 跑行為探針 | `:447-454` |

⇒ 結構斷言的對照組是「**A1 單獨重建出來的表**」,不是正式站現況的表。
S2 加欄之後,這一步仍會 drop 掉 6 欄的表、由 A1 重建成 5 欄再斷言 ⇒ **結構斷言照樣綠**。
**「保證全紅」未證實,而我讀到的機制指向相反。**
🟡 **仍未確認的兩件**:①`d1t2-rehearsal.sh provision` 會不會把未來的 S2 一起套進拋棄庫
②S2 的 trigger/函式在「表被 drop 又重建成 5 欄」之後,行為探針會不會紅。
⇒ **動作保留(S2 開工先實跑)、理由改成「實跑看結果」,不寫成已知必紅。**

🔴 **收尾要 grep 全樹一次**(本片已三度發生「清單漏處」;`feedback_claimed-sync-but-only-patched-touched-lines`)。

---

## §8 Apply 合約

**三支同批 apply,順序強制 `S1a-1 → S1a-2 → S1b`。**
🔴 `supabase db push` **逐支提交、非同一 transaction** ⇒ 同批的真實效力 = **把危險窗縮到一次 apply 事件內**,
**不是原子性**。

| 項 | 內容 |
|---|---|
| **主防線** | **S1a-2 / S1b** 每支開頭 `DO $$` **forward-only 前置閘** pin 上一支的產物(🔴 v5.4 改:具名集合 + `tgenabled` 雙向比對,不得只數數量 —— 純計數對「改名」隱形,codex K2 #14)。🔴🔴 **v5.4-c 更正(`B-126-A`)**:v5.4 這句寫「**+ 事件面**」= **宣稱 > 事實** —— 實作的聚合鍵當時只有 `tgname:tgenabled`,**tgtype 根本沒進去**,同名 trigger 改掛 BEFORE/AFTER 或換事件面照樣全綠(codex K2-R1 must-fix 8,已親驗)。現已把聚合鍵擴成 **`tgname:tgenabled:tgtype`** 四處全改,並配突變靶⑯(改成 `BEFORE INSERT` ⇒ tgtype 19→7 ⇒ 閘必紅)⇒ **這句話現在才變成真的**。不符即 `RAISE`、拒重跑 |
| **主防線之例外(v5.4 明文,codex K2 nit 4)** | 🔴 **S1a-1 沒有、也不需要 `DO $gate$`**:它是本批第一支,**沒有上一支的產物可 pin**;它的 forward-only 保護由 `CREATE TABLE public.shipments` 自身的 **`42P07 duplicate_table`** 承擔(重跑必紅、且紅在 BEGIN 之後 ⇒ 整支回滾)。v5.3 §8 原文寫「**每支**開頭」= 宣稱 > 事實(S1a-1 實查 `DO $gate$` 命中數 = 0)⇒ 本列即該宣稱的更正,**不是補一支多餘的閘** |
| **cut point ①** | S1a-1 成功、S1a-2 失敗 = `shipments` 在但**可變性未鎖**;零 writer、零品項表 ⇒ **安全** |
| **cut point ②** | S1a-2 成功、S1b 失敗 = **只有 `shipments`**,**可變性守門完整、但 X1 尚未存在**(X1 在 S1b)⇒ 此中間態「已寄出必有品項」不生效。**仍安全,因為零 writer、零品項表**(沒有任何路徑能造出一張有品項的包裹)。🔴 v5.1 修字面:原文寫「守門完整」= 宣稱 > 事實 |
| **cut point ③** | 全成功 = 兩張空表 ⇒ **安全** |
| **處置** | 修出錯那支、從該支重套;**禁整批重跑** |
| **硬前置** | 🔴 出貨 owner RPC 不得早於三支全數 apply;**正因 apply 非原子,這條更重要** |

---

## §9 證據資產處置

- `scripts/b2s1-concurrency-probe.sh`(568 行,未 commit):**本批不採用、不 commit**。
  理由:A-F 段測的是 **A4a 摘要重算**的鎖序(S2 那層),G 段整段在量一個 **v4 已撤掉的設計**
  (statement-level + `ORDER BY`)⇒ **量錯東西**(R3 F16)。檔案留在 worktree 磁碟,
  隨 S2/出貨 RPC 那線重寫時取用。
- v4 §9.1 的 A-F 結論(承重件 = parent 鎖、承重點 = 鎖排在讀 SUM 之前)**屬 A4a/S2 層,本批不依賴**。
- v4 全文備份:`plan-v4-worktree-backup.md`(本 session scratchpad),**未 commit**。

---

## §10 送審指引

### 10.1 R3 判定輪(Fable)—— ✅ **已跑完:FAIL / 13 must-fix / 7 nit**

報告:`docs/reviews/2026-08-05-b2-v5-fable-r3.md`。逐條處置見 §0.35。
五角度的結論摘要:①守門完整性 = F1 的病**以縮小規模復發**(A 表宣稱涵蓋、衍生測試沒接到作廢面)
②災難日 = F9/F10 走得通,但**第四情境「裝箱打錯量」無補救**(§5.1 Q-a)
③名稱序 = 結論成立但**字面前提為假**(第五個假設)④假綠 = **項 13 是真假綠**
⑤獨立枚舉 24 格 = **14 合法 / 10 非法,與 §3.2-B 逐格零差異**(遺失 R3 的替代確認已完成)。

### 10.2 確認輪(Fable, fresh context)—— ✅ **已跑完:FAIL / 4 must-fix + nit,v5.2 全修**

報告:`docs/reviews/2026-08-05-b2-v5-1-fable-confirm.md`。逐條處置見 §0.36。
關鍵產出 = **四個突變靶被實測驗過三個**(①②實測會紅、⑤ 由本片實測補證;③④⑥ 仍是推理)。
它抓到的四條全部落在「**修法自己的判別力**」這一層,**不是前輪的重複**。

### 10.3 下一步(不是再開一輪審查)

🔴 **本片現在卡在 §5.1 的 Q-a / Q-b 兩題,那是 Sean 的業務取捨,不是審查能解的**:
- **Q-a 直接決定 X1 的實作形狀**(拍備選② ⇒ X1 必須改雙支、`shipment_items` 要加凍結條件)
  ⇒ **拍板前開工會做出一個註定要重寫的 X1。**
- Q-b 決定 `hct_*` 的欄形(維持 / 子表 / jsonb 陣列),影響 S1a-1 的建表。

**⇒ 建議順序**:①主視窗轉 Sean 拍 Q-a / Q-b ②依拍板結果調整 §3.2-C 與 §3.1
③**只有在 Q-a 拍了備選②時**才需要再跑一輪(因為那會新增 trigger、屬結構變更);
拍①或③則 v5.2 即可視為定稿、直接進實作。

**🔴 若真要再開一輪,必須換角度**(前兩輪都是 Fable、都已把「守門完整性 / 假綠」挖過一遍):
建議角度 = **「這三片在真的施工時會不會做不出來」**(SQL 可實作性、harness 可構造性、
`d1t2-rehearsal.sh provision` 的相容性)—— 這一面兩輪都沒碰過。
