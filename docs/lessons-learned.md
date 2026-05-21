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

**規範定位:** 對齊 working-style.md §6.3 第 10 條 Skill audit 工作流 + 第 30 條(本條對應)+ backlog #15 + 維度 A「具體技術細節」延伸

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

**規範定位:** 對齊 onboarding 字面校正(本 slice 同步修 5 檔活字面)、CLAUDE.md 四方分工字面更新 + working-style.md §6.3 第 31 條(本條對應)

**教訓來源:** M-1-04 wrs.png push 路徑、Sean 親自詢問 Claude Design 揭示能力(對話現場驗證)

**跨專案適用:** 適用所有 Sean 用 Claude Code + Claude Design 雙工具場景(其他工具如 Claude Code 對 GitHub 寫權限不涉本條)

**第 1 次發生立即立 trigger 理由:** 工具能力錯誤理解屬「字面 vs 事實」嚴重類(對齊鐵則 11)、規劃稿字面 vs 工具能力真權威差異、第 1 次發生即上 lessons 防後續對話沿用錯字面寫指令

**首例:** M-1-04 wrs.png 修復過程(本對話、無單一 commit hash 錨點 — 立規 commit 即本條觸發 commit)

---

### 12-22. DevTools 操作驗範圍界線 — Sean 不會 inspect / Network 結構解析、超範圍改 Code 字面估算

**事故脈絡:**
M-1-04 刀 1b2 audit Q4 操作驗、Claude.ai 推薦 Q4 = Sean 操作驗 4 件、其中 WCAG 2.5.5 觸控目標 ≥ 44×44 需 DevTools inspect element 量元素尺寸、Sean 回「我不會」、改 Code 用 CSS 字面估算才解決(HomeFooter `.ed-footer-cols a` 字面 font-size 13.5px × line-height 1.6 = 21.6px、實算 < AA-24px FAIL、進 backlog #138)。

**規則:**
- **Sean 能做(寫驗收清單可給):**
  - 看視覺(視覺對 / 不對 / 歪)
  - 看 Console 紅字字面(不解析 stack trace、只看字面有無「Error」)
  - 點連結看 URL bar(對 / 404 / 跳哪)
  - Cmd+F 在 Response / source 搜文字(找特定字面有無)
  - 在頁面內滾動 / 點按鈕 / 填表單
- **Sean 不會做(寫驗收清單不可給):**
  - DevTools inspect element 量尺寸 / 比對 CSS box model
  - DevTools Network panel Response 結構解析(只看 status code OK、不看 headers / payload 結構)
  - DevTools Performance / Memory / Application panel 操作
  - 用 querySelector / $0 / console.assert 互動操作
  - 量 a11y 屬性(aria-* / tabindex / focus order)
- **超範圍處置:** Claude.ai 寫驗收清單前每項自檢「Sean 在不接受 DevTools 中高階教學的前提下能做嗎?」、不能 → 改 Code 用 CSS / HTML / runtime 字面估算、不靠 Sean 操作 DevTools
- **enforce:** 違反 = Sean raise「我不會」、Claude.ai 不解釋直接改 Code 驗證版本、不教 Sean DevTools 操作

**規範定位:** 對齊 working-style.md §6.3 第 29 條(精簡版自檢入口)+ 維度 A「Sean 工具能力真權威」延伸 + lessons §12-21「工具能力字面 vs 事實」精神延伸

**教訓來源:** M-1-04 刀 1b2 audit Q4-2 觸控目標 ≥ 44×44 驗收項目、Sean 回「我不會」、Claude.ai 改 Code CSS 字面估算 21.6px FAIL 進 backlog #138

**跨專案適用:** 適用所有 Sean 用 Claude Code 開發的專案、Sean 不接受 DevTools 中高階教學是穩定偏好(不限本專案)

**首例:** M-1-04 刀 1b2 @ `477f249` audit Q4-2 觸控目標驗收項目重寫事故

---

### 12-23. skill audit 雙跑字面實況校正 — engineering:code-review + simplify stale、實況 requesting-code-review + accessibility-review

**事故脈絡:**
M-1-04 刀 1b2 audit、Claude.ai 寫指令字面「engineering:code-review + simplify 雙跑」、Code step 1 `ls ~/.claude/skills/` 撈 60 skill 完整清單揭示:**無 engineering / engineering:code-review / simplify** 同名 skill、實際 audit 視角候選只有 requesting-code-review / accessibility-review / audit-website / memory-leak-audit / design-critique 等。Claude.ai 補偵察拍 Q-B = requesting-code-review + accessibility-review 雙跑、實測:engineering 視角抓 3 Important + 4 Minor、a11y 視角抓 2 Major + 7 Minor pre-existing、互補揭示。

**規則:**
- **stale 字面安置:** `engineering:code-review` + `simplify` 字面源 = M-0-04 雙輪實測命名、Claude.ai memory + working-style §3.b + lessons §12-19 內字面沿用、實況 ~/.claude/skills/ 60 個 skill 不存在此 2 名
- **歷史 anchor 保留:** M-0-04「engineering 5 + simplify 12 + 共 17 + 互不重疊」歷史數據保留為 audit 雙跑紀律 anchor、**不為當下 audit 範本字面**(即「雙視角互補」精神留、「skill 名」改實況)
- **當下實況雙跑字面:**
  - `requesting-code-review`(engineering 通用視角、Critical / Important / Minor、dispatch superpowers:code-reviewer subagent — 若 subagent type 不存在、改用 Agent general-purpose 代)
  - `accessibility-review`(WCAG 2.1 AA framework、Perceivable / Operable / Understandable / Robust 4 大類、直接 framework 跑、非 dispatcher)
- **新雙跑數據 anchor(取代 M-0-04 stale 範本):**
  - M-1-04-1b2:code-review 3 Important + 4 Minor、a11y 2 Major + 7 Minor pre-existing(本條 trigger commit 即此數據首例)
- **第二視角彈性:** 視 slice 性質、accessibility-review 可換 audit-website / memory-leak-audit / design-critique(依 audit 視角覆蓋面互補性決定、不憑記憶寫死)
- **enforce:** Claude.ai 寫 audit 指令前必先 `ls ~/.claude/skills/` 撈實況清單、grep 用得到的 skill 對應 audit 視角、不憑 memory / lessons 字面寫 skill 名;違反 = Code step 1 撈實況 raise multi-select、Sean 拍板才執行

**規範定位:** 對齊 working-style.md §3.b 雙跑字面同步(本 commit 一併修)+ §6.3 第 32 條(本條對應)+ 維度 A「工具能力真權威」延伸 + lessons §12-21「Claude Design GitHub 工具能力字面 vs 事實」精神同類延伸(不同工具、同類教訓)

**教訓來源:** M-1-04 刀 1b2 audit Q-B 子拍偵察、Code 撈 60 skill 清單揭示 simplify 不存在、Claude.ai 寫指令字面憑 memory 沿用 stale 名

**跨專案適用:** 適用所有 Sean 用 Claude Code 開發的專案(~/.claude/skills/ 路徑跨專案一致、Claude Code 全域 skill 庫共享)

**首例:** M-1-04 刀 1b2 @ `477f249` audit Q-B 子拍偵察揭示

---

### 12-24. audit 推翻先前拍板時、必同步更新 stale 字面 — 4 處 stale 處置分流

**事故脈絡:**
M-1-04 候選刀 4 PRD 偵察揭示:2026-05-09 main-d-d2(commit `1147fbe`)拍板「不裝 `server-only` npm package、用 `typeof window` runtime guard 替代(範圍紀律不擴張 deps、Sean 例外條款只覆蓋 @pcm/adapters + @pcm/domain)」、2026-05-10 audit slice B-1(commit `89a20a8`)因 R1 #2 Critical(service_role key 從 @pcm/adapters root export 暴露給 client bundle)推翻 d2、加 `server-only ^0.0.1` dep 進 `packages/adapters/` + `apps/storefront/` package.json + 在 `packages/adapters/src/supabase/client.ts` 檔頭加 `import 'server-only';`(編譯期擋第一層)。**但 d2 原拍板字面散落 4 處未隨 B-1 同步:**
- `apps/storefront/src/lib/products.ts` L22-26 註解仍寫「不裝 'server-only' npm package」
- audit sub-8d L62 引「對齊 d2 Sean 拍板『範圍紀律不擴張 deps』」(歷史快照、不改)
- 4 份 recon 報告引同字面(M-1-04-recon / pre-recon / recon / recon-supplement、歷史快照、不改)
- d2 commit `1147fbe` body 內字面源頭(歷史不可變、絕不改)

**規則:**
- **推翻 commit body 必含「字面 vs 事實揭示」段、列:**
  - 推翻來源:audit 名 + commit hash + 日期
  - 原拍板出處:slice 編號(d2 / dx / 等)+ commit hash + 日期
  - **同步更新清單(本 slice 必修):** code 註解 + active docs / patterns
  - **歷史快照不改清單:** audit 報告 + recon 報告 + 原 commit body(歷史不可變、Sean 紀錄 anchor、絕不改)
- **code 註解引推翻前字面 → 必同步更新揭示時間軸 + 雙層架構說明**(編譯期 vs runtime guard 各自角色、不只刪舊字面)
- **active docs / patterns 引推翻前字面 → 必同步更新**(若該檔仍為 active 規範)
- **enforce:** 推翻 commit body 寫「待同步字面清單」、收工前清空、未清空進 backlog、**不允許「下次順手」**(累積 stale 字面風險高、跨 slice 易遺漏)
- **觸發點:** 任何 audit / 偵察結論為「先前 slice 拍板 A 推翻、改採 A'」時、Step 1 立即 grep 全 repo 引 A 字面位置、列同步清單

**規範定位:** 對齊鐵則 11(commit 字面 vs 事實)+ working-style §6.3 第 10 條(skill audit 工作流)+ 第 33 條(本條對應)+ lessons §12-3 維度 A(字面 vs 事實守則):本條為「推翻拍板」特殊場景的字面同步配套

**教訓來源:** M-1-04 候選刀 4 pre-PRD 偵察、發現 `89a20a8`(2026-05-10 audit B-1)推翻 d2(`1147fbe` 2026-05-09)後、4 處字面 stale 未同步(products.ts 註解 / audit sub-8d / 4 份 recon / d2 commit body)、本 slice 修 products.ts 註解 + 立 trigger 防再犯

**跨專案適用:** 適用所有 Sean 用 Claude Code 開發的專案(audit 推翻先前拍板屬通用工作模式、字面同步紀律跨專案一致)

**首例:** M-1-04 候選刀 4 pre-PRD 偵察、本 trigger commit 即同步修 `apps/storefront/src/lib/products.ts` L22-26 註解

---

### 12-25. 跨 session slice 指令字面內嵌義務 — 不靠「Code 看得到上輪對話」假設

**事故脈絡:**
M-1-04 slice 4 主刀(commit `9e40120` amend 前 `4b80769`):Claude.ai 上輪對話貼出 ADR-0006 + boundary.md 完整草稿、下輪 slice 指令引「上輪 Claude.ai 草稿、字面照搬」。但 Claude Code 是**新 session 啟動、看不到上輪對話**、只能依 task L3 章節大綱 + 既有事實 anchor 引用自行構造 ADR-0006 字面;boundary.md 因 Sean 在本 session 親自貼了完整 content、Code 有源可參。Claude.ai 後 review 抓 3 處字面 issue(boundary §4 4 條 link 缺 GitHub 行號 anchor / ADR packages/ui 字面與 boundary §1.1 不一致 / ADR server-only dep 字面漏 packages/adapters)、amend 修。

**規則:**
- **slice 指令引用「Claude.ai 上輪貼出」草稿字面時、必擇一處置:**
  1. **完整字面內嵌進 slice 指令**(指令長、但 Code 拿到完整字面、零跨 session 假設)
  2. **先請 Code 把上輪草稿存進 `docs/specs/`**(獨立小 slice)、後續 slice 指令引 `docs/specs/` 檔案路徑
  3. **Code 跑 slice 前明確問**「上輪草稿在哪?若無、停下回報」(防 Code 看不到時自行構造)
- **不允許:** slice 指令字面假設「Code 看得到上輪 Claude.ai 對話」、不允許 Code 在無草稿可參時自行構造章節字面繼續執行(除非指令明示豁免、且豁免後 Claude.ai 必後 review)
- **處置(發生時):**
  - Code 構造完成、Claude.ai 後驗 review、列字面 issue
  - amend slice 修字面(對齊「commit 不等於 slice 終結」原則)
  - 立法 trigger 防未來重蹈(本條 §12-25 即為此次教訓立法)
- **enforce:** Claude.ai 寫 slice 指令時自檢「Code 看得到本字面嗎?」、看不到 → 選處置 1 / 2 / 3 任一、不假設;違反 = Code 跑指令時 raise multi-select、Sean 拍板才執行(對齊 memory feedback「懷疑 claude.ai 指令、先檢查再動作」)

**規範定位:** 對齊 working-style §6.3 第 11-13 條(寫指令前 grep 真權威紀律)+ 第 34 條(本條對應)+ lessons §12-3 維度 A「Sean 工具能力真權威」延伸 + memory feedback「claude.ai 跨 session 會 forget 已拍板事」精神同類延伸(不同 actor、同類教訓:跨 session 無共享記憶)

**教訓來源:** M-1-04 slice 4 主刀、Claude.ai 上輪貼出 ADR-0006 + boundary.md 草稿、slice 指令引「上輪草稿」、Code 新 session 看不到、依大綱自寫、Claude.ai 後 review 3 處需修(boundary §4 anchor / ADR packages/ui 字面 / ADR server-only dep 字面)、屬「Code 構造能力夠、但字面細節需 Claude.ai 後驗」模式

**跨專案適用:** 適用所有 Claude.ai + Claude Code 跨 session 協作場景(claude.ai 對話與 claude code 對話獨立、無共享狀態、跨 session 字面引用必明示傳遞機制)

**首例:** M-1-04 slice 4 主刀 @ `9e40120` 落地、本 trigger amend 同 commit 立 + 3 處字面修

---

### 12-26. Supabase view 遮蔽敏感欄位 + adapter 切換時序紀律

**事故脈絡:**
M-1-03-audit Slice A(2026-05-10、`supabase/migrations/20260510134708_products_public_view.sql` 落地)建 `products_public` view 排除 `price_by_tier` + `metadata` 欄位、防經銷價洩漏到一般會員瀏覽器;但 SupabaseProductAdapter 6 method(findById / searchByKeyword / listByFitment / listByCategory / listByBrand / save)仍讀 base `products` 表(backlog #118 待落地、🔴 立即啟動)、形成「view 防線下沉、但 adapter 未對應切換」時間差。M-1-03-main-d-d2 application 層 priceByTier strip 為輔助防線、若漏 strip 仍洩;切到 view 後防線下沉到 DB 層、application 層 strip 改為輔助而非主防線(對齊 backlog #118 預期解法)。

**規則:**
- **加 view 前必列「投射欄位 × 角色(anon / authenticated / service_role)」對照矩陣**、不該看到的欄位必排除(現況 products_public 排除 price_by_tier + metadata、對齊 ADR-0003 §C2 RLS column-level)
- **view 落地後同 milestone(最遲下一個 slice)必跟「adapter 切讀 view」**、不允許「view 立但 adapter 未切」狀態跨 milestone 遺留(避免 application 層 strip 為主防線、view 為輔助的反向倒置)
- **contract test 必加 case 驗 view 不回敏感欄位**(不只測 adapter、直接測 view DDL 投射欄位清單)
- **view 不加計算欄位 / 動態計算邏輯**、view 投射應為「base table 欄位的子集 + RLS 投射」、計算欄位放 application 層(對齊三視角「可追蹤性」、出 bug 易定位是 view 還是 application)
- **view 拆分(list-projection vs detail-projection)為延伸議題**、list 規模長大(M-2 分類頁 / 品牌頁啟用)才痛、不為過早抽象(對齊 backlog #119)
- **enforce:** 加 view migration 的 PR / slice 必同時列 adapter 切換 trigger;若同 slice 不切、必開 backlog 條目 + 標 🔴 / 🟠 優先級 + 註明依賴條件、不允許「view 立 + adapter 切」分兩 milestone 遺留(本條教訓來源即此情境)

**規範定位:** 對齊 working-style §6.3 第 35 條(本條對應)+ lessons §12-3 維度 A「字面 vs 事實守則」延伸(view 投射字面 vs adapter 讀取字面對齊)+ CLAUDE.md「server 端鐵則 — 經銷價絕不傳到一般會員瀏覽器」精神同類延伸(防線設計層次)+ ADR-0003 §C2 RLS column-level 設計 + `docs/architecture/supabase-schema-design.md` §6.1 / §9.2

**教訓來源:** 跨專案 skill audit 推延 — PCM_Quote `pcm-migration-generator` skill 12 條檢查重新對照本 repo 真實 schema 後、view 遮蔽欄位為「真適用」條(老案子 view 衍生欄位 vs 真實資料是相關但不同情境、本 repo 對應 view 投射做欄位遮蔽);本 repo 內生對應實況 = backlog #118(SupabaseProductAdapter 6 method 切換讀 products_public view、🔴 立即啟動)+ #119(view 拆分 list vs detail)+ M-1-03-audit Slice A 落地 view 但留接縫待 adapter 切、屬「view 立 + adapter 切時間差」結構性風險

**跨專案適用:** 適用所有 Sean 用 Claude Code + Supabase 的專案(RLS 層級防線設計通用、適用任何「view 投射做欄位遮蔽」場景、不限本 repo)

**首例:** M-1-03-audit Slice A @ `supabase/migrations/20260510134708_products_public_view.sql` 立 view、backlog #118 SupabaseProductAdapter 切 view 待落地時驗證本條規則;本 trigger commit 即立法

---

### 12-27. products.external_id 寫入大小寫立規 — 立規型、sync-engine pipeline 對應點

**事故脈絡:**
本條為「**立規型**」非「事故型」 — 跨專案 skill audit(PCM_Quote `pcm-migration-generator` skill 12 條檢查)揭示 SKU 大小寫紀律是 PCM_Quote 老案子的真實踩坑教訓(老案子 vendor crawler 對同一 SKU 不同來源用大小寫不一、導致 UNIQUE 重複行 / 查詢漏命中);本 repo 還未實作 sync-engine pipeline(M-5-03 前空檔)、為避免落地時忘記預先立規、寫進 lessons 作 anchor。本條與其他 §12-X 條目「事故型」性質不同、透明標明:教訓來源是老案子實證、不是本 repo 內生事故。

**規則:**
- **products.external_id(= SKU)寫入 Supabase 前必統一 `.toUpperCase()`**(對齊 PCM_Quote 老案子實證;Postgres text 預設 case-sensitive、UNIQUE 約束不會自動忽略大小寫)
- **寫入端責任分流:** SupabaseProductAdapter `save` method(Phase 1 後台手動上架)+ sync-engine 上架 pipeline(M-5-03 後 Sheet row → product.title)兩處都必加;寫入單一入口前不依賴下游兜底
- **不在 SQL 加 trigger 強制大寫** — trigger 隱藏邏輯、三視角「可追蹤性」差(出 bug 不知是 trigger 還是 application 層);一律 application 層處理
- **既有資料無需回填**(Phase 1 規模、M-1-16 200 SKU 種子未上、種子前直接走規則)
- **同步點:** sync-engine pipeline 落地(M-5-03)時、該 slice 必引用本條 trigger 確認執行;Phase 2 加 vendor crawler / vehicle-service-ecosystem 時同
- **本條僅規範 external_id(SKU)大小寫**;商品名(product.title)格式為獨立議題、對應 backlog #78(商品名 concat helper、M-5-03 sync-engine pipeline)、勿混為一談

**規範定位:** 對齊 working-style §6.3 第 36 條(本條對應)+ lessons §12-3 維度 A「字面 vs 事實守則」(立規 anchor 寫進 lessons 防失憶)+ CLAUDE.md 鐵則 9 內容分級 L2(每季 1-3 次潛在踩坑、預先立規)+ 鐵則 10 三視角「可追蹤性」(application 層處理 vs SQL trigger 隱藏邏輯)

**教訓來源:** 跨專案 skill audit 推延 — PCM_Quote `pcm-migration-generator` SKILL.md 內建 12 條檢查中「SKU 一律 UPPER(.upper() / SQL UPPER())」對照本 repo schema(products.external_id UNIQUE NOT NULL、無 trigger 強制大寫)後、為「真適用但本 repo 還沒踩過坑」之一;屬「立規型」非「事故型」、教訓來源是老案子實證(不是本 repo 內生事故);backlog #78 為相關非直接事故錨點(#78 規範商品名 concat helper、本條規範 SKU 大小寫、層級不同)

**跨專案適用:** 適用所有 Sean 用 Claude Code + Supabase + 多來源寫入(manual / sync / crawler)的專案 — 任何 UNIQUE text key(不只 SKU)多來源寫入時皆應預先統一大小寫(case-sensitive 預設)

**首例:** 本 trigger commit 即立規(無事故首例);實際首次落地驗證點 = M-5-03 sync-engine pipeline 落地 slice;backlog #78 為相關非直接事故錨點

---

### 12-28. Claude.ai 指令字面「整段移除」+ 上游 prop 合約存在時、Code 自行裁決保留 wrapper fallback

**事故脈絡:**
M-1-04 刀 3-b(commit `7f99033`):Claude.ai 指令字面 3(c)「Header 3 nav button onNavLocal stub 整段移除 + handleNav 直接 router.push」、純照字面執行會引入 `onNav` destructure unused-vars 紅(因 HeaderProps.onNav prop 字面仍宣告);Code 自行裁決保留 props.onNav fallback 進 handleNav body(非 onNavLocal 復活、handleNav 接管 fallback 機制)、HeaderProps 合約不破、lint `--max-warnings 0` 通過。commit body 揭示「字面 vs 事實偏離」段、屬鐵則 11「事實 > 字面」允許範圍、未中斷 raise(偏離方向對齊三視角非規避指令)。

**規則:**
- **指令字面「整段移除」+ 上游 prop 合約存在時、Code 自行裁決保留 wrapper fallback**(維持上游 caller 字面合約不破、避免 destructure unused-vars 紅;lint --max-warnings 0 強制下尤其重要)
- **commit body 必揭示字面 vs 事實偏離**(對齊鐵則 11 預防條 + lessons §12-3 維度 A);揭示為前提、不揭示等於規避
- **不需中斷 raise**(偏離方向是「對齊三視角」非「規避指令」、屬鐵則 11 允許範圍)
- **邊界:**
  - 「整段移除」+ **無** prop 合約 → 純照字面執行、無 fallback 需求
  - 「整段移除」+ **有** prop 合約 + 三視角優於照字面(擴充性 / 可維護性 / bug 可追蹤性) → 自行裁決保留 wrapper + commit body 揭示(本條規範)
  - 「整段移除」+ 有 prop 合約 + **三視角無優於照字面** → raise multi-select 拍板、不擅自裁決
- **enforce:** 字面偏離後 commit body 揭示為硬性要求(commit body 缺揭示 → 視為違反鐵則 11);prop 合約存在判定 = grep destructure caller / function signature、不憑記憶

**規範定位:** 對齊 working-style §6.3 第 37 條(本條對應)+ 鐵則 11「事實 > 字面」允許範圍(commit body 揭示為前提)+ lessons §12-3 維度 A「字面 vs 事實守則」延伸(字面整段移除 vs 事實 prop 合約對齊)

**教訓來源:** M-1-04 刀 3-b 主刀(commit `7f99033`)、Claude.ai 指令字面「onNavLocal stub 整段移除 + handleNav 直接 router.push」、Code 偵察揭示 `HeaderProps.onNav` prop 合約字面、自行裁決保留 props.onNav fallback、commit body 揭示「handleNav 接管 fallback 機制、非 onNavLocal 復活」、屬本 repo 內生事故

**跨專案適用:** 適用所有有 prop 合約 + lint `--max-warnings 0` / 嚴格 unused-vars 強制的專案(React / TypeScript / Vue / Svelte 等元件框架通用)

**首例:** M-1-04 刀 3-b @ `7f99033` Header.tsx handleNav fallback 保留(對齊 boundary.md §2.2 第 2 列「互動後 nav」第 2 次落地)

---

### 12-29. Claude.ai 預警範圍超界時、預設拆 sub-slice、不留「邊緣合一」選項

**事故脈絡:**
M-1-04 刀 3-c:Claude.ai 指令字面自寫「範圍超出 15-45 min 上界邊緣」預警、卻同段建議「合一」(整段 HomeSelect 主刀 + STATUS 對齊 3 件 + backlog #141/#142 + lessons §12-28 + working-style §6.3 第 37 條 + #118 評估、未預設拆);Code 偵察揭示實況 60-95 min 嚴重超鐵則 4(15-45 min)、自行裁決拆 3-c.1(commit `b7b755b`、HomeSelect + STATUS)+ 3-c.2(立法 + backlog + STATUS)、Sean「你建議」拍板;3-c.2 指令字面再次落入相同陷阱(Sean §2.6 估 35-55 min 邊緣超界 + §2.6 (b) 留「Code 評估超 45 min raise 拆」邊緣合一選項)、Code 偵察揭示實況 51-71 min、Sean 再次拆 3-c.2.1(本 commit、純 .md 立法 + STATUS)+ 3-c.2.2(backlog #141/#142)。**Claude.ai 寫指令時自身預警邊緣超界、但同段留邊緣合一選項屬陷阱重複違反鐵則 4**。

**規則:**
- **Claude.ai 寫 slice 指令、若自己預警範圍可能超界、必預設拆 sub-slice、不留邊緣合一選項**(預警即拆、不留 Claude.ai 自我寬容空間)
- **硬要合一需具體列「為何合一三視角優於拆」**(擴充性 / 可維護性 / bug 可追蹤性)、**不能僅以邏輯耦合為由**(邏輯耦合不等於必須單 slice)
- **Code 偵察揭示超界 → 自行裁決拆 + commit body 揭示為正確 raise**(對齊「事實 > 字面」鐵則 11、屬正確介入非規避指令)
- **enforce:** Claude.ai 寫指令時自檢「最大估時是否超 45 min?」、超即拆;Code 偵察揭示超 45 min raise multi-select 拍板拆法、不擅自合一

**規範定位:** 鐵則 4(15-45 min)強制、預警即拆、不留 Claude.ai 自我寬容空間;對齊 working-style §6.3 第 38 條(本條對應)+ lessons §12-3 維度 B 滾動修正(本 slice 即 §12-29 規則 1 違反 + 修正自身落地驗證一次)

**教訓來源:** M-1-04 刀 3-c(`b7b755b` 拆出 3-c.1、本 commit 為 3-c.2.1、§12-29 規則 1 違反 + 修正自身落地驗證二次:第一次 3-c → 3-c.1+3-c.2、第二次 3-c.2 → 3-c.2.1+3-c.2.2)、本 repo 內生

**跨專案適用:** 適用所有 milestone-driven + slice 切分制專案(對齊「最小 commit、最大可控、可中斷」slice 設計哲學)

**首例:** M-1-04 刀 3-c → 3-c.1(`b7b755b`)+ 3-c.2 拆分(Code raise + Sean「你建議」拍板)為 §12-29 規則 1 違反 + 修正首例;本 commit(3-c.2.1)為第二次違反 + 修正案例、§12-29 自身落地驗證二次

---

### 12-30. Claude.ai 不可把 Code 在 commit body 揭示的歷史快照重新詮釋成「對方失準」、必先 view commit body 字面

**事故脈絡:**
M-1-04 刀 3-a 主刀(`eb5196e`)Code 在 commit body 完整誠實揭示:「指令字面 L17 有『Header 3 button』需修、實況 L17 字面無此字串(L17 為 ADR-0006 amend 描述)、實況 L15 + L35 才有對應字面、本 slice 改 L15 + L35」+「7fa9f42 commit 訊息實為『docs(working-style+lessons): §6.3 補...』非 ADR-0006 amend、純 sed 後 L17 / L23 / L29 / L236 引入 hash vs 訊息 mismatch(L29 表格寫『7fa9f42 | docs(M-1-04-slice-4): ADR-0006...』、實況 7fa9f42 訊息屬 working-style)」 — 屬刀 3-a **當下**歷史快照、commit body 字面源完整。Claude.ai 在 b7b755b(3-c.1 commit body)後續對話中、把此歷史揭示重新詮釋成「Sean 跨 session 事故描述失準 2 處」(#141 觸發「刀 3-a L17 偏離 ADR-0006」+ #142 觸發「7fa9f42 hash vs ADR-0006 message mismatch」)、**未回 view eb5196e commit body 字面源**、誤判 Sean 字面意思(Sean 描述對齊 eb5196e 歷史快照);寫 3-c.2 指令時把此誤判字面寫進 §2.4 + §3.1 #142 + commit body 揭示要求;Code 在 3-c.2 偵察階段 view eb5196e + b7b755b commit body 揭示 Claude.ai 自身連環誤判、Sean 重發 3-c.2.1 含 §12-30 立法。**屬「Code 事實揭示 → Claude.ai 詮釋失準 → 詮釋失準延續進 slice 指令字面 → Code 二次偵察揭示」連環誤判模式**。

**規則:**
- **Claude.ai 引用「跨 session 對話內容」時、必區分兩類字面:**
  - (a) **對話內當事人原述**(Sean / Code 在對話內當下說的話)
  - (b) **對話內引用既有 commit body / 文件字面**(歷史快照、git 不可變)
  - 不可混為一談、不可把 (b) 引用詮釋成 (a) 失準
- **引用 commit body 內容時必先 `git log --format="%h %s%n%n%b" -1 <hash>` view 字面、不憑印象推**(對齊原則 10「不憑記憶寫具體技術字面」+ 原則 13「規劃稿字面 vs 既有 code 實況交叉檢查」)
- **把 Code「事實揭示」重新詮釋成「對方失準」前、必交叉檢查原始字面源**(commit body / eb5196e 等 anchor 為事實源、Sean 字面引用為 secondary)
- **違反 = 連環誤判**(誤判延續進 slice 指令字面、Code 二次偵察揭示時已造成 1 commit + 1 後續 slice 指令字面污染)
- **enforce:** commit body 內若引用「對方失準」、必同段內列 anchor commit hash + 字面源 grep 結果;違反 = 視為違反鐵則 11

**規範定位:** 鐵則 11「事實 > 字面」+ working-style 原則 10「不憑記憶寫具體技術字面」+ 原則 13「規劃稿字面 vs 既有 code 實況交叉檢查」+ lessons §12-25「跨 session 字面內嵌義務」綜合場景(本條為跨 session 字面引用失準的特殊型態 — 詮釋失準);對齊 working-style §6.3 第 39 條(本條對應)

**教訓來源:** M-1-04 刀 3-c.1 主刀(`b7b755b` commit body 內 Claude.ai 誤判:把 eb5196e commit body 歷史快照重新詮釋成「Sean 跨 session 失準」)+ 3-c.2 指令字面誤判延續(Sean 寫 §2.4 + §3.1 (c) #142 + commit body 揭示要求時延續 b7b755b 誤判字面)、Code 在 3-c.2 偵察階段(本 commit 3-c.2.1 前置 §2.3 (a)(b))view 字面源揭示連環誤判、Sean 重發 3-c.2.1 含 §12-30 立法、本 repo 內生

**跨專案適用:** 適用所有有「commit body 字面揭示制度」+「跨 session 對話協作」的專案(Claude.ai + Claude Code / Cursor + Composer / GitHub Copilot Chat 等跨 session AI 協作場景通用)

**首例:** M-1-04 刀 3-c.2.1 @ 本 commit(§12-30 自身落地驗證:§2.3 (b) view b7b755b commit body 字面為規則 2 自身驗證行為);b7b755b commit body 已 push 不 amend、本 commit body 為對齊鐵則 11 的後續揭示(對齊鐵則 11 字面 vs 事實守則:後續揭示優於 amend 既有 commit history)

---

### 12-31. commit 落地 ≠ apply 落地(Supabase migration 兩階段紀律)

**事故脈絡:**
M-1-05 刀 1 spike(2026-05-12)揭示:repo 內 `supabase/migrations/20260510134708_products_public_view.sql` 已 commit + push 落地、但 dev DB 未 apply、Code 跑 spike 撞 view 不存在 raise;Sean 跑 `supabase db push --include-all` 補 apply 落地後三重驗證(list_migrations / pg_class / information_schema 13 欄)綠、刀 1.5(`e2ac99a`)收工;Claude.ai 規劃刀 1 時憑印象認為「migration commit 落地 = DB 落地」、未區分兩階段、指令字面「驗證 view 已建」未含 apply 步驟、撞 raise 才修正認知。

**規則:**
- **commit 落地 ≠ apply 落地**:Supabase migration 兩階段、commit 進 git ≠ DB 已套用、必明確區分
- **Claude.ai 引用「落地」字面時必區分**:
  - 「commit 落地」= migration SQL 進 git(`git log` 可見)
  - 「apply 落地」= DB 已套用(`supabase migration list` / `information_schema.tables` 可見)
- **slice 指令字面紀律**:涉 view / table / column 行為時、必明示驗證階段(commit-only 還是含 apply);若需 apply 落地、必含 Step「Sean 手動跑 supabase db push」(對齊四方分工、Code 不代跑)
- **commit body 字面紀律**:commit message 寫「新增 X view」時、body 必揭示 apply 狀態(「待 Sean push apply」/「已 apply at <timestamp>」)
- **enforce:** Claude.ai 寫 slice 指令引「migration 已落地」前自檢「指的是 commit 還是 apply?」、不明確即補字面;Code 偵察揭示「commit 落地但 apply 未落」立即 raise multi-select(對齊「事實 > 字面」鐵則 11)

**規範定位:** 對齊 working-style §6.3 第 40 條(本條對應)+ lessons §12-3 維度 A「字面 vs 事實守則」延伸(commit 字面 vs apply 事實)+ CLAUDE.md「Sean 手動跑 push / Code 不代跑」四方分工延伸(手動跑包含 supabase db push)

**教訓來源:** M-1-05 刀 1 spike 撞 migration drift、Sean `supabase db push --include-all` 修法、刀 1.5(`e2ac99a`)收工三重驗證落地、Claude.ai 規劃刀 1 時憑印象「commit 落地 = DB 落地」事故源

**跨專案適用:** 適用所有 Sean 用 Claude Code + Supabase migration 的專案;延伸適用其他兩階段落地(commit-only vs deploy / DB-apply / cache-invalidate)場景

**首例:** M-1-05 刀 1 spike 撞 drift(2026-05-12)+ 刀 1.5(`e2ac99a`)補 apply、本立法 commit 即首例 anchor

---

### 12-32. Claude.ai 不憑印象推 MCP / CLI 工具行為(寫指令引用工具行為前必驗 schema + flag)

**事故脈絡:**
M-1-05 刀 1 spike 補 migration drift 時、Claude.ai 規劃用 Supabase MCP `apply_migration` 工具補套用、未知該工具會用 apply 當下 timestamp(無 version 參數可指定)、若 commit 落地的 migration timestamp 早於 remote 最新、apply 後製造版本倒掛(`20260507222633` apply 在 `20260510134708` 之後);Code 偵察揭示改用 Supabase CLI `supabase db push --include-all`(flag 強制 apply 所有 unapplied migration 而非僅最新)修法。Claude.ai 寫指令引 MCP 工具行為前憑印象、未查工具 schema、未列 flag 行為差異、撞坑才修正認知。

**規則:**
- **寫指令引用 MCP / CLI 工具行為前必驗 schema + flag**:不憑印象推測工具行為、特別是
  - timestamp / version 處理(apply 當下 vs 指定 / 倒掛風險)
  - flag 必要性(`--include-all` / `--all` / `--dry-run` / `--force` 行為差異)
  - 副作用(apply 是否寫 schema_migrations 表 / 是否回填 / 是否破壞性)
- **Claude.ai 寫指令字面前 grep 紀律**:
  - MCP tool list `parameter schema`(Anthropic MCP 規格)
  - CLI `--help` 字面(Code 跑 `<tool> --help` 回報)
  - 工具行為實測:dry-run 確認、不憑文件描述推
- **不憑記憶寫工具 flag / 字面**:即使 Claude.ai 訓練資料含工具文件、版本可能 drift;真權威 = 當下實測 schema + dry-run
- **enforce:** slice 指令引 MCP / CLI 工具具體 flag / behavior 前、Code Step 1 確認字面;Claude.ai 寫指令憑印象 → Code raise multi-select、Sean 拍板再執行(對齊 §12-3 維度 A)

**規範定位:** 對齊 working-style §6.3 第 41 條(本條對應)+ lessons §12-3 維度 A「字面 vs 事實守則」+ §12-25 跨 session 字面內嵌義務延伸(工具行為字面也需內嵌、不假設)

**教訓來源:** M-1-05 刀 1.5 揭示 MCP apply_migration timestamp 倒掛、改用 Supabase CLI `supabase db push --include-all`、Claude.ai 規劃時憑印象推 MCP 工具行為事故源

**跨專案適用:** 適用所有用 MCP / CLI 工具的專案(Supabase / Vercel / GitHub MCP / 第三方 CLI 通用);Phase 2 加 vendor crawler / vehicle-service-ecosystem 時、各 MCP integration 同紀律

**首例:** M-1-05 刀 1.5(`e2ac99a`)補 apply 修法事故源、本立法 commit 即首例 anchor

---

### 12-33. Claude.ai 寫指令字面前必先 grep callsite 真權威(投射欄位 / type 簽名 / 既有 method 字面)

**事故脈絡:**
M-1-05 刀 2 Sub-slice 2-3(commit `650279a`、2026-05-16)規劃階段:Claude.ai 指令字面預設「SupabaseProductAdapter 5 read method 拆 DETAIL + LIST 兩 const + mapper 分流 detail/list、分別還原 domain Product」、未 grep callsite 真實投射欄位事實(products_list_public 9 欄 vs domain Product 完整欄位差);Code 落地撞 products_list_public 缺 description / images / created_at / updated_at、單一 mapSupabaseProductToDomain 還原不出完整 domain Product、raise Option A multi-select(全 5 read method 改讀 products_public detail view、products_list_public 暫不接線留 list-projection slice);Sean 拍 A、本 sub-slice 收斂為單一 detail 投射 + 單一 mapper、不建 PRODUCT_SELECT_LIST 避免 dead code。Claude.ai 規劃時憑「list view 投射欄位夠用」印象、未 grep callsite 真權威。

**規則:**
- 寫指令字面涉「mapper 拆分 / 投射欄位列舉 / type 簽名 / 既有 method 字面」前必 grep callsite 真權威:
  - mapper 簽名 / domain type 完整欄位(`packages/domain/src/catalog/types.ts`)
  - DB view / table 投射欄位(`supabase/migrations/*.sql` 字面 / `information_schema.columns`)
  - 既有 method 字面(adapter / use-case / port contract 字面)
- 不憑「概念上應該夠用」印象推:投射欄位 / type 簽名 / 既有 method 簽名屬具體技術細節、必字面驗(對齊 lessons §12-3 維度 A)
- callsite 真權威 grep 三層:
  - 第一層 domain / port:`packages/domain/src/**/types.ts` + `packages/ports/src/I*.ts`
  - 第二層 DB:`supabase/migrations/*.sql` view DDL 字面 + base table schema 字面
  - 第三層 adapter / use-case:既有 method 簽名 + mapper 簽名字面(grep `map.*ToDomain` / `map.*ToSupabase`)
- **enforce:** Claude.ai 寫涉 mapper 拆 / 投射欄位 / type 簽名指令字面前自檢「三層 callsite 已 grep?」、未 grep → 必標 `<待 Code 字面確認>` 占位、不寫死;違反 = Code raise multi-select、Sean 拍板再執行

**規範定位:** 對齊 working-style §6.3 第 42 條(本條對應)+ lessons §12-3 維度 A「具體技術細節字面真權威」延伸(投射欄位 / type 簽名 / 既有 method 字面為其中三類)+ §12-25 跨 session 字面內嵌義務(callsite 字面為「不靠記憶」核心應用)

**教訓來源:** M-1-05 刀 2 Sub-slice 2-3 拍板拆 mapper / 落地撞 products_list_public 缺欄事故源、Option A 全 5 read method 收斂 detail view 修法、Claude.ai 規劃憑「list view 投射欄位夠用」印象未 grep callsite 事故源

**跨專案適用:** 適用所有 Sean 用 Claude Code 開發的專案(callsite 真權威 grep 紀律跨專案通用、不限 Supabase / Prisma / TypeORM);Phase 2 vehicle-service-ecosystem adapter 落地時、各 adapter mapper / 投射欄位字面同紀律

**首例:** M-1-05 刀 2 Sub-slice 2-3(`650279a`)Option A 收斂事故源、本立法 commit 即首例 anchor

---

### 12-34. Claude.ai 寫「working-style / lessons / ADR / backlog 條目」字面前必 view 末條編號

**事故脈絡:**
M-1-05 刀 3-a(commit `f8271aa`、2026-05-16)規劃階段:Claude.ai 指令字面寫「working-style §6.3 第 40 + 41 條對應」、實況 §6.3 末條為第 39 條、刀 3-a 補 40 + 41 為正確編號、無 raise;但 Claude.ai 字面寫前憑印象推「上次落地到 39」、未 grep view §6.3 真實末條編號(`grep "^**第" docs/working-style.md | tail -3`)、本次推對 = 僥倖。同類風險:lessons §12-N 子節編號 / ADR-N 編號 / backlog #N 條目編號、若 Claude.ai 寫立法字面前憑印象推下一條編號、推錯 = 編號倒置 / 跳號 / 重複(已 §12-11 立規則編號區分、但「寫條前 view 末條編號」工序未明文)。

**規則:**
- Claude.ai 寫「立法新條」字面前必 view 末條編號:
  - working-style §6.3:`grep "^**第" docs/working-style.md | tail -3` 拿末三條編號
  - lessons §12:`grep "^### 12-" docs/lessons-learned.md | tail -3` 拿末三節編號
  - ADR:`ls docs/decisions/` 拿最大編號
  - backlog #N:`grep "^### #" docs/phase-1-backlog.md | tail -3` 拿末三條編號
- 不憑「上次落地到 N、下次 N+1」印象推:跨 session 期間可能有其他 slice 落地中間編號、編號倒置 / 跳號 / 重複風險(對齊 §12-11 規則編號區分立規則精神延伸)
- 立法字面內引「對應條」編號時必同樣 grep view 驗:例「對應 working-style §6.3 第 N 條」字面、必 grep 該條真存在
- **enforce:** Claude.ai 寫立法字面前自檢「末條編號已 view?」、未 view → 標 `<待 Code view 確認末條編號>` 占位、不寫死;違反 = Code raise multi-select、Sean 拍板再寫

**規範定位:** 對齊 working-style §6.3 第 43 條(本條對應)+ §12-11 規則編號區分立規則延伸(「區分編號 source」+「view 末條編號」雙工序、區分後仍需 view 才不踩跳號)+ lessons §12-3 維度 A「不憑記憶寫具體技術字面」延伸(編號為其中一類)

**教訓來源:** M-1-05 刀 3-a 規劃憑印象推「第 40 + 41 條」、本次推對僥倖、揭示「寫條前 view 末條編號」工序未明文事故源

**跨專案適用:** 適用所有有「編號制立法 / 條目系統」的專案(lessons / ADR / RFC / backlog / patterns 等通用)

**首例:** M-1-05 刀 3-a(`f8271aa`)「working-style §6.3 第 40 + 41 條對應」字面(刀 3-a 規劃時 §6.3 末條為第 39 條、補 40 + 41 為正確、惟 Claude.ai 憑印象推未 grep view)、本立法 commit 為首例 anchor;刀 3-b 自身落地驗證 = 寫本條前 grep view §6.3 末條為第 41 條(刀 3-a 已補 40 / 41)、確認本刀補 42 / 43 / 44 為正確編號、§12-34 規則自身落地驗證一次

---

### 12-35. Claude.ai 列 multi-select 跨選項字面格式 / 詳簡度 / 三視角描述必統一

**事故脈絡:**
本條為「**立規型**」— 規則本身可立、惟具體事故脈絡無 git 可查實據、透明標明(對齊既有 §12-27 立規型先例)。M-1-05 刀 2 Sub-slice 2-3(commit `650279a`、2026-05-16)有 Code raise + Sean multi-select 拍板(`650279a` commit body 可證「Option A(本 slice 執行中 Code raise + Sean multi-select 拍板)」+ Option A 收斂結果);Claude.ai 規劃端回報「列 Option A / B / C multi-select 時跨選項字面格式 / 詳簡度 / 三視角描述深度不一致、Sean 拍板需多輪比對」、惟該不一致細節屬對話層、commit body 與 STATUS 變更紀錄皆只記「Option A 拍板」結果、非 git 可 grep 之具體事故。刀 3-b 偵察階段 Code grep `650279a` body 揭示此點、Sean 拍板採立規型框架 — 規則照立、事故脈絡誠實標明「multi-select 拍板確曾發生、跨選項一致性為預防性立規、具體不一致無 git 痕跡」。

**規則:**
- Claude.ai 列 multi-select 跨選項字面必統一以下三層:
  - 格式層:選項標題 / 描述段落數 / 列舉項數量 / 字面術語(同題內不混用「投射欄位」/「列出欄位」/「query 字段」三種說法、固定一個)
  - 詳簡度層:跨選項描述長度相當(不容 Option A 詳述、Option B 一句話帶過)
  - 三視角層:跨選項三視角(擴充性 / 可維護性 / bug 可追蹤性)描述深度相當、每選項三視角各一句、不缺(回答原則 4 強制「每個選項附三視角推薦理由」)
- 不統一徵兆:Sean 拍板需多輪「比對」/「對齊」/ Code raise multi-select「哪選項對應實況」、即屬跨選項字面不一致
- **enforce:** Claude.ai 列多選項字面後自檢「跨選項格式 / 詳簡度 / 三視角是否統一?」、不統一即重寫;違反 = Code raise multi-select 列「跨選項字面格式不一致清單」、Sean 拍板修正字面後再執行

**規範定位:** 對齊 working-style §6.3 第 44 條(本條對應)+ 回答原則 4「涉及選擇用 multi-select 選項(2-4 個)、每個選項附三視角推薦理由」延伸(強制三視角為其中一層、本條補「跨選項格式 / 詳簡度統一」雙層)+ lessons §12-27 立規型先例(本條同採立規型框架、透明標明事故脈絡無 git 實據)

**教訓來源:** M-1-05 刀 2 Sub-slice 2-3(`650279a`)multi-select 拍板(commit body 可證 Option A 收斂結果);Claude.ai 規劃端回報「Option A / B / C 跨選項字面格式 / 詳簡度 / 三視角不一致」、惟具體不一致細節屬對話層、非 git 可 grep — 屬「立規型」(對齊 §12-27)、規則可立而具體事故無 git 痕跡、刀 3-b 偵察 Code grep `650279a` body 揭示後 Sean 拍板採立規型框架

**跨專案適用:** 適用所有 Sean + Claude.ai 用 multi-select 拍板協作的專案(回答原則 4 跨專案統一)

**首例:** 本立法 commit 即立規(立規型、無 git 可查事故首例);M-1-05 刀 2 Sub-slice 2-3(`650279a`)multi-select 拍板為相關非直接錨點(commit body 可證拍板發生、不證跨選項不一致細節)

---

### 12-36. Claude.ai 寫立法字面前必 view 既有條目格式真權威(模板 / bullet 結構 / 段落 marker)

**事故脈絡:**
M-1-06 a11y polish slice(2026-05-17、commit `61d7fc0` amend 補入)累積 4 處「指令字面 vs 既有 code 實況交叉檢查不足」事故(回答原則 13 violation):(1) Step 2 CSS 副作用評估事實錯誤 — slice 字面寫「4 條 placeholder 全在 `.ed-footer-cols` 容器」、實況 social 3 條在 `.ed-footer-social`、僅聯絡客服 1 條在 `.ed-footer-cols`、Sean Q7 = 選項 1 拍板補齊 CSS 動 3 處;(2) backlog #135「9 處 arrow」範圍預估 — slice 偵察 grep pattern 僅命中 8 處、ed-finder-go-arrow(VehicleFinder L66 button 內裝飾)未命中、Sean Q4 = A 拍板補入湊足 9;(3) M-1-06-amend Step 1 grep pattern 自身命中 0(meta 第 1 印證)— slice grep `^### §12-` 命中 0、lessons §12 實際標題格式 `### 12-N.` 不帶 `§`;(4) M-1-06-amend Step 2 立法字面結構錯誤(meta 第 2 印證、本條直接事故)— Claude.ai 寫 §12-36 / 第 45 條字面用 7 段 prose 格式、未 view §12-33/34/35 + 第 42/43/44 真實 6 段模板 / bullet 結構、屬同族「憑記憶推結構」、Code raise Q9 multi-select、Sean Q9 = C 拍板 Claude.ai view 真權威後重寫、本條 §12-36 自身誕生符合本條規則。事件累積 8+ 次跨歷史同族(回答原則 10 + 13 同族:CSS 選擇器 / grep pattern / 表格結構 / commit 字面 / view 字面 / 立法模板 ...)、依 working-style §6.3「7+ 次必立法」enforce。

**規則:**
- Claude.ai 寫「立法新條」字面前必 view 既有條目格式真權威:
  - lessons §12 末三條完整字面:`view docs/lessons-learned.md` 範圍涵蓋 §12-(N-2) 至 §12-N 條尾(確認模板結構穩定性、非單條看)
  - working-style §6.3 末三條完整字面:`view docs/working-style.md` 範圍涵蓋 第 (M-2) 至 第 M 條條尾
  - ADR 末條完整字面:`view docs/decisions/000N-*.md`(確認段落 marker / Status 風格)
  - backlog 末條完整字面:`view docs/phase-1-backlog.md` 末條條尾
- view 範圍含「條尾 marker」(下一條起始 / 章節分隔 / 檔尾):確認新條插入點精確
- view 後 verbatim 比對立法字面:6 段模板(lessons)/ bullet 結構(working-style)/ 段落 marker(`**N:**` 同行 vs 換行)/ 條間 marker(`---` 或空行)— 任一不對齊即重寫
- 不憑「上次落地是 6 段」/「印象中是 bullet」推:跨 session 期間既有條目格式可能微調、必字面驗
- 立法字面內引「跨檔對應條」(例 lessons §12-N ↔ working-style 第 M 條)時、必雙向 view 驗對應存在
- **enforce:** Claude.ai 寫立法字面前自檢「既有末三條模板已 view?」、未 view → 標 `<待 Code view 確認模板>` 占位、不寫死;違反 = Code raise multi-select、Sean 拍板採 C 路線(Claude.ai 重寫、不允 B 路線 Code 代排、守四方分工)

**規範定位:** 對齊 working-style §6.3 第 45 條(本條對應)+ lessons §12-34 「寫立法字面前必 view 末條編號」延伸(§12-34 立「編號」/ §12-36 立「結構模板」、兩條合構成「立法字面前 view 完整工序」)+ lessons §12-33 「callsite 真權威 grep」立法 doc 域對應(§12-33 立 code 域 / §12-36 立 docs 立法域、雙域同精神)+ 四方分工「Claude.ai 立法主筆權」守護(C 路線 enforce、不允 B 路線越界)

**教訓來源:** M-1-06 a11y polish slice(`61d7fc0` amend)4 處同族事故累積源:CSS 評估容器結構誤判 / 9 處 arrow grep pattern 範圍不足 / amend slice grep pattern 命中 0 meta / amend Step 2 立法字面 7 段 prose 結構錯誤 meta。本條 §12-36 自身誕生過程(Code raise Q9 → Sean Q9 = C → Claude.ai view 六條真權威字面 → verbatim 比對 6 段模板 + bullet 重寫)即本條規則完整工序執行驗證一次

**跨專案適用:** 適用所有有「編號制立法 + 模板格式」的專案(lessons / ADR / RFC / patterns / backlog 等通用、不限 PCM);Phase 2 vehicle-service-ecosystem 立 ADR / patterns / 領域 lessons 時同紀律

**首例:** M-1-06 a11y polish slice amend(`61d7fc0` → 新 hash)4 處同族事故源、本立法 commit 即首例 anchor;本條 §12-36 自身落地驗證 = Code raise Q9 → Sean Q9 = C → Claude.ai view §12-33/34/35 + 第 42/43/44 真權威字面後重寫、6 段模板 + bullet 結構 verbatim 對齊、§12-36 規則自身落地驗證一次(對齊 §12-34 刀 3-b 自身落地驗證先例)

---

### 12-37. Cowork 引偵察報告字面寫拍板題前必交叉檢查 design-reference 既有實作 + storefront 既有實作雙端字面

**事故脈絡:**
M-1-13H 商品頁全面改版 plan 階段(2026-05-21、本 PRD `docs/specs/M-1-13H-product-page-overhaul-plan.md` commit slice-doc chore TBD 落地後)、Cowork 寫 Q4 拍板題給 Sean 拍板「Related grid 與 ProductCard」、Q4 raise 字面建立在 Code 偵察報告(`docs/recon/M-1-13H-product-page-recon-2026-05-21.md`)§9.4 風險點 #6「`<ProductCard>` 保留可能視覺斷層」+ HANDOFF #16 字面「保留 ProductCard 不要改它」、假設「ProductCard 是舊版、跟新版商品頁不協調」、給 Sean 4 個選項(其中 B「分階段:Sean 之後在 Claude Design 端產出新版 ProductCard」)。Sean 質疑「我印象有把 design 新檔案跟 handoff 不是交給你了、這次整個流程就是去把商品卡部分對應上去而已、為何有這麼多疑問?」、Cowork 立即 bash grep design-reference 實況查證、5 處字面確認 Sean 對:(1) `design-reference/components/ProductCard.jsx` 6397 bytes 存在、L1「editorial · hover-swap images」、是 design 已產出的新版設計;(2) `design-reference/styles/product-card.css` 存在 213 行;(3) `apps/storefront/src/components/ProductCard.tsx` L4 註解「字面從 design-reference/components/ProductCard.jsx @ 25d3a2a 直接搬」(M-1-04 mini-slice 已搬完成);(4) design-reference 內 HomePage.jsx / ProductPage.jsx / Pages.jsx / ProductsPage.jsx 4 處 import ProductCard、是跨頁正式元件;(5) VariantCFull L219-230 `.vcf-related-card` hardcoded = demo 平面 jsx 寫法(demo 自包含不 import 真元件)、不取代正式 ProductCard 元件;根因:Cowork 引偵察報告字面寫拍板題前、未交叉檢查 design ProductCard.jsx + storefront ProductCard.tsx 雙端字面;NORTHSTAR §2.4「.jsx + .css 字面 > HANDOFF docs」優先級在 demo 變體場景反向應用、Cowork 應辨識「demo 平面 jsx 是 demo 寫法、不是真權威」;累計第三次同族違反(對齊 §12-30 + §12-33)、依 working-style §6.3「3+ 次同族即立法」enforce 觸發語規範。

**規則:**
- Cowork 引用 Code 偵察報告字面寫拍板題前必交叉檢查雙端字面:
  - design-reference 既有元件字面:`grep -rn "{ComponentName}" design-reference/` 確認元件 .jsx + .css 是否已存在
  - storefront 既有實作字面:`grep -rn "{ComponentName}" apps/storefront/src/` 確認是否已搬、commit body 註解「字面從 design @ {hash} 直接搬」歷史
- 不假設「現狀不協調」、不基於偵察報告風險點推「需 Sean 補新版設計」、必先 grep design-reference 既有元件實況
- 辨識 demo 變體字面(VariantCFull 等 explorations)vs design 正式元件字面(ProductCard.jsx / ProductPage.jsx 等):
  - demo 變體內的 hardcoded 寫法 = demo 平面 jsx 自包含、**不取代正式元件 import**
  - 正式元件 .jsx + .css 字面 = 真權威、用 import 引用、不複製 hardcoded
- NORTHSTAR §2.4「.jsx + .css 字面 > HANDOFF docs」優先級補丁:demo 變體場景下、demo .jsx 字面非真權威、HANDOFF docs 字面反為「保留正式元件」實質指引
- **enforce:** Cowork 寫拍板題 raise 字面涉及「需 Sean 補設計」/「現狀不協調」前自檢「design-reference 對應元件實況已 grep?」+「storefront 對應實作實況已 grep?」、雙端未 grep → 改寫為「Cowork 待 grep 後確認」、不拋給 Sean 不必要拍板;違反 = Sean 質疑、Cowork 立即實況查證 + 認錯 + 寫 lessons

**規範定位:** 對齊 lessons §12-13(規劃稿字面 vs 既有 code 實況交叉檢查)+ §12-14(跨層設計意圖串接檢查)同族延伸 + §12-30(Claude.ai 不可把 Code 在 commit body 揭示的歷史快照重新詮釋成「對方失準」、必先 view commit body 字面)+ §12-33(Claude.ai 寫指令字面前必先 grep callsite 真權威)雙錨點 + NORTHSTAR §2.4「.jsx + .css 字面 > HANDOFF docs」優先級在 demo 變體場景反向應用紀律補丁(本條新立 demo 變體辨識規矩)+ working-style §6.3 對應條(待新增、本立法時補)

**教訓來源:** 2026-05-21 M-1-13H plan 階段、Cowork 寫 Q4 拍板題給 Sean、Q4 raise 建立在偵察報告風險點 #6 + HANDOFF #16 字面、假設 ProductCard 是舊版;Sean 質疑「印象交付 design 新檔 + handoff、流程就是把商品卡對應上去」;Cowork 立即 bash grep 實況查證、5 處字面確認:(1) design ProductCard.jsx 存在新版設計、(2) css 存在、(3) storefront 已搬完(M-1-04 commit body 註解)、(4) 4 處 import 確認跨頁正式元件、(5) VariantCFull `.vcf-related-card` 是 demo 寫法;本條 §12-37 自身誕生過程符合本條規則(實況查證 + 認錯 + 寫 lessons)

**跨專案適用:** 適用所有「Cowork(規劃層)+ Code(偵察層)+ design-reference(視覺真權威)三層協作」的專案;Phase 2 vehicle-service-ecosystem 啟動時、相同模式 grep design-reference 既有 + storefront 既有雙端字面;適用所有「demo 變體 vs 正式元件」辨識場景(不限 VariantCFull、Phase 2 可能還有 VariantD/E/F 等 demo 變體)

**首例:** 2026-05-21 M-1-13H plan 階段對話、Sean 質疑 Q4 raise 錯誤;Cowork bash grep design-reference + apps/storefront/src 5 處字面實況查證、確認 Sean 對、自我糾正;本條 §12-37 自身落地驗證 = Cowork 實況查證 + Sean 確認 + 寫 PRD `docs/specs/M-1-13H-product-page-overhaul-plan.md` + 寫 lessons §12-37;commit slice-doc chore TBD 落地後即首例 anchor

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
