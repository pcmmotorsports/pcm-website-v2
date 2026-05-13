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

## 12. Test framework + contract 紀律(M-1-03-prep audit 教訓、2026-05-05 拍板)

### 12-1. test framework re-export 必走 subpath

**事故脈絡:**
M-1-03-prep 件 #3 把 `runProductRepositoryContract`(內含 `import { describe, it } from 'vitest'`)從 `packages/ports/src/IProductRepository.contract.ts` re-export 進 `packages/ports/src/index.ts` main entry。`@pcm/ports` 被 storefront / sync-engine 等 production app import 時、vitest 透過 main entry 拉進 production bundle。

tree-shaking 樂觀假設不可信(pnpm workspace + esbuild + 沒標 `sideEffects: false`、或 vitest 模組自身有 side effects)。

audit Round 1 F1 + Round 2 F19(雙視角 Critical 同向命中)抓出。

**規則:**
- 純 test framework(含 vitest 等 devDependency)不可從 main entry index.ts re-export
- 必走 subpath export:`package.json` `exports` field 加 `./contract` 子路徑
- 保留 `main` + `types`(對齊 monorepo 既有 main+types 寫法、雙保險)
- adapter test 端 import 走 `@pcm/{pkg}/contract`、不走 `@pcm/{pkg}`
- tsconfig `moduleResolution: "Bundler"`(或 `node16` / `nodenext`)才 honor exports field、加 exports 前先確認

**範例(正確 vs 錯誤):**

❌ 錯誤(main entry re-export):
```ts
// packages/ports/src/index.ts
export type * from './IProductRepository';
export { runProductRepositoryContract } from './IProductRepository.contract';
// ↑ vitest 跟著進 production bundle
```

✅ 正確(subpath export):
```ts
// packages/ports/src/index.ts
export type * from './IProductRepository';
// 不 re-export contract.ts
```

```jsonc
// packages/ports/package.json
{
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": { "types": "./src/index.ts", "default": "./src/index.ts" },
    "./contract": {
      "types": "./src/IProductRepository.contract.ts",
      "default": "./src/IProductRepository.contract.ts"
    }
  }
}
```

```ts
// adapter test 端
import { runProductRepositoryContract } from '@pcm/ports/contract';
// ↑ subpath、production bundle 不會拉到
```

### 12-2. contract 命名以 port public method 為錨

**事故脈絡:**
M-1-03-prep 件 #3 contract.ts `describe('matchFitment year-range', ...)` 暴露 InMemoryProductRepository 的 private method 名(matchFitment)。matchFitment 不在 IProductRepository 介面字面、是 InMemory 內部 helper。

main-b SupabaseProductAdapter 用 PG range query 實作、無 matchFitment、describe 名變誤導。

audit Round 1 F2 / F3 + Round 2 F16(雙視角 Major 同向命中)抓出。

**規則:**
- contract 級 describe 名必以 IProductRepository 公開 method 為錨
- 不暴露 adapter 內部 helper / private method 名
- 同 method 多維度測試用嵌套 describe 表達層次
- 延伸 `docs/architecture/testing-strategy.md` §3.4「樣板不外洩」精神

**範例(正確 vs 錯誤):**

❌ 錯誤(暴露 InMemory private method):
```ts
describe('matchFitment year-range', () => {
  // ↑ matchFitment 是 InMemory private、Supabase adapter 無此 helper
  it.todo('範圍重疊 match');
});
```

✅ 正確(嵌套子 describe 表達多維度):
```ts
describe('listByFitment', () => {
  it.todo('依 FitmentSpec 配對 fitments[] 任一筆');
  describe('year-range matching', () => {
    it.todo('範圍重疊 match');
    it.todo('開放式範圍 match');
    // ...
  });
});
```

### 12-3. 字面 vs 事實守則延伸 — 不憑記憶 / 歷史字面寫死

**核心規則:** Claude.ai 寫指令字面前、必先以「最新真權威 / 最新事實」對齊、不憑記憶 / 歷史字面推測。

**兩個適用維度:**

**維度 A:具體技術細節(SQL / API / config / 工具能力 / 路徑 / 函式簽名)**

- 必先請 Code grep 真權威 + 查官方文件 / 跑 `--help`、摘要回報後組指令
- 不確定的、標 `<待 Code 字面確認>`、不寫死
- 真權威類型:
  - 視覺 slice → design-reference 字面(.jsx + .css)
  - schema slice → docs/architecture/*.md(supabase-schema-design / ADR-*)
  - 工具能力 slice → 官方文件 + `--help`
  - API slice → 既有 code
- inventory md 是 Code 寫的、可能含 drift、不算字面真權威
- 教訓來源:M-1-03-main-a2-1 連續兩輪憑記憶錯 6 處(§ 編號 §3/§4 錯置 / ON DELETE SET NULL→RESTRICT / categories column 數 8→3 / RLS policy 預設 4 policy 真權威留白 / 索引憑記憶寫真權威沒列 / supabase config.toml [db.migrations] 同等選項憑記憶寫實際 CLI 寫死路徑技術不可行)、Code §B grep 真權威 + §C 工具能力查驗抗住兩輪 raise multi-select、Sean 拍板修正

**維度 B:當前 git 狀態(push / ahead / 同步)**

- 必以最近一次 `git rev-list` / `git log` / `git status` 輸出為準
- 不算當前事實的字面來源:
  - STATUS.md 內 commit body 字面(「待 Sean 手動推」「ahead = N」「未 commit」等)
  - 過去 N 輪對話的 git 數字
  - busboy-end 自動更新的 STATUS 內字面(寫入時刻 vs 當前可能差很多)
  - 上輪 slice 結束時的 working tree 狀態描述
- 涉及 push / ahead / 同步狀態的指令、必先請 Sean 跑 `git rev-list --count origin/<branch>..HEAD` 拿事實數、貼回後 Claude.ai 才寫指令字面
- 教訓來源:M-1-03-main-a2-1-followup 段 1A Claude.ai 字面「預期 3 commits = a35f797 + cb55373 + d93a20c」實際 ahead=0 + HEAD = 3684036(amend 後 hash 重算、a35f797 dangling)、字面 vs 事實第 4 次踩同類坑;進一步揭示 amend 後 working tree 改變使 hash 重算但 message 沒動、兩 commit body 逐字一致 git object 並存、其中一 dangling、git gc 後字面不再可解、STATUS hash drift 修正不只「美觀」是事實追溯能力的維護

**雙維度共通:** 字面寫死前必先校準事實、不憑記憶 / 歷史字面推測。

**規範定位:** 對齊 working-style.md 原則 10(維度 A 字面不憑記憶)+ 原則 9(維度 B 含數字提醒 Sean 跑 git 命令拿事實)+ 自檢條 9 + 11。lessons §12-3 提供「為什麼這樣設計」的歷史教訓、working-style 提供「規則本身」、互補。

### 12-4. 跨 workspace 議題前 grep pnpm-workspace include 範圍

**事故脈絡:**
M-1-03-audit-disposition Slice B-2 過程、Claude.ai 推「spike script API surface 規範」字面、未先讀 pnpm-workspace.yaml include 範圍。實況 spike 不在 workspace + .npmrc `shamefully-hoist=false` 嚴格模式 = package name 無法 resolve、字面方向錯。Sean Q-G4-spike=A1 拍板還原 spike + 新開 backlog #121 anchor 處置、修正鏈完整記錄 commit `8e31b0a` body §G.4。

**規則:**
- 寫跨 workspace 議題(import / dep 引用 / 共享 type / 規範擴張)字面前、必先 grep `pnpm-workspace.yaml` `packages:` include 範圍 + `.npmrc` `shamefully-hoist` 設定
- 確認 importer / importee package 是否同 workspace、避免「workspace 內 vs 外」字面誤推
- 嚴格模式(`shamefully-hoist=false`)下、cross-package 必須走顯式 `workspace:*` deps、否則 phantom dep / resolve fail
- 同類風險:spike script / one-off tool / 不在 workspace 的 dev script、不可預設 workspace import 慣例

**教訓來源:** M-1-03-audit-disposition Slice B-2(commit `8e31b0a`)Sean Q-G4-spike=A1 拍板鏈、字面 enforce 第 7 次踩

### 12-5. 業務字面 vs schema 字面不一致時、必 multi-select 問 Sean

**事故脈絡:**
M-1-03-post-supplement sub-slice 0b 過程、發現三層字面拼法不同:
- schema / wire / TS type:`'premiumStore'`(camelCase、`MemberTier` 列舉真權威)
- 後台 UI / 業務語意:「高級店家」(中文)
- design-handoff 慣例:`premium_store`(snake_case、業務溝通用)
- STATUS L35 字面:「業務字面權威 general/store/premium_store」

Claude.ai 寫指令字面易混用三層、Code 執行端難判「對齊哪層」。

**規則:**
- 遇 design / 業務 / schema 字面拼法不同、必 multi-select 問 Sean「字面權威是哪層 / 是否要統一」、不擅自選邊
- 文件層必明示三層對應(schema vs 業務 vs design-handoff)、提供 mapping 表、避免後續實作端混淆
- 若必須先動字面(避免阻塞 slice)、優先對齊 schema 真權威(技術字面、grep 可驗證)、業務字面用註腳對應
- 同類風險:任何「業務溝通字面」與「technical key 字面」分歧、必三層對應

**教訓來源:** M-1-03-post-supplement sub-slice 0b §2.4 Pricing 公式字面對照(指令字面 `premium_store` snake_case vs schema 真權威 `premiumStore` camelCase)、Code raise 三層對應補進 §2.4 註腳

### 12-6. 寫 rsync / 跨 system 同步前必 grep target .gitignore + 既有目錄結構

**事故脈絡:**
M-1-03-post-audit-design-bump-v2.0-v2.1 過程、Claude.ai 寫 rsync 字面 3 次未先 grep design repo `.gitignore` + 既有目錄結構、雜質進 working tree:
- PCM Motorsports v2.html 16MB bundle(本不該進 design repo)
- scraps/ Claude Design sketch(被 design repo 排除的本地草稿)
- uploads/ Sean 中文檔名截圖(本地 working file、非設計成品)

3 次需 Code raise multi-select 救、Sean Q-zip-extract=C1 / Q-scraps=S4 / Q-uploads=U1 三題拍板 exclude 模式。

**規則:**
- 寫 rsync(或 cp -r / git clone bare 模式 / 任何跨 system 同步)字面前、必先讀 target repo `.gitignore` + 既有目錄結構
- 用 `--exclude` / `--filter` 排除 .gitignore 命中的檔、避免雜質
- 若 source 無 `.gitignore` / target 有 / 兩邊有但內容不同、必先列差、multi-select 問 Sean 拍板 exclude 模式
- 同類風險:zip 解壓進 working tree / submodule update --remote / 跨 fork merge — 都需先讀 target .gitignore

**教訓來源:** M-1-03-post-audit-design-bump-v2.0-v2.1 §F.2 rsync 3 雜質 exclude(commit `c2240e4` body)

### 12-7. 不憑印象推測檔名慣例、必 grep 既有引用層雙看

**事故脈絡:**
M-1-03-post-audit-design-bump-v2.0-v2.1 過程、Claude.ai 寫指令字面推測「`?v=1` query string 不該入檔名」、認為應 strip。Sean Q-walletcache=W1a 拍板「rename 純檔名取 v2.1 中文化『進階會員』字面」— 揭示實況:`?v=1` 是 HTML 引用層快取破壞字面、filesystem 檔名層另一回事、兩層各自獨立、不能憑印象推「一定不該入檔名」。

**規則:**
- 寫指令推測「字面慣例」前、必先 grep 既有引用層(HTML import / Markdown link / 配置 path)+ filesystem 實況雙看
- 同 token 在不同層字面有不同意義(`?v=`HTML 快取 vs filesystem 檔名)、不可預設「一致跨層」
- 涉及 rename / 規範化指令、必先列出當前實況 + 推論依據、multi-select 問 Sean 拍板、不憑印象寫死字面
- 同類風險:檔名空格 / hash / 中文字符 / 副檔名大小寫 — 任何「我以為這樣才對」的字面假設

**教訓來源:** M-1-03-post-audit-design-bump-v2.0-v2.1 Q-walletcache=W1a `WalletTab.jsx?v=1` rename 事件

### 12-8. 寫跨 repo 同步前必 grep target README + .gitignore(退役 / 不入版控慣例)

**事故脈絡:**
M-1-03-post-audit-design-bump-v2.0-v2.1 過程、design submodule bump 含 `PCM Motorsports v2.html` 16MB bundle exclude 等議題、Claude.ai 寫 rsync 字面未先讀 design repo README + .gitignore 慣例、字面方向需 Code raise 救。target repo 既有「退役檔不入版控」「scraps/ 本地草稿」等慣例、Claude.ai 未事先掌握。

**規則:**
- 跨 repo 同步前(rsync / submodule update / merge / clone)必 grep target repo `README` + `.gitignore` 找慣例:
  - 退役檔(舊版本 / legacy bundle)
  - 本地草稿(scraps/ / drafts/ / tmp/)
  - 環境特定檔(.env.local / .DS_Store)
  - 大檔 / binary(LFS 規則)
- 若 target README 無明文、必 multi-select 問 Sean 拍板「哪些檔該進 / 該排除」
- 同類風險:第一次接觸的 repo / fork / 第三方專案 — 不可預設「跟主 repo 慣例一樣」

**教訓來源:** M-1-03-post-audit-design-bump-v2.0-v2.1 design submodule bump §F.2 雜質 exclude 拍板鏈

### 12-9. 寫 rsync --delete 前必 grep target dotfile / infra 預先 restore

**事故脈絡:**
M-1-03-post-audit-design-bump-v2.0-v2.1 過程、rsync --delete 誤殺 design repo `.gitignore`、Sean Q-gitignore=N1 拍板「git restore .gitignore」救回。Claude.ai 寫 rsync --delete 字面未提醒「dotfile / infra 檔可能在 --delete 範圍內、需預先 restore 或 exclude」。

**規則:**
- 寫 rsync --delete(或 `git clean -fd` / 任何「同步刪除非預期檔」指令)前、必 grep target dotfile / infra 檔列表:
  - `.gitignore` / `.gitattributes` / `.editorconfig` / `.npmrc`
  - `.github/` / `.vscode/` / `.husky/`
  - 任何 `.<name>` 開頭的隱藏設定
- 提醒 Code 預先 `git restore` 或 `--exclude` 這些檔、避免誤殺
- --delete 類指令本質「source 沒的 target 全砍」、必須事先列 target 獨有檔
- 同類風險:`git checkout .` / `git clean -fdx` / `rm -rf` — 任何「批次刪除非預期檔」操作

**教訓來源:** M-1-03-post-audit-design-bump-v2.0-v2.1 Q-gitignore=N1 `.gitignore` 誤殺事件

### 12-10. 寫指令字面前自檢「是否能讀真權威」、不能讀必標待確認

**事故脈絡:**
M-1-03-post-audit-design-bump-v2.0-v2.1 過程、Sean Q-wrs=R1 拍板「wrs.png 接受 deletion 對齊 brand-logos 重組」— 實況唯一 1 檔、但 Claude.ai 指令字面預期「多筆」、未先 grep 實況。類似事件累積第 11+ 次踩字面、揭示「不憑印象 / 歷史記憶推測檔列表 / 編號數量」鐵則需強化。

**規則:**
- 寫指令字面前自檢:
  - 是否已 grep 真權威字面、不憑印象?
  - 是否能精準寫死字面(file name / count / list)、不能精準時必標 `<待 Code 字面確認>`?
  - 字面數量(N 筆 / N 個)是否能 grep 驗、不憑歷史推測?
- 不能讀 / 不能精準時、指令字面留待確認占位、Code 偵察補實況再寫死
- 同類風險:任何「我以為這檔列表是這樣」「我記得有 N 個」的字面假設

**教訓來源:** M-1-03-post-audit-design-bump-v2.0-v2.1 Q-wrs=R1 wrs.png 1 筆 vs 多筆預期偏離事件(累積第 11+ 次字面踩)

### 12-11. STATUS 文件內候選編號 vs backlog 既有條目編號必區分

**事故脈絡:**
M-1-03-post-supplement sub-slice 0a 偵察、指令字面 Step 6 寫「確認 STATUS.md 提到的 #117/#120/#121/#122 在 backlog 既有狀態」。Code 0a grep 揭示:
- #117 / #120 / #121:在 backlog 字面存在(#117 是 reserved anchor、#120 / #121 已開條目)
- #122:在 backlog 無字面、且 STATUS.md 全文無 `#122` 字面
- STATUS L35 字面有「累積教訓 #7 + #8 + 候選 #9-#13」— 這串是 working-style §6.3「第 N 條教訓」候選編號、非 backlog 條目編號
- 指令字面似把 STATUS 內候選教訓編號誤讀為 backlog 條目編號

**規則:**
- 寫指令字面引用編號前、必明示來源:
  - `backlog #N` = `docs/phase-1-backlog.md` 條目編號
  - `lessons §12-N` = `docs/lessons-learned.md` §12 子節編號
  - `working-style 第 N 條` = `docs/working-style.md` §6.3 教訓條目編號
  - `STATUS 候選 #N` = STATUS.md 內 commit body 候選編號(尚未落地、非正式條目)
- 不可混用 `#N` 短語、避免誤讀(STATUS 文件內候選 vs backlog 既有條目)
- 寫字面前必 grep 確認編號真存在於指定文件、不憑記憶
- 同類風險:跨文件編號引用(ADR-N / audit-F\<N\> / tech-debt T\<N\> / risk R\<N\>)— 必標 source 文件

**教訓來源:** M-1-03-post-supplement sub-slice 0a 偵察糾正(指令字面 #122 為 STATUS 內候選教訓編號、非 backlog 條目、Code 偵察揭示後 sub-slice 0b 補進 §12-11 防同類)

---

### 12-12. slice 指令字面對 script 啟動方式 + 工具 hook 行為必先 grep 真權威

**事故脈絡:**
M-1-03-main-a 刀 4 sub 6 過程、Claude.ai 寫 busboy-end 指令字面預設 `bash` 啟動、實況 busboy-end.js 是 node script 必須 `node /Users/sean_1/pcm-tools/scripts/busboy-end.js pcm` 啟動。Code raise multi-select 救、Sean Q-busboy-launch=A 拍板用 node。同類擴張:本對話 sub 8e-1 撞 husky pre-commit hook bootstrap commit 雞生蛋(hook 對自身裝設 commit 撞 .test.ts ESLint ignore false-warning)、後續 sub 8e-1 撞同類 hook fail、揭示「script 啟動方式 + hook 行為」需作為 slice 指令前置自檢項。

**規則:**
- 寫涉及 script 啟動 / hook 觸發 / CI gate 字面前、必先 grep 真權威:
  - script 啟動:`cat script_path | head -1` 看 shebang / `package.json scripts` 看慣例
  - git hook 行為:`.husky/` 目錄 + `lint-staged` 配置 + `package.json prepare`
  - CI gate:`.github/workflows/` 內 yaml
- hook 對自身裝設 commit 撞 bootstrap 問題、`--no-verify` 一次性例外、之後恢復 hook 正常運作
- 同類風險:tools install commit / config 自身改 / 依賴 hook 行為的指令

**規範定位:** 對齊 working-style.md §6.3 第 22 條(lessons §12-12 對應簡潔版)+ 維度 A「具體技術細節」延伸

**教訓來源:** M-1-03-main-a 刀 4 sub 6 busboy-end bash vs node 事故 + sub 8e-1 husky hook bootstrap 撞 .test.ts ignore false-warning 事故、本對話累積教訓 #124 + 撞坑連鎖(chore tooling + tooling-fix + sub 8e-1 重新 commit)、A5 路徑根因處置

**跨專案適用:** 適用所有 Sean 用 Claude Code 開發的專案(PCM + 蝦皮 + 報價 + 訂單)。Sean 多 session 多 repo 平行運作、script 啟動 + hook 行為跨專案差異需 grep 真權威確認、不憑印象

---

### 12-13. git push 字面前必 grep ahead 範圍 + 評估 push 處置選項

**事故脈絡:**
M-1-03-main-a 刀 4 sub 6 過程、Sean push 帶上 sub 4b + sub 6 兩個 commit(Code 處置選項 C「Sean 先 push sub 4b 再 amend」漏想 sub 6 主 commit 已 commit 會被 push 帶上去、ahead=0 不可再 amend)。改走 docs(status) 補救獨立 commit。

**規則:**
- 寫 push 字面前、必先 grep ahead 範圍:
  - `git rev-list --count origin/<branch>..HEAD` 拿事實數
  - `git log origin/<branch>..HEAD --oneline` 列出未推 commit
  - 確認 push 範圍 = HEAD 與否、避免「Sean 推 X 結果連 Y 也推」
- 涉 amend / 多 commit 並存時、評估處置選項:
  - ahead=1 + amend → 安全(未推、amend hash drift 可接受)
  - ahead≥2 + amend → 拒絕(不能 amend 已被新 commit 蓋過的舊 commit、應走新 commit / docs(status) 補救)
  - 已 push → 不可 amend、走新 commit
- 提醒 Sean push 範圍 = HEAD 內容、再執行 push、避免「漏想 commit」

**規範定位:** 對齊 working-style.md §6.3 第 23 條(lessons §12-13 對應簡潔版)+ 維度 B「git push / ahead」延伸

**教訓來源:** M-1-03-main-a 刀 4 sub 6 Q-busboy-multi-commit 事故、本對話累積教訓 #125、sub 8c push + sub 8d push + sub 8e-1 路徑全程實證 trigger 生效

**跨專案適用:** 適用所有 Sean 用 Claude Code 開發的專案。Sean 多 repo 操作、push 紀律跨專案統一、避免不同 repo push 規矩混淆

---

### 12-14. monorepo 工具配置真權威確認 + 文件官方雙 source 驗證

**事故脈絡:**
M-1-03-main-a 刀 4 sub 7 dev server 啟動 fail(apps/storefront/.env.local 不存在、NEXT_PUBLIC_SUPABASE_URL not set HTTP 500)+ sub 8b 評估 monorepo env load 位置(root vs apps/storefront)需 web_fetch Next.js 官方 + Turborepo 官方雙文件確認。Claude.ai 寫指令字面前未先確認真權威、Code raise multi-select 救。

**規則:**
- 寫 monorepo 工具配置字面前、必先確認真權威:
  - Next.js env load → web_fetch Next.js 官方 docs
  - Turborepo task pipeline → web_fetch Turborepo 官方 docs
  - pnpm workspace 行為 → `pnpm-workspace.yaml` + `.npmrc` + pnpm docs
  - ESLint flat config → eslint.config.js + ESLint 9+ docs
- 跨工具交互(如 Turborepo + Next.js + pnpm + ESLint)必雙 source 驗證、避免單一文件 outdated
- 不憑記憶寫「我以為這樣配」、必 grep 真權威

**規範定位:** 對齊 working-style.md §6.3 第 24 條(lessons §12-14 對應簡潔版)+ 維度 A「工具能力」延伸

**教訓來源:** M-1-03-main-a 刀 4 sub 7 dev server fail + sub 8b apps/storefront .env per-package 落地路徑評估、本對話累積教訓 #126

**跨專案適用:** 適用所有 Sean 用 Claude Code 開發的專案。Sean 多框架(PCM Next.js + 蝦皮 Apps Script + 報價 Python)、monorepo 工具配置真權威確認跨專案必要

---

### 12-15. env / secret 檔案操作必 redaction、絕不讀整檔內容(🔴 高)

**事故脈絡:**
M-1-03-main-a 刀 4 sub 8 前置偵察期間 Supabase keys 洩露事故。Claude.ai 用 Filesystem:read_multiple_files 讀 .env.local 整檔、keys 進對話上下文、不可逆。補救:(1) Supabase Dashboard /settings/api-keys/legacy disable Legacy keys、(2) .env.local 更新 sb_publishable + sb_secret 雙新 keys。Supabase 2025 後 Legacy keys 不可 rotate、必須走切新版 sb_publishable + sb_secret + disable Legacy 雙步驟。

**規則:**
- Claude.ai 操作含 env / secret / token 字面檔案前強制 redaction、絕不讀整檔內容:
  - 不可用 Filesystem:read_multiple_files 讀 .env / .env.local / secrets / credentials 整檔
  - 不可用 Code 端 cat / view 等命令讀 secret 整檔到對話上下文
  - 必要時用 `grep -v 'key\|token\|secret\|password'` redaction、僅讀無 secret 字面
- 處理 secret rotate / disable 走 Dashboard 操作、不寫對話
- 補救紀律:洩露發生後 (1) Dashboard 切新版 keys + disable Legacy、(2) 應用層更新 keys、(3) commit body 揭示事故 + 補救完成

**規範定位:** 對齊 working-style.md §6.3 第 25 條(lessons §12-15 對應簡潔版)+ 安全規則第 1 條 + 第 5 條 + 原則 10 延伸

**教訓來源:** M-1-03-main-a 刀 4 sub 8 前置偵察期間 Supabase keys 洩露事故、本對話累積教訓 #127、§12-N3 第 1-5 條精神擴張

**跨專案適用:** 適用所有 Sean 用 Claude Code 開發的專案。Sean 多 service(PCM Supabase + 蝦皮 token + 供應商 B2B 後台)、env / secret 紀律跨專案統一、洩露補救流程跨平台類似(Dashboard 切新 keys + disable 舊 keys + 應用層更新)

---

### 12-16. 跨訊息上下文同步、含「多 session 同 repo 字面交織」風險

**事故脈絡:**
M-1-03-main-a 刀 4 sub 8b 完成後寫 Step 3「HEAD = 6f9c072 sub 8a」字面錯、Code raise Q-sub8b-redo(憑記憶寫 HEAD 而非 grep 上一輪 Code 回報)。同類擴張:sub 8e-1 啟動前 Claude.ai 端 dirty tree 屬本 repo 還是另一專案的字面交織(兩個 session 平行運作、Claude.ai 多次接受 Sean 單方面回報而未交叉驗證、Code 偵察揭示後校準)。

**規則:**
- Claude.ai 寫指令字面前、必先讀上一輪 Claude Code 回報 + 本對話事實校準:
  - HEAD / commit hash / ahead 數 / sub 進度字面 → 必先 grep / view STATUS.md L17/L29 或 git rev-parse 拿事實數
  - 「上一輪我說 X / 上輪 Code 說 X」字面有 stale 風險(amend 後 hash 重算、busboy-end 自動更新 STATUS、Sean 改變主意推翻舊拍板)
  - 不可憑「2-3 輪前印象」寫死字面
- 多 session 同 repo 平行運作風險:
  - 同 Sean 另一個 session 在本 repo 做事、本 session 不知道、working tree 字面交織
  - Sean 單方面回報「dirty tree 是別的 repo」可能本身字面混淆、必交叉驗(grep / git status)
  - 不可僅憑 Sean / Code 單方面回報接受、必字面真權威交叉驗(特別是狀態類資訊)

**規範定位:** 對齊 working-style.md §6.3 第 26 條(lessons §12-16 對應簡潔版)+ 維度 B「當前 git 狀態」延伸 + 多 session 場景

**教訓來源:** M-1-03-main-a 刀 4 sub 8b Q-sub8b-redo 事故 + sub 8e-1 啟動前 dirty tree 多 session 字面交織事故、本對話累積教訓 #128(雙次踩 + trigger 範圍擴張)

**跨專案適用:** 適用所有 Sean 用 Claude Code 開發的專案。Sean 多 session 多 repo 平行運作為常態(工具配備揭示 80+ skill 包 + 10 MCP 連線、跨專案併行做生意自動化)、跨訊息上下文同步紀律跨專案必要、字面交織風險全面(不限 PCM)

---

### 12-17. audit findings 編號 vs STATUS 摘要編號必對應、commit body 必寫對應表

**事故脈絡:**
M-1-03-audit-disposition slice-C 偵察揭示「議題 4 NaN bug」字面全 repo 0 命中(僅 STATUS L15/L35 描述)、無單一獨立議題清單檔。audit-disposition 系列用「議題 1-8」編號(slice-A 議題 1+6 view、slice-B 議題 2 三層防、slice-C 議題 4 NaN)、實際 audit findings 報告(`docs/audits/M-1-03-main-a-刀-4-sub-8d-findings.md`)用 eng-1~13 / simp-1~19 編號、兩套編號無對應表、recon 多繞 2 輪才確認「議題 4 = #117 anchor = eng-1/eng-8/simp-6/simp-12 雙 audit 命中」。

**規則:**
- audit findings 報告用編號(eng-X / simp-Y / Audit-FN / TN / RN)、STATUS 摘要 / commit body 用「議題 N」摘要編號時:
  - **commit body 必寫對應表**(例:「議題 4 NaN = backlog #117 anchor = audit findings eng-1+8 / simp-6+12 雙 audit 命中」)
  - 新對話接手前置檢查必對齊兩套編號、不憑單一編號推導
- 同類風險:M-0-04 雙輪 audit 17 議題 + skill audit 5 規範類 + backlog #N 三套編號交織、commit body 引用編號時必標 source(對齊 §12-11)
- recon 偵察 phase 撞「議題 N」字面全 repo 0 命中時、必走 commit body 逆推路徑(audit-slice 系列 commit body 內找映射)、不憑 STATUS 摘要直接推

**規範定位:** 對齊 working-style.md §6.3 第 27 條(lessons §12-17 部分對應)+ §12-11 編號區分規則延伸 + 維度 A「具體技術細節」延伸

**教訓來源:** M-1-03-audit-disposition slice-C 偵察 recon 撞「議題 4 NaN」字面 0 命中事故、本對話多繞 2 輪偵察才確認映射關係、累積教訓 §12-N3 第 6 條

**跨專案適用:** 適用所有 Sean 用 Claude Code 開發的專案。Sean 多 audit slice + multi-round skill audit 並存場景常見、編號對應表跨專案紀律必要

---

### 12-18. 純 code 題不丟 Sean 拍板、Claude.ai 用三視角自決、只回報白話結論

**事故脈絡:**
M-1-03-audit-disposition slice-C 偵察報告 § 5 列出 5 題給 Claude.ai 拍板、其中包括「議題編號 vs eng-/simp- 編號對應」「規範類批量涵蓋範圍」「修法位置選擇」等純 code 內部選擇題。Sean 無程式背景、看不懂 code 內部選擇、也無法判斷修哪層 / 命名 / 規範 / slice 紀律題;丟給 Sean 拍板浪費他時間 + Sean 看不懂只能憑直覺答 + Claude.ai 浪費 multi-select 預算。

**規則:**
- Claude.ai 列拍板題前自檢:
  - **「Sean 看得懂嗎」**:技術細節 / 程式語法 / 命名規則 / slice 紀律 → Sean 看不懂、不丟
  - **「影響業務嗎」**:網站顯示 / 業務邏輯 / 資料結構 / 部署 → 影響、丟拍板
- 純 code 內部選擇題 Claude.ai 用三視角自決(擴充性 / 可維護性 / bug 可追蹤性)、只給白話結論 + 字面 vs 事實揭示
- 拍板題分層:
  - **丟 Sean**:影響網站顯示 / 業務邏輯 / 資料結構 / 部署 / 命名(對外可見)
  - **Claude.ai 自決**:命名(內部)/ slice 紀律 / 修哪層 / 規範類分類 / commit message 格式 / audit findings 編號映射
- 同類風險:多選題堆疊 Sean 看不懂選 random 默認、誤導後續執行

**規範定位:** 對齊 working-style.md §6.3 第 27 條(lessons §12-18 對應簡潔版)+ 維度 B「Sean 工作模式」延伸 + 「決策題分層」紀律

**教訓來源:** M-1-03-audit-disposition slice-C 偵察報告 § 5 列 5 題純 code 拍板事故、累積教訓本對話 multi-select 過載 + Sean 看不懂題目反饋

**跨專案適用:** 適用所有 Sean 用 Claude Code 開發的專案。Sean 無程式背景跨專案統一(PCM / 蝦皮 / 報價 / 訂單)、拍板題分層紀律跨專案必要、避免 Sean 看不懂題目浪費他時間

---

### 12-19. Skill audit 適用範圍補丁(skip 條款)

**事故脈絡:**
M-1-03-audit-disposition slice-C(commit `6f0ba36`)首次破例 skip skill audit、變動規模:apps/storefront/src/lib/products.ts +14/-1 行(hashIdToNumber helper 7 行 + L77 cast 替換 1 行 + JSDoc 6 行)+ docs 字面同步 4 處(supabase-schema-design.md 3 + lessons §12-17/18 + working-style 第 27 條)。實質 source code 變動僅 8 行、ROI 偏低、跑雙 audit 規模不符。slice-A 既有先例(commit body 揭示「對齊 working-style §6.3 第 10 條 + backlog #15、純 SQL migration 不 cover」)+ slice-B-3 先例(「不跑 build 對齊 working-style §6.3 第 10 條 + backlog #15」)、但兩先例字面理由不一、無統一條款防未來無依據援用。

**規則:**
- 純收尾 slice、同時滿足以下三條件可 skip skill audit:
  - **(1) 新 code 變動規模 < 10 行**(以 `git diff --stat` 真 +N/-N 為準、不算 JSDoc / 註解)
  - **(2) 主要 scope 為 doc 字面同步 / trigger 立法 / 收尾**(不是 entity / adapter / API surface / use-case logic 改造)
  - **(3) 無新 entity / 新 adapter / 新 schema / 新 API surface**
- skip 時 **commit body 必寫**:
  - skip audit 理由(白話一行)
  - 變動規模(行數、引 `git diff --stat`)
  - **對齊 §12-19 三條件逐條檢視**(條件 1 ✅ X 行 / 條件 2 ✅ scope X / 條件 3 ✅ 無 X)
- **不破例不寫理由、援用條款必逐條對照、不可只引條款名**(防「援用 §12-19 但不對照三條件」rot)
- 同類風險:CI gate / pre-commit hook skip 條款、build skip 條款、test skip 條款(本條為 skill audit only、其他 skip 場景需獨立立條款)

**規範定位:** 對齊 working-style.md §6.3 第 10 條 Skill audit 工作流 + backlog #15 + 維度 A「具體技術細節」延伸

**教訓來源:** M-1-03-audit-disposition slice-C @ `6f0ba36` 首次破例 skip audit 事故、slice-A / slice-B-3 兩先例字面理由不一統一條款立法、本對話累積條款 ROI 偏低慣例化

**跨專案適用:** 適用所有 Sean 用 Claude Code 開發的專案。Sean 多專案多 slice 收尾頻繁、skill audit ROI 評估跨專案紀律必要、避免「為跑而跑」浪費 multi-round skill audit 預算

**首例:** M-1-03-audit-disposition slice-C @ `6f0ba36`(本條觸發案例、即本 slice-C 收工事實)

---

### 12-20. zsh 紀律 — 給 Sean 跑的 Terminal 指令絕不包 # 註解(§4-1 既有條款、執行紀律重犯立規強化)

**事故脈絡:**
M-1-04 wrs.png push 修復過程、Claude.ai 寫的 Terminal 指令多處包 `#` 註解(在 ```bash 區塊內)、Sean 整段貼進 zsh、`#` 後內容被當指令跑、Terminal 連續 5+ 行 `zsh: command not found: #` 等 error、指令執行順序亂、最終撞 detached HEAD non-fast-forward push 失敗、wrs.png push 路徑變複雜。**第 N+1 次重犯既有條款**:§4-1(本檔)+ working-style §4.2 + CLAUDE.md「zsh 禁忌」段三處早已立法(zsh `#` → command not found)、本對話仍犯。

**規則(§4-1 強化執行版):**
- 給 Sean 跑的 Terminal 指令(寫在 ```bash 區塊內、預期 Sean 整段複製貼進 Terminal)、**絕對不放 `#` 註解**(zsh 把 `#` 後內容當指令、報 `command not found: #`)
- 指令說明寫在指令外的 prose 段(指令前/後 markdown 文字、不在 ```bash 區塊內)
- **適用範圍:** 「給 Sean 跑」= slice 指令內 ```bash / busboy template ```bash / Claude.ai 對話貼回的 ```bash;**docs reference 文件內 ```bash 範例不適用**(Sean 看 reference 摘片段跑、不整段貼)
- 對 **Code 內部執行的 shell 不適用**(Code 直接跑、不經 Sean 貼上、bash subshell 對 `#` 行為正常)
- **違反偵測:** Claude.ai 寫完指令後自檢、看到自己寫的「給 Sean 跑」```bash 區塊內含 `#` → 立即重寫成「指令(```bash) + prose 說明」雙段
- **同類錯第 N 次:** 既有 §4-1 / working-style §4.2 / CLAUDE.md「zsh 禁忌」三處立法、本對話仍犯;本 §12-20 升級為 lessons §12 強化執行紀律、跨對話 Claude.ai 必過自檢
- **本 slice 自身遵守 §12-20 即將立法條款 self-enforce 範例:** mini-B slice 指令本身內所有 ```bash 不含 `#`、註解全寫在 prose 散文段

**規範定位:** 既有 §4-1 / working-style §4.2 / CLAUDE.md「zsh 禁忌」表立法位置不動、本 §12-20 升級為「執行紀律重犯立規」+ working-style §6.3 第 28 條(精簡版自檢入口)同步擴張

**教訓來源:** M-1-04 wrs.png push 修復事故、Sean Terminal output 連續 5+ 行 `zsh: command not found: #`、本對話現場揭示

**跨專案適用:** 適用所有 Sean 用 Claude Code 開發的專案、所有給 Sean 跑的 Terminal 指令場景(zsh / bash 為 macOS 預設互動 shell、`#` 行為一致)

**首例:** M-1-04 wrs.png push 修復事故(本對話內、無單一 commit hash 錨點 — 立規 commit 即本條觸發 commit)

---

### 12-21. Claude Design GitHub 工具能力 — 單向讀取、Sean 是 pcm-website-design repo 唯一寫手

**事故脈絡:**
M-1-04 wrs.png 修復、Claude.ai 默認 onboarding doc 多處字面「Sean 在 Claude Design 改 → push pcm-website-design」(主詞「push」歧義、讀者可能誤解 Claude Design 是 push 主詞);Sean 詢問 Claude Design 揭示工具能力真權威 = 「✅ 從 GitHub 讀取(瀏覽 repo、匯入 token / 元件 / CSS 變數參考)、❌ 推送回 GitHub」、push 一直是 Sean 手動做(Sean 從 Claude Design 取出設計檔 → 在本地 design-reference 端 commit + push pcm-website-design repo)。

**規則:**
- **Claude Design 對 GitHub 工具能力 = 單向讀取**:瀏覽 repo / 匯入 token / 元件 / CSS 變數參考、**不 commit / 不 push / 不寫**
- **pcm-website-design repo 唯一寫手 = Sean**(手動 git push)
- **Claude.ai 寫指令涉及「design-reference submodule 更新 / pcm-website-design repo 變更」時**、永遠寫:
  - ✅ 「Sean 在 design-reference 端手動 commit + push」
  - ✅ 「Sean 從 Claude Design 取出設計檔 → 本地 commit + push」
  - ❌ 不寫「Claude Design push」/「Claude Design 推 GitHub」(主詞錯)
- onboarding doc 字面歷史殘留主詞歧義 → 本 trigger 立法時順手批量校正(CLAUDE.md / PROJECT-OVERVIEW.md / working-style §8.3+§8.5 / tools-and-skills.md / PHASE-1-MILESTONES.md 命中字面)

**規範定位:** 對齊 onboarding 字面校正(本 slice 同步修 5 檔活字面)、CLAUDE.md 四方分工字面更新

**教訓來源:** M-1-04 wrs.png push 路徑、Sean 親自詢問 Claude Design 揭示能力(對話現場驗證)

**跨專案適用:** 適用所有 Sean 用 Claude Code + Claude Design 雙工具場景(其他工具如 Claude Code 對 GitHub 寫權限不涉本條)

**第 1 次發生立即立 trigger 理由:** 工具能力錯誤理解屬「字面 vs 事實」嚴重類(對齊鐵則 11)、規劃稿字面 vs 工具能力真權威差異、第 1 次發生即上 lessons 防後續對話沿用錯字面寫指令

**首例:** M-1-04 wrs.png 修復過程(本對話、無單一 commit hash 錨點 — 立規 commit 即本條觸發 commit)

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
