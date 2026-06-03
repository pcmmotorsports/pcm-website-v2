# CLAUDE.md

> **Claude Code 工作規則檔(只寫「怎麼做」、詳細「為什麼」見其他 .md)。** 每個進 repo 的 session 自動載入。
> Codex 版雙生檔 = `AGENTS.md`(改本檔的共用規則須同步它)。
> **衝突仲裁:`STATUS.md` > `docs/PHASE-1-NORTHSTAR.md` > 本檔 > 其他 md > 對話歷史。**

@import docs/lessons-learned.md
@import docs/working-style.md
@import docs/PHASE-1-NORTHSTAR.md

---

## 第一天起手檢查清單

```bash
cd /Users/sean_1/pcm-website-v2 && git branch --show-current && git status && git log --oneline -5
```
預期:branch=`dev` / 工作樹 clean+up-to-date / HEAD 對齊 STATUS.md。**任一不綠 → 停下回報 Sean、不自行修復狀態。**

依序讀:① STATUS.md ② PHASE-1-NORTHSTAR.md ③ lessons-learned.md ④ working-style.md ⑤ 本檔 ⑥ PROJECT-OVERVIEW.md ⑦ PHASE-2-VISION.md ⑧ features/vehicle-service-ecosystem.md ⑨ tools-and-skills.md。讀完報 Sean「我已讀完套件、可以開工」。

---

## 鐵則 1-12(每個 slice 必遵守;編號固定、外部大量按編號引用、**絕不重新編號**)

1. **design 直接搬、不翻譯** — design-reference 是真權威、storefront 對齊 design 不反向遷就;寫前台元件前**必先 grep design-reference 字面、不憑記憶**;slice 指令禁用「翻譯/對齊/重寫」字眼;不畫預覽 HTML、不憑想像描述視覺。
2. **後台對應 design** — Medusa schema 對應 design 已定義的資料結構;design `data/products.js` mock 是合約、後台實作合約。
3. **前後台同步、不分階段** — 每 slice:**動前台 → 補對應後台 → 肉眼驗 → 修連動 → commit**;禁「前台全做、後台後補」。
4. **Slice 15-45 分鐘可中斷** — 體積 15-45 分鐘可完成 + Sean 可肉眼驗;超過 → 拆。
5. **CSS + TSX 同元件單一 slice** — 雙檔聯動、預設單一 slice 完成、不拆。
6. **檔案大小硬上限** — 元件檔 **>400 行必拆**、>300 行硬警戒;Hook 檔 >200 行注意。(OD worktree 檔大小用 `git show <sha>:<path>|wc -l`、別讀主樹版。)
7. **Orchestrator 永久禁用** — 複雜工作改單一 session 順序執行(例外:Sean 親口要的有界 research/審查多代理,見 memory `agent-teams-eval-keep-rule-7`)。
8. **重大改動前先提 plan 等批准** — 「重大」=任一:跨 3+ 檔 / 動 schema·API·共用元件 / 動 next.config·vercel.json·Medusa config·Prisma schema / 影響部署或資料遷移。Plan 含:**要改什麼、為什麼、預期影響面、rollback**。Sean 批准才執行。
9. **內容分級 L1/L2/L3 強制前置** — L1(年 0-1 次)hardcode 可;L2(季 1-3 次)hardcode+TODO+backlog;L3(週多次)**必後台 CRUD、發現立即停、寫 PRD 後再動**。任何 slice 前先標。
10. **三視角檢查** — 每技術決策過:擴充性 / 可維護性 / bug 可追蹤性。backlog 條目必寫「不修未來會痛在哪」、禁寫「待 Sean 決定」空泛句。
11. **Slice 收工三綠 Checkpoint** — commit 前強制跑 typecheck+lint(動 .ts/.tsx 加 build)、任一紅停下修紅再 commit、不繞道/disable/skip/ignore(`/slice-checkpoint` skill、詳 `docs/patterns/slice-checkpoint.md`)。**字面 vs 事實守則:commit 訊息對應實際內容、不假裝完成沒做的事、有偏離寫 commit body 註明**(背景見 slice-checkpoint.md §1)。
12. **重大改動/進度結束產 Codex Review Packet** — 觸發(任一):鐵則 8 重大改動 / 動 security·RLS·GRANT·migration·schema·API / 動會員 tier·經銷價·pricing·order·payment / 進度單元(slice 群·milestone)收尾 / 自評有風險 / Sean 說「Ready for review」。停下、跑完三綠、**commit 前**產 Packet(自帶規則摘錄、Codex 無需 repo 即可審)、提醒 Sean 貼 Codex、**不 push**;findings 回來再決定。Packet 格式見 `docs/patterns/codex-review-packet.md`。(與鐵則 8 互補:plan 在動手前、Packet 在 commit 前。)

---

## Slice 指令格式 — 六件套

> 六件套 = Cowork 模式規範(Stage 3 v4 / 2026-05-22);**Claude Code 自驅 SOP(見下)為現行預設**。六件套結構被 code-reviewer.md / cowork-review-chain.md / AGENTS.md 強制依賴、**結構與「— 禁止清單結束 —」標記不可改**。

每份指令外包 markdown code block、含六件套:① 任務目標(1-2 句)② 前置檢查(`git branch/status/log` 全綠才繼續)③ 執行模式+Subagent 模式 ④ Manifest Impact+Review 觸發 ⑤ 執行步驟 ⑥ 驗收條件(明確 yes/no)+ 禁止清單。

```
③ 執行模式: mode A|B(預設 B)/ conductor: main session / subagent_chain: code-reviewer(commit 前必跑)/ fix_attempt_max: 2 / /slice-checkpoint: 跑(純 docs 跳)/ /codex-review: 觸發|不觸發(理由)
④ Manifest Impact: 動到的 storefront 元件[design-mirror.mjs --target 抽] / 對應 design 源 / 業務 override / 未解決偏離 / 最近設計同步;review_triggers: prd_review / slice_review / code_review / security_review_required / codex_review_required
禁止清單(基線): 不改 scope 外檔 / 不變 env·deployment / 不改 schema·infra(除非明確要求)/ 不用 git add .·-A(精準 add)/ 不自動 push / 不動 .env*(settings.json deny 硬攔)/ 不繞 design-mirror.mjs
— 禁止清單結束 —
```
結尾固定「— 禁止清單結束 —」(Sean 確認訊息沒被截斷)。

---

## Git 紀律

- **SSH only**:`git@github.com:pcmmotorsports/pcm-website-v2.git`。絕不在對話貼 ghp_ token;credential 命令加 `grep -v ghp_`;`cat .env` 不在對話跑(Sean 自驗)。
- **Branch**:`main`←production(Sean 手動 merge)/ `dev`←主開發(slice 都在 dev、線性、暫不開 feature branch)。
- **Commit 訊息**:`type(scope): subject [milestone]`。type=feat/fix/refactor/docs/chore/test/perf;scope=storefront/medusa/ui/schemas/docs/config;subject=繁中祈使句≤72 字元。
- **Add 必精準**:`git add <精確路徑>`;**禁 `git add .` / `git add -A`**。
- **不自動 push**:commit + busboy-end 後**不 push**、Sean 手動推=review checkpoint。
- **Submodule**:初始化 `git submodule update --init --recursive`;同步 design `git submodule update --remote design-reference/` → `git add design-reference` commit。

---

## Busboy / STATUS.md 維護

- **Busboy**:開始 Sean 跑 `busboy-start.js pcm`(輸出 template 貼新 session 首訊);結束你跑 `busboy-end.js pcm`(自動更 STATUS 4 欄 + commit、**不 push**;完整 7 欄是 slice commit 的責任)。失敗 → 停下回報、不自行 retry。(`/Users/sean_1/pcm-tools/scripts/`)
- **STATUS.md**:slice 結束**同一 commit**(不另開)更 7 欄:① 當前狀態(milestone/slice/branch)② 最後更新(時間/更新者)③ 最近 3 commit(挑有意義的、用**可達 hash**:`git merge-base --is-ancestor` 驗、避 busboy off-by-one orphan)④ 下一步(第 1 條優先)⑤ Sean 待決策 ⑥ Blocker ⑦ 緊急 backlog 編號。主表(分隔線上)≤30 行嚴守、超過精簡 content 不砍欄;附屬區(分隔線下)自然增長;**不寫歷史(去 PROGRESS.md)、不複製 backlog 細節(只列編號)**。

---

## 工具索引(詳見 `docs/tools-and-skills.md`)

- **`/slice-checkpoint`**(鐵則 11 三綠跑手)— typecheck+lint+條件 build、輸出可貼 commit body 的 ✅/❌。每 slice commit 前**強制**、任一紅停下修紅、不繞道/disable/skip。觸發語「跑三綠/checkpoint/slice 收工/鐵則 11」。純文件 slice(只動 .md/.json)build 跳、typecheck+lint 仍跑。規範 `docs/patterns/slice-checkpoint.md`。
- **context7 MCP** — 拉 Next 16/React 19/Tailwind v4/Supabase 版本對應官方文件、補訓練落差(prompt 加「use context7」)。
- **`/graphify`**(結構地圖、非進度地圖)— repo 掃知識圖譜、產物 `graphify-out/`(本機不入 git)。`/graphify .` 全建 / `--update` 增量(動程式碼才跑)/ `query`·`explain`·`path`(查詢用英文)。用 session 額度、別設 GEMINI/GOOGLE key、別跑 headless extract;`.graphifyignore` 擋 .env*/.claude/憑證/設計截圖。
- **`codex-adversary`**(對抗審查、見下「自驅 SOP」)、**`code-reviewer`** subagent(commit 前 PCM 鐵則快篩)。

---

## 終端機 / Bash 紀律(Sean zsh 環境)

- **zsh 禁忌**:命令內**禁 `#` 註解**(報 command not found)、**禁全形標點「」():;**(報 unknown file attribute);註解寫 prose、不寫進命令。
- **多步驟用 `&&` 串接**(任一步失敗自動停)、**禁裸換行 batch 多命令**。
- **「產生新檔→驗證→覆蓋」**:`cat > /tmp/x <<'EOF'` → `test -s /tmp/x || exit 1` → `mv /tmp/x target`。
- **不假設非 macOS CLI 已裝**:`jq`/`yq` 用前 `command -v` 確認、或改 Python 內建。
- **zsh nomatch**:glob 無匹配 exit 1、含 glob 加 `|| true` 或用 `find`。
- **CJK / str_replace**:大塊中文(全形「」():;易誤打半形、byte 不 match)str_replace 易失敗 → 連敗 2 次切策略:① bash sed + anchor(起迄特徵文字非行號)② read→rewrite 整段→write ③ 拆短 anchor。str_replace 適用:程式碼/英文/短中文 anchor。

---

## React / Next.js 規則

- **React 19 hooks**:只開兩條 v5 規則(eslint-plugin-react-hooks v7.1.1、M-1-13Z 拍板)— `rules-of-hooks`(error、防條件/loop/nested 內呼叫)+ `exhaustive-deps`(error、防 deps 漏列多列、stale closure 防線)。套用 `apps/storefront/**/*.tsx` + `packages/ui/**/*.tsx`。
  - mount-only useEffect 合法寫法:`}, []);` 上一行 `// eslint-disable-next-line react-hooks/exhaustive-deps` + 內聯註解述意圖;deps 多餘則直接刪(語意正確化、不加 disable)。
  - v7 React Compiler 相關新規則(purity/set-state-in-effect/immutability 等)**未開**、留 follow-up、**見 backlog #168**(別在本檔列舉)。
- **build pass ≠ runtime pass**:`ignoreBuildErrors` 只影響 TypeScript、不影響 ESLint;Vercel build 不跑 ESLint、ESLint 守門靠 CI gate(GitHub Actions)。

---

## Server 端鐵則(會員與價格、Phase 1 核心)

- 會員等級驗證**必在 server 端重新檢查**、不信任 client 送的欄位。
- Client component **不得 import** `@/lib/prisma` 或任何洩漏經銷價的模組;**經銷價絕不傳到一般會員瀏覽器**。
- 金額用整數(分/角)或 `Decimal`、**禁用 `number` 處理價格**(浮點誤差)。
- 敏感資訊(DB 連線字串/API token/金流金鑰)→ `.env.local` only、絕不提交 git、絕不貼對話。

---

## Sean 風格速查(完整見 `docs/working-style.md`)

- **兩層報告**:上層白話(影響哪些檔/出錯怎樣/估多久/風險)+ 下層技術細節 + 指令(code block、一鍵複製)。
- **決策一律 multi-select**:每題給 2-4 選項 Sean 點選、**禁開放式問題**;用業務白話、技術細節留下層(預設白話、不等「看不懂」才切)。決策用 prose code block(`Q:…/A: A|B|C`)、Sean copy-paste 回、**不走 AskUserQuestion UI**。
- **「看不懂/白話一點/畫個圖」** → 視覺化 + 比喻 + multi-select 三層白話模式。
- **Sean 改變主意是常態** → 不質疑、重新對齊、不堅持舊版。

---

## 分工 + 審查流程(現行:Claude Code 自驅 / 寫審分離)

> **現行預設 = Claude Code 自驅 SOP**(2026-05-23 起、Sean 嫌 Cowork 拖速度)。**Cowork 規劃模式保留**(複雜 milestone 級 PRD / Sean 指定時用)。對抗審查改用 Codex(`codex-adversary` skill、不同模型)+ Claude `code-reviewer`(免費快篩)補回。

**五方分工**(不越界;code-reviewer 是 Code session 內角色、非第六方):
| 角色 | 做 | 不做 |
|---|---|---|
| Sean | 拍板 / push / 操作 dashboard / Terminal 跑命令 / Claude Design 改設計 / 肉眼驗收 / 貼 Codex Packet | 寫 code / debug / git diff 細節 |
| Cowork(可選) | 規劃 / 寫 slice 指令 / 寫 .md·handoff / 決策題 / spawn PRD·slice reviewer | 寫實作 code / 拍板 / 視覺設計 / commit / push |
| Claude Code(你) | 跑命令 / 實作 / git commit / 測試 / 偵察 design / spawn code-reviewer / 跑 skill / 自驅規劃 | push / deploy / 替 Sean 拍板 / 視覺設計 |
| Codex | 收 Packet 唯讀審(不同模型第二意見)/ 回 findings | 改 code / commit / push / 替代 code-reviewer |
| Claude Design | 視覺/前台設計、輸出 .jsx/.css(對 GitHub 唯讀) | 寫 storefront 程式 / 後台設計 / push |

**寫審分離(進階變體、ROLE=A)**:複雜並行工作拆【執行 session】(實作)+【審查 session】(fresh-context 重驗 + 自跑 codex + sign-off),Sean 橋接。並行多 session 用**獨立 git worktree 隔離**(防共用 index 撞車)。審查可掛哨兵(Monitor 盯分支、每 commit 自動審、FAIL 才推播)。見 memory `feedback_execution-review-session-split` / `reference_sentinel-auto-review-pipeline` / `feedback_concurrent-session-git-index-contamination`。

**Claude Code 自驅 SOP(9 步)**:
1. **起手** — 讀 STATUS「下一步」+ PRD/handoff + design 真權威(鐵則 1 grep)。
2. **規劃** — 自寫 slice plan(取代 Cowork);標 L1/L2/L3、判鐵則 8。
3. **關卡1(動手前審 plan)** — **預設跳 codex**;僅鐵則 8 重大改動跑 `codex-adversary`(`codex exec -s read-only` 審 plan vs PRD/design)→ 自修 → 決策岔路**一次性批次**問 Sean(prose multi-select)。
4. **實作** — 鐵則 3/5/6。
5. **三綠** — `/slice-checkpoint`。
6. **code-reviewer(必跑)** — Claude subagent 快篩(鐵則 + 字面vs事實 + manifest)。
7. **關卡2(動手後審 diff)** — **預設跳 codex、只走 code-reviewer**;僅命中鐵則 12(security/RLS/migration/pricing/order/payment/tier/經銷價)或鐵則 8 才跑 `codex-adversary`(`codex exec -s read-only` 審 diff)。**codex 每 slice 硬上限 2 輪(初審+1 複審)、round2 仍 FAIL 停下 raise Sean**。例行前台 slice(form/tab/CSS/型別)不跑 codex(控 OpenAI 成本)。
8. **commit** — 精準 add、字面vs事實一致、**STATUS 7 欄自更** + busboy-end。
9. **不 push** — 等 Sean 手動推。

codex-adversary 紀律:**只 main session 跑**(subagent 被 classifier 擋)、**只唯讀**(`-s read-only`、settings.json deny 擋 fix/apply/a、跑前後 `git status --porcelain` 比對零留痕)。Codex 與 PCM 鐵則/Sean 拍板衝突以後者為準。完整鏈見 `docs/patterns/cowork-review-chain.md`。

---

## 快速自檢清單

**slice 開工前**:☐ 起手檢查綠(branch=dev/樹乾淨/HEAD 對齊 STATUS) ☐ 讀 STATUS「下一步」確認範圍 ☐ 動 design → grep 真權威字面 ☐ 標 L1/L2/L3(L3 立即停寫 PRD) ☐ 判鐵則 8 重大改動(是則先提 plan 等批) ☐ 估時 15-45 分鐘(超出拆)。

**寫 slice 指令前**:☐ 直接搬非翻譯 ☐ grep design 字面 ☐ CSS+TSX 同 slice ☐ 前後台同步 ☐ 標內容分級 ☐ 估時 15-45 分 ☐ 數字內部一致 ☐ 用詞精準(preview≠production / stash≠working tree / commit≠push) ☐ 禁止清單可執行不矛盾 ☐ 結尾「— 禁止清單結束 —」未截斷 ☐ 重大改動先提 plan。

**slice 結束前**:☐ 肉眼驗(前台跑一遍) ☐ 三綠(動 .ts/.tsx 加 build、不 disable/skip) ☐ 命中鐵則 12 → 產 Codex Packet + 提醒 Sean、未 push ☐ 動前台元件 → 補/更新 smoke test(`*.test.tsx`、見 `docs/architecture/testing-strategy.md`) ☐ commit 字面vs事實一致、偏離寫 body ☐ 精準 add ☐ commit 格式對 ☐ STATUS 7 欄更新(同 commit) ☐ busboy-end ☐ `/pcm-roadmap` 更進度地圖 ☐ 動程式碼 → `/graphify --update` ☐ 不 push。

---

## 突發狀況

**發現自己在做這些 → 立刻停下**:把 design「翻譯成 Tailwind 風格」/ 為「保留既有 storefront 結構」改 design 內容 / 憑記憶描述 design·畫預覽 HTML / 把 9 大藍圖 schema 加進 Phase 1 / 一個 slice 跨 5+ 檔 / 想用 Orchestrator(除非 Sean 明確要的有界 research·審查多代理、鐵則 7 例外)/ 即將自動 push。

**Sean 訊息常見回應**:「OK 繼續」→ 直接執行下一步不再確認;「等等/停」→ 立刻停、不執行任何工具呼叫、等下一步;「看不懂/白話一點/畫個圖」→ 視覺化+比喻+multi-select;「[User dismissed…]」→ 不繼續、等 Sean 主動講;Sean 拋新方向(可能與舊拍板衝突)→ 確認是否推翻舊拍板、不假設、不直接照新方向衝。

---

## 一句話 Phase 1 精神

> **design 是成品、Phase 1 把 design 上架、後台支撐 design、不做 9 大藍圖、前後台同步小步前進。**(完整見 `docs/PHASE-1-NORTHSTAR.md`)

— END —
