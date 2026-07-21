# CLAUDE.md

> **Claude Code 工作規則檔(常載本體;細節與「為什麼」按下方路由表按需讀)。** 每 session 自動載入。
> Codex 入口 = `AGENTS.md`；共同規則只寫在 `docs/ops/AI_CONTRACT.md`，不再靠雙生檔人工同步。2026-07-03 瘦身備份仍在 `docs/archive/2026-07-03-CLAUDE-md-pre-slim.md`。
> **固定政策:** `docs/ops/AI_CONTRACT.md` > 本檔；**現況:** 可驗證事實 > `STATUS.md` > `docs/handoff/CURRENT.md` > 歷史 memory／對話。

---

## 開工儀式(分級;不再一律通讀 9 檔)

```bash
cd /Users/sean_1/pcm-website-v2 && git branch --show-current && git status && git log --oneline -5
```
預期:branch=`dev` / HEAD 對齊 STATUS.md。CURRENT 已標 ownership 的 dirty 可保留並繼續；無法解釋的 dirty、branch 不符或 HEAD 明顯矛盾才停下回報 Sean，不自行 reset／stash／清理。

- **每 session 必讀**:`STATUS.md` + `docs/ops/AI_CONTRACT.md` + `docs/handoff/CURRENT.md` + 本工作直接相關的 handoff/PRD。Codex 與 Claude 都可完整執行；任務明確寫審查時才唯讀。
- **新 milestone / 接手陌生領域才加讀**:`docs/PHASE-1-NORTHSTAR.md` 全文、`docs/PROJECT-OVERVIEW.md`、`docs/PHASE-2-VISION.md`、相關 `docs/features/*.md`。
- **陌生領域開工加一步(盲點掃描)**:上列檔讀完、寫 plan 前,派 subagent 回答「這領域裡我和 Sean 可能都沒想到的坑/依賴/隱含決策是什麼」,把 unknown unknowns 變成問題清單附進 plan 再動手。
- **禁止為「保險」通讀大檔**:用路由表,命中觸發條件才讀對應段落(讀不相關長檔 = 燒 token 也稀釋注意力)。

---

## 鐵則 1-12(每個 slice 必遵守;編號固定、外部大量按編號引用、**絕不重新編號**)

1. **design 直接搬、不翻譯** — design-reference 是真權威、storefront 對齊 design 不反向遷就;寫前台元件前**必先 grep design-reference 字面、不憑記憶**;slice 指令禁用「翻譯/對齊/重寫」字眼;不畫預覽 HTML、不憑想像描述視覺。
2. **後台對應 design** — Medusa schema 對應 design 已定義的資料結構;design `data/products.js` mock 是合約、後台實作合約。
3. **前後台同步、不分階段** — 每 slice:**動前台 → 補對應後台 → 肉眼驗 → 修連動 → commit**;禁「前台全做、後台後補」。
4. **Slice 15-45 分鐘可中斷** — 體積 15-45 分鐘可完成 + Sean 可肉眼驗;超過 → 拆。
5. **CSS + TSX 同元件單一 slice** — 雙檔聯動、預設單一 slice 完成、不拆。
6. **檔案大小硬上限** — 元件檔 **>400 行必拆**、>300 行硬警戒;Hook 檔 >200 行 → 評估拆分、不拆須於 commit body 寫理由。(OD worktree 檔大小用 `git show <sha>:<path>|wc -l`、別讀主樹版。)
7. **Orchestrator 永久禁用** — 複雜「實作」工作單一 session 順序執行(例外:Sean 親口要的有界 research/審查多代理;讀取/驗證/審查/機械批次套用·docs/制度檔工程(限主對話已驗證模式、diff 回核;2026-07-06 拍板)類委派守則見 `~/.claude/rules/00-work-rules.md` §1)。
8. **重大改動前先提 plan 等批准** — 「重大」=任一:跨 3+ 檔 / 動 schema·API·共用元件 / 動 next.config·vercel.json·Medusa config·Prisma schema / 影響部署或資料遷移。Plan 含:**要改什麼、為什麼、預期影響面、rollback**。Sean 批准才執行。
9. **內容分級 L1/L2/L3 強制前置** — L1(年 0-1 次)hardcode 可;L2(季 1-3 次)hardcode+TODO+backlog;L3(週多次)**必後台 CRUD、發現立即停、寫 PRD 後再動**。任何 slice 前先標;**頻率拿不準 → 預設當 L3 停下問 Sean、不硬標 L2**。
10. **三視角檢查** — 每技術決策過:擴充性 / 可維護性 / bug 可追蹤性。backlog 條目必寫「不修未來會痛在哪」、禁寫「待 Sean 決定」空泛句。
11. **Slice 收工三綠 Checkpoint** — commit 前強制跑 typecheck+lint(動 .ts/.tsx 加 build)、任一紅停下修紅再 commit、不繞道/disable/skip/ignore(`/slice-checkpoint` skill、詳 `docs/patterns/slice-checkpoint.md`)。**字面 vs 事實守則:commit 訊息對應實際內容、不假裝完成沒做的事、有偏離寫 commit body 註明**(背景見 slice-checkpoint.md §1)。
12. **高風險改動 commit 前必過 Codex 對抗審查** — 高風險=動到任一(2026-07-22 拍板 C 案):**①錢**(order·payment·refund·pricing·經銷價·會員 tier·儲值金)**②權限**(auth·RLS·GRANT·service_role·server/client 邊界)**③DB 結構與大量/不可逆寫入**(schema·migration·批次匯入)**④平台設定**(next.config·vercel.json·Prisma·CI·env)**⑤對外不可回收**(寄信·對外發布·法律頁)**⑥共用元件 packages/ui 行為改動**(props 介面/邏輯/資料流;純樣式=標準片)。跨 3 檔/一般 API/進度單元收尾**不再自動觸發**;自評有風險只能加審不能免審;Sean 說「Ready for review」必審;milestone 收尾仍跑一次總審。動作:停下、跑完三綠、**commit 前**直呼 codex CLI 唯讀對抗審查(`codex-adversary` 關卡2、`-s read-only`;07-21 拍板不產書面 Packet)、findings 修完才 commit、**不 push**。審查唯讀紀律見 `docs/ops/AI_CONTRACT.md` §2;歷史 Packet 格式備查 `docs/patterns/codex-review-packet.md`。

---

## 路由表(按需讀取;命中「觸發情境」才讀,取代舊 @import 常載)

| 觸發情境 | 讀 |
|---|---|
| 判斷功能是否屬 Phase 1 範圍 / 範圍爭議 | `docs/PHASE-1-NORTHSTAR.md` §1 |
| 動 design-reference / design 與文件矛盾 / 找真權威位置 | `docs/PHASE-1-NORTHSTAR.md` §2 |
| 上線/公測就緒判斷 | `docs/PHASE-1-NORTHSTAR.md` §5 |
| 寫或審 slice 指令格式(六件套完整規格) | `docs/patterns/slice-instruction-six-piece.md` |
| 寫 slice 指令前的逐條自檢 | `docs/working-style.md` §6.3 |
| diff 含 use 開頭 hook(useState/useEffect/useCallback/useMemo/useRef…)/ 動 eslint 設定 / client component 抓資料 | `docs/patterns/react-nextjs-rules.md` |
| 寫 rsync / env·secret 操作 / 跨 repo 同步指令 | `docs/lessons-learned.md` §12-6/12-8/12-9/12-15(🔴) |
| 引用其他 session 的 commit body / 跨 session 交接 | `docs/lessons-learned.md` §12-30/12-25/12-16 |
| 要在任何規則檔新增條目(立法)前 | `docs/lessons-learned.md` §12-34/12-36 |
| 偵察類工作(凡結論將寫「X 未實作/未覆蓋/查無」)/ 下此類斷言前 | `docs/lessons-learned.md` §13 |
| 其他事故式教訓(37 條事故 log) | `docs/lessons-learned.md` §12(先 `grep -n '^### 12-' docs/lessons-learned.md` 列標題、精準讀命中條) |
| 決策題 / 報告格式細節 / Sean 說看不懂 | `docs/working-style.md` §1/§2 |
| 需要 Sean 操作 dashboard / GUI / 查環境路徑 | `docs/working-style.md` §4 |
| skill 與工具用法(context7 / graphify / busboy 細節) | `docs/tools-and-skills.md` |
| 跨專案關聯問題(老闆腦/報價單/上架鏈與本 repo 怎麼連) | 四 repo 合併圖 `/Users/sean_1/老闆腦/跨專案圖/`(cd 進去 `graphify query "問題"`;repo 內問題優先用本 repo `graphify-out/`,較新;合併圖由老闆腦維護、本 repo 不更新它) |
| 三綠細節 / 字面vs事實背景 | `docs/patterns/slice-checkpoint.md` |
| 歷史 Codex Packet 格式(2026-07-21 起停用、改直呼 codex CLI) | `docs/patterns/codex-review-packet.md` |
| 審查鏈全貌 / 寫審分離 | `docs/patterns/cowork-review-chain.md` |
| 鐵則字面的詳解與程式碼範例(規則以本檔為準) | `docs/patterns/general.md` + `docs/patterns/pcm-specific.md` |
| 派 subagent / 判斷猶豫 / 交辦範本 / 制度維護 | `~/.claude/rules/00-work-rules.md`(每 session 自動常載;§1 調度 §2 判準 §3 範本 §4 維護;2026-07-10 六檔合併) |

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
- **多步驟用 `&&` 串接**(任一步失敗自動停)、**禁裸換行 batch 多命令**。
- **「產生新檔→驗證→覆蓋」**:`cat > /tmp/x <<'EOF'` → `test -s /tmp/x || exit 1` → `mv /tmp/x target`。
- **不假設非 macOS CLI 已裝**:`jq`/`yq` 用前 `command -v` 確認、或改 Python 內建。
- **zsh nomatch**:glob 無匹配 exit 1、含 glob 加 `|| true` 或用 `find`。
- **CJK / str_replace 切策略**:見常載 `~/.claude/rules/00-work-rules.md` §5(單一權威,此處不重複;2026-07-22 去重)。

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
- **片型分級(2026-07-22 拍板)**:動手前先標片型。**輕量片**=不碰「共用元件(packages/ui)/金流·order·payment/schema·migration·RLS/auth·tier/next.config·vercel.json·Prisma·CI/.env」且體積=單一元件 CSS+TSX、文案、smoke test 補齊或純 docs → 只跑 SOP ①④⑤⑧⑨(跳偵察 pass、graphify 查詢、關卡1、code-reviewer、關卡2)。**標準片**=其餘 → 全 9 步(同一條線延續片:偵察 pass 沿用本 session 已有結果、免重跑)。**高風險片**=命中鐵則 12 六類 → 全 9 步、對抗審查不降級(僅命中鐵則 8=照常提 plan 等批、片型另按前兩級判)。
- **9 步自驅 SOP**:①起手(讀 STATUS 下一步 + design 真權威 grep)②規劃前偵察 pass(標準片以上;派 haiku/sonnet 掃 backlog/STATUS/specs/memory/lessons 多關鍵字變體 + 查 graphify 連動面、套 T1 範本)→ 自寫 slice plan(標 L1/L2/L3 與片型、判鐵則 8、plan 附「相關既有紀錄與連動面」一節列命中項與連動檔)③關卡1:預設跳 codex、僅高風險片(鐵則 12 六類)跑 `codex-adversary` 審 plan(輪數上限 2、仍不收斂=整理決策題給 Sean;07-22 拍板 C)→ 決策岔路一次性批次問 Sean ④實作(鐵則 3/5/6)⑤三綠 `/slice-checkpoint` ⑥code-reviewer subagent(標準片以上必跑、輕量片跳過;一輪制詳常載 00-work-rules §5 輪次紀律)⑦關卡2:預設只走 code-reviewer、僅命中鐵則 12 才跑 codex 審 diff(每 slice 硬上限 2 輪、round2 仍 FAIL 停下 raise Sean)⑧commit(精準 add、字面vs事實一致、STATUS 7 欄同 commit)+ 收尾對帳(本 session Sean 拍板逐條 vs 已落檔;漏的補寫進對應檔——拍板落 memory `project_*.md`、含決定/理由/連動面、一板一檔或更新既有、不只留 commit body)+ busboy-end ⑨**不 push** 等 Sean 手動推。
- codex-adversary 紀律:只 main session 跑(subagent 被 classifier 擋)、只唯讀(`-s read-only`、settings.json deny 擋 fix/apply/a)、跑前後 `git status --porcelain` 比對零留痕;Codex 與 PCM 鐵則/Sean 拍板衝突以後者為準。

## 快速自檢清單

**slice 開工前**:☐ 起手檢查綠(branch=dev/樹乾淨/HEAD 對齊 STATUS)☐ 讀 STATUS「下一步」確認範圍 ☐ 動 design → grep 真權威字面 ☐ 標 L1/L2/L3(L3 立即停寫 PRD)☐ 標片型(輕量/標準/高風險;輕量片=三綠+smoke test 直達 commit)☐ 判鐵則 8 重大改動(是則先提 plan 等批)☐ 涉錢/權限/schema·migration·大量寫入/平台設定/對外發送/共用元件行為任一 → 逐字過鐵則 12 六類清單(硬清單、不憑自評)☐ 規劃前偵察 pass(標準片以上;掃 backlog/STATUS/specs/memory/lessons + graphify 連動面、plan 附相關紀錄節)☐ 估時 15-45 分鐘(超出拆)。
**slice 結束前**:☐ 肉眼驗(「肉眼驗✅」是 Sean 專屬用詞、Claude 只能寫程式驗)☐ 三綠(動 .ts/.tsx 加 build、不 disable/skip)☐ 命中鐵則 12 → codex CLI 對抗審查已跑(不產 Packet、07-21 拍板)、未 push ☐ 動前台元件 → 補/更新 smoke test(`*.test.tsx`)☐ commit 字面vs事實一致、偏離寫 body ☐ 精準 add ☐ commit 格式對 ☐ STATUS 7 欄更新(同 commit)☐ 收尾對帳(Sean 拍板逐條 vs 已落檔;漏的補寫成 memory `project_*.md`、含決定/理由/連動、不只 commit body)☐ busboy-end ☐ 不 push。(`/pcm-roadmap` 與 `/graphify --update` 不隨每 slice:milestone 收尾或每日收工跑一次即可;07-10 拍板)

## 突發狀況

**發現自己在做這些 → 立刻停下**:把 design「翻譯成 Tailwind 風格」/ 為「保留既有 storefront 結構」改 design 內容 / 憑記憶描述 design·畫預覽 HTML / 把 9 大藍圖 schema 加進 Phase 1 / 一個 slice 跨 3+ 檔卻未提 plan(鐵則 8)/ 想用 Orchestrator 做實作(鐵則 7)/ 即將自動 push。
**Sean 訊息常見回應**:「OK 繼續」→ 直接執行下一步不再確認;「等等/停」→ 立刻停、不執行任何工具呼叫、等下一步;「看不懂/白話一點/畫個圖」→ 視覺化+比喻+multi-select;「[User dismissed…]」→ 不繼續、等 Sean 主動講;Sean 拋新方向(可能與舊拍板衝突)→ 確認是否推翻舊拍板、不假設、不直接照新方向衝。

## 一句話 Phase 1 精神

> **design 是成品、Phase 1 把 design 上架、後台支撐 design、不做 9 大藍圖、前後台同步小步前進。**(完整見 `docs/PHASE-1-NORTHSTAR.md`)

— END —
