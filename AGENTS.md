# AGENTS.md

> **Codex 工作規則檔(只寫「怎麼做」、詳細「為什麼」見其他 .md)。** 每個進 repo 的 Codex session 自動載入。
> Claude Code 版雙生檔 = `CLAUDE.md`(共用規則須兩檔同步;鐵則 1-11 + git/bash/server/CJK 共用,鐵則 12 + 角色框架為 Codex 視角)。
> **衝突仲裁:`STATUS.md` > `docs/PHASE-1-NORTHSTAR.md` > 本檔 > 其他 md > 對話歷史。**

**按需路由(2026-07-03 與 CLAUDE.md 同步瘦身:移除 @import 常載、原版備份 `docs/archive/2026-07-03-AGENTS-md-pre-slim.md`;命中情境才讀,不通讀)**:
- Phase 1 範圍爭議 → `docs/PHASE-1-NORTHSTAR.md` §1;design 真權威與矛盾仲裁 → 同檔 §2;上線判斷 → 同檔 §5
- 事故式教訓 37 條(rsync/env·secret/跨 repo/立法格式等) → `docs/lessons-learned.md` §12(先 `grep -n '^### 12-' docs/lessons-learned.md` 列標題、精準讀命中條);偵察方法論(凡結論將寫「X 未實作/未覆蓋/查無」)→ 同檔 §13;寫 slice 指令前自檢 → `docs/working-style.md` §6.3;Sean 報告/決策格式 → 同檔 §1/§2;Sean 環境與 dashboard → 同檔 §4
- 三綠與字面vs事實背景 → `docs/patterns/slice-checkpoint.md`;Packet 格式 → `docs/patterns/codex-review-packet.md`;審查鏈全貌 → `docs/patterns/cowork-review-chain.md`;React/hooks 規則 → `docs/patterns/react-nextjs-rules.md`;鐵則詳解與程式碼範例(規則字面以本檔為準)→ `docs/patterns/general.md` + `docs/patterns/pcm-specific.md`

---

## 第一天起手檢查清單

```bash
cd /Users/sean_1/pcm-website-v2 && git branch --show-current && git status && git log --oneline -5
```
預期:branch=`dev` / 工作樹 clean+up-to-date / HEAD 對齊 STATUS.md。**任一不綠 → 停下回報 Sean、不自行修復狀態。**

分級開工:**每 session 必讀** STATUS.md(「下一步」「Sean 待決策」「Blocker」)+ 本工作直接相關 handoff/PRD,讀完報 Sean「已就緒、可開工」;**新 milestone / 陌生領域才加讀** `docs/PHASE-1-NORTHSTAR.md` 全文、`docs/PROJECT-OVERVIEW.md`、`docs/PHASE-2-VISION.md`、相關 `docs/features/*.md`。其餘按上方路由表按需讀,不為「保險」通讀大檔。

---

## 鐵則 1-12(每個 slice 必遵守;編號固定、外部大量按編號引用、**絕不重新編號**)

1. **design 直接搬、不翻譯** — design-reference 是真權威、storefront 對齊 design 不反向遷就;寫前台元件前**必先 grep design-reference 字面、不憑記憶**;slice 指令禁用「翻譯/對齊/重寫」字眼;不畫預覽 HTML、不憑想像描述視覺。
2. **後台對應 design** — Medusa schema 對應 design 已定義的資料結構;design `data/products.js` mock 是合約、後台實作合約。
3. **前後台同步、不分階段** — 每 slice:**動前台 → 補對應後台 → 肉眼驗 → 修連動 → commit**;禁「前台全做、後台後補」。
4. **Slice 15-45 分鐘可中斷** — 體積 15-45 分鐘可完成 + Sean 可肉眼驗;超過 → 拆。
5. **CSS + TSX 同元件單一 slice** — 雙檔聯動、預設單一 slice 完成、不拆。
6. **檔案大小硬上限** — 元件檔 **>400 行必拆**、>300 行硬警戒;Hook 檔 >200 行 → 評估拆分、不拆須於 commit body 寫理由。(OD worktree 檔大小用 `git show <sha>:<path>|wc -l`、別讀主樹版。)
7. **Orchestrator 永久禁用** — 複雜「實作」工作單一 session 順序執行(例外:Sean 親口要的有界 research/審查多代理;Claude Code 端「讀取/驗證/審查/機械批次套用·docs/制度檔工程(限主對話已驗證模式、diff 回核;2026-07-06 拍板)」的委派授權見其 `~/.claude/rules/00-work-rules.md` §1,你審到此類委派時知悉為合規、非鐵則 7 違反)。
8. **重大改動前先提 plan 等批准** — 「重大」=任一:跨 3+ 檔 / 動 schema·API·共用元件 / 動 next.config·vercel.json·Medusa config·Prisma schema / 影響部署或資料遷移。Plan 含:**要改什麼、為什麼、預期影響面、rollback**。Sean 批准才執行。
9. **內容分級 L1/L2/L3 強制前置** — L1(年 0-1 次)hardcode 可;L2(季 1-3 次)hardcode+TODO+backlog;L3(週多次)**必後台 CRUD、發現立即停、寫 PRD 後再動**。任何 slice 前先標;**頻率拿不準 → 預設當 L3 停下問 Sean、不硬標 L2**。
10. **三視角檢查** — 每技術決策過:擴充性 / 可維護性 / bug 可追蹤性。backlog 條目必寫「不修未來會痛在哪」、禁寫「待 Sean 決定」空泛句。
11. **Slice 收工三綠 Checkpoint** — commit 前強制跑 typecheck+lint(動 .ts/.tsx 加 build)、任一紅停下修紅再 commit、不繞道/disable/skip/ignore(詳 `docs/patterns/slice-checkpoint.md`)。**字面 vs 事實守則:commit 訊息對應實際內容、不假裝完成沒做的事、有偏離寫 commit body 註明**(背景見 slice-checkpoint.md §1)。
12. **(Codex 視角)收到 Codex Review Packet 做唯讀審查** — 收 Sean 轉貼的「Codex Review Packet」時:**唯讀審查、不改任何檔、不跑寫入工具、不 commit、不 push**。只回 findings / 風險點 / 是否可繼續(可 commit / 需修正 / 需 Sean 拍板)。審查重點(任一漏掉就點出):① 安全/權限(RLS·GRANT·經銷價洩漏)② schema/migration 會否破壞現有行為 ③ 是否符合 STATUS·NORTHSTAR·本檔鐵則 ④ 該補的 backlog/文件。與鐵則 8 互補:plan 在動手前、Codex Review 在 commit 前。Packet 由 Claude Code 整理、Sean 轉貼、格式見 `docs/patterns/codex-review-packet.md`。(Claude Code 端對應規則 = 產出 Packet,見 CLAUDE.md 鐵則 12。)

---

## Slice 指令格式 — 六件套(你審 slice 時對照)

> 六件套 = Cowork 模式規範(Stage 3 v4);Claude Code 自驅模式下由 Claude Code 自寫 plan。結構被 code-reviewer.md / cowork-review-chain.md / CLAUDE.md 強制依賴、**結構與「— 禁止清單結束 —」標記不可改**。

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

- **Busboy**:開始 Sean 跑 `busboy-start.js pcm`(輸出 template 貼新 Codex session 首訊);結束你在 Codex 跑 `busboy-end.js pcm`(自動更 STATUS 4 欄 + commit、**不 push**;完整 7 欄是 slice commit 的責任)。失敗 → 停下回報、不自行 retry。(`/Users/sean_1/pcm-tools/scripts/`)
- **STATUS.md**:slice 結束**同一 commit**(不另開)更 7 欄:① 當前狀態(milestone/slice/branch)② 最後更新(時間/更新者)③ 最近 3 commit(挑有意義的、用**可達 hash**:`git merge-base --is-ancestor` 驗、避 busboy off-by-one orphan)④ 下一步(第 1 條優先)⑤ Sean 待決策 ⑥ Blocker ⑦ 緊急 backlog 編號。主表(分隔線上)≤30 行嚴守、超過精簡 content 不砍欄;附屬區(分隔線下)自然增長;**不寫歷史(去 PROGRESS.md)、不複製 backlog 細節(只列編號)**。

---

## 終端機 / Bash 紀律(Sean zsh 環境)

- **zsh 禁忌**:命令內**禁 `#` 註解**(報 command not found)、**禁全形標點「」():;**(報 unknown file attribute);註解寫 prose、不寫進命令。
- **多步驟用 `&&` 串接**(任一步失敗自動停)、**禁裸換行 batch 多命令**。
- **「產生新檔→驗證→覆蓋」**:`cat > /tmp/x <<'EOF'` → `test -s /tmp/x || exit 1` → `mv /tmp/x target`。
- **不假設非 macOS CLI 已裝**:`jq`/`yq` 用前 `command -v` 確認、或改 Python 內建。
- **zsh nomatch**:glob 無匹配 exit 1、含 glob 加 `|| true` 或用 `find`。
- **CJK / str_replace**:大塊中文(全形「」():;易誤打半形、byte 不 match)str_replace 易失敗 → 連敗 2 次切策略:① bash sed + anchor(起迄特徵文字非行號)② read→rewrite 整段→write ③ 拆短 anchor;切策略後僅再試 1 次、同一處總嘗試上限 3 次、仍敗停下回報。str_replace 適用:程式碼/英文/短中文 anchor。

---

## React / Next.js 規則(你審 hooks 時對照)

- **eslint 實際只開兩條**:`rules-of-hooks`(防條件/loop/nested 內呼叫)+ `exhaustive-deps`(防 deps 漏列多列、stale closure 防線);套用 `apps/storefront/**/*.tsx` + `packages/ui/**/*.tsx`。mount-only useEffect 合法寫法:`}, []);` 上一行 `eslint-disable-next-line react-hooks/exhaustive-deps` + 內聯註解述意圖。
- **Codex 額外人工審查點**(v7 React Compiler 規則 eslint 未開、backlog #168):`purity`(render body 內禁 `Date.now()`/`Math.random()` 等不純)/ `set-state-in-effect`(`try/finally` vs `.catch()` AST 敏感、`try/finally` 須完整包 `await + setState`)/ immutability。審到違反點出、但修法超出 slice 範圍時用 `eslint-disable-line` + 註解 + backlog 追蹤、不擴張 slice。
- **build pass ≠ runtime pass**:`ignoreBuildErrors` 只影響 TypeScript、不影響 ESLint;Vercel build 不跑 ESLint、ESLint 守門靠 CI gate(GitHub Actions)。

---

## Server 端鐵則(會員與價格、Phase 1 核心、你審安全的重點)

- 會員等級驗證**必在 server 端重新檢查**、不信任 client 送的欄位。
- Client component **不得 import** `@/lib/prisma` 或任何洩漏經銷價的模組;**經銷價絕不傳到一般會員瀏覽器**。
- 金額用整數(分/角)或 `Decimal`、**禁用 `number` 處理價格**(浮點誤差)。
- 敏感資訊(DB 連線字串/API token/金流金鑰)→ `.env.local` only、絕不提交 git、絕不貼對話。

---

## Sean 風格速查(完整見 `docs/working-style.md`)

- **兩層報告**:上層白話(影響哪些檔/出錯怎樣/估多久/風險)+ 下層技術細節(code block、一鍵複製)。
- **決策一律 multi-select**:每題給 2-4 選項 Sean 點選、**禁開放式問題**;用業務白話、技術細節留下層;**答案會改變架構或方向的題排最前面問**。
- **品味題(視覺/文案調性)不用文字選項讓 Sean 想像**:給 3-4 個方向差異夠大的實體版本讓他直接看(互相打架、不是同款微調);視覺 demo 由 Claude Design 產出(分工不變)。
- **「看不懂/白話一點/畫個圖」** → 視覺化 + 比喻 + multi-select。
- **Sean 改變主意是常態** → 不質疑、重新對齊、不堅持舊版。
- 拍板格式 `Q:…/A: A|B|C`、你也用同格式回覆。

---

## 五方分工(不越界;code-reviewer 是 Claude Code session 內角色、非第六方)

| 角色 | 做 | 不做 |
|---|---|---|
| Sean | 拍板 / push / 操作 dashboard / Terminal 跑命令 / Claude Design 改設計 / 肉眼驗收 / 轉貼 Codex Packet | 寫 code / debug / git diff 細節 |
| Cowork(可選) | 規劃 / 寫 slice 指令 / 寫 .md·handoff / 決策題 / spawn PRD·slice reviewer | 寫實作 code / 拍板 / 視覺設計 / commit / push |
| Claude Code | 跑命令 / 實作 / git commit / 測試 / 偵察 design / spawn code-reviewer / 跑 skill / 自驅規劃 | push / deploy / 替 Sean 拍板 / 視覺設計 |
| **Codex(你)** | 收 Codex Review Packet 唯讀審查 / 回 findings·風險·是否可繼續(不同模型第二意見) | 改 code / commit / push / 替代 code-reviewer |
| Claude Design | 視覺/前台設計、輸出 .jsx/.css(對 GitHub 唯讀) | 寫 storefront 程式 / 後台設計 / push |

**你審查的對象**:Claude Code 走「自驅 SOP」(自規劃+實作)或「寫審分離」(執行 session + 審查 session、Sean 橋接)產出的 plan/diff/Packet。你與 PCM 鐵則 / Sean 拍板衝突時以後者為準。完整鏈見 `docs/patterns/cowork-review-chain.md`。(codex-adversary skill = Claude Code 端跑 `codex exec -s read-only` 對抗審 plan/diff、只唯讀;本檔讀者=web Codex 審 Packet。)

---

## 快速自檢清單(你審 slice 是否合規的對照)

**slice 開工前應有**:☐ 起手檢查綠(branch=dev/樹乾淨/HEAD 對齊 STATUS) ☐ 讀 STATUS「下一步」確認範圍 ☐ 動 design → grep 真權威字面 ☐ 標 L1/L2/L3(L3 立即停寫 PRD) ☐ 判鐵則 8 重大改動(是則先提 plan 等批) ☐ 涉金流/RLS/GRANT/migration/schema/auth/.env 任一 → 逐字過鐵則 8+12 觸發清單(硬清單、不憑自評) ☐ 規劃前偵察 pass(掃 backlog/STATUS/specs/memory/lessons + graphify 連動面、plan 附相關紀錄節) ☐ 估時 15-45 分鐘(超出拆)。

**寫 slice 指令應有**:☐ 直接搬非翻譯 ☐ grep design 字面 ☐ CSS+TSX 同 slice ☐ 前後台同步 ☐ 標內容分級 ☐ 估時 15-45 分 ☐ 數字內部一致 ☐ 用詞精準(preview≠production / stash≠working tree / commit≠push) ☐ 禁止清單可執行不矛盾 ☐ 結尾「— 禁止清單結束 —」未截斷 ☐ 重大改動先提 plan。

**slice 結束應有**:☐ 肉眼驗 ☐ 三綠(動 .ts/.tsx 加 build、不 disable/skip) ☐ 動前台元件 → 補/更新 smoke test(`*.test.tsx`、見 `docs/architecture/testing-strategy.md`) ☐ commit 字面vs事實一致、偏離寫 body ☐ 精準 add ☐ commit 格式對 ☐ STATUS 7 欄更新(同 commit) ☐ 收尾對帳(Sean 拍板逐條 vs 已落檔;漏的補寫成 memory `project_*.md`、含決定/理由/連動、不只 commit body) ☐ busboy-end ☐ 不 push(roadmap/graphify=milestone 收尾或每日一次、不隨每 slice;07-10 拍板)。

---

## 突發狀況

**發現 Claude Code 在做這些 → 點出**:把 design「翻譯成 Tailwind 風格」/ 為「保留既有 storefront 結構」改 design 內容 / 憑記憶描述 design·畫預覽 HTML / 把 9 大藍圖 schema 加進 Phase 1 / 一個 slice 跨 3+ 檔卻未提 plan(鐵則 8)/ 想用 Orchestrator(除非 Sean 明確要的有界 research·審查多代理、鐵則 7 例外)/ 即將自動 push。

**Sean 訊息常見回應**:「OK 繼續」→ 直接執行下一步不再確認;「等等/停」→ 立刻停、不執行任何工具呼叫、等下一步;「看不懂/白話一點/畫個圖」→ 視覺化+比喻+multi-select;「[User dismissed…]」→ 不繼續、等 Sean 主動講;Sean 拋新方向(可能與舊拍板衝突)→ 確認是否推翻舊拍板、不假設、不直接照新方向衝。

---

## 一句話 Phase 1 精神

> **design 是成品、Phase 1 把 design 上架、後台支撐 design、不做 9 大藍圖、前後台同步小步前進。**(完整見 `docs/PHASE-1-NORTHSTAR.md`)

— END —
