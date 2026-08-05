# 夜跑派工單 — B2 出貨線 S1 三片 · 26 條 must-fix 重工(2026-08-05 夜)

> **給接手的施工視窗看的唯一入口。** 主視窗寫;上一棒(視窗B)已收工,交接來源=信箱 `B-215-STOP.md`。
> 開工先讀本檔全文,再讀 §2 列的三份檔案,**不要**從 316 行的 codex 原始報告從頭讀。

## §0 你是誰、在哪、紅線

- **worktree**:`/Users/sean_1/pcm-a4a-chain`(branch `a4a-chain`,HEAD 已對齊 dev)。
- 🔴🔴 **本片全部產物都是「未 commit」狀態**(15 個 modified/untracked 檔案)。上一棒依鐵則 12
  (關卡2 FAIL 不得 commit)刻意不存檔 ⇒ **開工前先 `git status --porcelain` 確認 15 個檔案都在**;
  **絕對不要** `git checkout` / `git stash` / `git reset` / `git clean`,那會把整天的產物清掉。
- **紅線**:不 push、不 apply 正式站、不動 `STATUS.md` / `docs/handoff/CURRENT.md`(主視窗負責)。
  修完 findings 才 commit(仍不 push),然後寫 `B-2xx-STOP` 等收割。
- **信箱**:`/Users/sean_1/pcm-mailbox/`,先讀 README 全文(含補訂 1-5)。你的號段=`B-2xx`,
  主視窗=`B-1xx`。🔴 **每次寫 STOP 前先 `ls` 一次信箱**(上一棒在這裡栽了兩次)。

## §1 這批是什麼、為什麼要重工

三片 migration(出貨線 DB 地基:`shipments` + `shipment_items` + 守門)已寫完並在拋棄庫實跑
(40/0、26/0、24/0),但 **關卡2 codex 判 FAIL:26 must-fix + 7 nit**。

🔴 **先搞清楚 findings 的性質**(這句要保留進 commit body):
**codex 沒有重跑任何 harness**(自述純靜態核對 + `bash -n`)⇒ 那些綠色數字**沒有被推翻**;
它挑的是**那些數字證明不了什麼**。不要讀成「原來全是假的」,也不要以為「重跑一次數字就解決了」。

## §2 開工必讀的三份(依序)

| 檔案 | 是什麼 |
|---|---|
| `docs/reviews/2026-08-05-b2-s1-codex-k2-triage.md` | 🔴 **主要輸入**:26 條逐條 triage(分類 / 已親驗 or 未驗 / 建議修法 / 落點行號)+ nit 7 條 + 動手前三提醒 |
| `docs/specs/2026-08-05-e10-b2-shipments-db-plan.md` | plan **v5.3**(Sean 拍板 Q-a=C / Q-b=A 已落字面;§4 驗收 35+1 條;§8 apply 合約) |
| `docs/reviews/2026-08-05-b2-s1-codex-k2.md` | codex 原始報告 316 行 —— **只在 triage 表某條寫不清楚時**才回頭查那條 |

其餘備查:`…-b2-v5-fable-r3.md`(判定輪 FAIL 13)/ `…-v5-1-fable-confirm.md`(確認輪 FAIL 4)/
`…-v5-2-implementability-selfcheck.md`(施工前自檢,**RLS 判別力的正確做法寫在這裡**,對應 triage #5)。

## §3 裁示:**A 修正版(全修)**,不准拆兩批

主視窗 `B-119-A` ③ 已裁,理由請讀懂再動手:

上一棒推薦「分兩批:真缺口先修先落地、判別力那族另立片」,**被駁回**。駁回理由=**循環論證**:
它替 B 案寫的辯護是「判別力那族不會讓壞資料寫進去」,而那句話本身就是「守門有效」的宣稱,
**正是判別力不足的 harness 證明不了的事**。codex 15-26 抓的是「消融某條守門後仍全綠」=
**我們不知道那條守門有沒有在工作**,不是「它在工作但測試寫得醜」。這是 schema 片、apply 不可逆,
不能帶著「不知道」落地。

## §4 執行順序(六步,照順序)

1. 🔴 **先逐條消融實測那 21 條「未驗」的**。triage 表只有 **5 條是上一棒親驗過的**
   (#6 btrim / #15 #16 #17 fixture 不可能狀態 / #5 RLS 判別力),其餘 21 條是 codex 的**靜態推論**。
   **不要直接照修** —— 先各自做一次消融(把守門拿掉 / 把斷言改壞)看 harness 會不會紅,
   確認 finding 成立再修。誤判的寫反駁依據(上一棒對 nit 7 已示範一次)。
2. **真缺口族先修**:#6 btrim 全族(`btrim` 只吃 ASCII 空格 ⇒ 一個 tab 繞過 A3/X7/A8 三條守門,
   改 `regexp_replace(x,'\s','','g') <> ''` 或等價)/ #7 `hct_request_id=''` / #2 既有列 anti-join /
   #3 函式 ACL / #10 約束集合漏 FK / #11 索引只驗名稱 / #13-14 雙向。
3. **fixture 全面合法化**(#15/#16/#17):上一棒的 `SHIPPED` fixture 是「設了 `shipped_at` 且零品項」,
   **在三片齊全的世界根本 commit 不了**(X1 會擋);它看似通過只因每格 `ROLLBACK`、X1 從未發火。
   🔴 修法連同「每格補 `SET CONSTRAINTS ALL IMMEDIATE`」一起做,**不要只改 fixture**。
   (同型病上一棒在 S1b 抓到過卻沒回頭查 S1a-1/S1a-2 —— 那正是這三條的由來。)
4. **判別力族(#4/#5/#9/#12/#19-24/#26)照修**,含 **#25 併發 barrier**:parent guard 目前全是單 session,
   把 `FOR NO KEY UPDATE` 換成普通 SELECT 仍全綠 ⇒ 沒有 barrier 的競賽測試證明不了任何事
   (memory `feedback_race-test-without-barrier-proves-nothing` 記過形狀,照那條的做法)。
5. **吸收 C 案的一半**:第 4 步裡若確認某條是「plan §4 本來就沒要求到那個深度」(併發 barrier、
   函式 ACL 雙向斷言)⇒ **先更新 plan §4 把要求寫進去,再補測**。規格與測試同批對齊,
   不要讓測試偷偷超前或落後規格。
6. **修完跑確認輪**(codex 同引擎即可)。再 FAIL 且 findings 落在**新層** ⇒ 照舊繼續;
   落在**同層打轉** ⇒ 停下整理決策題給主視窗,不要無限迭代。

## §5 已知邊界(照抄進 commit body / STOP,不要重新發現一次)

1. **項 34「既有 harness 全綠」= 6/8 + 兩條豁免**:
   `a1`=61/0、`a4a`=65/0、`a6`=157/0、`a8a2`=74/0、`a2b1`、`a5a` 全綠;
   `a8a1-verify` = **結構性豁免**(全量 migration 的庫裡 `admin_cancel_order` 已被 A8a2 取代,
   該支只能對「套到 A8a1 為止」的庫跑)—— 理由要寫進 plan;
   `a7-verify` = **既有 harness 缺陷、非本批**(突變段全紅在不相關的 DML 閘、對照組也紅)
   ⇒ 已立 **backlog #327**,本批不修。
2. **PORT 已可注入**(`ed00be7`):八支 `PORT=` + 11 支寫死 URL + 4 支身分閘 + 2 支 SQL 端點閘全改;
   跑 harness 用 `PORT=543xx`(範圍閘限 543xx,擋「指向正式站」)。**別碰 54329 / 54331**
   (別的視窗的拋棄庫)。上一棒的 `/tmp/b2w*` 已全收、零殘留。
3. **commit body 必寫**:「codex 未重跑 harness,40/0、26/0、24/0 等數字未經第三方獨立確認。」
4. **Sean 拍板(已落字面,不要重問)**:Q-a=C(裝箱打錯=DB 維持嚴格,補救做成出貨畫面「照這箱內容
   開新箱」按鈕、歸未來 UI 片)/ Q-b=A(重送只留最新)/ shipped 強制點 Q1=A、Q2=A(C9 摘要表 CHECK,
   歸 v5 之後的 S2 片)。
5. **驗收項 24 的地位**:「作廢後同批品項可進新包裹並重新出貨」是 Q1=A 拍板流程的**唯一 DB 層驗收**,
   它紅掉=那條拍板的作業流程走不通。

## §6 收工

修完 + 確認輪過 ⇒ commit(精準 add,15 個檔案逐一列;gate 標記照 `.husky/reviewer-gate.sh` 檔頭寫法)
⇒ **不 push** ⇒ 寫 `B-2xx-STOP`(含實跑數字、突變證據、未竟事項)⇒ 掛背景等待迴圈等 `B-1xx-A`。

夜跑紀律:**清路不是推數字** —— 這批對 27 項驗收的直接貢獻是 0,它的價值是讓出貨線地基能安心落地。
卡住就寫 STOP 停下,不要自行放寬驗收或改測試期望值(那是立即停止訊號)。
