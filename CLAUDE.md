# CLAUDE.md

> **Claude Code 工作規則檔(常載本體;細節與「為什麼」按下方路由表按需讀)。** 每 session 自動載入。
> Codex 入口 = `AGENTS.md`;共同規則只寫在 `docs/ops/AI_CONTRACT.md`,不再靠雙生檔人工同步。
> 🔴 **重複段主從(2026-08-09 Sean Q-F=C)**:與 `AGENTS.md` 逐字重複的八段以**本檔為準**;字面歧異照本檔執行並回報修齊,改任一段必同 commit 改兩檔。
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

1. **design 直接搬、不翻譯** — design-reference 是真權威、storefront 對齊 design 不反向遷就;寫前台元件前**必先 grep design-reference 字面、不憑記憶**;slice 指令禁用「翻譯/對齊/重寫」字眼;不畫預覽 HTML、不憑想像描述視覺。**真權威解析**:design 真權威不只 design-reference——任何會被人看到的產出物(前台頁面/後台 UI/列印單據/信件模板)動工前,先解析真權威:OD `list_projects` 當場列全部設計專案 + grep design-reference;各面對應與拍板紀錄見 `docs/PHASE-1-NORTHSTAR.md` §2(清單不寫進本檔:清單會過期,查法不會)。查無 ⇒「查無」寫進 plan 並附掃過的分母;拿不準哪個是權威 ⇒ 問 Sean。
2. **後台對應 design** — Medusa schema 對應 design 已定義的資料結構;design `data/products.js` mock 是合約、後台實作合約。
3. **前後台同步、不分階段** — 每 slice:**動前台 → 補對應後台 → 肉眼驗 → 修連動 → commit**;禁「前台全做、後台後補」。
4. **Slice 15-45 分鐘可中斷** — 體積 15-45 分鐘可完成 + Sean 可肉眼驗;超過 → 拆。
5. **CSS + TSX 同元件單一 slice** — 雙檔聯動、預設單一 slice 完成、不拆。
6. **檔案大小** — 元件檔 >400 行預設拆、>300 行警戒;Hook 檔 >200 行評估拆分;判斷不拆 → commit body 寫理由。(OD worktree 檔大小用 `git show <sha>:<path>|wc -l`、別讀主樹版。)
7. **多代理實作需批准** — 實作預設單一 session 順序執行;模型自評多代理派工更合適時,**先向 Sean 提案**(拆法、各代理範圍、怎麼驗收)、批准才派,不得自行啟動。讀取/驗證/審查/機械批次套用・docs/制度檔工程(限主對話已驗證模式、diff 回核)類委派照 `~/.claude/rules/00-work-rules.md` §1,不需另批。(2026-08-04 放寬自原「永久禁用」)
8. **重大改動前先提 plan 等批准** — 「重大」=任一:跨 3+ 檔 / 動 schema・API・共用元件 / 動 next.config・vercel.json・Medusa config・Prisma schema / 影響部署或資料遷移。Plan 含:**要改什麼、為什麼、預期影響面、rollback**。Sean 批准才執行。
9. **內容分級 L1/L2/L3 強制前置** — L1(年 0-1 次)hardcode 可;L2(季 1-3 次)hardcode+TODO+backlog;L3(週多次)**必後台 CRUD、發現立即停、寫 PRD 後再動**。任何 slice 前先標;**頻率拿不準 → 預設當 L3 停下問 Sean、不硬標 L2**。
10. **三視角檢查** — 每技術決策過:擴充性 / 可維護性 / bug 可追蹤性。backlog 條目必寫「不修未來會痛在哪」、禁寫「待 Sean 決定」空泛句。
11. **Slice 收工三綠 Checkpoint** — commit 前強制跑 typecheck+lint(動 .ts/.tsx/.css/設定檔加 build)、任一紅停下修紅再 commit、不繞道/disable/skip/ignore(`/slice-checkpoint` skill、詳 `docs/patterns/slice-checkpoint.md`)。🔴 **三綠指令一律加前綴 `TURBO_FORCE=1 pnpm <項目>`** —— 少了它 turbo **命中既有快取時**會 replay 舊的綠(2026-08-17 實測:`pnpm typecheck` ⇒ `8 cached / FULL TURBO`,加前綴 ⇒ `0 cached`;正本 `docs/phase-1-backlog.md` `#524`)。動 .sh / .yaml / .sql 另有語法守門(隨 pre-commit 自動跑,詳 slice-checkpoint.md §2.2a);🔴 **「純文件片」僅指只動 .md**(2026-08-17 Sean 拍板收斂;~~原「.md / .json schema」~~ 作廢 —— **三綠不會 parse 任意 JSON、格式壞掉照樣全綠**,而 `package.json`/`turbo.json`/`tsconfig*.json` 副檔名都是 `.json`),`.json` / `.css` / `.sh` / `.yaml` / `.yml` / `.sql` **一律不算**(`.css` **要跑 build 才有判別力**;`.json` / `.sh` / `.yaml` / `.yml` / `.sql` 對三綠恆綠或零判別力、另有守門)。**字面 vs 事實守則:commit 訊息對應實際內容、不假裝完成沒做的事、有偏離寫 commit body 註明**。
12. **高風險改動 commit 前必過 Codex 對抗審查** — 高風險=動到任一:**①錢**(order・payment・refund・pricing・經銷價・會員 tier・儲值金)**②權限**(auth・RLS・GRANT・service_role・server/client 邊界)**③DB 結構與大量/不可逆寫入**(schema・migration・批次匯入)**④平台設定**(next.config・vercel.json・Prisma・CI・env)**⑤對外不可回收**(寄信・對外發布・法律頁)**⑥共用元件 packages/ui 行為改動**(props 介面/邏輯/資料流;純樣式=標準片)。跨 3 檔/一般 API/進度單元收尾**不自動觸發**;自評有風險只能加審不能免審;Sean 說「Ready for review」必審;milestone 收尾仍跑一次總審。動作:停下、跑完三綠、**commit 前**直呼 codex CLI 唯讀對抗審查(`codex-adversary` 關卡2、`-s read-only`、不產書面 Packet)、findings 修完才 commit、**不 push**。審查唯讀紀律見 `docs/ops/AI_CONTRACT.md` §2。

---

## 路由表(按需讀取;命中「觸發情境」才讀)

| 觸發情境 | 讀 |
|---|---|
| 判斷功能是否屬 Phase 1 範圍 / 範圍爭議 | `docs/PHASE-1-NORTHSTAR.md` §1 |
| 動 design-reference / design 與文件矛盾 / 找真權威位置 | `docs/PHASE-1-NORTHSTAR.md` §2 |
| 上線/公測就緒判斷 | `docs/PHASE-1-NORTHSTAR.md` §5 |
| 寫或審 slice 指令格式(六件套完整規格) | `docs/patterns/slice-instruction-six-piece.md` |
| 寫 slice 指令前的逐條自檢 | `docs/working-style.md` §6.3 |
| diff 含 use 開頭 hook(useState/useEffect/useCallback/useMemo/useRef…)/ 動 eslint 設定 / client component 抓資料 | `docs/patterns/react-nextjs-rules.md` |
| 寫 rsync / env・secret 操作 / 跨 repo 同步指令 | `docs/lessons-learned.md` §12-6/12-8/12-9/12-15(🔴) |
| 引用其他 session 的 commit body / 跨 session 交接 | `docs/lessons-learned.md` §12-30/12-25/12-16 |
| 要在任何規則檔新增條目(立法)前 | `docs/lessons-learned.md` §12-34/12-36 |
| 偵察類工作(凡結論將寫「X 未實作/未覆蓋/查無」)/ 下此類斷言前 | `docs/lessons-learned.md` §13 |
| 其他事故式教訓(事故 log;條數會長,當場 `grep -c '^### 12-'` 才算數) | `docs/lessons-learned.md` §12(先 `grep -n '^### 12-' docs/lessons-learned.md` 列標題、精準讀命中條) |
| 決策題 / 報告格式細節 / Sean 說看不懂 | `docs/working-style.md` §1/§2 |
| 需要 Sean 操作 dashboard / GUI / 查環境路徑 | `docs/working-style.md` §4 |
| skill 與工具用法(context7 / graphify / busboy 細節) | `docs/tools-and-skills.md` |
| 🔴 **不知道某個東西牽動到哪 / 想知道「改這支檔會影響什麼」** | 查地圖:`graphify query "<檔名或識別字>"`(在 repo 根跑,例 `graphify query "orders-table"`)。它回傳那個節點 BFS depth=2 的連動子圖,答得出**跨檔關係**而 grep 只答得出字面命中。**查完一定要開檔核** —— 地圖給方向,檔案給事實 |
| ⚠️ **地圖問不出來的東西**(先知道,免得以為它壞了) | ①**中文白話問句零命中**(2026-08-18 實測「訂單列表的品項在哪裡展開成一列」⇒ `No matching nodes`)②**不是節點名的識別字也零命中**(同日實測 `itemsTruncated` ⇒ 0)③🔴 **沒有 HTML 可以開** —— 圖的節點數超過 viz 上限,`graphify update` 會**跳過並移除** `graph.html`(2026-08-18 實測 `ls graphify-out/graph.html` ⇒ `No such file or directory`)。**⇒ 只用 `query`,沒有圖可以看** |
| 地圖過期了 / 收工前要刷 | `graphify update`(增量)。**milestone 收尾或每日收工跑一次**,不隨每 slice。⚠️ **本表不記節點數與刷新時間** —— 那種數字寫進常載檔就會過期,而過期時零機械訊號;要現值就當場跑 `graphify update` 看它自己印 |
| 跨專案關聯問題(老闆腦/報價單/上架鏈與本 repo 怎麼連) | 四 repo 合併圖 `/Users/sean_1/老闆腦/跨專案圖/`(cd 進去 `graphify query "問題"`;repo 內問題優先用本 repo `graphify-out/`,較新;合併圖由老闆腦維護、本 repo 不更新它) |
| 三綠細節 / 字面vs事實背景 | `docs/patterns/slice-checkpoint.md` |
| 歷史 Codex Packet 格式(已停用、僅備查) | `docs/patterns/codex-review-packet.md` |
| 審查鏈全貌 / 寫審分離 | `docs/patterns/cowork-review-chain.md` |
| 鐵則字面的詳解與程式碼範例(規則以本檔為準) | `docs/patterns/general.md` + `docs/patterns/pcm-specific.md` |
| 想知道 `docs/patterns/` 有哪些細節檔 / 從零接手本 repo 找入口 | `docs/patterns/index.md`(全目錄索引與各檔定位) |
| 要寫守門/負測/突變 · 要下「零命中/沒覆蓋/構造不出來」這類斷言 · 要判 BLOCKER 前 | `docs/patterns/guard-and-instrument-traps.md`(恆綠格 / 紅錯地方 / 一發紅多格 / 守門一裝就紅 / 掃描字集比宣稱窄 / 可重跑 vs 不可重跑的證據;每條附 2026-08-14 當天實例與行號) |
| 要跑任何會【改檔案】的腳本 · 要寫突變/還原流程之前 | `docs/patterns/mutation-harness-restore.md`(來源=2026-08-16 A 窗實錘:**一份被突變的 migration 被 commit 進正式分支**(`02dd510e`,修在 `e37fbea5`)。🔴 **病灶不是忘了還原,是用一個會殺掉還原的方式跑它** ⇒ 那不是提醒能防的,是流程層) |
| 要下「查無 / 不存在 / 零命中」這種斷言,而對象是【一個檔案路徑】 | 先跑 `bash scripts/where-is.sh <path>`(四處分開報:工作樹 / dev / 所有 ref(分支・remote-tracking・tag) / 信箱;**查無 rc=3 / 用法錯 rc=2 / 工具自壞 rc=1,三者分得開**)。🔴 **`git ls-files` / `test -e` 只看【當前 checkout】,不是整個 repo** —— 未收割分支上的檔在那裡是隱形的(2026-08-17 實錘:一份真實存在的資安報告差點被記成「不存在」;成因全文 `docs/lessons-learned.md` §12-43) |
| 要寫或審任何 `.range()` · 翻頁迴圈 · 「撈全部」的迴圈 | `docs/patterns/pagination-loop-review.md`(🔴 **檔頭有證據等級聲明** —— 原文已隨 session 消失、本檔是轉錄版,引用前先讀那一段;五條準則:頁大小嚴格小於 `db-max-rows` / `.range()` 兩端皆含 / 中途失敗要 throw 不得 break / `count` 不當終止判準 / 排序帶唯一鍵) |
| 要把某供應商商品上架到顧客站 shop.pcmmotorsports.com | `docs/runbooks/supplier-storefront-onboarding.md`(完整流程 + forget-proof preflight,單一入口) |
| 夜跑多窗指揮(哨兵/派工/批次收割/佇列預派/斷線復原) | `docs/runbooks/night-run-command-playbook.md`(2026-08-06 Sean 拍板常設) |
| 開新施工窗/新 session 主視窗建置/工作流移植他專案 | `docs/runbooks/multi-window-command-workflow.md`(2026-08-09 Sean 拍板常設;§B 主視窗/§C 施工窗啟動提示詞) |
| 要驗一支 migration 而手上沒有 DB access(施工窗常態)/ 要在本機起拋棄式 Postgres 或 PostgREST | `docs/runbooks/throwaway-postgres-for-migration-verification.md`(PCM 專屬 bootstrap 清單、`apply 成功 ≠ 斷言通過`、本機效度限制) |
| 🔴 **新建任何 DB 物件(表 / view / 函式)**,或動 `GRANT` / `REVOKE` / `SECURITY DEFINER` / 改既有函式的參數型別 | `docs/patterns/revoking-function-execute-in-supabase.md`(**檔名比範圍窄,表也在裡面**)。**新物件出生就自帶 anon 權限、repo 內零 `GRANT` 字面可掃、三綠不紅**;含兩道 REVOKE、`TRUNCATE` 不受 RLS 管、`has_*_privilege` 對欄級授權少報、ACL 欄是 `NULL` 時 PUBLIC 看不見 |
| 🔴 **要用瀏覽器打開後台看畫面**(本機;**不需要任何 `.env` 檔**) | `docs/design/admin-design-system.md` **檔頭第一段** —— 一行 `cd apps/admin && ADMIN_DEV_BYPASS=1 npx next dev -p 3001`。**這條路一直都在**(`proxy.ts:16` 註解寫著用途),而 2026-08-16 全窗花了兩輪才找到 —— **寫對地方 ≠ 會被讀到** |
| 🔴🔴 **要驗「這個功能到底行不行」**(Sean 2026-08-17 定為全陣預設:「不用再用 artifacts,直接來真的但是開伺服器做＋看」) | `docs/runbooks/local-admin-with-real-data-probe.md` —— 拋棄式 PG + PostgREST + 自簽 JWT + 前綴代理 + 真後台,**零 secret、不碰 `.env*`**(施工窗工作樹沒有 `.env.local`)。含 5 個會擋住你的坑(UTF8 / socket 長度 / `auth.uid()` / `service_role` GRANT + BYPASSRLS / `/rest/v1` 前綴)與**效度限制**。⚠️ **替身(fixture / mock / artifact)不再是「確認功能可用」的合格載體** |
| 後台 UI 片的視覺真權威 / BMW M 設計語言 / 某條做了沒 | `docs/design/admin-design-system.md`(**檔頭「落地狀態」表決定你能不能直接照抄下面的東西**) |
| 派 subagent / 判斷猶豫 / 交辦範本 / 制度維護 | `~/.claude/rules/00-work-rules.md`(每 session 自動常載;§1 調度 §2 判準 §3 範本 §4 維護) |
| 接手/重啟/被交辦一條「看起來停住、沒結論」的線 —— 在你說「那要開線」之前 | `docs/patterns/stalled-line-triage.md`(甲沒有落點/乙結論住錯地方/丙照拍板在等;丙型誤判=推翻當事人自己的拍板) |
| 制度/檔案盤整(過期清理/歸屬/skill 化;每 milestone 收尾跑) | `~/.claude/skills/pcm-housekeeping/SKILL.md`(2026-08-12 Sean 拍板常設) |

---

## Git 紀律

- **SSH only**:`git@github.com:pcmmotorsports/pcm-website-v2.git`。絕不在對話貼 ghp_ token;credential 命令加 `grep -v ghp_`;`cat .env` 不在對話跑(Sean 自驗)。
- **Branch**:`main`←production(Sean 手動 merge)/ `dev`←主開發(slice 都在 dev、線性、暫不開 feature branch)。
- **Commit 訊息**:`type(scope): subject [milestone]`。type=feat/fix/refactor/docs/chore/test/perf;scope=storefront/medusa/ui/schemas/docs/config;subject=繁中祈使句≤72 字元。
- **Add 必精準**:`git add <精確路徑>`;**禁 `git add .` / `git add -A`**。
- **不自動 push**:commit + busboy-end 後**不 push**、Sean 手動推=review checkpoint。
- **Submodule**:初始化 `git submodule update --init --recursive`;同步 design `git submodule update --remote design-reference/` → `git add design-reference` commit。

## Busboy / STATUS.md 維護

- **Busboy**:開始 Sean 跑 `busboy-start.js pcm`(輸出 template 貼新 session 首訊);結束你跑 `busboy-end.js pcm`(自動更 STATUS 4 欄 + commit、**不 push**;完整 7 欄是 slice commit 的責任)。失敗 → 停下回報、不自行 retry。(`/Users/sean_1/pcm-tools/scripts/`)
- **STATUS.md**:slice 結束**同一 commit**(不另開)更 7 欄:①當前狀態 ②最後更新 ③最近 3 commit(用**可達 hash**:`git merge-base --is-ancestor` 驗、避 busboy off-by-one orphan)④下一步 ⑤Sean 待決策 ⑥Blocker ⑦緊急 backlog 編號。主表(分隔線上)≤30 行嚴守、超過精簡 content 不砍欄;附屬區(分隔線下)自然增長;**不寫歷史(去 PROGRESS.md)、不複製 backlog 細節(只列編號)**。

## 終端機 / Bash 紀律(Sean zsh 環境)

- **zsh 禁忌**:命令內**禁 `#` 註解**(報 command not found)、**禁全形標點「」():;**(報 unknown file attribute);註解寫 prose、不寫進命令。
- 🔴 **雙引號內禁反引號**(2026-08-16 A 窗實錘):`git commit -m "…\`foo\`…"` 的反引號被 zsh 當**命令替換**吃掉 ⇒ **那段字從 commit body 消失**,而**句子還讀得通、只是掉了主詞** ⇒ 比「掉了字」難發現。**commit body / 多行訊息一律用檔案餵**(`git commit -F <檔>`)或單引號。
- 🔴 **pipeline 後面的 `$?` 是【右端】那個指令的,不是你關心的那支腳本的**(2026-08-16 一夜三次、三個不同的窗):`bash x.sh | head` 之後 `echo $?` 拿到的是 `head` 的 0。⇒ **要腳本自己的 exit code:別接管線,或 `set -o pipefail` 寫在【跑 pipeline 的那個 shell】**(寫在腳本裡管不到包住它的那一個)。
- 🔴 **輸出的標籤要由【結果】決定,不能無條件印**(2026-08-16 主視窗自己踩):`cmd; echo "(空 = 零命中)"` —— 那行 `echo` 在**有命中時照樣印**,而它就印在命中的正下方。⇒ **要嘛用 `|| echo`,要嘛把判定寫進條件式。**
- **多步驟用 `&&` 串接**(任一步失敗自動停)、**禁裸換行 batch 多命令**。
- **「產生新檔→驗證→覆蓋」**:`cat > /tmp/x <<'EOF'` → `test -s /tmp/x || exit 1` → `mv /tmp/x target`。
- **不假設非 macOS CLI 已裝**:`jq`/`yq` 用前 `command -v` 確認、或改 Python 內建。
- **zsh nomatch**:glob 無匹配 exit 1、含 glob 加 `|| true` 或用 `find`。
- **CJK / str_replace 切策略**:見常載 `~/.claude/rules/00-work-rules.md` §5(單一權威,此處不重複)。

## Server 端鐵則(會員與價格、Phase 1 核心)

- 會員等級驗證**必在 server 端重新檢查**、不信任 client 送的欄位。
- Client component **不得 import** `@/lib/prisma` 或任何洩漏經銷價的模組;**經銷價絕不傳到一般會員瀏覽器**。
- 金額用整數(分/角)或 `Decimal`、**禁用 `number` 處理價格**(浮點誤差)。
- 敏感資訊(DB 連線字串/API token/金流金鑰)→ `.env.local` only、絕不提交 git、絕不貼對話。

## Sean 風格速查(完整見 `docs/working-style.md`)

- **兩層報告**:上層白話(影響哪些檔/出錯怎樣/估多久/風險)+ 下層技術細節 + 指令(code block、一鍵複製)。
- **決策一律 multi-select**:每題 2-4 選項、**禁開放式問題**;業務白話、技術細節留下層;用 prose code block(`Q:…/A: A|B|C`)、Sean copy-paste 回、**不走 AskUserQuestion UI**;**答案會改變架構或方向的題排最前面問**。
- **品味題(視覺/文案調性)不用文字選項讓 Sean 想像**:給 3-4 個方向差異夠大的實體版本讓他直接看(互相打架、不是同款微調);視覺 demo 由 Claude Design 產出(分工不變),Claude Code 只把題目轉成 demo 需求、不自己做視覺。
- **「看不懂/白話一點/畫個圖」** → 視覺化 + 比喻 + multi-select 三層白話模式。
- **Sean 改變主意是常態** → 不質疑、重新對齊、不堅持舊版。

## 分工 + 自驅 SOP(現行預設;五方分工表與完整鏈見 `docs/patterns/cowork-review-chain.md` 與 `AGENTS.md`)

- 分工要點:Sean 拍板/push/操作 dashboard/肉眼驗收;Codex 或 Claude 執行 session 都可實作/commit/測試/自驅規劃、**不 push、不 deploy、不替 Sean 拍板、不做視覺設計**;明確審查 session 唯讀作不同模型第二意見;Design session 管視覺。
- **片型分級**:動手前先標片型。**輕量片**=不碰「共用元件(packages/ui)/金流・order・payment/schema・migration・RLS/auth・tier/next.config・vercel.json・Prisma・CI/.env」且體積=單一元件 CSS+TSX、文案、smoke test 補齊或純 docs → 只跑 SOP ①④⑤⑧⑨(跳偵察 pass、graphify 查詢、關卡1、code-reviewer、關卡2)。**標準片**=其餘 → 全 9 步(同一條線延續片:偵察 pass 沿用本 session 已有結果、免重跑)。**高風險片**=命中鐵則 12 六類 → 全 9 步、對抗審查不降級(僅命中鐵則 8=照常提 plan 等批、片型另按前兩級判)。
- **9 步自驅 SOP**:①起手(讀 STATUS 下一步 + design 真權威 grep)②規劃前偵察 pass(標準片以上;派 haiku/sonnet 掃 backlog/STATUS/specs/memory/lessons 多關鍵字變體 + 查 graphify 連動面、套 T1 範本)→ 自寫 slice plan(標 L1/L2/L3 與片型、判鐵則 8、plan 附「相關既有紀錄與連動面」一節列命中項與連動檔)③關卡1:預設跳 codex、僅高風險片(鐵則 12 六類)跑 `codex-adversary` 審 plan(輪數上限 2、仍不收斂=整理決策題給 Sean)→ 決策岔路一次性批次問 Sean ④實作(鐵則 3/5/6)⑤三綠 `/slice-checkpoint` ⑥code-reviewer subagent(標準片以上必跑、輕量片跳過;一輪制詳常載 00-work-rules §5 輪次紀律)⑦關卡2:預設只走 code-reviewer、僅命中鐵則 12 才跑 codex 審 diff(每 slice 硬上限 2 輪、round2 仍 FAIL 停下 raise Sean)⑧commit(精準 add、字面vs事實一致、STATUS 7 欄同 commit)+ 收尾對帳(本 session Sean 拍板逐條 vs 已落檔;漏的補寫進對應檔——拍板落 memory `project_*.md`、含決定/理由/連動面、一板一檔或更新既有、不只留 commit body)+ busboy-end ⑨**不 push** 等 Sean 手動推。
- codex-adversary 紀律:只 main session 跑(subagent 被 classifier 擋)、只唯讀(`-s read-only`、settings.json deny 擋 fix/apply/a)、跑前後 `git status --porcelain` 比對零留痕;Codex 與 PCM 鐵則/Sean 拍板衝突以後者為準。

## 快速自檢清單(鐵則與 SOP 的濃縮對照,內容以上文為準)

**slice 開工前**:☐ 起手檢查綠 ☐ 讀 STATUS「下一步」確認範圍 ☐ 動 design → grep 真權威字面 ☐ 標 L1/L2/L3(L3 立即停寫 PRD)☐ 標片型 ☐ 判鐵則 8(是則先提 plan 等批)☐ 涉錢/權限/schema・migration/平台設定/對外發送/共用元件行為 → 逐字過鐵則 12 六類清單(硬清單、不憑自評)☐ 偵察 pass(標準片以上)☐ **報片數/片界前先開母 plan §5.0 DAG 看上游;報 schema 行為前先開建表 migration 讀註解(契約債與交辦寫在那裡,查 `information_schema` 看不到);兩者在報告裡都要附 `檔案:行號`,附不出來=沒查**(詳 memory `feedback_assert-scope-only-after-reading-source-file`)☐ 估時 15-45 分鐘(超出拆)。
**slice 結束前**:☐ 肉眼驗(「肉眼驗✅」是 Sean 專屬用詞、Claude 只能寫程式驗)☐ 三綠(動 .ts/.tsx 加 build、不 disable/skip)☐ **改過任何對外字面(註解/文案/plan/commit body/handoff)→ 拿舊字面跑 `bash scripts/literal-sweep.sh '<舊字面>'` 再 commit**(Sean 2026-08-15 拍板;那支工具四個施工窗都有卻零人使用,同夜「宣稱改好其實沒改」發生 5 次,通報後三個窗在自稱掃乾淨處又撈到東西)☐ 命中鐵則 12 → codex 對抗審查已跑、未 push ☐ 動前台元件 → 補/更新 smoke test(`*.test.tsx`)☐ commit 字面vs事實一致、偏離寫 body ☐ 精準 add、格式對 ☐ STATUS 7 欄更新(同 commit)☐ 收尾對帳(Sean 拍板逐條 vs 已落檔,漏的補寫 memory `project_*.md`)☐ busboy-end ☐ 不 push。(`/pcm-roadmap` 與 `/graphify --update` 不隨每 slice:milestone 收尾或每日收工跑一次即可。)

## 突發狀況

**發現自己在做這些 → 立刻停下**:把 design「翻譯成 Tailwind 風格」/ 為「保留既有 storefront 結構」改 design 內容 / 憑記憶描述 design・畫預覽 HTML / 把 9 大藍圖 schema 加進 Phase 1 / 一個 slice 跨 3+ 檔卻未提 plan(鐵則 8)/ 未經 Sean 批准就啟動多代理實作(鐵則 7)/ 即將自動 push。
**Sean 訊息常見回應**:「OK 繼續」→ 直接執行下一步不再確認;「等等/停」→ 立刻停、不執行任何工具呼叫、等下一步;「看不懂/白話一點/畫個圖」→ 視覺化+比喻+multi-select;「[User dismissed…]」→ 不繼續、等 Sean 主動講;Sean 拋新方向(可能與舊拍板衝突)→ 確認是否推翻舊拍板、不假設、不直接照新方向衝。

## 一句話 Phase 1 精神

> **design 是成品、Phase 1 把 design 上架、後台支撐 design、不做 9 大藍圖、前後台同步小步前進。**(完整見 `docs/PHASE-1-NORTHSTAR.md`)

— END —
