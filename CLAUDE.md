# CLAUDE.md

> **Claude Code 工作規則檔(常載本體;細節與「為什麼」按下方路由表按需讀)。** 每 session 自動載入。
> Codex 雙生檔 = `AGENTS.md`(共用規則改動須同步)。2026-07-03 瘦身:移除 @import 常載、改按需路由;原版備份 `docs/archive/2026-07-03-CLAUDE-md-pre-slim.md`。
> **衝突仲裁:`STATUS.md` > `docs/PHASE-1-NORTHSTAR.md` > 本檔 > 其他 md > 對話歷史。**

---

## 開工儀式(分級;不再一律通讀 9 檔)

```bash
cd /Users/sean_1/pcm-website-v2 && git branch --show-current && git status && git log --oneline -5
```
預期:branch=`dev` / 工作樹 clean+up-to-date / HEAD 對齊 STATUS.md。**任一不綠 → 停下回報 Sean、不自行修復狀態。**

- **每 session 必讀**:STATUS.md(重點「下一步」「Sean 待決策」「Blocker」)+ 本工作直接相關的 handoff/PRD。讀完回報 Sean「已就緒、可開工」。
- **新 milestone / 接手陌生領域才加讀**:`docs/PHASE-1-NORTHSTAR.md` 全文、`docs/PROJECT-OVERVIEW.md`、`docs/PHASE-2-VISION.md`、相關 `docs/features/*.md`。
- **禁止為「保險」通讀大檔**:用路由表,命中觸發條件才讀對應段落(讀不相關長檔 = 燒 token 也稀釋注意力)。

---

## 鐵則 1-12(每個 slice 必遵守;編號固定、外部大量按編號引用、**絕不重新編號**)

1. **design 直接搬、不翻譯** — design-reference 是真權威、storefront 對齊 design 不反向遷就;寫前台元件前**必先 grep design-reference 字面、不憑記憶**;slice 指令禁用「翻譯/對齊/重寫」字眼;不畫預覽 HTML、不憑想像描述視覺。
2. **後台對應 design** — Medusa schema 對應 design 已定義的資料結構;design `data/products.js` mock 是合約、後台實作合約。
3. **前後台同步、不分階段** — 每 slice:**動前台 → 補對應後台 → 肉眼驗 → 修連動 → commit**;禁「前台全做、後台後補」。
4. **Slice 15-45 分鐘可中斷** — 體積 15-45 分鐘可完成 + Sean 可肉眼驗;超過 → 拆。
5. **CSS + TSX 同元件單一 slice** — 雙檔聯動、預設單一 slice 完成、不拆。
6. **檔案大小硬上限** — 元件檔 **>400 行必拆**、>300 行硬警戒;Hook 檔 >200 行注意。(OD worktree 檔大小用 `git show <sha>:<path>|wc -l`、別讀主樹版。)
7. **Orchestrator 永久禁用** — 複雜「實作」工作單一 session 順序執行(例外:Sean 親口要的有界 research/審查多代理;讀取/驗證/審查/機械批次套用(限主對話已驗證模式、diff 回核)類委派守則見 `~/.claude/rules/10-model-dispatch.md` §0-§1)。
8. **重大改動前先提 plan 等批准** — 「重大」=任一:跨 3+ 檔 / 動 schema·API·共用元件 / 動 next.config·vercel.json·Medusa config·Prisma schema / 影響部署或資料遷移。Plan 含:**要改什麼、為什麼、預期影響面、rollback**。Sean 批准才執行。
9. **內容分級 L1/L2/L3 強制前置** — L1(年 0-1 次)hardcode 可;L2(季 1-3 次)hardcode+TODO+backlog;L3(週多次)**必後台 CRUD、發現立即停、寫 PRD 後再動**。任何 slice 前先標;**頻率拿不準 → 預設當 L3 停下問 Sean、不硬標 L2**。
10. **三視角檢查** — 每技術決策過:擴充性 / 可維護性 / bug 可追蹤性。backlog 條目必寫「不修未來會痛在哪」、禁寫「待 Sean 決定」空泛句。
11. **Slice 收工三綠 Checkpoint** — commit 前強制跑 typecheck+lint(動 .ts/.tsx 加 build)、任一紅停下修紅再 commit、不繞道/disable/skip/ignore(`/slice-checkpoint` skill、詳 `docs/patterns/slice-checkpoint.md`)。**字面 vs 事實守則:commit 訊息對應實際內容、不假裝完成沒做的事、有偏離寫 commit body 註明**(背景見 slice-checkpoint.md §1)。
12. **重大改動/進度結束產 Codex Review Packet** — 觸發(任一):鐵則 8 重大改動 / 動 security·RLS·GRANT·migration·schema·API / 動會員 tier·經銷價·pricing·order·payment / 進度單元(slice 群·milestone)收尾 / 自評有風險 / Sean 說「Ready for review」。停下、跑完三綠、**commit 前**產 Packet(自帶規則摘錄、Codex 無需 repo 即可審)、提醒 Sean 貼 Codex、**不 push**;findings 回來再決定。格式見 `docs/patterns/codex-review-packet.md`。(與鐵則 8 互補:plan 在動手前、Packet 在 commit 前。動作分流:slice 內 commit 前的審查 = 關卡 2 跑 `codex-adversary` 自動審;書面 Packet = 進度單元/milestone 收尾或 Sean 說 Ready for review 時產、由 Sean 貼 web Codex。)

---

## 路由表(按需讀取;命中「觸發情境」才讀,取代舊 @import 常載)

| 觸發情境 | 讀 |
|---|---|
| 判斷功能是否屬 Phase 1 範圍 / 範圍爭議 | `docs/PHASE-1-NORTHSTAR.md` §1 |
| 動 design-reference / design 與文件矛盾 / 找真權威位置 | `docs/PHASE-1-NORTHSTAR.md` §2 |
| 上線/公測就緒判斷 | `docs/PHASE-1-NORTHSTAR.md` §5 |
| 寫或審 slice 指令格式(六件套完整規格) | `docs/patterns/slice-instruction-six-piece.md` |
| 寫 slice 指令前的逐條自檢 | `docs/working-style.md` §6.3 |
| 動 hooks / eslint / useEffect | `docs/patterns/react-nextjs-rules.md` |
| 寫 rsync / env·secret 操作 / 跨 repo 同步指令 | `docs/lessons-learned.md` §12-6/12-8/12-9/12-15(🔴) |
| 引用其他 session 的 commit body / 跨 session 交接 | `docs/lessons-learned.md` §12-30/12-25/12-16 |
| 要在任何規則檔新增條目(立法)前 | `docs/lessons-learned.md` §12-34/12-36 |
| 偵察 slice / 斷言「某功能未覆蓋」前 | `docs/lessons-learned.md` §13 |
| 其他事故式教訓(37 條事故 log) | `docs/lessons-learned.md` §12(先掃各條標題、精準讀命中條) |
| 決策題 / 報告格式細節 / Sean 說看不懂 | `docs/working-style.md` §1/§2 |
| 需要 Sean 操作 dashboard / GUI / 查環境路徑 | `docs/working-style.md` §4 |
| skill 與工具用法(context7 / graphify / busboy 細節) | `docs/tools-and-skills.md` |
| 三綠細節 / 字面vs事實背景 | `docs/patterns/slice-checkpoint.md` |
| Codex Packet 格式 | `docs/patterns/codex-review-packet.md` |
| 審查鏈全貌 / 寫審分離 | `docs/patterns/cowork-review-chain.md` |
| 派 subagent(模型選擇 / 升降級 / 回報合約) | `~/.claude/rules/10-model-dispatch.md` |
| 猶豫「完成了嗎 / 該問 Sean 嗎 / 該換路嗎」 | `~/.claude/rules/20-judgment-rubrics.md` |
| 寫 subagent prompt | `~/.claude/rules/30-task-templates.md` |
| 制度檔維護 / 踩雷教訓寫回哪 | `~/.claude/rules/40-maintenance.md` |

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
- **CJK / str_replace**:大塊中文(全形標點易誤打半形、byte 不 match)str_replace 連敗 2 次切策略:① sed + 特徵文字 anchor ② read→整段 rewrite→write ③ 拆短 anchor。第 3 次仍敗 → 停下回報。

## Server 端鐵則(會員與價格、Phase 1 核心)

- 會員等級驗證**必在 server 端重新檢查**、不信任 client 送的欄位。
- Client component **不得 import** `@/lib/prisma` 或任何洩漏經銷價的模組;**經銷價絕不傳到一般會員瀏覽器**。
- 金額用整數(分/角)或 `Decimal`、**禁用 `number` 處理價格**(浮點誤差)。
- 敏感資訊(DB 連線字串/API token/金流金鑰)→ `.env.local` only、絕不提交 git、絕不貼對話。

## Sean 風格速查(完整見 `docs/working-style.md`)

- **兩層報告**:上層白話(影響哪些檔/出錯怎樣/估多久/風險)+ 下層技術細節 + 指令(code block、一鍵複製)。
- **決策一律 multi-select**:每題 2-4 選項、**禁開放式問題**;業務白話、技術細節留下層;用 prose code block(`Q:…/A: A|B|C`)、Sean copy-paste 回、**不走 AskUserQuestion UI**。
- **「看不懂/白話一點/畫個圖」** → 視覺化 + 比喻 + multi-select 三層白話模式。
- **Sean 改變主意是常態** → 不質疑、重新對齊、不堅持舊版。

## 分工 + 自驅 SOP(現行預設;五方分工表與完整鏈見 `docs/patterns/cowork-review-chain.md` 與 `AGENTS.md`)

- 分工要點:Sean 拍板/push/操作 dashboard/肉眼驗收;Claude Code(你)實作/commit/測試/自驅規劃、**不 push、不 deploy、不替 Sean 拍板、不做視覺設計**;Codex 收 Packet 唯讀審(不同模型第二意見);Claude Design 管視覺。
- **9 步自驅 SOP**:①起手(讀 STATUS 下一步 + design 真權威 grep)②規劃前偵察 pass(派 haiku/sonnet 掃 backlog/STATUS/specs/memory/lessons 多關鍵字變體 + 查 graphify 連動面、套 T1 範本)→ 自寫 slice plan(標 L1/L2/L3、判鐵則 8、plan 附「相關既有紀錄與連動面」一節列命中項與連動檔)③關卡1:預設跳 codex、僅鐵則 8 重大改動跑 `codex-adversary` 審 plan → 決策岔路一次性批次問 Sean ④實作(鐵則 3/5/6)⑤三綠 `/slice-checkpoint` ⑥code-reviewer subagent 必跑 ⑦關卡2:預設只走 code-reviewer、僅命中鐵則 12 或鐵則 8 才跑 codex 審 diff(每 slice 硬上限 2 輪、round2 仍 FAIL 停下 raise Sean)⑧commit(精準 add、字面vs事實一致、STATUS 7 欄同 commit)+ 收尾對帳(本 session Sean 拍板逐條 vs 已落檔、漏的當場補寫)+ busboy-end ⑨**不 push** 等 Sean 手動推。
- codex-adversary 紀律:只 main session 跑(subagent 被 classifier 擋)、只唯讀(`-s read-only`、settings.json deny 擋 fix/apply/a)、跑前後 `git status --porcelain` 比對零留痕;Codex 與 PCM 鐵則/Sean 拍板衝突以後者為準。

## 快速自檢清單

**slice 開工前**:☐ 起手檢查綠(branch=dev/樹乾淨/HEAD 對齊 STATUS)☐ 讀 STATUS「下一步」確認範圍 ☐ 動 design → grep 真權威字面 ☐ 標 L1/L2/L3(L3 立即停寫 PRD)☐ 判鐵則 8 重大改動(是則先提 plan 等批)☐ 規劃前偵察 pass(掃 backlog/STATUS/specs/memory/lessons + graphify 連動面、plan 附相關紀錄節)☐ 估時 15-45 分鐘(超出拆)。
**slice 結束前**:☐ 肉眼驗(「肉眼驗✅」是 Sean 專屬用詞、Claude 只能寫程式驗)☐ 三綠(動 .ts/.tsx 加 build、不 disable/skip)☐ 命中鐵則 12 → 產 Packet + 提醒 Sean、未 push ☐ 動前台元件 → 補/更新 smoke test(`*.test.tsx`)☐ commit 字面vs事實一致、偏離寫 body ☐ 精準 add ☐ commit 格式對 ☐ STATUS 7 欄更新(同 commit)☐ 收尾對帳(Sean 本 session 拍板逐條 vs 已落檔、漏補寫)☐ busboy-end ☐ `/pcm-roadmap` 更進度地圖 ☐ 動程式碼 → `/graphify --update` ☐ 不 push。

## 突發狀況

**發現自己在做這些 → 立刻停下**:把 design「翻譯成 Tailwind 風格」/ 為「保留既有 storefront 結構」改 design 內容 / 憑記憶描述 design·畫預覽 HTML / 把 9 大藍圖 schema 加進 Phase 1 / 一個 slice 跨 5+ 檔 / 想用 Orchestrator 做實作(鐵則 7)/ 即將自動 push。
**Sean 訊息常見回應**:「OK 繼續」→ 直接執行下一步不再確認;「等等/停」→ 立刻停、不執行任何工具呼叫、等下一步;「看不懂/白話一點/畫個圖」→ 視覺化+比喻+multi-select;「[User dismissed…]」→ 不繼續、等 Sean 主動講;Sean 拋新方向(可能與舊拍板衝突)→ 確認是否推翻舊拍板、不假設、不直接照新方向衝。

## 一句話 Phase 1 精神

> **design 是成品、Phase 1 把 design 上架、後台支撐 design、不做 9 大藍圖、前後台同步小步前進。**(完整見 `docs/PHASE-1-NORTHSTAR.md`)

— END —
