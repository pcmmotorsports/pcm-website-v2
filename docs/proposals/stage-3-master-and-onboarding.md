# Stage 3 終版 v4 — Master + 階段 0 Code 落檔指令

> **產出者:** Cowork(本輪 session、Sean 拍 sign-off A 補案合理後)
> **日期:** 2026-05-22
> **位置:** `docs/proposals/`(repo 內、可 git commit、user 可開、永久追溯)
> **配套字面源:**
>   - `docs/proposals/stage-3-bundle-code-deliverables.md`(manifest YAML / design-mirror.mjs / code-reviewer.md / settings.json 完整字面)
>   - `docs/proposals/stage-3-bundle-docs-deliverables.md`(2 skills / 2 patterns 擴張 / 1 patterns 新建 / Cowork context doc / CLAUDE.md+AGENTS.md diff 完整字面)
> **Sean 動作:** 看 §A + §B、§B 是 slice 指令一鍵複製貼到 Claude Code session

---

## §A 總覽(Sean 看這段)

### A.1 deliverable 清單(13 個檔 + 1 devDep + 1 .gitignore)

| # | 檔 | 字面源段 | 狀態 |
|---|---|---|---|
| 1 | `docs/design-storefront-manifest.yaml` | bundle-code §C | 新 |
| 2 | `scripts/design-mirror.mjs` | bundle-code §D | 新 |
| 3 | `.claude/agents/code-reviewer.md` | bundle-code §E | 新 |
| 4 | `.claude/settings.json` | bundle-code §F | 新 |
| 5 | `~/.claude/skills/slice-checkpoint/SKILL.md` | bundle-docs §G-1 | 擴張(若 Sean 本機沒、Write 新檔) |
| 6 | `~/.claude/skills/codex-review/SKILL.md` | bundle-docs §G-2 | 新 |
| 7 | `docs/patterns/slice-checkpoint.md` | bundle-docs §H-1 | 擴張 |
| 8 | `docs/patterns/codex-review-packet.md` | bundle-docs §H-2 | 擴張 |
| 9 | `docs/patterns/cowork-review-chain.md` | bundle-docs §I | 新 |
| 10 | Cowork Projects instructions(Sean 自己貼進 Cowork app、不入 repo) | bundle-docs §J | 新 |
| 11 | `CLAUDE.md` diff | bundle-docs §K-1 | 改 |
| 12 | `AGENTS.md` diff | bundle-docs §K-2 | 改 |
| 13 | `package.json`(加 devDep `yaml`)| 本檔 §L | 改 |
| 14 | `.gitignore`(改 `.claude/` blanket → white-list pattern、放行 agents/ + settings.json、Sean 2026-05-22 Q=C1 拍) | 本檔 §L | 改 |

### A.2 Self-audit 14 條補案已落

對齊 `docs/proposals/stage-3-self-audit.md` 14 條漏缺、補案都進對應 deliverable 字面:

| 漏缺 # | 補在哪 |
|---|---|
| 1 PRD-reviewer 觸發 | docs/patterns/cowork-review-chain.md §1 |
| 2 slice-reviewer 強跑 | 同 §2 |
| 3 code-reviewer prompt 必含 | .claude/agents/code-reviewer.md 字面 |
| 4 manifest 第一版 grep 規範 | docs/patterns/cowork-review-chain.md §6 |
| 5 design submodule update 後 manifest 同步 | scripts/design-mirror.mjs --diff-against-storefront 模式 |
| 6 business_overrides 跨檔追蹤 | manifest YAML 元件條目 schema |
| 7 commit pre-check 檢 design-mirror | .claude/settings.json hook 配置 |
| 8 /slice-checkpoint manifest sync 算法 | slice-checkpoint SKILL extension |
| 9 slice 指令五件套→六件套 | Cowork context doc §4 + CLAUDE.md/AGENTS.md diff |
| 10 A mode vs B mode 切換 | docs/patterns/cowork-review-chain.md §3 |
| 11 各階段 failure recovery | docs/patterns/cowork-review-chain.md §4 |
| 12 manifest exclude explorations | manifest YAML 開頭 + cowork-review-chain.md §6 |
| 13 加 devDep yaml | package.json 改 |
| 14 code-reviewer vs Codex 重疊區 | docs/patterns/cowork-review-chain.md §5 |

### A.3 階段 0 落檔效果

跑完階段 0 後:
- 新工作流完整建好(0 程式碼 / 0 業務改動、純基礎建設)
- 1 個未 push commit、Sean 手動推
- 下個 Cowork session 接 M-1-13I、走新流程跑(Cowork 寫 PRD/slice 指令 → PRD-reviewer / slice-reviewer Agent 跑 → Sean 拍業務 → Code 跑 → code-reviewer subagent + /slice-checkpoint 自動 → commit + amend manifest sync → 不 push → Sean 推)
- Sean 預估介入頻率:每 milestone 業務拍板 1-3 次、每 2-3 milestone 貼 Codex + 肉眼驗 + push

---

## §B 階段 0 Code 落檔指令(Sean 一鍵複製貼到 Claude Code session)

```
[Stage-3-onboarding] PCM 工作流升級 — 落檔新工作流規範與工具

═══════════════════════════════════════════
任務目標
═══════════════════════════════════════════
落檔 Stage 3 終版 v4 全套(13 個檔 + 1 devDep + 1 .gitignore 改)、形成 PCM 新工作流的完整基礎建設。Cowork 已寫完所有字面、放 `docs/proposals/` 內、Code 只需 Read 該目錄字面源 + Write 到對應路徑 + 一個大 commit + 不 push。不需 Code 自決字面、若 Cowork 寫的字面有矛盾 raise multi-select。

═══════════════════════════════════════════
前置檢查(全綠才繼續)
═══════════════════════════════════════════
cd /Users/sean_1/pcm-website-v2
git branch --show-current      # 預期: dev
git status                      # 預期: clean + up to date
git log --oneline -5            # 預期最上面: 46594ae(docs(backlog): #163...)
ls docs/proposals/stage-3-master-and-onboarding.md  # 確認字面源存在
ls docs/proposals/stage-3-bundle-code-deliverables.md
ls docs/proposals/stage-3-bundle-docs-deliverables.md
ls docs/proposals/stage-3-self-audit.md
ls docs/proposals/stage-1.7-second-opinion-and-simplified-plan.md

# 任一不綠 → 停下回報。docs/proposals/ 字面源找不到 → 停下、Sean 提供路徑、不憑記憶。
# 注意:docs/proposals/ 是 Cowork 寫的設計字面源、目前 untracked(未進 git)、本 slice 順手 commit。

═══════════════════════════════════════════
執行模式 + Subagent 模式
═══════════════════════════════════════════
mode: B(單一基礎建設 slice、非 milestone 級 A mode)
conductor: main session(本 slice 動到 13 檔、屬鐵則 8 重大改動、但本檔字面源 Cowork 已寫好等同 plan、不需另提 plan、直接 main session 落字面)
subagent_chain: 無(本 slice 落字面、Code 自身 Read/Write 即可、不 spawn code-reviewer、因為 code-reviewer 還沒建出來)
fix_attempt_max: 0(若 Cowork 字面有矛盾 raise multi-select、不自修)
/slice-checkpoint: 不跑(typecheck + lint 對 .md / .yaml / .mjs 大多 N/A;.mjs 跑 node --check 驗 syntax 即可)
/codex-review: 跑(本 slice 屬鐵則 8 重大改動 + 鐵則 12 觸發、Code 自動產 Packet 寫 docs/reviews/2026-05-22-stage-3-onboarding-packet.md、Sean 貼 Codex)

═══════════════════════════════════════════
Manifest impact(本 slice 不動 storefront、N/A)
═══════════════════════════════════════════
動到的 storefront 元件: 無
business_overrides 動: 無
但本 slice 建 manifest 第一版字面、不需跑 design-mirror.mjs inspect(因 design-mirror.mjs 是本 slice 才建出)

═══════════════════════════════════════════
執行步驟
═══════════════════════════════════════════

# Step 1: Read 字面源(repo 內 docs/proposals/、Cowork 已 cp 過去)
ls -la docs/proposals/stage-3-* docs/proposals/stage-1.7-*

# Step 2: 建 13 個檔(順序 = manifest → script → agent → settings → skills → patterns → context doc → diffs)

# 2.1 docs/design-storefront-manifest.yaml(Read bundle-code §C → Write)
# 2.2 scripts/design-mirror.mjs(Read bundle-code §D → Write)
# 2.3 .claude/agents/code-reviewer.md(Read bundle-code §E → Write)
#     注意:.claude/agents/ 目錄若不存在、先 mkdir -p .claude/agents
# 2.4 .claude/settings.json(Read bundle-code §F → Write)
#     注意:若 .claude/settings.local.json 既有(個人設定)、不動;.claude/settings.json 是 repo 共享設定
# 2.5 ~/.claude/skills/slice-checkpoint/SKILL.md(Read bundle-docs §G-1)
#     ls ~/.claude/skills/slice-checkpoint/SKILL.md 確認存在?
#       存在 → Edit append §G-1 擴張段
#       不存在 → mkdir -p ~/.claude/skills/slice-checkpoint && Write 完整字面(對齊 bundle-docs §G-1 含原規範)
# 2.6 ~/.claude/skills/codex-review/SKILL.md(Read bundle-docs §G-2 → mkdir -p ~/.claude/skills/codex-review && Write)
# 2.7 docs/patterns/slice-checkpoint.md(Read bundle-docs §H-1 → Edit append 擴張段)
# 2.8 docs/patterns/codex-review-packet.md(Read bundle-docs §H-2 → Edit append 擴張段)
# 2.9 docs/patterns/cowork-review-chain.md(Read bundle-docs §I → Write 完整字面)
# 2.10 Cowork Projects instructions(Read bundle-docs §J → 提示 Sean「以下字面複製貼到 Cowork app Projects instructions 欄位、不入 repo」)
# 2.11 CLAUDE.md(Read bundle-docs §K-1 → Edit 四方分工表 + slice 指令格式六件套)
# 2.12 AGENTS.md(Read bundle-docs §K-2 → Edit 同步)
# 2.13 package.json(Edit、Cowork 自決加 devDep)
#       devDependencies 加: "yaml": "^2.6.0"
# 2.14 .gitignore(Edit:.claude/ blanket-ignore L33 改 white-list pattern、放行 .claude/agents/ + .claude/settings.json、維持忽略 settings.local.json / worktrees / scratch、對齊本檔 §L.2 精確 diff)

# Step 3: 跑 pnpm install(安裝 yaml devDep)
pnpm install

# Step 4: 跑 design-mirror.mjs --validate(驗 manifest YAML 解析正確 + 對應檔路徑存在)
node scripts/design-mirror.mjs --validate
# 預期:全 OK、無 broken link。若紅、停下 raise(可能 Cowork 字面有 bug)

# Step 5: 跑 node --check 驗 .mjs syntax
node --check scripts/design-mirror.mjs
# 預期:無錯。若紅、停下 raise

# Step 6: 精準 git add(13 個 deliverable + 5 份設計紀錄、共 18 路徑)
# 13 個 deliverable:
git add docs/design-storefront-manifest.yaml
git add scripts/design-mirror.mjs
git add .claude/agents/code-reviewer.md
git add .claude/settings.json
git add docs/patterns/slice-checkpoint.md
git add docs/patterns/codex-review-packet.md
git add docs/patterns/cowork-review-chain.md
git add CLAUDE.md
git add AGENTS.md
git add package.json
git add pnpm-lock.yaml  # devDep 加進後 lockfile 也動
git add .gitignore
# 5 份 docs/proposals/ 設計紀錄(永久 git 追溯、對齊 lessons §12-25 anchor 條):
git add docs/proposals/stage-3-master-and-onboarding.md
git add docs/proposals/stage-3-bundle-code-deliverables.md
git add docs/proposals/stage-3-bundle-docs-deliverables.md
git add docs/proposals/stage-3-self-audit.md
git add docs/proposals/stage-1.7-second-opinion-and-simplified-plan.md
# 不 add 的:.claude/scratch/(已進 .gitignore)、Cowork Projects instructions(不入 repo、Sean 手動貼 Cowork app)
# 不 add ~/.claude/skills/* 因為在 home dir、跨專案、不入本 repo

# Step 7: commit(訊息對齊 Cowork 寫的字面 vs 事實揭示)
git commit -m "$(cat <<'EOF'
chore(workflow): Stage 3 終版 v4 工作流升級基礎建設

落檔新工作流 13 個檔 + 5 份設計紀錄:

13 個 deliverable:
- docs/design-storefront-manifest.yaml(D 方向核心、設計現場對照表第一版)
- scripts/design-mirror.mjs(動工前 inspect 工具)
- .claude/agents/code-reviewer.md(階段 C code-reviewer subagent)
- .claude/settings.json(PreToolUse + SubagentStop hook 配置)
- docs/patterns/slice-checkpoint.md 擴張(加 manifest sync 驗證規範)
- docs/patterns/codex-review-packet.md 擴張(加 manifest 異動段內嵌)
- docs/patterns/cowork-review-chain.md(新、規範 5 階段 review 鏈)
- CLAUDE.md / AGENTS.md(四方分工表升五方 + slice 指令五件套升六件套)
- package.json(加 devDep yaml ^2.6.0、用於 design-mirror.mjs 解析 manifest)
- .gitignore(加 .claude/scratch/、design-mirror 本地 audit trail)

5 份設計紀錄(docs/proposals/、永久追溯、對齊 lessons §12-25):
- stage-3-master-and-onboarding.md(本 slice 指令本身)
- stage-3-bundle-code-deliverables.md(manifest / script / agent / settings 字面源)
- stage-3-bundle-docs-deliverables.md(2 skills / 3 patterns / context doc / 2 diff 字面源)
- stage-3-self-audit.md(Cowork 自審 14 條漏缺 + 補案)
- stage-1.7-second-opinion-and-simplified-plan.md(2 Agent second-opinion 整合過程)

字面 vs 事實揭示:
- Cowork 在 docs/proposals/stage-3-* 寫完所有字面源、Code 本 slice 純落檔、不自決字面
- ~/.claude/skills/slice-checkpoint/ 與 ~/.claude/skills/codex-review/ 屬 Sean 本機 home dir、不入本 repo、本 commit 不含這兩檔
- Cowork Projects instructions 字面(bundle-docs §J)由 Sean 手動複製貼進 Cowork app、不入 repo

對齊 Sean 2026-05-22 sign-off:Stage 1.7 second-opinion + D 方向 + Q1=Y + Q2=B + self-audit 14 條補案
對齊 rules:鐵則 8 重大改動(Cowork 寫的 master 即 plan)+ 鐵則 12 進度單元結束(本 slice 後跑 /codex-review)

Sean 拍 sign-off A:補案合理、依推薦走
EOF
)"

# Step 8: 更 STATUS.md(本 slice 不算 milestone、屬基礎建設、加進 commit body 不另開)
# Cowork 不在本指令內嵌 STATUS 改動字面(待 Code 看 STATUS 現況自己對齊「最近 3 commit」+「下一步」段、改完 git add STATUS.md + git commit --amend --no-edit)
git add STATUS.md
git commit --amend --no-edit

# Step 9: 跑 /codex-review skill 產 Packet(對齊鐵則 12)
# Skill 自動讀本 commit diff + 本 slice 字面源、寫 docs/reviews/2026-05-22-stage-3-onboarding-packet.md
# 若 ~/.claude/skills/codex-review/ 是本 slice 才裝、可能要 hot-reload 才能 invoke
# 簡化:本 slice 跳過 skill auto-invoke、Code 改成手動產 Packet(讀 bundle-docs §G-2 範本、用 commit hash + diff + 對應規則摘錄手動組)
# Packet 寫到 docs/reviews/2026-05-22-stage-3-onboarding-packet.md、提示 Sean 貼 Codex

# Step 10: 跑 busboy-end pcm
node /Users/sean_1/pcm-tools/scripts/busboy-end.js pcm

# Step 11: 不 push、Sean 手動推當 review checkpoint
echo "本 slice 完成、ahead=1(本 commit、含 busboy-end amend)、等 Sean 貼 Codex Review Packet + 手動 push origin dev"

═══════════════════════════════════════════
驗收條件
═══════════════════════════════════════════
- 13 個 deliverable 落到對應位置(ls 一一驗)+ 5 份 docs/proposals/ 設計紀錄已 git tracked
- pnpm install 後 yaml 套件入 node_modules
- node scripts/design-mirror.mjs --validate 全綠
- node --check scripts/design-mirror.mjs 無錯
- git log --oneline -1 顯示「chore(workflow): Stage 3 終版 v4 工作流升級基礎建設」
- git status clean、ahead=1
- docs/reviews/2026-05-22-stage-3-onboarding-packet.md 存在
- STATUS.md 7 欄位已 amend(對齊本 commit)
- 不 push

═══════════════════════════════════════════
禁止清單
═══════════════════════════════════════════
- 不可修改本次 scope 外檔案(scope = 上面 Step 6 列的 18 路徑:13 deliverable + 5 份 docs/proposals/ 設計紀錄 + package.json + pnpm-lock.yaml + .gitignore + STATUS.md)
- 不可變更 env / deployment 設定(vercel.json / turbo.json / next.config.* / .env*)
- 不可修改 schema / infra(supabase/migrations/* / 任何 SQL)
- 不可使用 git add . 或 git add -A、必須精準 add 上述 18 個路徑(對齊 Step 6 字面)
- 不可自動 push(Sean 手動推當 review checkpoint)
- 不可動 .env*(對齊 PreToolUse hook 規範、雖然本 slice 才建 hook、原則先守)
- 不可繞 docs/proposals/ 字面源憑記憶寫(對齊 lessons §12-25、Cowork 字面有矛盾 raise multi-select)
- 不可自決字面、若 docs/proposals/ 字面源不清或矛盾、停下 raise(對齊 rule 16)
- 不可漏跑 Step 4 design-mirror.mjs --validate(避免 manifest 字面 broken link 沒抓到)

— 禁止清單結束 —
```

---

## §L deliverable 13+14: package.json + .gitignore 改動

### L.1 package.json 改動(精確 diff)

在 `devDependencies` 段加一條:

```diff
   "devDependencies": {
     "@playwright/test": "...",  # 既有(若有)
     "@types/node": "...",
+    "yaml": "^2.6.0",
     "eslint": "catalog:",
     ...
   }
```

理由:`yaml` 套件用於 `scripts/design-mirror.mjs` 解析 `docs/design-storefront-manifest.yaml`。Node 22 內建無 YAML parser。`yaml` 套件輕量(壓縮後 < 30KB)、無 transitive deps、由 Eemeli Aro 維護、stable。

跑 `pnpm install` 後 `pnpm-lock.yaml` 自動更新、本 slice 一起 commit。

### L.2 .gitignore 改動(精確 diff、Stage 3 v4 補修對齊 §F 本意)

`.gitignore` L33 既有 `.claude/` blanket-ignore 整個資料夾、跟 §F「`.claude/settings.json` 入 git」+ §E「`.claude/agents/code-reviewer.md` 入 git」衝突。本 slice 改 white-list pattern、放行兩個共享檔、維持忽略個人設定 / 本地暫存 / worktrees:

```diff
 # 既有規則 ...
 .env
 .env.local
 .env.*.local
 !.env.example

-.claude/
+# .claude/ 採 white-list pattern:預設忽略、explicit 放行兩個共享檔(Stage 3 v4 工作流升級)
+.claude/*
+!.claude/agents/
+!.claude/settings.json
+.claude/scratch/
```

效果:
- `.claude/agents/code-reviewer.md` 入 git(及未來 .claude/agents/ 下新 subagent prompt)
- `.claude/settings.json` 入 git(repo 共享 hook 配置)
- `.claude/settings.local.json` 維持忽略(個人設定、`*` blanket cover)
- `.claude/worktrees/` 維持忽略(本地 worktree、`*` blanket cover)
- `.claude/scratch/` 顯式 ignore(本地 audit trail、design-mirror inspect.json 寫入處)、雖然 `.claude/*` 已 cover、保留可讀性 + 未來若改 pattern 不會誤放行

理由:
- 對齊 §F「`.claude/settings.json` 入 git」+ §E「`.claude/agents/code-reviewer.md` 入 git」本意
- `scripts/design-mirror.mjs` 跑時寫 `.claude/scratch/{slice-id}/inspect.json` timestamp、`commit pre-check hook` 檢這個檔證明 design-mirror 跑過。屬本地 audit trail、不入 git history、避免污染 commit
- 對齊 Code 階段 0 起手抓到的議題(2026-05-22 Sean Q=C1 拍板)、字面 vs 事實對齊

---

## §M 給 Sean 看完本主檔後做什麼

1. **讀 §B 階段 0 Code 落檔指令**、看執行步驟合理
2. **準備好複製 §B 整段 markdown code block(從 `[Stage-3-onboarding]` 開頭到 `— 禁止清單結束 —` 結尾)貼到新 Claude Code session 第一則訊息**
3. **兩份 bundle 檔**(`docs/proposals/stage-3-bundle-code-deliverables.md` + `stage-3-bundle-docs-deliverables.md`)是 Code 跑時的字面源、Sean 不必逐字看、Code 自己 Read
4. **等 Code 跑完、產 Codex Review Packet、Sean 貼 chatgpt.com/codex 唯讀審查、findings 回 Cowork(若無大議題 = push)**
5. **push 後**:第一個用新流程跑的 milestone = M-1-13I(handoff §5 plan 已寫、Q1+Q2 待 Sean 拍)

— END(master + onboarding 主檔)—
