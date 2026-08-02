# 夜跑視窗① 收工交接:A2b1 鏈(worktree `nightly/a2b1-chain`)

> 2026-08-03 凌晨。接手指令 = A2b1 → A2b2 一片一片做;實況 = **A2b1 在關卡1 三輪審查後依拍板判停於 plan 層,今晚零 migration code、A2b2 未動**。
> 本 worktree 基底 = `2c53322`;主樹、STATUS.md、docs/handoff/CURRENT.md **一個 byte 都沒動**。busboy 未跑(worktree 手動交接,照 memory `reference_busboy-end-is-printer-worktree-manual-status`)。

## TL;DR(白話)

A2b1 是「員工開採購不能超過客人買的量」的資料庫守門。我把設計做到可直接開工的程度(plan v4),但審查過程發現**四個要你拍板的選擇**(§9,見下)—— 其中兩個被 codex 兩輪連續判定「這是資料庫對外行為的契約、要 Sean 事前拍板」,符合你「關卡1 兩輪不收斂就停」的指令,所以我停了、沒寫 code。副產品:抓到並實測證明了**兩個原設計照字面做會出事的坑**(死結、隔離模式下守門失效),plan 已改對。

## 做了什麼(全部在 worktree,3 個新檔)

1. **plan v1→v4**:`docs/specs/2026-08-03-e10-a2b1-procurement-allocation-guard-plan.md` —— 設計 + harness 規格 + 13 cells/13 突變地圖 + §9 四題決策題。早上拍完 §9 即可直接實作,偵察與契約親讀(§2 C1-C10)不用重做。
2. **關卡1 三輪審查**,findings 逐字 + 逐條處置 = `docs/reviews/2026-08-03-e10-a2b1-k1-codex.md`:
   - codex `gpt-5.6-sol` xhigh R1 = NO-GO(12 must-fix + 8 nit)→ 全折入
   - codex R2 = NO-GO(處置稽核 13 真修/5 部分/1 假修 + 新 5 must-fix + 7 nit)→ 技術條全折入;**兩條決策權條原樣重現 ⇒ 判停**
   - Fable `adversarial-reviewer` R3 換角度 = NO-GO(2 must-fix + 6 條,全加法)→ 全折入
   - 三輪 40 條、逐條親驗、駁回 0;跑前後 `git status --porcelain` 零留痕。
3. **本交接檔**。

## 驗了什麼(實測,非推論;細節在 review 檔尾)

- **RR 快照失效**:本機 PG17.10 兩 session 實跑 —— repeatable read 下等到鎖後 SUM 看不到兄弟交易已提交列(守門會雙雙放行超量);read committed 下看得到。⇒ plan 的隔離閘依據。
- **FK RI 死結**:照 row 28 字面用 `FOR UPDATE` 鎖 parent,兩筆併發 INSERT 真的死結(`40P01`,RI 的 KEY SHARE 升級衝突);改 `FOR NO KEY UPDATE` 同實驗零死結。⇒ §9 Q4 的依據。
- **DID 三態**:`DEFERRABLE INITIALLY IMMEDIATE` 的 immediate 擋 / defer+補回過 / defer 不補 COMMIT 炸,全實測。
- **函式級 `SET lock_timeout`** 真的作用於 trigger 內等鎖(1.5s 實測、SQLSTATE 55P03)。
- **上游全齊**:Supabase MCP 唯讀撈正式站 ledger,A2/A7/A7-t/A1/S1a/S1b/S2/A6 八支全在(不再只轉述 STATUS)。
- 實驗全程用昨晚遺留的 `/tmp/a6-work` harness(port 54329),收工零留痕已驗(兩張採購表 0 列、scratch 表/函式全清);**postmaster 照原樣留著沒停**。

## 沒做什麼(誠實邊界)

- **零 migration code、零 harness code**:`supabase/migrations/20260803130000_*.sql` 與 `scripts/a2b1-verify.sh` 都不存在,是 plan §4 的未來產物。
- **A2b2 完全未動**(依賴 A2b1)。
- 三綠/關卡2/code-reviewer 都沒到(沒有 code 可審)。
- 對 27 項驗收貢獻 = 0。
- master plan row 28/A4a 的鎖序字面**尚未修訂**(等 Q4;今晚不動主權威檔)。

## 🔴 等 Sean 什麼:§9 四題(= A2b1 實作與 apply 的硬前置)

全文與選項在 plan §9(含各題翻案連動面);答案格式照慣例:

```
Q1: A|B|C   (隔離閘範圍;推薦 A 全拒非 read committed)
Q2: A|B|C   (可否「交易內先超後補」;推薦 A 預設不允許、可顯式宣告)
Q3: A|B     (非預設模式下連調降也一起拒?;推薦 A 一起拒)
Q4: A|B     (授權修訂 master plan row 28/A4a 鎖序字面;推薦 A)
```

拍完四題 → 早上任一 session 可在本 worktree 直接照 plan v4 §3-§6 實作(估:migration + harness + 突變 + 關卡2 完整跑 = 半天級)。

## 早上接手清單

1. 讀本檔 + plan v4 §9 → 拿 Sean 四題答案。
2. 若有翻非推薦選項 → 按 §9 連動面段改 plan 對應格,免重審全案(技術層三輪已收斂;Fable R3 明講「折入後不需第四輪全審,read-back 即可」)。
3. 實作照 plan §3-§5;harness provision 前先處理 port 54329(昨晚 a6 postmaster 還在跑,`pg_ctl -D /tmp/a6-work/pgdata stop` 後再 provision 新 workdir)。
4. Q4=A 的話順手修 master plan row 28/A4a 字面(同 commit 或緊鄰 commit)。
5. worktree 併回由主視窗決定;本分支只有 docs commit、不 push。
