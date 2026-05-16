# 工具與流程指南

> **讀者:** 新 Claude Code(從零進入此 repo、無上下文)
> **作者:** Claude.ai(基於第一輪累積的工具知識)
> **目的:** 你會用到的工具、流程、技能、第一天就能上手
> **狀態:** v1 / 2026-04-29
>
> 配合閱讀:`CLAUDE.md`(工作規則)、`docs/lessons-learned.md`(踩過的坑)

---

## 0. 工具總覽

| 工具 | 用途 | 必裝程度 |
|---|---|---|
| Claude Code CLI | 你本身、實作層 | 必 |
| pnpm 9.15 + Turborepo | monorepo 套件管理 | 必 |
| Node v22 | 跑 Next.js / Medusa | 必 |
| Hermes Node | M1 Mac 版本管理(`/Users/sean_1/.hermes/node/bin/`) | Sean 環境必有 |
| Git + SSH | 版控、認證 | 必 |
| Busboy 腳本 | 自動化 STATUS 更新 | 沿用第一輪、必裝 |
| Chrome DevTools MCP | 跨 viewport 截圖、devtools 互動 | 強烈建議 |
| Storybook 10.3.5 | packages/ui 元件預覽 | 寫 packages/ui 必用 |
| Supabase CLI(可選) | 操作 Supabase DB | 偶爾用、Sean 一般用 dashboard |

---

## 1. Busboy 腳本(沿用第一輪)

### 1.1 用途

每個 slice 的「session 起手 + session 收尾」自動化、避免人工漏步驟。

### 1.2 路徑與來源

- `/Users/sean_1/pcm-tools/scripts/busboy-start.js`
- `/Users/sean_1/pcm-tools/scripts/busboy-end.js`
- repo 路徑(沿用第一輪)

新 repo `pcm-website-v2` 的 repo 參數 = `pcm`(沿用)。

### 1.3 流程

**Session 開始(Sean 在 Terminal 跑):**

```bash
cd /Users/sean_1/pcm-website-v2
node /Users/sean_1/pcm-tools/scripts/busboy-start.js pcm
```

輸出一段「session start template」、Sean 把這段貼進新 Claude Code session 第一則訊息。

template 含:
- 當前 git 狀態(branch / status / 最近 commit)
- STATUS.md 當前內容
- 上一個 slice 的尾巴狀態
- session 編號

**Session 結束(你 Claude Code 跑):**

slice 全部 commit 完成後、跑:

```bash
node /Users/sean_1/pcm-tools/scripts/busboy-end.js pcm
```

自動更新 STATUS.md 4 個欄位、commit、**不 push**(Sean 手動推當 review checkpoint)。

### 1.4 注意事項

- busboy-end **不會 push**、Sean 在 GitHub.com / GitHub Desktop / Tower 等 GUI 手動推
- busboy 失敗 → 停下回報、不自行 retry / 修復
- 第一輪累積 3 個 repo 參數:`pcm`(主)/ `api`(舊 medusa-v2 backend)/ `tools`(pcm-tools 自己)
- 新 project 暫時只用 `pcm`、若新 medusa repo 開出來再加 `medusa`

---

## 2. Git + SSH(認證紀律)

### 2.1 SSH only 鐵則

**所有 git remote 必須是 SSH 格式:**

```
git@github.com:pcmmotorsports/pcm-website-v2.git
```

**不允許 HTTPS:**

```
https://github.com/pcmmotorsports/pcm-website-v2.git    ❌
```

第一輪曾因 HTTPS + embedded ghp_ token 出事、永久禁用 HTTPS。

### 2.2 SSH key 設定(Sean 環境已有)

```bash
ls -la ~/.ssh/id_ed25519     # 確認 key 存在
ssh -T git@github.com        # 驗證能連 GitHub
```

預期輸出:`Hi pcmmotorsports! You've successfully authenticated...`

### 2.3 涉及 credential 的命令必加 redaction

| 危險命令 | 加 redaction |
|---|---|
| `git remote -v` | `git remote -v \| grep -v ghp_` |
| `env` | `env \| grep -v -i 'token\|key\|secret'` |
| `cat .env` | **不在對話跑、Sean 在 Terminal 自驗** |

### 2.4 Commit 訊息格式

```
type(scope): subject [optional milestone-id]
```

- `type`: feat / fix / refactor / docs / chore / test / perf
- `scope`: storefront / medusa / ui / schemas / docs
- `subject`: 繁體中文、祈使句、≤72 字元
- `[optional]`: milestone-id(若有)

範例:
```
feat(storefront): 新增 ProductsPage 對齊 design 真權威
fix(medusa): 修正 cart line item 計算邏輯
docs(architecture): 補充 Phase 1 schema 設計筆記
chore(scripts): 更新 busboy-end 至 v2 [M-1]
```

---

## 3. pnpm + Turborepo

### 3.1 monorepo 結構

```
pcm-website-v2/
├── apps/
│   ├── storefront/      ← Next.js 16
│   └── medusa/          ← Medusa v2
├── packages/
│   ├── ui/              ← @pcm/ui
│   └── schemas/         ← @pcm/schemas
└── pnpm-workspace.yaml
```

### 3.2 常用命令

```bash
# 從 root 跑全部
pnpm install              # 安裝全部 workspace 套件
pnpm dev                  # 跑全部 app dev server(Turborepo 並行)
pnpm build                # build 全部
pnpm lint                 # lint 全部
pnpm typecheck            # typecheck 全部

# 從 root 跑特定 workspace
pnpm --filter storefront dev
pnpm --filter medusa dev
pnpm --filter @pcm/ui storybook

# 加套件
pnpm --filter storefront add lucide-react
pnpm --filter @pcm/ui add -D @storybook/react-vite
```

### 3.3 Turborepo 設定

`turbo.json` 定義 task 依賴:
- `build` 依賴上游 workspace 的 `build`(packages/ui build 完才能 storefront build)
- `dev` 不快取、不依賴
- `lint` / `typecheck` 並行

---

## 4. Chrome DevTools MCP(強烈建議)

### 4.1 用途

讓你(Claude Code)能直接控制 Chrome、跨 viewport 截圖、查 devtools console / network、操作頁面元素。

第一輪 2026-04-25 裝、四 viewport 截圖能力(desktop 1280 / tablet 1100 / mobile 560 / iPhone 430)。

### 4.2 安裝(若新 project 沒裝)

裝在 `~/.claude.json`(user scope)、所有 Claude Code session 共用。Sean 環境第一輪已裝、新 project 沿用、不需重裝。

### 4.3 使用注意

- `new_page` / `emulate` 預設 timeout 10 秒、cold start 可能不夠 → 設 `timeout: 30000`
- **不用 MCP-controlled Chrome 跑 SSO 登入**(Gmail / 銀行 / Vercel admin 等)、credential 風險
- 截圖完關 page、不留 zombie

### 4.4 第一輪驗證的工作流

```
寫 storefront 元件
   ↓
你跑 dev server (pnpm --filter storefront dev)
   ↓
你用 Chrome DevTools MCP 開 localhost:3000
   ↓
四 viewport 截圖
   ↓
比對 design-reference 真權威
   ↓
有 drift 修、無 drift 進下一步
```

---

## 5. Storybook 10.3.5

### 5.1 用途

`packages/ui` 元件獨立預覽 + 視覺驗證。

### 5.2 啟動

```bash
pnpm --filter @pcm/ui storybook
```

預設 `http://localhost:6006`。

### 5.3 第一輪驗證的紀律

寫完元件 + story:
1. 跑 storybook
2. 用 Chrome DevTools MCP **點開每個 story**(不只看 server startup logs)、確認 runtime 沒 bug
3. 第一輪曾因「server 起來了但點開 story 是紅屏」漏抓 bug、後加此規則

---

## 6. Supabase(資料庫)

### 6.1 角色

- Phase 1 主 DB
- Singapore region(接近台灣低延遲)
- Medusa 用 service role key 連、bypass RLS

### 6.2 RLS(Row Level Security)

第一輪 04-23 曾因 RLS 未開、Supabase 寄 150 筆 advisor 警告、緊急開啟。

新 project 起手就開 RLS、走「開 RLS 不寫 policy」策略(Medusa service role key bypass、所有讀寫透過 Medusa API)。

### 6.3 連線字串

兩種:
- `DATABASE_URL` — 走 PgBouncer pooler、應用層用
- `DIRECT_URL` — 直連 Postgres、Prisma migrate 用

注意:**Prisma migrate 不能用 PgBouncer**、必須 `DATABASE_URL="$DIRECT_URL" npx prisma migrate dev`(沿用第一輪 CLAUDE.md 規則)。

### 6.4 Sean 操作

Sean 用 Supabase Dashboard GUI 操作、不用 CLI。涉及 Supabase 的指示、給 Sean step-by-step。

---

## 7. Vercel(前台部署)

### 7.1 帳號

第一輪用 Vercel Pro 方案($20/mo)、Spend Cap 設好。新 project 沿用同帳號、新增 project。

### 7.2 部署模式

```
git push origin dev      → Vercel 自動建 preview deployment
git push origin main     → Vercel 自動建 production deployment
```

Sean 主要看 dev branch 的 preview URL 驗收、不直接 push main。

### 7.3 環境變數

Vercel Dashboard → Settings → Environment Variables 設定:
- DATABASE_URL / DIRECT_URL
- MEDUSA_BACKEND_URL
- TAPPAY_APP_KEY / TAPPAY_APP_ID(public)
- NEXT_PUBLIC_* 開頭的 public env

不在 Claude.ai 對話貼 env 值、Sean 在 Vercel Dashboard 設定。

---

## 8. Railway(後台部署)

### 8.1 帳號

第一輪用 Railway 部署 Medusa backend、新 project 沿用同模式、新建 service。

### 8.2 部署模式

Push 到指定 branch 自動 deploy。Railway URL 形如:
```
https://pcm-website-v2-medusa.up.railway.app
```

### 8.3 Medusa Admin UI

```
https://pcm-website-v2-medusa.up.railway.app/app
```

Sean 用這個 URL 進 Medusa 內建 Admin。

---

## 9. TapPay(金流)

### 9.1 sandbox vs production

- **Phase 1:** 用 sandbox(測試卡、不實際扣款)
- **正式上線:** 切 production(需 Partner Key、Sean 手動申請)

### 9.2 串接

第一輪已串接、新 project 重做。Phase 1 範圍只跑 sandbox happy path。

---

## 10. design-reference submodule

### 10.1 操作

```bash
# 第一次 clone repo 時
git clone --recurse-submodules git@github.com:pcmmotorsports/pcm-website-v2.git

# 已 clone 但沒 init submodule
git submodule update --init --recursive

# Sean 從 Claude Design 取出設計檔、本地 commit + push pcm-website-design 後(Claude Design 對 GitHub 唯讀、不 push;對齊 lessons §12-21)
git submodule update --remote design-reference/
git diff design-reference                          # 看改動
git add design-reference
git commit -m "chore: 同步 design-reference 至 {hash}"
```

### 10.2 注意

- design-reference 是 submodule、提交時 git 只記 commit hash、不複製內容
- design-reference 自己有 git history、別動(只在 pcm-website-design repo 動)
- `.gitignore` 排除 design-reference/uploads/(大量 screenshot、不進新 repo)

---

## 11. 文件閱讀順序(進入 repo 第一天)

```
STATUS.md
   ↓
docs/PHASE-1-NORTHSTAR.md
   ↓
docs/lessons-learned.md
   ↓
docs/working-style.md
   ↓
CLAUDE.md
   ↓
docs/PROJECT-OVERVIEW.md
   ↓
docs/PHASE-2-VISION.md
   ↓
docs/features/vehicle-service-ecosystem.md
   ↓
本檔(docs/tools-and-skills.md)
   ↓
docs/decisions/(若有)
   ↓
docs/patterns/(若有)
```

讀完跟 Sean 報「我已讀完套件、可以開工」。

---

## 12. 第一輪有但新 project 暫不用的工具

記錄在這、避免你誤以為要裝:

- ❌ **Codex CLI 整合** — 第一輪評估後棄用(時序衝突 busboy / privacy 風險)
- ❌ **Orchestrator** — 永久禁用(2269 行 TDZ 事故)
- ❌ **Cloudflare** — Phase 2 或之後加(DDoS shield)
- ❌ **PostHog / Sentry / 監控** — Phase 2 或之後加
- ❌ **Playwright E2E** — Phase 2 加(Phase 1 靠肉眼)
- ❌ **GitHub Actions CI gate** — Phase 1 中後期加(初期靠 typecheck + lint 手動跑)

---

## 13. 你需要遵守的硬規則(快速複習)

| 規則 | 為什麼 |
|---|---|
| 元件檔 >400 行必拆、>300 行警戒 | 第一輪 OrdersClient 2269 行 TDZ 事故 |
| 不用 git add . / -A、必須精準 add | 避免誤包雜檔 |
| 不自動 push、Sean 手動推 review | review checkpoint |
| 重大改動前先提 plan 等批准 | 跨 3+ 檔 / 動 schema / 動 config |
| 同 slice 一起更新 STATUS.md | 不另開 commit |
| Commit 訊息繁體中文 | 沿用第一輪約定 |

---

## 14. pcm-roadmap skill(進度施工地圖)

> **2026-05-16 新增。** Sean 要求「進度地圖能跟著進度自動更新」而建的第一個
> pcm-website-v2 專屬自訂 skill。本節為交接說明。

### 14.1 用途

把專案進度產成一份**給非技術讀者(Sean)看的視覺化「施工地圖」HTML** ——
`docs/progress-roadmap.html`。用「開一間店」比喻講解 Phase 1 的 8 個施工段、
79 個小步驟做到哪、Phase 2 / 3 願景、需要 Sean 拍板的事。

### 14.2 怎麼觸發

任何 Claude Code session 裡跟 Claude 說「**更新地圖 / 進度地圖 / 看進度到哪**」、
或直接打 `/pcm-roadmap`。skill 是全域自動掃描、新 session 不需任何設定。

### 14.3 skill 的三個檔案

放在 `~/.claude/skills/pcm-roadmap/`(**全域、不在本 repo 內** —— 與 PCM 既有
自訂 skill 同慣例):

| 檔案 | 作用 |
|---|---|
| `SKILL.md` | 指令檔:觸發條件、執行流程、狀態判定規則、誠實守則 |
| `roadmap-data.json` | 地圖**唯一內容來源**:8 milestone × 79 slice 白話文字 + 狀態 |
| `generate.js` | 零相依 Node 產生器:讀 json → 寫 HTML |

輸出 `docs/progress-roadmap.html` 落在本 repo(目前**未納入 git tracking**、屬本機產生物)。

### 14.4 invoke 時做什麼

1. 讀 `STATUS.md`(+ `git log` 對照)判斷各 slice 現況。
2. 更新 `roadmap-data.json` 每個 slice 的 `status`(done / active / todo)、保守判定不灌水。
3. **漂移檢查:** `STATUS.md` / `PHASE-1-MILESTONES.md` 若出現 json 沒有的新 slice
   或 milestone 改組 → 回報 Sean、不靜默(不自行臆造白話翻譯)。
4. 跑 `generate.js` 重產 HTML —— 完成數 / 百分比 / 「你在這裡」/ 狀態燈**全自動算**。
5. 回報變更(哪些 slice 翻狀態、新百分比)。

### 14.5 何時跑

已納入 `CLAUDE.md`「快速自檢清單(slice 結束前)」—— 每個 slice 收工、busboy-end 之後
順手 invoke 一次 `/pcm-roadmap`、地圖即跟最新進度同步。

### 14.6 維護注意

- **不手改 `docs/progress-roadmap.html`** —— 它是產生物。改內容改 `roadmap-data.json` 後重跑。
- 藍圖結構真的變動(新增 / 改組 slice)→ skill 會回報、需人工更新 json 結構。
- 詳細規則見 skill 自己的 `SKILL.md`。

— END —
