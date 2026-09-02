# CLAUDE.md

> **Claude Code 工作規則檔(常載本體;細節與「為什麼」按下方路由表按需讀)。** 每 session 自動載入。
> Codex 入口 = `AGENTS.md`;共同規則只寫在 `docs/ops/AI_CONTRACT.md`,不再靠雙生檔人工同步。
> 🔴 **重複段主從(2026-08-09 Sean Q-F=C)**:與 `AGENTS.md` ~~逐字重複~~**部分重疊**的八段以**本檔為準**;字面歧異照本檔執行並回報修齊,改任一段必同 commit 改兩檔。
> ⚠️ **2026-09-02 量到「逐字重複」那個前提不成立**:四段實測 AGENTS 獨有內容 24%~50%(鐵則 35% / Bash 45% / 自檢清單 50% / Git 24%,10 字視窗)⇒ **照抄任一邊都會毀掉另一邊的內容**。⇒ 🎯 同步方式改為:**條文與指標對齊, 各自獨有的段落保留** —— 而「改任一段必同 commit 改兩檔」照舊。
> **固定政策:** `docs/ops/AI_CONTRACT.md` > 本檔;**現況:** 可驗證事實 > `STATUS.md` > `docs/handoff/CURRENT.md` > 歷史 memory/對話。制度演變史與拍板典故一律在 docs/decisions/、memory 與 lessons-learned,本檔只留現行規則。

---

## 規則怎麼讀(先看這段)

判斷優先於程序,但分三層:**鐵則 1-12、Git 紀律、Server 端鐵則 = 硬規則**,每個 slice 必遵守、不憑自評鬆綁——它們是 Sean 不寫程式之下的驗證鏈與安全線,不是模型能力的補丁。**SOP 與清單 = 現行預設做法**,可憑判斷調整廣度與粒度(例如偵察掃多深、todo 開多細),但省掉某一步要在報告一句話說明。**風格章節 = 溝通約定**,照做。

## 開工儀式(分級;不一律通讀)

```bash
cd /Users/sean_1/pcm-website-v2 && git branch --show-current && git status && git log --oneline -5
```
預期:branch=`dev` / HEAD 對齊 STATUS.md。CURRENT 已標 ownership 的 dirty 可保留並繼續;無法解釋的 dirty、branch 不符或 HEAD 明顯矛盾才停下回報 Sean,不自行 reset/stash/清理。

- **每 session 必讀**:`STATUS.md` + `docs/handoff/CURRENT.md` + 本工作直接相關的 handoff/PRD;權限、分工或政策不確定時再讀 `docs/ops/AI_CONTRACT.md`。Codex 與 Claude 都可完整執行;任務明確寫審查時才唯讀。
- **新 milestone / 接手陌生領域才加讀**:`docs/PHASE-1-NORTHSTAR.md` 全文、`docs/PROJECT-OVERVIEW.md`、`docs/PHASE-2-VISION.md`、相關 `docs/features/*.md`。
- **陌生領域開工先掃盲點**:寫 plan 前先自問「這領域裡我和 Sean 可能都沒想到的坑/依賴/隱含決策是什麼」;盲區大就派 subagent 跑一輪、掌握得住就直接把問題清單附進 plan,自行判斷。
- **禁止為「保險」通讀大檔**:用路由表,命中觸發條件才讀對應段落(讀不相關長檔 = 燒 token 也稀釋注意力)。

---

## 鐵則 1-12(每個 slice 必遵守;編號固定、外部大量按編號引用、**絕不重新編號**)

1. **design 直接搬、不翻譯** — design-reference 是真權威、storefront 對齊 design 不反向遷就;寫前台元件前**必先 grep design-reference 字面、不憑記憶**;slice 指令禁用「翻譯/對齊/重寫」字眼;不畫預覽 HTML、不憑想像描述視覺。**真權威解析**:design 真權威不只 design-reference——任何會被人看到的產出物(前台頁面/後台 UI/列印單據/信件模板)動工前,先解析真權威:OD `list_projects` 當場列全部設計專案 + grep design-reference;各面對應與拍板紀錄見 `docs/PHASE-1-NORTHSTAR.md` §2(清單不寫進本檔:清單會過期,查法不會)。查無 ⇒「查無」寫進 plan 並附掃過的分母;拿不準哪個是權威 ⇒ 問 Sean。🔴 **`list_projects` 的結果【必須跟磁碟目錄數對一次】;數字不合 ⇒ 以磁碟為準**(2026-08-28 Sean 拍甲,取代原「回空 ⇒ 不得當成查無」)。數法 `ls ~/Library/Application\ Support/Open\ Design/namespaces/release-stable/data/projects | wc -l`。 📎 **病史·實錘·舊字面 → `docs/patterns/ironrules-casebook.md` §鐵則1**
2. **後台對應 design** — Medusa schema 對應 design 已定義的資料結構;design `data/products.js` mock 是合約、後台實作合約。
3. **前後台同步、不分階段** — 每 slice:**動前台 → 補對應後台 → 肉眼驗 → 修連動 → commit**;禁「前台全做、後台後補」。
4. **Slice 15-45 分鐘可中斷** — 體積 15-45 分鐘可完成 + Sean 可肉眼驗;超過 → 拆。
5. **CSS + TSX 同元件單一 slice** — 雙檔聯動、預設單一 slice 完成、不拆。
6. **檔案大小** — 元件檔 >400 行預設拆、>300 行警戒;Hook 檔 >200 行評估拆分;判斷不拆 → commit body 寫理由。🛑 **而過線只是「要看一眼」的訊號, 不是「一定要拆」的結論** —— 每一刀要寫得出與 400 無關的理由。🔴 **拆檔時註解必須跟著它解釋的那段碼搬;不得以壓縮/刪減註解作為降行手段** —— 那些註解裡住著 Sean 的拍板紀錄,而「刪註解」在 diff 上與「搬移」長得一樣、三綠全綠、審查看的是行為零改動。(OD worktree 檔大小用 `git show <sha>:<path>|wc -l`、別讀主樹版。) 📎 **病史·實錘·舊字面 → `docs/patterns/ironrules-casebook.md` §鐵則6**
7. **多代理實作需批准** — 實作預設單一 session 順序執行;模型自評多代理派工更合適時,**先向 Sean 提案**(拆法、各代理範圍、怎麼驗收)、批准才派,不得自行啟動。讀取/驗證/審查/機械批次套用・docs/制度檔工程(限主對話已驗證模式、diff 回核)類委派照 `~/.claude/rules/00-work-rules.md` §1,不需另批。(2026-08-04 放寬自原「永久禁用」)
8. **重大改動前先提 plan 等批准** — 「重大」=任一:跨 3+ 檔 / 動 schema・API・共用元件 / 動 next.config・vercel.json・Medusa config・Prisma schema / 影響部署或資料遷移。Plan 含:**要改什麼、為什麼、預期影響面、rollback**。Sean 批准才執行。
9. **內容分級 L1/L2/L3 強制前置** — L1(年 0-1 次)hardcode 可;L2(季 1-3 次)hardcode+TODO+backlog;L3(週多次)**必後台 CRUD、發現立即停、寫 PRD 後再動**。任何 slice 前先標;**頻率拿不準 → 預設當 L3 停下問 Sean、不硬標 L2**。
10. **三視角檢查** — 每技術決策過:擴充性 / 可維護性 / bug 可追蹤性。backlog 條目必寫「不修未來會痛在哪」、禁寫「待 Sean 決定」空泛句。
11. **Slice 收工三綠 Checkpoint** — commit 前強制跑 typecheck+lint(動 .ts/.tsx/.css/設定檔加 build)、任一紅停下修紅再 commit、不繞道/disable/skip/ignore(`/slice-checkpoint` skill、詳 `docs/patterns/slice-checkpoint.md`)。🔴 **三綠指令一律加前綴 `TURBO_FORCE=1 pnpm <項目>`** —— 少了它 turbo **命中既有快取時**會 replay 舊的綠(2026-08-17 實測:`pnpm typecheck` ⇒ `8 cached / FULL TURBO`,加前綴 ⇒ `0 cached`;正本 `docs/phase-1-backlog.md` `#524`)。動 .sh / .yaml / .sql 另有語法守門(隨 pre-commit 自動跑,詳 slice-checkpoint.md §2.2a);🔴 **「純文件片」僅指只動 .md**(2026-08-17 Sean 拍板收斂;~~原「.md / .json schema」~~ 作廢 —— **三綠不會 parse 任意 JSON、格式壞掉照樣全綠**,而 `package.json`/`turbo.json`/`tsconfig*.json` 副檔名都是 `.json`),`.json` / `.css` / `.sh` / `.yaml` / `.yml` / `.sql` **一律不算**(`.css` **要跑 build 才有判別力**;`.json` / `.sh` / `.yaml` / `.yml` / `.sql` 對三綠恆綠或零判別力、另有守門)。**字面 vs 事實守則:commit 訊息對應實際內容、不假裝完成沒做的事、有偏離寫 commit body 註明**。🔴 **測試那一項:跑【測到你動的那個東西的檔】就好、不必每次全套 —— 而放寬與驗法【成對】, 不可只取前半。**⚠️ 「測到你動的那個東西的檔」**不是**「我這次建的那幾支」。✅ 驗法(Sean 兩次拍板 2026-08-26 甲 · 2026-08-28 `Q-鐵則11分母=甲`):**連跑兩發, 比四個數 —— `Test Files` 檔數 / `Tests` 測項總數 / 紅的格數 / 🔴 我餵幾條 vs 它跑幾支。**🛑 少了第四個數 ⇒ 餵一條不存在的路徑 vitest **不報錯、rc=0、就少跑一支**, 而連跑兩發都印同一個少的數 ⇒ 那是重現性不是效度。 📎 **病史·實錘·舊字面 → `docs/patterns/ironrules-casebook.md` §鐵則11**
12. **高風險改動 commit 前必過 Codex 對抗審查** — 高風險=動到任一:**①錢**(order・payment・refund・pricing・經銷價・會員 tier・儲值金)**②權限**(auth・RLS・GRANT・service_role・server/client 邊界)**③DB 結構與大量/不可逆寫入**(schema・migration・批次匯入)**④平台設定**(next.config・vercel.json・Prisma・CI・env)**⑤對外不可回收**(寄信・對外發布・法律頁)**⑥共用元件 packages/ui 行為改動**(props 介面/邏輯/資料流;純樣式=標準片)。跨 3 檔/一般 API/進度單元收尾**不自動觸發**;自評有風險只能加審不能免審;Sean 說「Ready for review」必審;milestone 收尾仍跑一次總審。動作:停下、跑完三綠、**commit 前**直呼 codex CLI 唯讀對抗審查(`codex-adversary` 關卡2、`-s read-only`、不產書面 Packet)、findings 修完才 commit、**不 push**。審查唯讀紀律見 `docs/ops/AI_CONTRACT.md` §2。

---

## 路由表(按需讀取;命中「觸發情境」才讀)

| 觸發情境 | 讀 |
|---|---|
| ①判斷功能是否屬 Phase 1 範圍 / 範圍爭議<br>②動 design-reference / design 與文件矛盾 / 找真權威位置<br>③上線/公測就緒判斷 | ①`docs/PHASE-1-NORTHSTAR.md` §1<br>②`docs/PHASE-1-NORTHSTAR.md` §2<br>③`docs/PHASE-1-NORTHSTAR.md` §5 |
| 寫或審 slice 指令格式(六件套完整規格) | `docs/patterns/slice-instruction-six-piece.md` |
| ①寫 slice 指令前的逐條自檢<br>②決策題 / 報告格式細節 / Sean 說看不懂<br>③需要 Sean 操作 dashboard / GUI / 查環境路徑 | ①`docs/working-style.md` §6.3<br>②`docs/working-style.md` §1/§2<br>③`docs/working-style.md` §4 |
| diff 含 use 開頭 hook(useState/useEffect/useCallback/useMemo/useRef…)/ 動 eslint 設定 / client component 抓資料 | `docs/patterns/react-nextjs-rules.md` |
| ①寫 rsync / env・secret 操作 / 跨 repo 同步指令<br>②引用其他 session 的 commit body / 跨 session 交接<br>③要在任何規則檔新增條目(立法)前<br>④偵察類工作(凡結論將寫「X 未實作/未覆蓋/查無」)/ 下此類斷言前<br>⑤其他事故式教訓(事故 log;條數會長,當場 `grep -c '^### 12-'` 才算數) | `docs/lessons-learned.md` —— 📎 **病史·實錘·射程 → `docs/patterns/routing-casebook.md` §1** |
| skill 與工具用法(context7 / graphify / busboy 細節) | `docs/tools-and-skills.md` |
| 🔴🔴 **要動【後台訂單相關的任何 UI】/ 要對稿 / 要判「我們跟 OD 一不一樣」** | OD 專案 `pcm-524f` 的 `HANDOFF-orders-ui.md` + `orders-admin-v2.html`(Sean 本人改的那一份) —— 📎 **病史·實錘·射程 → `docs/patterns/routing-casebook.md` §2** |
| 🔴 **不知道某個東西牽動到哪 / 想知道「改這支檔會影響什麼」** | 查地圖:`graphify query "<檔名或識別字>"`(在 repo 根跑,例 `graphify query "orders-table"`)。它回傳那個節點 BFS depth=2 的連動子圖,答得出**跨檔關係**而 grep 只答得出字面命中。**查完一定要開檔核** —— 地圖給方向,檔案給事實 |
| ⚠️ **地圖的限制與刷新**(先知道,免得以為它壞了) | `graphify query` / `graphify update` —— 📎 **病史·實錘·射程 → `docs/patterns/routing-casebook.md` §3** |
| 🔴 **要知道 OD 稿上某個 CSS 變數【真正生效】的值是多少** | `docs/design/od-cascade-winning-values.md` —— 📎 **病史·實錘·射程 → `docs/patterns/routing-casebook.md` §4** |
| 🔴 **要比對 CSS 的值 / 對 OD 稿 / 查某個 token 現在到底是多少** | `python3 scripts/tool-final-css.py` —— 📎 **病史·實錘·射程 → `docs/patterns/routing-casebook.md` §5** |
| 跨專案關聯問題(老闆腦/報價單/上架鏈與本 repo 怎麼連) | 四 repo 合併圖 `/Users/sean_1/老闆腦/跨專案圖/`(cd 進去 `graphify query "問題"`;repo 內問題優先用本 repo `graphify-out/`,較新;合併圖由老闆腦維護、本 repo 不更新它) |
| 三綠細節 / 字面vs事實背景 | `docs/patterns/slice-checkpoint.md` |
| 審查鏈全貌 / 寫審分離 | `docs/patterns/cowork-review-chain.md`(歷史 Codex Packet 格式**已停用、僅備查** ⇒ `docs/patterns/codex-review-packet.md`) |
| 鐵則字面的詳解與程式碼範例(規則以本檔為準) | `docs/patterns/general.md` + `docs/patterns/pcm-specific.md` |
| 想知道 `docs/patterns/` 有哪些細節檔 / 從零接手本 repo 找入口 | `docs/patterns/index.md`(全目錄索引與各檔定位) |
| 要寫守門/負測/突變 · 要下「零命中/沒覆蓋/構造不出來」這類斷言 · 要判 BLOCKER 前 | `bash scripts/two-controls.sh <純字串> <正對照> <範圍>` —— 📎 **病史·實錘·射程 → `docs/patterns/routing-casebook.md` §6** |
| 要跑任何會【改檔案】的腳本 · 要寫突變/還原流程之前 | `docs/patterns/mutation-harness-restore.md`(來源=2026-08-16 A 窗實錘:**一份被突變的 migration 被 commit 進正式分支**(`02dd510e`,修在 `e37fbea5`)。🔴 **病灶不是忘了還原,是用一個會殺掉還原的方式跑它** ⇒ 那不是提醒能防的,是流程層) |
| 🔴🔴 **我 grep `design-reference` 一個字都沒有 / 對稿對不到 / 「稿裡好像沒有這個元件」** | `bash scripts/design-ref-check.sh` —— 📎 **病史·實錘·射程 → `docs/patterns/routing-casebook.md` §7** |
| 要下「查無 / 不存在 / 零命中」這種斷言,而對象是【一個檔案路徑】 | `bash scripts/where-is.sh <path>` —— 📎 **病史·實錘·射程 → `docs/patterns/routing-casebook.md` §8** |
| 🔴 **我要查正式庫的一個數字 / 我想知道某支 migration 貼了沒 / 我掃了 `scripts/`+環境變數+`~/.pgpass`+MCP 都查無, 而想斷言「沒有唯讀權限」之前** | `~/pcm-mailbox/0905查證/run.sh` —— **那條路存在**(Sean 2026-09-03 00:5x 批, 它 source `.env.local`)。🛑 三句缺一不可:①**唯讀與 apply 是兩個授權, 而 Sean 只給了唯讀** ⇒ 不得拿它 apply 任何東西 ②**跑不跑得動由你的 session 權限決定 —— 跑不動是【對的】, 不是壞掉**(2026-09-03 主視窗被擋, 它沒有繞) ③**絕不把連線字串印進對話**。📎 **病史·實錘·射程 → `docs/patterns/routing-casebook.md` §23** |
| 要寫或審任何 `.range()` · 翻頁迴圈 · 「撈全部」的迴圈 | `docs/patterns/pagination-loop-review.md`(🔴 **檔頭有證據等級聲明** —— 原文已隨 session 消失、本檔是轉錄版,引用前先讀那一段;五條準則:頁大小嚴格小於 `db-max-rows` / `.range()` 兩端皆含 / 中途失敗要 throw 不得 break / `count` 不當終止判準 / 排序帶唯一鍵) |
| 要把某供應商商品上架到顧客站 shop.pcmmotorsports.com | `docs/runbooks/supplier-storefront-onboarding.md`(完整流程 + forget-proof preflight,單一入口) |
| 🔴 **客人打電話說「我收到【兩封不一樣的】出貨通知」/「到底哪一個追蹤號才對」/「你們是不是出了兩次貨」** | `docs/runbooks/duplicate-shipping-email-sop.md` —— 📎 **病史·實錘·射程 → `docs/patterns/routing-casebook.md` §21** |
| 🔴 **客人來要求「查我的資料 / 刪掉我的資料 / 不要再寄信給我」** | `docs/runbooks/data-rights-sop.md` —— 📎 **病史·實錘·射程 → `docs/patterns/routing-casebook.md` §22** |
| 🔴 **多窗同時在跑**:①我要回報進度而主視窗會不會忘記我 ②**收到 push 警示:有人推了 dev 而不是我** / 我 commit 了而它上去了沒 ③我要自己 push | `bash scripts/heartbeat.sh "<窗>" "<剛做完>" "<手上>"` —— 📎 **病史·實錘·射程 → `docs/patterns/routing-casebook.md` §9** |
| 夜跑多窗指揮(哨兵/派工/批次收割/佇列預派/斷線復原) | `docs/runbooks/night-run-command-playbook.md`(2026-08-06 Sean 拍板常設) |
| 開新施工窗/新 session 主視窗建置/工作流移植他專案 | `docs/runbooks/multi-window-command-workflow.md`(2026-08-09 Sean 拍板常設;§B 主視窗/§C 施工窗啟動提示詞) |
| 要驗一支 migration 而手上沒有 DB access(施工窗常態)/ 要在本機起拋棄式 Postgres 或 PostgREST | `docs/runbooks/throwaway-postgres-for-migration-verification.md`(PCM 專屬 bootstrap 清單、`apply 成功 ≠ 斷言通過`、本機效度限制) |
| 🔴 **新建任何 DB 物件(表 / view / 函式)**,或動 `GRANT` / `REVOKE` / `SECURITY DEFINER` / 改既有函式的參數型別 / 🔴 **或你正在做一次【安全強化】—— 收掉 `BYPASSRLS`、動 `ALTER ROLE`、把 RLS 收緊、改 `service_role` 的用法**(2026-09-01 補:⟦b9-RLSHARDEN⟧ 的威脅模型**不是攻擊者, 是一個善意而看起來完全正確的改動**;而**那個人不會去翻板子, 他會讀他該讀的那支檔** ⇒ 這道防線必須寫在【觸發情境】裡。🔴 而在補這一句之前, 觸發情境**逐字沒有** `ALTER ROLE` / `BYPASSRLS` / 「RLS 強化」 ⇒ **做那件事的人不會被路由到這裡**) | `docs/patterns/revoking-function-execute-in-supabase.md`(**檔名比範圍窄,表也在裡面**)。**新物件出生就自帶 anon 權限、repo 內零 `GRANT` 字面可掃、三綠不紅**;含兩道 REVOKE、`TRUNCATE` 不受 RLS 管、`has_*_privilege` 對欄級授權少報、ACL 欄是 `NULL` 時 PUBLIC 看不見 |
| ①🔴🔴 **要用瀏覽器打開後台看畫面** / **我跑了那一行而每一頁都 HTTP 500**(⛔ ~~不需要任何 `.env` 檔~~ —— **2026-09-02 實測那句已不成立**)<br>②後台 UI 片的視覺真權威 / BMW M 設計語言 / 某條做了沒 | ①`bash scripts/admin-probe/up.sh` ②`docs/design/admin-design-system.md` —— 📎 **病史·實錘·射程 → `docs/patterns/routing-casebook.md` §10** |
| ①🔴🔴 **要驗「這個功能到底行不行」**(Sean 2026-08-17 定為全陣預設:「不用再用 artifacts,直接來真的但是開伺服器做＋看」)<br>②🔴🔴 **本機 dev server 打開了,而畫面「看起來像功能沒做」**(按鈕沒反應 / 停在載入中 / console 有 chunk 403) | `docs/runbooks/local-admin-with-real-data-probe.md` —— 📎 **病史·實錘·射程 → `docs/patterns/routing-casebook.md` §11** |
| 🔴 **要在本機開【顧客站】來看或量畫面**(手機版面 / 走一遍客人動線 / 購物車結帳) | `bash scripts/storefront-probe/up.sh` —— 📎 **病史·實錘·射程 → `docs/patterns/routing-casebook.md` §12** |
| 派 subagent / 判斷猶豫 / 交辦範本 / 制度維護 | `~/.claude/rules/00-work-rules.md`(每 session 自動常載;§1 調度 §2 判準 §3 範本 §4 維護) |
| 接手/重啟/被交辦一條「看起來停住、沒結論」的線 —— 在你說「那要開線」之前 | `docs/patterns/stalled-line-triage.md`(甲沒有落點/乙結論住錯地方/丙照拍板在等;丙型誤判=推翻當事人自己的拍板) |
| 想知道「上線前還剩多少沒關」 | `docs/launch-todo.md` —— 一張**自己數得出來**的表(態=封閉集 open/doing/parked/done)。⚠️ 它**不涵蓋**沒有人盤過的面;檔尾「這張板子沒涵蓋什麼」那節先讀 |
| 查「某個坑我們記過沒」<br>🔴 **或:我剛寫了一道守門 / 一個門檻 / 一個正對照 —— 在 commit 之前** | `scripts/traps-neighbours.py` —— 📎 **病史·實錘·射程 → `docs/patterns/routing-casebook.md` §18** |
| 🔴 **列印出來的紙【多了一頁】/ 紙上看不到頁碼 / 換一台印表機就不一樣 / 「另存 PDF 是一頁而真印表機是兩頁」** | `apps/admin/src/app/print/print-a4.css` —— 📎 **病史·實錘·射程 → `docs/patterns/routing-casebook.md` §19** |
| 🔴 **①三綠印了綠而我不確定它真的跑了 / build 紅了而找不到錯誤行**<br>②**這件事我接了,而它是不是已經被做掉了 / 板子那一列還成不成立**<br>③**測試說「找不到建置產物」/ 我明明 build 過了它還說沒有** | `bash scripts/greenlight.sh` —— 📎 **病史·實錘·射程 → `docs/patterns/routing-casebook.md` §13** |
| 🔴🔴 **我新寫了一支帶 `--selftest` 的腳本,而它在我自己樹上跑是綠的** —— 🛑 **那句話本身就是觸發條件,不是通過條件** | `.husky/selftest-git-isolation-gate.sh` —— 📎 **病史·實錘·射程 → `docs/patterns/routing-casebook.md` §14** |
| 🔴 **板上寫著 `open` 而我不確定 · 有人跟我說「那件早就做掉了」而我想自己驗 · 我要說「這件沒有人做」之前** | `python3 scripts/what-happened-to.py <錨>` —— 📎 **病史·實錘·射程 → `docs/patterns/routing-casebook.md` §15** |
| 🔴 **我要端一題給 Sean 之前**(任何決策題、任何「要他拍板」的東西) | `bash scripts/before-asking-sean.sh "<他會講的話>"` —— 📎 **病史·實錘·射程 → `docs/patterns/routing-casebook.md` §16** |
| 🔴 **要抄一支既有的 DB 函式來改 / 要寫 `CREATE OR REPLACE` 之前 / 有人給你一個「那支函式在這裡」的行號** | `bash scripts/latest-definition-of.sh <物件名>` —— 📎 **病史·實錘·射程 → `docs/patterns/routing-casebook.md` §20** |
| 制度/檔案盤整(過期清理/歸屬/skill 化;每 milestone 收尾跑) | `~/.claude/skills/pcm-housekeeping/SKILL.md`(2026-08-12 Sean 拍板常設) |
| 🔴 **我在自己的工作區跑全套測試, 紅了一堆不像我弄的 / 有人說 CI 綠而我這邊紅** | `bash scripts/why-is-this-red.sh <vitest log>` —— 📎 **病史·實錘·射程 → `docs/patterns/routing-casebook.md` §17** |

---

## Git 紀律

- **SSH only**:`git@github.com:pcmmotorsports/pcm-website-v2.git`。絕不在對話貼 token;**credential 相關命令一律只印【名稱】不印【值】**(例:`git config --get-regexp '^credential' | awk '{print $1}'`)；`cat .env` 不在對話跑(Sean 自驗)。
  > 🛑 **2026-08-31 Sean 拍甲改字面**:~~原本寫「credential 命令加 `grep -v ghp_`」~~ —— **那是【黑名單】, 它只擋掉開頭是 `ghp_` 的那一種**。
  > 🔴 而 GitHub 現在的 token 前綴至少有 `ghp_` / `gho_` / `ghu_` / `ghs_` / `ghr_` / `github_pat_`,而別家(`glpat-` / `xoxb-` / `sk-`)一個都不在那個黑名單裡。
  > 📌 **⇒ 黑名單在跟下一個沒想到的前綴賽跑。改成【只印名稱】—— 那是白名單, 而它不需要知道值長什麼樣。**
- **Branch**:`main`←production(Sean 手動 merge)/ `dev`←主開發(slice 都在 dev、線性、暫不開 feature branch)。
- **Commit 訊息**:`type(scope): subject [milestone]`。type=feat/fix/refactor/docs/chore/test/perf;scope=storefront/medusa/ui/schemas/docs/config;subject=繁中祈使句≤72 字元。
- **Add 必精準**:`git add <精確路徑>`;**禁 `git add .` / `git add -A`**。🔴 **而「路徑精準」≠「內容精準」** —— `git add <單一檔案>` 拿的是那支檔的**整個 diff**。🛑 **`git commit -F <msg> -- <pathspec>` 與不帶 pathspec【各擋一半、各對另一半失明】** ⇒ 兩種都不是無條件安全 ⇒ commit 前 `git diff --cached -- <檔>`、commit 後 `git show HEAD:<檔>` 回核。🛑 **而【兩邊同時有東西】時(index 有別人的檔、你要 commit 的那支檔工作樹裡也有別人未 commit 的行), 兩種形狀都不安全 ⇒ 預設動作是【停下來協調、等對方先 commit】, 不要自己動手**(Sean 2026-08-29 拍 `⑦ 補`)。 📎 **共用 index 的暴露期、pathspec 兩種形狀各擋一半、兩邊同時有東西時的預設動作 → `docs/runbooks/multi-window-command-workflow.md` 附錄**
- **不自動 push**:commit + busboy-end 後**不 push**、Sean 手動推=review checkpoint。
- **Submodule**:初始化 `git submodule update --init --recursive`;同步 design `git submodule update --remote design-reference/` → `git add design-reference` commit。

## Busboy / STATUS.md 維護

- **Busboy**:開始 Sean 跑 `busboy-start.js pcm`(輸出 template 貼新 session 首訊);結束你跑 `busboy-end.js pcm`(自動更 STATUS 4 欄 + commit、**不 push**;完整 7 欄是 slice commit 的責任)。失敗 → 停下回報、不自行 retry。(`/Users/sean_1/pcm-tools/scripts/`)
- **STATUS.md**:slice 結束**同一 commit**(不另開)更 7 欄:①當前狀態 ②最後更新 ③最近 3 commit(用**可達 hash**:`git merge-base --is-ancestor` 驗、避 busboy off-by-one orphan)④下一步 ⑤Sean 待決策 ⑥Blocker ⑦緊急 backlog 編號。主表(分隔線上)≤30 行嚴守、超過精簡 content 不砍欄;附屬區(分隔線下)自然增長;**不寫歷史(去 PROGRESS.md)、不複製 backlog 細節(只列編號)**。

## 終端機 / Bash 紀律(Sean zsh 環境)

- **zsh 禁忌**:命令內**禁 `#` 註解**、**禁全形標點「」():;**;註解寫 prose、不寫進命令。
- 🔴 **雙引號內禁反引號** —— 被 zsh 當命令替換吃掉,而句子還讀得通。commit body 一律 `git commit -F <檔>` 或單引號。
- 🔴 **含反斜線的字寫進檔案一律 `printf '%s\n'`,不要 `echo`** —— `echo` 遇 `\c` 會停止輸出,`rc=0` 而那行從來沒存在過。⚠️ 射程:只在 `/bin/zsh` 實測過、只講 `\c`(bash 的 `echo` 需 `-e` 才解讀跳脫),而它打的是**人在終端機打的那一層**不是腳本層。✅ **而可機械執行的自檢是:餵給 psql 之前先數一次** `grep -c '^\\copy' <產生的檔>` vs 你期望的條數 —— 那就是鐵則 11「我餵幾條 vs 它跑幾支」套在【腳本產生】這一層。
- 🔴 **`$?` 每一個指令都會覆寫**(實測 40 種寫法 40 中)⇒ 唯一安全形狀 `cmd > file 2>&1 ; RC=$?`,中間不准有任何東西。
- 🔴 **`local X=$(cmd)` 會【吞掉】rc**(不是蓋掉)⇒ 必須拆兩行 `local X; X=$(cmd); RC=$?`。
- 🔴 **管線每一段的結果 ⇒ 跑完【立刻】整條收進陣列**,中間不准有任何東西(bash `PIPESTATUS` / zsh `pipestatus`)🛑 **這一條只能寫成「你必須怎麼做」, 不可以寫成「它會怎樣」** —— bash 與 zsh 行為相反, 任何事實描述一定對其中一邊是錯的。。
- 🔴 **背景任務的輸出檔會被截斷** ⇒ 要 rc 就寫 `cmd > file 2>&1 ; echo "rc=$?" >> file`。
- 🔴 **結果標籤要由【結果】決定,不能無條件印** —— 一句寫死的「以下為空」在有命中時照樣印,而它就印在命中的正下方。用 `&&` / `||`,或把判定寫進條件式。
- **多步驟用 `&&` 串接、禁裸換行 batch**;🔴 **而 `&&` 會被一個【合法的零】截斷**(`grep -c` 印 0 而 rc=1)⇒ 量測鏈不要用 `&&` 串。
- **「產生新檔→驗證→覆蓋」**:`cat > /tmp/x <<'EOF'` → `test -s /tmp/x || exit 1` → `mv /tmp/x target`。
- **不假設非 macOS CLI 已裝**:`jq`/`yq` 用前 `command -v` 確認、或改 Python 內建。
- **zsh nomatch**:glob 無匹配 exit 1、含 glob 加 `|| true` 或用 `find`;🔴 **而 zsh 【不】對未加引號的變數斷詞** ⇒ 迴圈一律 `while IFS= read -r`,禁 `for f in $VAR`、禁 `git add $P`。
- **CJK / str_replace 切策略**:見常載 `~/.claude/rules/00-work-rules.md` §5(單一權威,此處不重複)。
📎 **每一條的實測數字、實錘、射程與已被訂正的舊字面 → `docs/patterns/zsh-and-bash-traps.md`**

## Server 端鐵則(會員與價格、Phase 1 核心)

- 會員等級驗證**必在 server 端重新檢查**、不信任 client 送的欄位。
- Client component **不得 import** `@/lib/prisma` 或任何洩漏經銷價的模組;**經銷價絕不傳到一般會員瀏覽器**。
- 金額用整數(分/角)或 `Decimal`、**禁用 `number` 處理價格**(浮點誤差)。
- 敏感資訊(DB 連線字串/API token/金流金鑰)→ `.env.local` only、絕不提交 git、絕不貼對話。

## Sean 風格速查(完整見 `docs/working-style.md`)

- **兩層報告**:上層白話(影響哪些檔/出錯怎樣/估多久/風險)+ 下層技術細節 + 指令(code block、一鍵複製)。
- 🔴 **一個字回得完**(2026-08-20 Sean 指示):端給 Sean 的每則訊息自問「他可以用一個字回完嗎」——不行 ⇒ 那是【告知】不是決策題,而**告知不會產生決定,只會產生「我講過了」**。連帶:①「他決定之前要知道」的東西必須寫在【叫他決定的那句話裡】,不是附件 ②「你可以劃掉了/你不用做什麼」最危險(既讓他停止查證、又不需要回應 ⇒ 錯了沒有回饋路徑)⇒ 這類句子要附證據落點。詳 `docs/working-style.md` §2.1a
- **決策一律 multi-select**:每題 2-4 選項、**禁開放式問題**;業務白話、技術細節留下層;用 prose code block(`Q:…/A: A|B|C`)、Sean copy-paste 回、**不走 AskUserQuestion UI**;**答案會改變架構或方向的題排最前面問**。
- **品味題(視覺/文案調性)不用文字選項讓 Sean 想像**:給 3-4 個方向差異夠大的實體版本讓他直接看(互相打架、不是同款微調);視覺 demo 由 Claude Design 產出(分工不變),Claude Code 只把題目轉成 demo 需求、不自己做視覺。
- **「看不懂/白話一點/畫個圖」** → 視覺化 + 比喻 + multi-select 三層白話模式。
- **Sean 改變主意是常態** → 不質疑、重新對齊、不堅持舊版。

## 分工 + 自驅 SOP(現行預設;五方分工表與完整鏈見 `docs/patterns/cowork-review-chain.md` 與 `AGENTS.md`)

- 分工要點:Sean 拍板/push/操作 dashboard/肉眼驗收;Codex 或 Claude 執行 session 都可實作/commit/測試/自驅規劃、**不 push、不 deploy、不替 Sean 拍板、不做視覺設計**;明確審查 session 唯讀作不同模型第二意見;Design session 管視覺。
- **片型分級**:動手前先標片型。**輕量片**=不碰「共用元件(packages/ui)/金流・order・payment/schema・migration・RLS/auth・tier/next.config・vercel.json・Prisma・CI/.env」且體積=單一元件 CSS+TSX、文案、smoke test 補齊或純 docs → 只跑 SOP ①④⑤⑧⑨(跳偵察 pass、graphify 查詢、關卡1、code-reviewer、關卡2)。**標準片**=其餘 → 全 9 步(同一條線延續片:偵察 pass 沿用本 session 已有結果、免重跑)。**高風險片**=命中鐵則 12 六類 → 全 9 步、對抗審查不降級(僅命中鐵則 8=照常提 plan 等批、片型另按前兩級判)。
- **9 步自驅 SOP**:①起手(讀 STATUS 下一步 + design 真權威 grep)②規劃前偵察 pass(標準片以上;派 haiku/sonnet 掃 backlog/STATUS/specs/memory/lessons 多關鍵字變體 + 查 graphify 連動面、套 T1 範本)→ 自寫 slice plan(標 L1/L2/L3 與片型、判鐵則 8、plan 附「相關既有紀錄與連動面」一節列命中項與連動檔)③關卡1:預設跳 codex、僅高風險片(鐵則 12 六類)跑 `codex-adversary` 審 plan(輪數上限 2、仍不收斂=整理決策題給 Sean)→ 決策岔路一次性批次問 Sean ④實作(鐵則 3/5/6)⑤三綠 `/slice-checkpoint` ⑥code-reviewer subagent(標準片以上必跑、輕量片跳過;一輪制詳常載 00-work-rules §5 輪次紀律)⑦關卡2:預設只走 code-reviewer、僅命中鐵則 12 才跑 codex 審 diff(每 slice 硬上限 2 輪、round2 仍 FAIL 停下 raise Sean)⑧commit(精準 add、字面vs事實一致、STATUS 7 欄同 commit)+ 收尾對帳(本 session Sean 拍板逐條 vs 已落檔;漏的補寫進對應檔——拍板落 memory `project_*.md`、含決定/理由/連動面、一板一檔或更新既有、不只留 commit body)+ busboy-end ⑨**不 push** 等 Sean 手動推。
- codex-adversary 紀律(條文):**在 main session 跑**(每個施工窗自己就是一個 main session);只唯讀(`-s read-only`);零留痕檢查比**我的檔的內容雜湊**、不比全樹 `git status`;Codex 與 PCM 鐵則/Sean 拍板衝突以後者為準;**層級由片型決定** —— 每片先跑 `code-reviewer`,命中鐵則 12 六類才叫 codex,第三輪換 Fable 換角度;🔴 **stdin 一定要導掉 `< /dev/null`**;**等待方法:背景起 codex 的下一行立刻收 `PID=$!`(那一行前後不准有任何東西),然後 `wait "$PID"`**。📎 **為什麼、實錘與兩個「看起來很自然但錯」的做法 → `docs/patterns/cowork-review-chain.md` 附錄**

## 快速自檢清單(鐵則與 SOP 的濃縮對照,內容以上文為準)

**slice 開工前**:☐ 起手檢查綠 ☐ 讀 STATUS「下一步」確認範圍 ☐ 動 design → 先跑 `bash scripts/design-ref-check.sh` 再 grep 真權威字面 ☐ 標 L1/L2/L3(L3 立即停寫 PRD)☐ 標片型 ☐ 判鐵則 8(是則先提 plan 等批)☐ 涉錢/權限/schema・migration/平台設定/對外發送/共用元件行為 → 逐字過鐵則 12 六類清單 ☐ 偵察 pass(標準片以上)☐ **報片數/片界前先開母 plan §5.0 DAG;報 schema 行為前先開建表 migration 讀註解**(附不出 `檔案:行號` = 沒查)☐ 估時 15-45 分鐘(超出拆)☐ 🔴 **新寫帶 `--selftest` 且會碰 git 的腳本 ⇒ selftest 第一件事剝掉繼承來的 git 環境**(`GIT_DIR` / `GIT_INDEX_FILE` / `GIT_WORK_TREE` / `GIT_OBJECT_DIRECTORY` / `GIT_ALTERNATE_OBJECT_DIRECTORIES` / `GIT_COMMON_DIR` / `GIT_NAMESPACE`;`git -C` 擋不住它)

**slice 結束前**:☐ **寫一行心跳**(`bash /Users/sean_1/pcm-website-v2/scripts/heartbeat.sh …`)☐ 🔴 **順序:先 `git add`、【再】寫 reviewer 標記、才 commit** ☐ 標記一律走 `bash scripts/write-reviewer-marker.sh "<片名+輪次或跳審理由>"`,不要直接寫 `.git/` ☐ 肉眼驗(「肉眼驗✅」是 Sean 專屬用詞)☐ 三綠(動 .ts/.tsx 加 build、不 disable/skip)☐ **改過任何對外字面(註解 / 文案 / plan / commit body / handoff)→ 拿舊字面跑 `bash scripts/literal-sweep.sh '<舊字面>'` 再 commit** ☐ 命中鐵則 12 → codex 對抗審查已跑、未 push ☐ 動前台元件 → 補/更新 smoke test ☐ commit 字面vs事實一致、偏離寫 body ☐ 精準 add、格式對 ☐ STATUS 7 欄更新(同 commit)☐ 收尾對帳(Sean 拍板逐條 vs 已落檔,漏的補寫 memory `project_*.md`)☐ busboy-end ☐ 不 push

📎 **每一格「為什麼有這一格」的實錘、量測與射程 → `docs/patterns/checklist-casebook.md`**
(`/pcm-roadmap` 與 `/graphify --update` 不隨每 slice:milestone 收尾或每日收工跑一次即可。)

## 突發狀況

**發現自己在做這些 → 立刻停下**:把 design「翻譯成 Tailwind 風格」/ 為「保留既有 storefront 結構」改 design 內容 / 憑記憶描述 design・畫預覽 HTML / 把 9 大藍圖 schema 加進 Phase 1 / 一個 slice 跨 3+ 檔卻未提 plan(鐵則 8)/ 未經 Sean 批准就啟動多代理實作(鐵則 7)/ 即將自動 push。
**Sean 訊息常見回應**:「OK 繼續」→ 直接執行下一步不再確認;「等等/停」→ 立刻停、不執行任何工具呼叫、等下一步;「看不懂/白話一點/畫個圖」→ 視覺化+比喻+multi-select;「[User dismissed…]」→ 不繼續、等 Sean 主動講;Sean 拋新方向(可能與舊拍板衝突)→ 確認是否推翻舊拍板、不假設、不直接照新方向衝。

## 一句話 Phase 1 精神

> **design 是成品、Phase 1 把 design 上架、後台支撐 design、不做 9 大藍圖、前後台同步小步前進。**(完整見 `docs/PHASE-1-NORTHSTAR.md`)

— END —
