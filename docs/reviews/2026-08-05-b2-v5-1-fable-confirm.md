# B2 出貨模型 DB 地基 plan v5.1 — 確認輪報告(Fable adversarial-reviewer,fresh context)

> 受審:`docs/specs/2026-08-05-e10-b2-shipments-db-plan.md`(591 行,worktree `a4a-chain`,untracked)。
> 範圍:§0.35 逐列核對 + 四突變靶判別力 + 修法新洞 + 剩餘假綠 + §5.1 兩題完整性。
> 模式:FULL-REPO 唯讀;事實面親讀三支 migration;PG 語意以本機 PG17.10 拋棄庫實測
> (`initdb` 於 scratchpad、port 55442、teardown 後 `git status --porcelain` 與開工前逐項相同、零殘留)。
> **判定:FAIL(must-fix 4 條,全屬 plan 字面可修;§0.35 主幹 11 列大體已修,四靶三真一未釘死)。**

## 1. 事實面親讀對帳(不採信 plan 轉述)

| 宣稱 | 親讀結果 |
|---|---|
| 名稱序契約 `20260803140000:48-53` | ✅ 逐字在(48-53,含契約債⑥「只在 apply 跑一次」) |
| `NOT DEFERRABLE` 慣例 `20260803140000:417` | ✅ 在(R1-19 不新開交易契約) |
| A4a 函式 `SECURITY DEFINER` + `SET search_path = public, pg_temp` | ✅ `20260803140000:140-145` |
| 重讀形先例 `20260730140000:167-177` | ✅ 在:`pcm_assert_cancellation_has_items` 逐 id 重讀 header、`CONTINUE WHEN NOT FOUND`、`RETURN NULL`(AFTER 面) |
| 函式 EXECUTE 收斂理由 `20260730140000:205-212` | ✅ 在(實測註記 `proacl = NULL` ⇒ PUBLIC 可執行) |
| presence 先例 = **兩支**(header + items 面) | ✅ `20260730140000:214-226`:items 面掛 `AFTER INSERT OR UPDATE OR DELETE` —— 因為該表品項可刪可改掛;**本片 X1 單支成立的前提 = A6 append-only,v5.1 仍未明文**(見 MF-1) |
| suppliers 樣板另一慣例 | ✅ `20260801140000:69`/`:104` 用 `pg_catalog, public`,且 touch/block 函式**非 SECDEF** |

## 2. §0.35 十三列逐列裁決(逐條回 v5.1 本文,非採信該表)

| # | 裁決 | 依據(v5.1 實際字面) |
|---|---|---|
| 1 X1→S1b | **已修** | §2:136-151(片界+中間態)、§3.2-C:249「(S1b)」、§3.3:297「由 S1b 建」、§4:342 標頭+382 專段、§6:467-469(含跨表 X1 提醒)、§8:546 cut② 改「X1 尚未存在」。全鏈一致,無舊字面殘留。附 nit:S1b 自己就是「在 shipments 掛 trigger 的片」,§3.3:323-324 契約債⑥字面命中它自己,plan 未說 S1b 要重跑名稱序斷言 |
| 2 項31判別序 | **已修(實測)** | §4:389-394;拋棄庫實測:DEFERRED 下 submitted-first→補品項→commit **成功**;改 INITIALLY IMMEDIATE 後同序在 UPDATE 語句當場 `P0001` |
| 3 重讀語意 | **已修,但附帶依賴仍缺 ⇒ 連動出新問題** | §3.2-C:249 前提② + §4:395-397;實測:重讀形下「submitted→改回 draft→零品項→commit」成功。**但** X1 單支(不掛 items 面)的第三前提「A6 append-only ⇒ 品項數單調不減」全文未明文(grep `A6`/`append-only` 僅 :138/:262/:443/:500,無一是 X1 前提欄),而 §5.1 Q-a 備選②正是會打倒它的選項 → MF-1 |
| 4 X8 作廢面 | **已修** | §3.2-C:256 條件逐字含 `OR OLD.deleted_at IS NOT NULL`;§4:350-351 項 11b |
| 5 F2 作廢面驗收 | **沒修完** | §4:385-388:項 30 兩面 + 30b 一格,**都只踩 `submitted`**;F2 家族 4 格 = S∅×{submitted,failed}×{D∅,D≠},`failed` 兩格仍零驗收 → MF-3 |
| 6 A3 COALESCE | **已修** | §3.2-C:259 式含 COALESCE + 四格實測紅綠;但 §4:333 項 3 未把 `('other',NULL)` 釘進驗收字面 → MF-4(繫住突變④) |
| 7 P1-P3 | **已修,但斷言面開新洞** | §3.3:310-324 前提為真、結論成立(X8/X2 讀集重疊確與結果無關);**P1 的驗證(grep 無 `NEW.<欄> :=`)量不到 `RETURN NULL` 與 `=` 賦值** → MF-2。另 P3「由 P1 直接推得」實需 P1+P2(touch 若寫別欄,P1 仍真而 P3 倒)= nit |
| 8 §6 函式通則 | **已修** | §6:463-473 三片逐支列數。nit:suppliers 先例是一函式雙掛(delete+truncate 共用),若照抄則 S1a-1「函式×2」字面漂移 |
| 9 C-2 函式面 | **已修,附前提缺口** | §3.2-C-2:270-279 三件套+結構斷言(含 owner)都在;**但零字提 RLS**:兩表 zero-policy RLS 下 SECDEF 讀得到的前提 = 函式 owner **就是表 owner** 且表非 FORCE RLS(memory `reference_pg-has-table-privilege-not-rls-passthrough` 同族坑)。倒了的症狀是 X1/A7 誤殺(loud、fail-closed)非靜默放行 ⇒ consider 非 must-fix。另:blanket「全部守門函式 SECDEF」比先例寬(suppliers touch/block 非 SECDEF;只有要跨表 SELECT 的 X1/A7 需要)= nit |
| 10 A7+X3 NOT DEFERRABLE | **已修** | §3.2-C:263 + §4:370-372 項 21 catalog+行為雙 oracle;誤設 DEFERRED 時 canonical 序 commit 必殺,判別力成立 |
| 11 DEFERRED×外部呼叫 | **已修** | §7:492 DoD 第 7 條二選一,字面完整 |
| 12 Q-a | **如實轉 Sean** | §5.1:442-448;但備選②描述不完整 → MF-1(見 §6) |
| 13 Q-b | **如實轉 Sean** | §5.1:450-453;備選漏第三案(見 §6) |

## 3. 四個突變靶判別力(各自獨立論證;①②實測)

| 靶 | 裁決 | 理由 |
|---|---|---|
| ① X1 改 IMMEDIATE → 項 31 | **會紅(實測)** | 拋棄庫:`DEFERRABLE INITIALLY IMMEDIATE` 下,設 submitted 的 UPDATE 語句尾即 `P0001`(品項尚未加)⇒ 項 31 紅。DEFERRED 原版同序 commit 成功 ⇒ 正反都對 |
| ② X1 信 `NEW` → 項 32 | **會紅(實測)** | 拋棄庫:trust-NEW 版在「submitted→revert draft→零品項」的 **commit 當下** `P0001`(deferred 佇列帶的是 submitted 那格 row image);重讀版同序成功。另實測確認:trust-NEW 版在項 31 的序仍綠 ⇒ 項 32 是唯一偵測器,分工正確 |
| ③ X8 砍 `OR OLD.deleted_at` → 項 11b | **會紅(推理)** | 已作廢未出貨列 `OLD.shipped_at IS NULL` ⇒ 突變版放行凍結欄 UPDATE ⇒ 期望的 `P0001` 消失。無他閘遮蔽的前提 = fixture `hct_status='draft'`(若 fixture 是 submitted,改 carrier 會紅在 X5 `23514`;oracle 釘 `P0001` 則仍紅、但歸因錯)⇒ 建議 11b 釘 fixture(nit) |
| ④ A3 拿掉 COALESCE → 項 3 | **未釘死(條件會紅)** | 突變後只有 `('other', NULL)` 這一格會漏(`('other','   ')` 無 COALESCE 也紅)。項 3 字面只寫「other 無 note」—— 實作者若用 `''` 造這格,突變④全綠 = 裝飾 → MF-4 |

## 4. 新開的洞(修法自身)+ 本輪 findings

- [must-fix] plan:443-447×249 —— §5.1 Q-a 備選②(草稿期 `shipped_at IS NULL 且 deleted_at IS NULL` 開放品項 UPDATE/DELETE)**會打倒 X1 單支設計**:submitted 未出貨的箱子仍算「草稿期」⇒ 送單後刪光品項,X1 只掛 shipments、不會再發火 ⇒ F2 拚死堵上的那族(送單零品項)整個重開且零錯誤。備選②成本漏列「X1 需改雙支(照 `20260730140000:214-226` 先例、items 面含 DELETE)+ items 凍結條件須含 `hct_status<>'draft'`」;同時 X1 的 C 表前提欄補第三條「依賴 A6 append-only」。**若我錯了**:v5.1 有任何一行把 A6 依賴或備選②此成本寫出(grep 無)。
- [must-fix] plan:314×361-362 —— P1 斷言「grep 無 `NEW.<欄> :=`」量不到兩個真實失效模式:plpgsql 賦值可寫 `=`、以及 **BEFORE guard `RETURN NULL`(實測:`UPDATE 0`、列不變、零錯誤)**;後者靜默吞掉合法 UPDATE 並跳過後續 trigger,而 §4 所有「→ 成功」正測若只驗無錯即全綠。修法:P1 斷言加 RETURN 紀律(grep 每支守門 `RETURN NEW`)+ 正測 oracle 明文「斷言觀察到的新值已落庫(rowcount=1 且欄值=預期)」。**若我錯了**:§4 有任一行要求正測驗「值真的變了」(grep 無)。
- [must-fix] plan:385-397×239 —— §3.2-B 宣稱 X1「一條擋滿 10 格」,但驗收 28-32 全踩 `submitted`,**`hct_status='failed'` 面(可達:draft 可直接改 failed,X4 不管 failed、X5 只要 carrier=hct)零測試格** ⇒ X1 條件誤實作成 `= 'submitted'` 時 §4 全綠。修法:項 30/30b 各加一格 failed(或至少一格)。**若我錯了**:§4 有任何 X1 格用 failed(grep `failed` 僅項 13,屬 X8/F9)。
- [must-fix] plan:333×408 —— 突變④的判別力繫於項 3「other 無 note」被實作成 NULL;字面未釘 `('other',NULL)` 與 `('other','   ')` 分列兩格 ⇒ 突變④可能是裝飾。修法:把 §3.2-C:259 已實測的四格逐字搬進項 3。**若我錯了**:項 3 字面已含 NULL 格(無)。
- [consider] plan:270-279 —— C-2 缺前提:zero-policy RLS 下 SECDEF 函式讀得到兩表的條件 = 函式 owner 即表 owner 且未 FORCE RLS;結構斷言雖含 owner,理由與「FORCE RLS 禁令」未明文。倒了 = X1/A7 誤殺(loud)。**若我錯了**:C-2 或結構斷言有 RLS 字樣(grep 無)。
- [nit] plan:277 —— `public, pg_temp` 選擇本身無害且優於 `pg_catalog, public`(後者未列 pg_temp,暫存表可影未限定名);pg_catalog 隱式優先保住內建解析。無副作用,維持即可。
- [nit] plan:323-324 —— 契約債⑥反身性:S1b 自己在 shipments 掛 X1,依字面須重跑 §3.3 斷言(雖不同事件、序不受影響),plan 應補一句或把債的範圍釘成「同表同事件」。
- [nit] plan:350×383-388 —— 項 11b/28/30 fixture 需明文滿足他閘(11b 用 draft;28/29 帶 tracking 或 other+note;30 帶 request_id+carrier hct),否則紅在 23514 = 誤紅錯歸因(dev 期會被發現,非假綠)。
- [nit] plan:316 —— P3「由 P1 直接推得」應為「由 P1+P2 推得」。
- [nit] plan:472 —— 若照 suppliers 一函式雙掛慣例,S1a-1「函式×2」與實作會漂;二選一釘死。

## 5. 剩餘假綠(修完 §0.35 之後,拿掉守門仍綠的)

1. **守門 `RETURN NULL` / `=` 賦值**:P1 grep 斷言與「只驗無錯」的正測 oracle 都量不到(實測 `UPDATE 0` 零錯誤)→ MF-2。
2. **X1 條件縮成 `='submitted'`**:§4 全綠 → MF-3。
3. **A3 突變④**:若「無 note」實作為 `''` → MF-4。
4. 突變③在 fixture=submitted 時紅在 X5 而非 X8(oracle 釘 P0001 則仍紅,僅歸因錯)= nit。
5. 其餘 34 項:項 21(catalog+行為雙 oracle)、項 31/32(實測)、項 15 歸因格、項 5/23/27 判別力正測,拿掉對應守門都會紅;未再發現同級假綠。

## 6. §5.1 兩題完整性

- **Q-a**:題目問對(補救路徑是真缺口)。**備選②不完整到危險**:如 MF-1,照字面採納會重開 F2 洞;拍板前必須補成本(X1 雙支+items 凍結含送單態)。**漏第三案**:③ DB 層維持①,writer/RPC 層做「一鍵複製重開」(舊箱作廢、品項自動搬進新箱)—— 稽核乾淨度=①、操作成本≈②,且天然保留 hct 證據(與 Q-b 連動)。
- **Q-b**:題目問對(意旨存疑的定性誠實)。**漏第三案**:③ `hct_raw_response` 改 jsonb 陣列 append(同表留履歷,不加表、不改守門形狀)。另備選①的描述可補一句:草稿期換快遞的證據銷毀其實已有免費出路 —— 走 F10 作廢重開,舊箱證據永存;真正只剩 F9 重送會覆蓋。

## 7. 自我審計

(a) 未反駁 must-fix:4。(b) UNVERIFIED 且最壞 BLOCKER/HIGH:0(事實面全親讀;PG 語意關鍵格全實測)。
(c) 實際構造的擊破嘗試:9(突變①②實測正反、trust-NEW 對項 31 的盲區實測、RETURN NULL 吞寫實測、
X5 遮蔽突變③推演、failed 面可達性構造、Q-a② 刪品項重開 F2 構造、C-2 RLS 前提推演、契約債⑥反身性)。
**WOULD-CHANGE-MY-VERDICT**:若 §4 已有字面同時 ①要求正測驗「值真落庫」②含 X1 failed 格 ③項 3 釘 NULL 格,
且 §5.1 Q-a② 已列 X1 雙支成本 ⇒ 四條 must-fix 塌掉、降為 PASS(含 nit)。
