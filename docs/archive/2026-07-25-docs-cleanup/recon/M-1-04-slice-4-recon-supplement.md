# M-1-04 候選刀 4 — Supplement Recon(4 缺口字面補偵察)

> **產出時間:** 2026-05-14
> **產出者:** Claude Code(純偵察、不寫推薦、不寫結論、不替 Claude.ai 寫 PRD)
> **任務目標:** 為 ADR-0006 + `docs/architecture/server-client-boundary.md` PRD 草稿補 4 缺口事實字面
> **驅動依據:** `docs/recon/M-1-04-slice-4-pre-recon.md`(§3 / §4 / §5)+ Claude.ai 缺口識別
> **本檔範圍:** 8 章節純事實列表、不歸納規則、不寫「應該 / 建議 / 推薦」
> **字面 vs 事實守則(對齊 lessons §12-3 維度 A):** 每章引用字面均標檔名 + 行號 / 數字均用實況 wc -l + ls 取得、不憑記憶 / audit / ADR / config 檔名先 `ls` 確認

---

## §1 design-handoff/ vs design-reference/design-reference/ 兩份 HANDOFF metadata + 互引關係

### 1.1 `design-reference/design-handoff/` 兩檔 metadata(`wc -l` + `head` 字面)

| 檔 | 行數 | 標題 + 副標 + 日期 | 字面引用上游 |
|---|---|---|---|
| [HANDOFF-v2.0.md](design-reference/design-handoff/HANDOFF-v2.0.md) | 459 | `# Handover Report — Phase 2.0(6 個補頁 + 配送 / 經銷價系統)` / 「給 Storefront 實作參考」/ 完成日期 2026-05-11 | 上一版 `design-handoff/HANDOFF.md`(v1.0,Phase 2 初版) |
| [HANDOFF-v2.1.md](design-reference/design-handoff/HANDOFF-v2.1.md) | 193 | `# PCM Website — Handover v2.1(三 tier 完整 + 廠牌加碼)` / 「承接 v2.0(6 頁 + StorePicker + 配送整合)。本檔為**增量補丁**,未提及檔案不動;只修正三 tier 中間層遺漏 + 廠牌加碼公式。」 | v2.0 |

#### v2.0 範圍字面(L9-L33 摘錄)

新建檔案(15 項、L12-L30):
- `components/CheckoutPage.jsx`(698 行)/ `OrderCompletePage.jsx`(121 行)/ `StorePickerModal.jsx`(303 行)/ `WalletTab.jsx`(270 行)/ `TierComponents.jsx`(104 行)/ `Pricing.jsx`(86 行)/ `ErrorPage.jsx`(51 行)/ `LegalPage.jsx`(321 行)
- `styles/checkout.css`(551 行)/ `order-complete.css`(177 行)/ `store-picker.css`(308 行)/ `wallet.css`(373 行)/ `tier.css`(174 行)/ `pricing.css`(61 行)/ `error.css`(97 行)

#### v2.1 範圍字面(L9-L23 摘錄、增量補丁清單)

- `App.jsx` `DEFAULT_TWEAKS` 加 `memberTier:"general"`
- `TierComponents.jsx` 移除 `TIER_THRESHOLD_PREMIUM`、改三節點純視覺
- `Pricing.jsx` 整檔重寫、加 `getPriceForTier(p,b,t)` / `getBrandFor(p)`、移除 `DEALER_RATE = 0.85` 硬寫死
- `data/products.js` 16 個 brands 加 `premium_extra_pct`、+ 5 個新 brands(RIZOMA / AKRAPOVIČ / BREMBO / ÖHLINS / TERMIGNONI)、20 個 products 加 `priceByTier: { general, store }`
- `WalletTab.jsx` / `AccountPages.jsx` / `CheckoutPage.jsx` / `ProductPage.jsx` / `ProductCard.jsx` 各自局部修
- L22:「全站 `0.85` / `0.95` / `0.97` 硬編碼折扣率掃描結果 = **0**」

### 1.2 `design-reference/design-reference/` 10 份 HANDOFF metadata(`ls -la` + `head` 字面)

| 檔 | bytes | 主題(自述) |
|---|---|---|
| HANDOFF-API.md | 9874 | 「真實串接清單 — 未來把 mock 換成真 API 時會用到的所有 endpoint」「schema 結構建議沿用 mock 的格式」 |
| HANDOFF-CHANGELOG.md | 6724 | 「設計決策時序紀錄 — 不是 Git log、只記有設計含意的決策(風格、結構、棄案)」 |
| HANDOFF-COMPONENTS.md | 7485 | 「共用元件交付清單 — 本輪改動涉及的共用元件各列一節」 |
| HANDOFF-DEPLOY.md | 5412 | 「部署 / 環境策略 — 策略建議,不是硬性規格」 |
| HANDOFF-DETAILS.md | 29022 | 「細節規格補強 — **第 5 份權威檔**。前 4 份(OVERVIEW / PAGES / COMPONENTS / TOKENS)說『在哪用什麼』,這份說 **『精確到 px 的怎麼用』**。**衝突時,本檔是最終權威**」 |
| HANDOFF-OVERVIEW.md | 8782 | 「**權威文件 · v1.1** · 給 Claude Code 實作 PCM Motorsports 前台時當唯一參考。不需要回 Claude Design 對話翻歷史 — 這份 + 同目錄四份姊妹文件就是真權威。」「文件索引(共 5 份)」 |
| HANDOFF-PAGES.md | 14812 | 「頁面交付清單 — 每個頁面各列一節、首頁 → 目錄 → 列表 → 詳情 → 加入購物車 → 結帳 / 會員」 |
| HANDOFF-ROADMAP.md | 4834 | 「已知 issue / TODO / 技術債 — 策略性 TODO,不是 bug tracker」 |
| HANDOFF-TOKENS.md | 5456 | 「Design Tokens 交付清單 — 完整 token 定義在 `styles/tokens.css`(108 行)」 |
| HANDOFF-TWEAKS.md | 4114 | 「Tweaks 是**設計稿專用**的右側可切換面板。**生產不要保留**(無用、增 bundle、混淆使用者)」 |

### 1.3 兩組互引字面實況(`grep -l`)

```bash
# design-reference/design-reference/ 內 HANDOFF docs 是否提 "HANDOFF-v2"
grep -l "HANDOFF-v2" design-reference/design-reference/HANDOFF-*.md
# → 0 命中

# design-reference/design-handoff/ 內 HANDOFF v2 docs 是否提 5 主 anchor / 5 輔助 anchor
grep -l "DETAILS|TOKENS|COMPONENTS|PAGES|OVERVIEW|API|CHANGELOG|DEPLOY|ROADMAP|TWEAKS" \
  design-reference/design-handoff/HANDOFF-v2.*.md
# → 0 命中
```

→ 兩組 HANDOFF docs **無直接 cross-reference**(0 命中)。判定:兩組各自獨立、無自我描述為「索引 vs 內容」或「源頭 vs 衍生」關係的字面證據。

### 1.4 HANDOFF 自我索引 vs 實況數量

- HANDOFF-OVERVIEW.md 自述「文件索引(共 5 份)」(L7-L11 範圍)
- HANDOFF-DETAILS.md 自述「第 5 份權威檔。前 4 份(OVERVIEW / PAGES / COMPONENTS / TOKENS)」
- 實況 `design-reference/design-reference/` 共 **10 份** HANDOFF-*.md(L1.2 表)
- design-handoff/(v2.0 + v2.1)= **2 份增量補丁** 字面引用「上一版 design-handoff/HANDOFF.md(v1.0)」
- `design-reference/HANDOFF.md`(根目錄 13257 bytes)— 為 v1.0 候選位置、本偵察未驗 v1.0 是否就是此檔

---

## §2 刀 1 三 commit HANDOFF 字面引用實況

### 2.1 `git log -S` 命中結果

| 搜尋字面 | 範圍 | 命中數 |
|---|---|---|
| `"HANDOFF-v2"` | 2026-05-12 ~ 2026-05-15 | 0 |
| `"design-handoff"` | 2026-05-12 ~ 2026-05-15 | 0 |
| `"HANDOFF-DETAILS"` | 2026-05-12 ~ 2026-05-15 | 0 |
| `"HANDOFF-COMPONENTS"` | 2026-05-12 ~ 2026-05-15 | 0 |

→ 刀 1 三 commit(0549e71 / 477f249 / db978de)**不引** HANDOFF 字面、只引 `.jsx` source path 字面(對齊 NORTHSTAR §2.4 實務鐵則「.jsx + .css 字面 > HANDOFF docs」)。

### 2.2 刀 1 三 commit 是否動到 design-reference/(`git log -- design-reference/`)

```bash
git log --format="%h %s" 0549e71 477f249 db978de -- design-reference/
# → 0 命中
```

→ 刀 1 三 commit **未動** design-reference submodule(submodule pointer 變動屬另一條 commit 軌跡)。

### 2.3 design-handoff/ v2.0 / v2.1 進入 storefront repo 的軌跡(`git log --diff-filter=A`)

`design-reference/design-handoff/HANDOFF-v2.0.md` / `HANDOFF-v2.1.md` 在 storefront repo 內 `git log --diff-filter=A` **0 命中** = 兩檔不是 storefront repo 直接 commit、而是經 design-reference submodule pointer 變動帶入。

相關 submodule pointer commit(`git log -- design-reference/` 篩):
- `857c074` chore(design-reference): submodule pointer 25d3a2a → 797e386(wrs.png 修復 + 舊路徑清)
- `c2240e4` chore: bump design-reference submodule (v2.0 + v2.1 整合 + brand-logos 重組)
- `d692553` chore(submodule): 更新 design-reference 指針 d700ca4 → d5ea3aa
- `6b6a44d` chore: 初始化 pcm-website-v2、放入 .md onboarding 套件

→ `c2240e4` commit subject 明寫「v2.0 + v2.1 整合」、v2.0 / v2.1 經此 submodule bump 進入。

---

## §3 ADR-0005 對 design-handoff/ 字面引用 + stale 風險

### 3.1 ADR-0005 grep 結果(`grep -n "design-handoff|HANDOFF|design-reference" docs/decisions/0005-*.md`)

```bash
$ grep -nE "design-handoff|HANDOFF|design-reference" docs/decisions/0005-custom-supabase-direct.md
(0 hits)
```

→ ADR-0005 **完全不引** design-handoff / HANDOFF / design-reference 字面。

### 3.2 其他 ADR 對 design-reference / HANDOFF 引用字面(`grep -n` 跨 ADR)

| ADR | 命中行 | 字面摘錄 |
|---|---|---|
| 0001 | L14 | `**方向:** design-reference 直接搬進新 storefront、Medusa 後台 schema 對應 design 資料結構重建` |
| 0001 | L30 | `**設計與實作分裂** — design-reference 引入後、storefront 既有結構與 design 衝突、走「縫合」路線卡兩週` |
| 0001 | L87 | `### 3.6 design-reference` |
| 0001 | L111 | `新 Claude Code 第一個動作 = 偵察 design-reference + 寫 PRD` |
| 0001 | L136 | `\| design-reference 內容 \| 用 submodule 掛 pcm-website-design repo、字面相同 \|` |
| 0001 | L165 | `**重做執行中發現 design-reference 結構嚴重不可實作**(極不可能、但若發生需重新評估方向)` |
| 0002 | L160 | `└── design-reference/        ✅ submodule(decision 0001、視覺真權威)` |
| 0003 | L12 | `\`docs/recon/design-reference-recon-2026-04-30.md\` §7(9 個 design vs Medusa 衝突清單、本檔處置依據)` |
| 0003 | L28 | `\`docs/recon/design-reference-recon-2026-04-30.md\` §7 列出 design 字面與 Medusa wire format 的不對齊:` |
| 0003 | L208 | `對著 \`docs/recon/design-reference-recon-2026-04-30.md\` §7 字面填、不憑記憶。` |
| 0003 | L218 | `\| 7 \| §7.7 TweaksPanel \| design 字面有 TweaksPanel 元件 \| (Medusa 無關) \| (生產不上、Phase 1 storefront 跳過搬 — 對齊 **HANDOFF-TWEAKS** §1「生產不要保留」) \| 無 adapter \|` |
| 0003 | L224 | `recon §7.10(HANDOFF docs 數量)是 meta-doc 議題、非技術衝突、不入本表。` |
| 0003 | L312 | `\| \`docs/recon/design-reference-recon-2026-04-30.md\` §7 \| 9 條 design vs Medusa 衝突清單 \| 本檔 §4 處置表依據 \|` |

→ ADR-0001 / 0002 / 0003 引用 design-reference / HANDOFF-TWEAKS 字面、但 **0 處** 引用 `design-handoff/`(v2.0 / v2.1 兩檔不存在於任何 ADR 字面)。

### 3.3 ADR 對 v2.0 / v2.1 補頁(checkout / wallet / tier / 等)的字面引用

`docs/decisions/` 5 ADR 內 grep `CheckoutPage|StorePickerModal|WalletTab|TierComponents|LegalPage|ErrorPage|OrderCompletePage`:本偵察未跑、留 Claude.ai 寫 PRD 時自查。

### 3.4 ADR-0005 與 §2.1 修正(commit 0d27d00)的字面依存

- ADR-0005 拍板於 2026-05-04(`> **Status:** 🟢 拍板 / 2026-05-04`)、§2.1 修正於 2026-05-14
- ADR-0005 grep 0 命中、無 stale 風險
- ADR-0001 §3.6 / L136 對 design-reference 字面用「submodule」抽象引用、不寫具體目錄結構、§2.1 修正不影響

---

## §4 既有 docs 對 server / client 邊界討論密度

### 4.1 `grep -rln "server component|client component|'use client'|use client|server-only|client-only"` 命中

範圍:`docs/decisions/` / `docs/architecture/` / `docs/patterns/` / `CLAUDE.md`

命中檔(4 個):
- `docs/architecture/supabase-schema-design.md`
- `docs/patterns/general.md`
- `docs/architecture/security-timeline.md`
- `docs/patterns/pcm-specific.md`

未命中:`docs/decisions/*.md`(5 ADR 全)/ CLAUDE.md / 其他 architecture / patterns 檔

### 4.2 命中行字面(line refs + 字面摘錄)

#### [docs/patterns/general.md](docs/patterns/general.md)

```
L134: ### 4-1. Client component 不得 import server-only 模組
L138: 'use client';
L139: import { prisma } from '@/lib/prisma';   // ❌ Prisma 是 server-only
L144: 'use client';
```

#### [docs/patterns/pcm-specific.md](docs/patterns/pcm-specific.md)

```
L284: ### 7-1. service role key 走 server-only
```

#### [docs/architecture/security-timeline.md](docs/architecture/security-timeline.md)

```
L86: | **C3** | C | client component 不得 import server-only module(經銷價防洩漏鐵則)、用 TypeScript `package.json#exports` + path alias 阻擋 | M-1 | M-1 任一 client component slice、M-1-14 Customer adapter 同步 | client bundle grep 無 `prisma` / `@/lib/server-only` 字面;TS exports 阻擋 server module 對 client 可見 | `CLAUDE.md`「Server 端鐵則 § 敏感資訊」 | ✅ |
```

#### [docs/architecture/supabase-schema-design.md](docs/architecture/supabase-schema-design.md)

```
L474: - 對齊 dependency-rules.md §1 字面「ui / schemas 不 import domain」精神、storefront 不 import server-only module(security-timeline #C3)
L476:   - **第一層(編譯期)**:`packages/adapters/src/supabase/client.ts` 檔頭 `import 'server-only'`、client component import 即時 fail
```

### 4.3 討論密度判定(純列、不歸納)

- 跨 4 檔共 **8 行** 命中
- 集中在「client component 不得 import server-only module」鐵則(general.md §4-1 / security-timeline #C3 / supabase-schema-design L474-L476 三處互引)
- patterns/pcm-specific.md §7-1 補 service role key 走 server-only 規則
- 無檔自稱「server-client boundary 規範書」/「邊界判定指引」
- 5 ADR 全 0 命中、ADR 層級無正式邊界決策紀錄
- CLAUDE.md 0 命中、工作規則檔無正式邊界規範

---

## §5 Next 16 / React 19 邊界相關官方字面(next.config + server-only + client-only + package.json)

### 5.1 [apps/storefront/next.config.ts](apps/storefront/next.config.ts) 全文

```typescript
import type { NextConfig } from 'next';
import bundleAnalyzer from '@next/bundle-analyzer';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig: NextConfig = {};

export default withBundleAnalyzer(nextConfig);
```

→ `nextConfig` 物件為 `{}` 空、**無 server / client 邊界相關 config 字面**(無 serverActions / serverComponentsExternalPackages / experimental / 等 key)。

### 5.2 `apps/storefront/node_modules/server-only/` 實況

```
total 16
-rw-r--r--   empty.js          0 bytes
-rw-r--r--   index.js        144 bytes
-rw-r--r--   package.json    467 bytes
```

#### package.json 字面

```json
{
  "name": "server-only",
  "description": "This is a marker package to indicate that a module can only be used in Server Components.",
  "keywords": [
    "react"
  ],
  "version": "0.0.1",
  "homepage": "https://reactjs.org/",
  "bugs": "https://github.com/facebook/react/issues",
  "license": "MIT",
  "files": ["index.js", "empty.js"],
  "main": "index.js",
  "exports": {
    ".": {
      "react-server": "./empty.js",
      "default": "./index.js"
    }
  }
}
```

→ 包字面為 React 官方 marker package、用 `react-server` exports condition 區分 server / non-server 環境。

### 5.3 `apps/storefront/node_modules/client-only/` 實況

```bash
ls apps/storefront/node_modules/client-only/
# (0 output、目錄不存在)
```

→ **`client-only` package 未安裝**(只有 `server-only`)。

### 5.4 [apps/storefront/package.json](apps/storefront/package.json) 全文(30 行)

```json
{
  "name": "@pcm/storefront",
  "version": "0.0.0",
  "private": true,
  "description": "PCM 前台(Next.js 16 + Tailwind v4)— 殼、待後續 slice 裝框架",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint . --max-warnings 0 --no-error-on-unmatched-pattern",
    "typecheck": "tsc --noEmit",
    "analyze": "ANALYZE=true next build"
  },
  "dependencies": {
    "@pcm/adapters": "workspace:*",
    "@pcm/domain": "workspace:*",
    "next": "16.2.6",
    "react": "19.2.6",
    "react-dom": "19.2.6",
    "server-only": "^0.0.1"
  },
  "devDependencies": {
    "@next/bundle-analyzer": "^16.2.6",
    "@types/node": "^25.6.2",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "typescript": "catalog:"
  }
}
```

關鍵 deps 字面:
- `next`: `16.2.6`
- `react`: `19.2.6`
- `react-dom`: `19.2.6`
- `server-only`: `^0.0.1`(line 20、已明列 dep)
- `client-only`:**未列**

---

## §6 audit sub-8d L40-L80 server-only 引入閾值上下文

### 6.1 檔名實況確認(`ls docs/audits/`)

```
2026-05-02-full-audit.md
M-1-03-main-a-刀-4-sub-8d-findings.md
```

→ sub-8d 檔名 = `M-1-03-main-a-刀-4-sub-8d-findings.md`。

### 6.2 L40-L80 完整字面(eng-2 + eng-3 + eng-4 + eng-5 + eng-6 5 findings)

#### eng-2: ?tier= override security guard ✅(L42-L48)

```
- **檔案:** `apps/storefront/src/app/page.tsx:46-49`
- **嚴重程度:** 🟡 低(已正確處理、屬「looks good」)
- **視角:** security
- **描述:** `process.env.PCM_DEV_TIER_OVERRIDE === '1'` env-guarded 防 production 訪客 URL 加 ?tier= 取得 dealer 價、對齊 PRD §3.1 Q1=B 拍板
- **建議處置:** 現實作正確、M-1-14 真 auth 落地後 flag 可廢除
- **三視角:** 全綠
```

#### eng-3: designTierToSchema try/catch fallback ✅(L50-L56)

```
- **檔案:** `apps/storefront/src/app/page.tsx:54-58`
- **嚴重程度:** 🟡 低
- **視角:** correctness
- **描述:** `try/catch` 包 `designTierToSchema`、corrupt cookie / 攻擊 URL fallback `'general'`、防 server 端 throw
- **建議處置:** 現實作 correctness 全綠、可考慮 log fallback case 便於 admin debug
- **三視角:** bug ✅ 增加 log 可加分
```

#### eng-4: server-only runtime guard 替代 npm package(L58-L64)

```
- **檔案:** `apps/storefront/src/lib/products.ts:28-32`
- **嚴重程度:** 🟡 低(已記 commit body)
- **視角:** security
- **描述:** `typeof window !== 'undefined'` runtime guard 替代 `server-only` npm package(對齊 d2 Sean 拍板「範圍紀律不擴張 deps」)、runtime guard 在 build time 不阻擋 client component import
- **建議處置:** 現實作可接受;storefront 規模擴張可考慮加 `server-only` package(對齊 Next.js 13+ 推薦)
- **三視角:** 擴 ✅(規模擴張)/ 維 ✅ / bug -
```

#### eng-5: badge corner 浮點除法邊界(L66-L72)

```
- **檔案:** `apps/storefront/src/components/ProductCard.tsx:114`
- **嚴重程度:** 🟡 低
- **視角:** correctness
- **描述:** `Math.round((1 - p.price / p.origPrice) * 100)` 若 `p.origPrice === 0` 撞除零 → -Infinity → `-Infinity%`;但 `if (... && p.origPrice)` truthy check 已過濾 0/null/undefined、edge case 不 hit
- **建議處置:** 現實作 truthy check 已防、可接受;若改為 explicit `p.origPrice && p.origPrice > 0` 更明確 TypeScript narrow
- **三視角:** 全綠(truthy 已防)
```

#### eng-6: 'NT$' hardcode 5 處(Phase 2 多幣別)(L74-L80)

```
- **檔案:** `apps/storefront/src/components/Price.tsx:43, 45, 56, 58, 67`
- **嚴重程度:** 🟡 低
- **視角:** 維護性
- **描述:** `NT$ ${...toLocaleString()}` 5 處 hardcode、未來多幣別需散修
- **建議處置:** 留新 backlog 條目(對齊 PRD §7.2 預估「'NT$' currency → symbol helper Phase 2 多幣別」、本對話 sub 8c #125 已被 git push 處置佔用、需 sub 8e 評估新編號)
- **三視角:** 擴 ✅(多幣別)/ 維 ✅ / bug -
```

### 6.3 eng-4 「規模擴張」字面 vs 量級指標

- audit 字面僅用「storefront 規模擴張可考慮加 `server-only` package(對齊 Next.js 13+ 推薦)」
- **無具體量級判定字面**(無檔案數 / LOC / client 元件數 / 安全事件 / 等閾值)
- 「對齊 Next.js 13+ 推薦」字面為 Next.js 官方推薦(非 PCM 量級判定)

### 6.4 audit eng-4 vs 實況 server-only dep 狀態 drift 觀察

- audit L58-L64 字面(2026-05-09 sub-8d 寫成)主張「`typeof window !== 'undefined'` runtime guard 替代 `server-only` npm package」、「對齊 d2 Sean 拍板『範圍紀律不擴張 deps』」
- 實況 [apps/storefront/package.json:20](apps/storefront/package.json#L20) 字面 = `"server-only": "^0.0.1"`(已是 dep)
- 兩字面存在偏離、本偵察純列事實、不歸納(屬「不可預判刀 1 字面 vs 事實 drift」禁止範圍)

---

## §7 storefront 'use client' 元件清單 + client 化原因分類

### 7.1 4 個 client 元件、各自前 15 條相關 line

#### [Header.tsx](apps/storefront/src/components/Header.tsx)

```
L5:  // - React.useState / useEffect → import { useState, useEffect }
L6:  // - window.Header UMD 註冊移除(改 ES export)
L9:  // M-1-04 Header mini-slice:Header 維持 client(useState searchQuery/autoMobile + useEffect + dispatchEvent)、
L11: // 3 button(cart / account / search)onClick stub 留候選刀 3 router.push;
L14: 'use client';
L17: import { useState, useEffect, useCallback } from 'react';
L34: const [searchQuery] = useState('');
L35: const onNavLocal = useCallback((target: string, ctx?: object) => {
L41: // button onClick stub 仍消費 handleNav wrapper(cart / account / search)、候選刀 3 router.push 接
L47: window.dispatchEvent(new CustomEvent('pcm-open-search', { detail: { query: q } }));
L50: const [autoMobile, setAutoMobile] = useState<boolean>(false);
L51: useEffect(() => {
L53: const dm = document.querySelector('[data-mobile="true"]');
L54: setAutoMobile(!!dm || window.innerWidth < 1080);
L57: const mq = window.matchMedia('(max-width: 1079px)');
```

#### [VehicleFinder.tsx](apps/storefront/src/components/VehicleFinder.tsx)

```
L4:  // design 用 window.PCM_DATA.motoBrands → 改 import { MOCK_MOTO_BRANDS }
L5:  // React.useState → import { useState }
L7:  'use client';
L9:  import { useState, useCallback } from 'react';
L14: const [sel, setSel] = useState({ brand: '', model: '', year: '' });
L20: const onNav = useCallback((target: string, ctx?: object) => {
L38: <select value={sel.brand} onChange={(e) => setSel({ brand: e.target.value, model: '', year: '' })}>
L45: <select value={sel.model} disabled={!brand} onChange={(e) => setSel({ ...sel, model: e.target.value, year: '' })}>
L52: <select value={sel.year} disabled={!model} onChange={(e) => setSel({ ...sel, year: e.target.value })}>
L60: onClick={() => onNav('products', { vehicle: { brand: sel.brand, model: sel.model, year: sel.year } })}>
```

#### [ProductCard.tsx](apps/storefront/src/components/ProductCard.tsx)

```
L4:   // 字面從 design-reference/components/ProductCard.jsx @ 25d3a2a 直接搬(M-1-04-mini-slice 修:25d3a2a 加 tier prop + window.Price 條件渲染、storefront 用 import <Price> + tierLabel 優於 window.Price UMD、不重做):
L6:   // - React.useState / useMemo → import { useState, useMemo }
L7:   // - window.ProductCard / window.ProductImage UMD 註冊移除(改 ES export)
L10:  'use client';
L12:  import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
L65:  const imgs = useMemo(() => productGallery(seed), [seed]);
L66:  const [failedIdx, setFailedIdx] = useState<Record<number, boolean>>({});
L101: onClick?: () => void;
L104: export function ProductCard({ p, showRedPrice, badgeStyle = 'minimal', compact = false, onClick }: ProductCardProps) {
L105: const [hover, setHover] = useState(false);
L106: const [liked, setLiked] = useState(false);
L128: onClick={onClick}
L141: onClick={(e) => { e.stopPropagation(); setLiked(!liked); }}
L155: <button className="pcard-quick-btn" onClick={(e) => e.stopPropagation()}>
```

#### [HomeSelect.tsx](apps/storefront/src/components/HomeSelect.tsx)

```
L4:  // d1 階段:用 MOCK_PRODUCTS.slice(0, 4) 對齊 design 字面 window.PCM_DATA.products.slice(0, 4)
L8:  // 'use client' 因 ProductCard 是 client component + 傳 onClick callback、server-client boundary 需 client
L9:  'use client';
L11: import { useCallback, type MouseEvent } from 'react';
L23: const onNav = useCallback((target: string, ctx?: object) => {
L49: <a href="#" onClick={(e) => handle(e, 'new')} className="ed-link ed-link-sm">
L88: onClick={() => onNav('product', { productId: p.id, source: 'home', sourceLabel: '首頁' })}
```

### 7.2 client 化原因類型矩陣(每元件命中哪幾類)

| 元件 | useState | useEffect | useCallback | useMemo | window.* | document.* | onClick | onChange | 'use client' 自述原因 |
|---|---|---|---|---|---|---|---|---|---|
| Header.tsx | ✓ ×2 | ✓(matchMedia + setInterval) | ✓ | — | dispatchEvent / innerWidth / matchMedia | querySelector | ✓ ×3(button) | — | 自註 L9-L12「維持 client(useState searchQuery/autoMobile + useEffect + dispatchEvent)」 |
| VehicleFinder.tsx | ✓ ×1 | — | ✓ | — | — | — | ✓(button) | ✓ ×3(select) | 無顯式自註、`'use client'` L7 行頂 |
| ProductCard.tsx | ✓ ×3 | — | — | ✓ | — | — | ✓ ×4(card / heart / quick / inner) | — | 無顯式自註、`'use client'` L10 行頂 |
| HomeSelect.tsx | — | — | ✓ | — | — | — | ✓ ×2(L49 a + L88 ProductCard) | — | 自註 L8「因 ProductCard 是 client component + 傳 onClick callback、server-client boundary 需 client」 |

### 7.3 已 server 化 6 元件不出現於本清單(對齊 pre-recon §2 / recon §4)

- HomeHero / HomeStatement / HomeFooter / FeatureEditorial / CategoryGrid / BrandIndex

各自註解「'use client' 移除原因:此元件無 useState / useEffect / onClick / window. / hover、純展示」(recon §4.1 已記)。

---

## §8 偵察過程觀察(純事實、不寫推薦)

### 8.1 偵察範圍

- design-handoff/(3 entries)+ design-reference/design-reference/(10 entries)= 13 個 HANDOFF / index 檔 head + wc -l
- 5 ADR grep + 5 ADR cross-grep
- 4 docs/architecture + docs/patterns + CLAUDE.md grep
- apps/storefront/next.config.ts read(全文)
- apps/storefront/package.json read(全文)
- node_modules/server-only/ ls + package.json read
- node_modules/client-only/ ls(empty)
- audit sub-8d L40-80 read(完整 5 findings)
- 4 client 元件 grep client API 字面(各前 15 條)
- 4 條 `git log -S` 對刀 1 三 commit + design-handoff 字面命中查驗
- 1 條 `git log --diff-filter=A` 對 v2.0 / v2.1 進入軌跡
- 0 webfetch / online 查詢
- 0 git 動作(無 add / commit / push)

### 8.2 偵察當下發現的字面差異(列、不歸納)

- HANDOFF-OVERVIEW 自述「文件索引(共 5 份)」、實況 `design-reference/design-reference/` 共 **10 份** HANDOFF-*.md(差 5 份)
- HANDOFF-DETAILS 自述「衝突時,本檔是最終權威」、對齊 NORTHSTAR §2.4 優先序 `DETAILS > ...` 字面
- `design-handoff/HANDOFF-v2.0.md` L6 字面引用「上一版:`design-handoff/HANDOFF.md`(v1.0,Phase 2 初版)」、實況 `design-reference/HANDOFF.md`(根目錄 13257 bytes、本偵察未驗是否就是該 v1.0)
- ADR-0005 grep `design-handoff|HANDOFF|design-reference` **0 命中**(不引)
- ADR-0001 / 0002 / 0003 共 13 處引用 design-reference / HANDOFF-TWEAKS、但 0 處引 `design-handoff/`
- 刀 1 三 commit `git log -S` 對 HANDOFF / design-handoff / HANDOFF-DETAILS / HANDOFF-COMPONENTS 全 0 命中、實作端只引 .jsx source path 字面
- audit sub-8d L62 字面主張「`typeof window` runtime guard 替代 `server-only` npm package」、實況 [apps/storefront/package.json:20](apps/storefront/package.json#L20) = `"server-only": "^0.0.1"`(已是 dep)、兩字面存在偏離
- audit sub-8d L63「規模擴張可考慮加 server-only package」**無具體量級判定字面**(無 LOC / 元件數 / 安全事件閾值)
- `next.config.ts` 字面為空 `{}` config、無 server / client 邊界相關 key
- `node_modules/server-only/` 存在(0.0.1、144 bytes index.js)、`node_modules/client-only/` 不存在
- server / client 邊界討論在 4 檔共 8 行命中、無檔自稱「邊界規範書」、5 ADR 全 0 命中、CLAUDE.md 0 命中

### 8.3 偵察過程零既有檔案修改

- 0 git add / commit / push
- 0 dev server / typecheck / lint / build / test
- 0 webfetch / online 查詢
- 0 submodule update --remote
- 0 deps 變更(pnpm add / package.json edit)
- 1 新增 untracked:本檔(`docs/recon/M-1-04-slice-4-recon-supplement.md`)
- 0 修改既有檔案
- audit / ADR / config / patterns 檔名先 `ls` 確認、不憑記憶寫死(對齊禁止清單)

### 8.4 留給 Claude.ai 寫 PRD 時自查 / 拍板的字面

- `design-handoff/HANDOFF.md`(根目錄 13257 bytes)是否就是 v1.0 — 本偵察未驗
- v2.0 v2.1 補頁(CheckoutPage / WalletTab / TierComponents / 等)是否在 ADR 字面 — 本偵察未跑
- ADR-0006 是否引 v2.0 / v2.1 — Claude.ai 寫 PRD 時拍
- audit sub-8d eng-4 vs 實況 `server-only` dep 已存在 drift — Claude.ai 寫 PRD 時引(屬「不可預判刀 1 字面 vs 事實 drift」禁止範圍、本偵察純列)
- server / client 邊界判定具體量級閾值(audit 未列、CLAUDE.md 未列)— Claude.ai 寫 PRD 時拍
- `react-server` exports condition 在 server-only marker 包的字面用途、與 Next 16 RSC payload boundary 的字面關係 — Claude.ai 寫 PRD 時查 Next 16 / React 19 官方
- ADR-0006 是否需吸收 docs/patterns/general.md §4-1 + pcm-specific.md §7-1 + security-timeline #C3 + supabase-schema-design L474-L476 既有字面 — Claude.ai 寫 PRD 時拍

— END —
