# PCM 重做專案 — 給新 Claude Code 的避雷手冊

> **讀者:** 新 Claude Code(從零進入此 repo、無上下文)
> **作者:** Claude.ai(根據第一輪 PCM 專案 2026-04-01 至 2026-04-29 經驗整理)
> **目的:** 讓你看完這份就知道過去踩過哪些坑、避免重蹈覆轍
> **狀態:** v2 / 2026-04-29 / 給 AI 讀的版本
>
> 配合閱讀:`docs/patterns/`(具體規矩怎麼做)、`CLAUDE.md`(工作流程)、`docs/working-style.md`(Sean 風格)

---

## 0. 一句話最重要的事

> **design 是成品、不是參考稿。前台直接搬 design 來用、不重寫一份。**

如果你發現自己在「翻譯 design」「改寫成自己的風格」「想辦法兼容既有結構」、立刻停下、回頭看這條。第一輪在這裡卡了好幾週。

---

## 1. 視覺與設計紀律

### 1-1. design-reference 是真權威

**真權威字面位置:** `design-reference/` submodule(來自 `pcmmotorsports/pcm-website-design` repo)

**你應該做:**
- 寫任何前台元件前、先 `grep` design-reference 字面、確認 props / className / 字面常數
- 直接搬 design 的 .jsx 檔進 `apps/storefront`、改副檔名 + import path、不重寫
- 衝突仲裁:storefront 對齊 design、不反向遷就

**你不可做:**
- 憑記憶或印象描述 design 長相
- 畫預覽 HTML / 自己想像 design 樣子
- 為了「保留既有 storefront 結構」而修改 design 的內容

### 1-2. 第一輪三次踩坑(都是「憑想像當真權威」)

| # | 事件 | 教訓 |
|---|---|---|
| 1 | Slice C 對齊「虛構 v6」revert | 不存在的版本當基準、卡兩天 |
| 2 | MobileFab cascade badge dead rule 推測錯刪 | 沒 grep 字面、憑印象判斷 |
| 3 | M-γ-A-2-pageheader props 憑記憶含 sort+count | 真權威只有 title+breadcrumb、props 想像出來 |

**規則:** 寫 slice 前必先 grep design-reference 字面、不憑記憶、不憑 inventory md(inventory 也可能含 drift)。

### 1-3. CSS + TSX 雙檔聯動單一 slice

第一輪曾把 CSS 與 TSX 拆兩個 slice、中間出現 dead code、Sean 無法肉眼驗。

**你應該做:** CSS + TSX 屬於同元件、預設單一 slice 完成、不拆。

---

## 2. 工程實作紀律

### 2-1. 直接搬、不翻譯、不重寫

**錯誤模式(第一輪卡這裡):**
```
讀 design jsx → 看結構 → 翻譯成 Next.js + TypeScript → 寫進 storefront
```

**正確模式:**
```
design .jsx → cp 到 storefront → 改副檔名 + import path + TS 型別 → 用
```

差別:
- 翻譯 = 重新實作一個一樣的、過程中 100 個小決策都可能踩坑
- 直接搬 = 改插頭規格、不改家具本身

**你應該做:** slice 指令裡寫「直接搬」、不寫「翻譯 / 對齊 / 重寫」。

### 2-2. 後台對應 design、不是 design 配合後台

**第一輪錯誤:** Medusa schema 已存在、想辦法讓 design 配合既有 schema。

**新 project 對應:** Medusa schema 重新規劃、對應 design 已定義的資料結構(products mock、cart 結構、user 結構等)。design 是合約、後台實作合約。

### 2-3. 檔案大小硬上限

| 規則 | 上限 | 處理 |
|---|---|---|
| 元件檔 | >400 行 必須拆 | 抽子元件 / hook |
| 元件檔 | >300 行 硬警戒 | 計畫拆分 |
| Hook 檔 | >200 行 注意 | 評估拆 hook |

**第一輪事件:** OrdersClient 因 Orchestrator 跑出 2269 行 TDZ 事故。**Orchestrator 永久禁用**。

### 2-4. build pass ≠ runtime pass

`ignoreBuildErrors` 只影響 TypeScript、不影響 ESLint。Vercel build 不跑 ESLint、ESLint 守門必須靠 CI gate(GitHub Actions)。

**你應該做:** 新 project 起手就裝 CI gate、不延後。

### 2-5. React 19 hooks 規則嚴格

- `react-hooks/purity` 拒絕 render body 內 `Date.now()`
- `react-hooks/set-state-in-effect` 對 `try/finally` vs `.catch()` AST 結構敏感
- `try/finally` 必須完整包 `await + setState`

**規則修法超出 slice 範圍時:** 用 `eslint-disable-line` + 註解 + backlog 追蹤、不擴張 slice。

---

## 3. 你的操作紀律(Claude Code session)

### 3-1. 新 session 前置檢查 4 項

每次新 session、貼 slice 指令前必先確認:

```bash
cd /Users/sean_1/pcm-website-v2
git branch --show-current
git status
git log --oneline -5
```

預期:
- pwd 顯示 `pcm-website-v2`
- branch = `dev`(或當期 branch)
- working tree clean + up to date
- HEAD 與 STATUS.md 一致

**任一不綠 → 停下回報、不自排除狀態。**

Desktop Claude Code 額外:Settings → Worktree location 須改非預設、防 auto worktree 偷建 `claude/xxx` 分支。

### 3-2. Slice 指令格式四件套

每份 slice 指令必含:
1. **任務目標**
2. **執行步驟**
3. **驗收條件**
4. **禁止清單**(以「— 禁止清單結束 —」收尾)

外層包 markdown code block 方便 Sean 一鍵複製。

### 3-3. 禁止清單基線(每 slice 必含)

- 不可修改本次 scope 外檔案
- 不可變更 env / deployment 設定
- 不可修改 schema / infra(除非本次任務明確要求)
- 不可使用 `git add .` 或 `git add -A`、必須精準 add 檔
- 不可自動 push(Sean 手動推當 review checkpoint)

### 3-4. Orchestrator 永久禁用

第一輪 OrdersClient TDZ 事故根因。Orchestrator 拆任務粒度不可控、複雜工作禁用、改用單一 session 順序執行。

---

## 4. 終端機 / Bash 操作紀律

### 4-1. zsh 禁忌(給 Sean 的 bash 貼片必避)

| 禁忌 | 為什麼 |
|---|---|
| `#` 註解 | zsh 報 `command not found` |
| 全形標點(「」(): ;) | 報 `unknown file attribute` |

**你應該做:** 註解寫在 prose 裡、不寫進命令本身。

### 4-2. Pipeline 多步驟用 `&&` 串接

任一步失敗自動停。**禁裸換行 batch 多命令。**

### 4-3. 「產生新檔 → 驗證 → 覆蓋」模式

`mv` / `cp` 前必先 `test -s /tmp/newfile || exit 1` 擋空檔覆蓋。

### 4-4. 不假設非 macOS 預設 CLI 已裝

`jq` / `yq` 等用前先 `command -v jq` 確認、或改 Python 內建。

### 4-5. zsh nomatch 處理

zsh 在 glob 無匹配時 exit 1、bash 含 glob 加 `|| true` 或用 `find`。

---

## 5. CJK 處理紀律

### 5-1. str_replace 對大塊中文易失敗

全形「」(): ; 常被無意打成半形、byte 不 match。

**連敗 2 次切換策略:**
1. `bash sed` + anchor pattern(起迄特徵文字、非行號)
2. read → rewrite 整段 → write
3. 拆短 anchor

**str_replace 適用範圍:** 程式碼、英文、短中文 anchor。

---

## 6. GitHub / 認證紀律

### 6-1. SSH only、零 HTTPS token

- 兩 repo remote 皆 `git@github.com:...` 格式
- M1 用 `~/.ssh/id_ed25519`、`ssh -T git@github.com` 驗證
- **絕對不在對話貼任何 ghp_ token**

### 6-2. 涉及 credential / remote URL 命令必加 redaction

```bash
git remote -v | grep -v ghp_
env | grep -v -i 'token\|key\|secret'
```

`cat .env` 不該在對話跑、Sean 在 Terminal 自驗。

第一輪曾因 Sean 貼 `git remote -v` 含 embedded `ghp_` token 進對話、立即 revoke + 全切 SSH。**新 project 嚴守。**

---

## 7. 內容分級 L1/L2/L3 規矩

### 7-1. 三級定義

| 級別 | 變更頻率 | 處置 |
|---|---|---|
| **L1** | 每年 0-1 次 | hardcode 可接受 |
| **L2** | 每季 1-3 次 | hardcode + TODO + backlog |
| **L3** | 每週多次 | **必須**後台 CRUD + 排程、強制停 slice 寫 PRD |

### 7-2. slice 強制前置分級

任何 slice 前、先標記涉及內容是哪一級。發現 L3 內容 → 立即停、不繼續、寫 PRD 後再動。

---

## 8. 設計決策原則

### 8-1. 三視角檢查(每個技術決策必過)

1. **擴充性:** 未來功能怎麼接
2. **可維護性:** 後續改動好不好懂
3. **bug 可追蹤性:** 出錯好不好定位

不修要具體列「未來會痛在哪」、禁寫「待 Sean 決定」空泛句。

### 8-2. backlog 條目寫法

| 寫法 | 範例 |
|---|---|
| ❌ 錯 | `#XX 字型 drift、待 Sean 決定` |
| ✅ 對 | `#XX 字型 drift:Storybook 用 PingFang、storefront 用 system-ui、改 storefront 後新加元件會繼承錯誤字型、影響範圍 packages/ui 全部 typography 元件` |

要素:具體場景、不修的痛點、影響範圍。

---

## 9. Sean 工作模式速查(完整版見 `working-style.md`)

### 9-1. Milestone-driven 不是 calendar-driven

做完就前進、不逼時間、小步前進(15-45 分鐘可中斷 slice)。

### 9-2. 兩層報告

- **上層:** 白話(影響哪些檔、出錯怎樣、估多久)
- **下層:** 技術細節(摺疊、Claude Code 指令塊內)

### 9-3. 決策題用 multi-select

不問開放式問題、給 2-4 選項。

### 9-4. 看不懂觸發語

「看不懂」「白話一點」「用一般人說法」 → 啟用全比喻模式 + visualize 工具圖示。

---

## 10. 你寫 slice 指令前的自檢清單

### 10-1. 通用自檢

- 數字內部一致(預估 vs 門檻 vs 實測空間)
- 用詞精準(preview vs production、stash vs working tree、commit vs push)
- 禁止清單可執行、不自相矛盾
- 讀上一輪 Claude Code 回報、校準 git 狀態
- 確認結尾「— 禁止清單結束 —」未截斷
- 提醒 PK 同步:local commits 未 push 不會在 PK 看到、不叫 Sean refresh

### 10-2. 涉及視覺 slice 的額外自檢

- 已 grep design-reference 字面、不憑記憶
- 不畫預覽 HTML、不憑想像描述
- CSS + TSX 雙檔聯動 → 單一 slice 不拆

---

## 11. Phase 1 重做專屬鐵則(2026-04-29 拍板)

### 11-1. design 是成品、不翻譯

slice 指令禁用「翻譯 / 對齊 / 重寫」字眼、預設「直接搬」。

### 11-2. 後台對應 design

Medusa schema 設計對應 design 資料結構、不反向。

### 11-3. 凍結期間舊 repo 只修 critical

舊 repo `pcmmotorsports/pcm-website` 完全凍結;若有 critical bug、Sean 拍板才修。

### 11-4. 新 repo 從零、不繼承舊 commit

新 repo `pcm-website-v2` 從零開始、舊 repo 4 元件等產出當「參考、不複製」、必要時從 design 重新搬。

---

## 附錄 A:第一輪事件年表(精簡)

| 日期 | 事件 |
|---|---|
| 2026-04-18~21 | M1-A3 OrdersClient 重構 1806→263、TDZ 教訓 |
| 2026-04-22 | design-reference clone、視覺真權威概念引入、vehicle-service-ecosystem PRD 寫入 |
| 2026-04-23 | Supabase RLS 警告事件、密碼緊急重設、SSH 全切 |
| 2026-04-24 | M1-Q 工程事實 + L1/L2/L3 分級立 |
| 2026-04-25 | Chrome DevTools MCP 裝、4 viewport 截圖能力 |
| 2026-04-27/28 | 卡兩天「虛構 v6」事件、視覺真權威紀律強化 |
| 2026-04-29 | 視覺真權威定調 + 北極星重設定 + 拍板整個重做(新 repo `pcm-website-v2`) |

---

## 附錄 B:你應該讀的相關文件(順序)

1. **`STATUS.md`** ← 每次新對話先讀
2. `docs/PHASE-1-NORTHSTAR.md` v2 — Phase 1 真權威定義
3. **本檔** `docs/lessons-learned.md` — 你正在讀
4. `docs/working-style.md` — Sean 風格詳解
5. `CLAUDE.md` — 你的工作規則
6. `docs/PHASE-1-MILESTONES.md` — milestone 排程
7. `docs/PROJECT-OVERVIEW.md` — 網站架構與商業願景
8. `docs/PHASE-2-VISION.md` — 9 點業務藍圖輪廓
9. `docs/features/vehicle-service-ecosystem.md` — Phase 2 完整 PRD
10. `docs/decisions/` — 重大決策記錄
11. `docs/patterns/` — 通用 + PCM 規矩
12. `docs/phase-1-backlog.md` — 未決事項
13. `design-reference/` — 視覺真權威字面(submodule)
14. `PROGRESS.md` — 歷史紀錄

---

## 偵察 slice 方法論(2026-04-30 立)

### 教訓:不能只看檔名 / grep 推測 routes

**事故脈絡:**
- 2026-04-30 design-reference v1 偵察報告判定「結帳 / 訂單詳情 / 我的車輛 CRUD 未覆蓋」
- Sean 親自進 design-reference 驗證、發現大部分頁面實際存在
- 根因:Claude Code v1 偵察用「.jsx 檔名 + grep 推測」、沒打開 hub-style 元件(`AccountPages`)看內部 page state

**教訓:**
- 偵察 slice 必含「page state 實際枚舉」步驟
- 對 hub-style 元件(`AccountPages` / `Pages` / `Layout` 等)、必 grep `useState` / `case` 找 state、列出對應渲染元件
- 不能只說「看到 X.jsx 一個檔」就推「相關功能只有一頁」
- 偵察報告若標「未覆蓋」、必附證據(具體哪個 state / 哪個 case 沒處理)、不可只憑檔名缺失推

**Claude Design 同步機制(順帶教訓):**
- handoff URL 每次點選會生成新 ID、URL ID 不同 ≠ 內容不同
- handoff URL 內容 = Claude Design 環境設計成品(包含 working files 如 `chats/` / `screenshots/` / `uploads/`)
- submodule(d5ea3aa)= handoff 設計成品(working files 不在內)
- d5ea3aa 與 handoff 設計成品 100% 一致、不需 sync 機制

— END —
