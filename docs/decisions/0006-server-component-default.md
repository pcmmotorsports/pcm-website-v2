# ADR-0006: Next.js 16 server-component-default 邊界採用

Status: 🟢 Accepted (2026-05-14)
Supersedes: N/A
Related: ADR-0005 (Custom + Supabase 直寫)、audit M-1-03-audit-slice-B-1 (`89a20a8`)、lessons §12-24
Detail: docs/architecture/server-client-boundary.md

---

## 決定

storefront(`apps/storefront/`)所有 React 元件**預設為 Server Component**(Next.js 16 default 行為、無 `'use client'` 標記者)。

僅以下 4 條情境必須標 `'use client'`:

1. 元件使用 React Hooks(`useState` / `useEffect` / `useReducer` / `useCallback` / `useMemo` / `useRef`)
2. 元件綁 DOM event handler(`onClick` / `onChange` / `onSubmit` 等需 hydration)
3. 元件使用 browser-only API(`window` / `document` / `localStorage` / `matchMedia` / `dispatchEvent`)
4. 元件使用 React 19 client-only feature(`use Context` / Form Actions client-side 等)

詳細判定決策表、優先序、`router.push` vs `<Link href>` 抉擇、`server-only` 編譯期擋雙層保護細節、見:

→ `docs/architecture/server-client-boundary.md`

---

## 採用理由(PCM scope)

### 理由 1:SEO Day 1(對齊 NORTHSTAR §3.5)

NORTHSTAR Phase 1 範圍明示「SEO + structured data + sitemap day 1 起就建」。Server Component 預設 = HTML 在 server 端 render 出完整 markup、search engine 直接 crawl + index;Client Component 預設則需 JavaScript hydration 後才完整、不利初次抓取。Phase 1 storefront 6 個純展示 sections(HomeHero / HomeStatement / HomeFooter / FeatureEditorial / CategoryGrid / BrandIndex)已落地為 Server Component(刀 1 完工)、SEO 結構 day 1 即生效。

### 理由 2:service_role key 安全(audit B-1 推翻 d2)

2026-05-09 M-1-03 main-d-d2(commit `1147fbe`)拍板「不裝 `server-only` npm package、用 `typeof window` runtime guard 替代(範圍紀律不擴張 deps)」。2026-05-10 audit slice B-1(commit `89a20a8`)因 R1 #2 Critical(service_role key 從 `@pcm/adapters` root export 暴露給 client bundle 風險)推翻 d2、加 `server-only ^0.0.1` dep + 在 `packages/adapters/src/supabase/client.ts` 檔頭加 `import 'server-only';`(編譯期擋第一層)。

server-component-default 與此安全紀律相輔相成:
- Server-only 模組(`@pcm/adapters` / `apps/storefront/src/lib/products.ts`)只能被 Server Component import
- Client Component 必須顯式標 `'use client'`、編譯期 trace import graph 阻擋誤用
- 雙層保護:第一層編譯期(`import 'server-only';`)+ 第二層 runtime guard(`typeof window`)、詳細見 lessons §12-24

### 理由 3:bundle size(對齊 audit 2026-05-02 全專案 audit)

`docs/audits/2026-05-02-full-audit.md` L437 / L439 / L491 / L773 指出:無集中 PricingService 抽象、storefront server bundle 含計算邏輯、未來 Phase 2「廠牌折扣 + VIP + tier」三層折扣疊加時、若預設 client component、所有計算邏輯會 leak 進 client bundle。server-component-default 把計算邏輯預設留 server-side、只有顯式需要互動的元件才標 client、bundle size 自然受控。

### 理由 4:三 tier 價格 server-side 隔離(audit sub-8d 字面)

`docs/audits/M-1-03-main-a-刀-4-sub-8d-findings.md` eng-2 ~ eng-6(L42-L80)揭示:
- eng-2 `?tier=` override env-guarded(防 production 訪客取 dealer 價)
- eng-3 `designTierToSchema` try/catch fallback(防 server 端 throw)
- eng-4 `server-only` runtime guard(本 ADR 採編譯期擋升級)
- eng-5 `badge corner` 浮點除法邊界(server side 計算)
- eng-6 `'NT$'` hardcode Phase 2 多幣別(server side 隔離)

三 tier 價格(`general` / `store` / `premiumStore`)server-side 隔離 = `priceByTier` jsonb 在 server 端 strip 取單一 tier、不送 client bundle、對齊 security-timeline #C4 `priceByTier` 不洩漏鐵則。server-component-default 是此隔離的基礎假設。

### 理由 5:對齊 Next 16 + React 19 官方方向

- `apps/storefront/package.json:17-19` 字面:`next 16.2.6` / `react 19.2.6` / `react-dom 19.2.6`
- Next.js 16 default = Server Component(無 `'use client'` 標記者)
- React 19 RSC(React Server Components)為官方 first-class feature
- `server-only ^0.0.1` 已是 `apps/storefront` + `packages/adapters` 雙直接 dep(`.npmrc shamefully-hoist=false` 嚴格隔離模式顯式對齊、audit B-1 `89a20a8` 同步加兩處)、由 React 官方維護(facebook/react)

採用 server-component-default = 走官方主流路線、未來升級成本低、文件 / 社群資源最完整。

---

## 不採用以下方案的理由

### 方案 A:client-component-default

**否決原因:**
- 違反 Next.js 16 + React 19 官方預設、需在每個 server 元件顯式禁用、心智負擔重
- SEO 受損(理由 1)
- service_role key 安全風險高(理由 2、所有元件預設可 import server-only module → 編譯期擋無意義)
- bundle size 爆炸(理由 3、所有元件邏輯預設打進 client bundle)

### 方案 B:Pages Router(回退到 Next.js 12 風格)

**否決原因:**
- 違反 Next.js 16 主流方向(Pages Router 仍可用但 deprecation 訊號明)
- 失去 RSC 能力、放棄 React 19 first-class feature
- 與 ADR-0001「整個重做」的「新 repo 從零、走最新主流」精神衝突
- 既有 storefront 已是 App Router(`apps/storefront/src/app/`)、回退成本高

### 方案 C:Mixed(無預設、case-by-case 拍板)

**否決原因:**
- 無預設 = 每個元件都需獨立判定、心智負擔重、新人 onboarding 困難
- 缺乏一致性、code review 反覆爭議
- 違反「寫新元件先讀本檔、再寫 code」的真權威精神
- 與 NORTHSTAR §3「直接搬、不翻譯」精神不對齊(設計階段就有清楚預設、實作只需服從)

---

## 影響範圍

### 新元件

新 React 元件落 `apps/storefront/src/components/` 或 `apps/storefront/src/app/` 時:
- 預設不標 `'use client'`(即 Server Component)
- 觸發 4 條情境之一才標 `'use client'`(file-level、檔頭第一行)
- 寫前先讀 `docs/architecture/server-client-boundary.md`(§2 判定決策表 / §6 新元件 checklist)

### 既有元件(刀 1 完工狀態)

- **Server Component(6 個):** HomeHero / HomeStatement / HomeFooter / FeatureEditorial / CategoryGrid / BrandIndex
- **Client Component(4 個):** Header / VehicleFinder / ProductCard / HomeSelect

本 ADR 不要求重新審視既有元件、4 個 Client Component 字面已對齊判定決策表(useState / useEffect / event handler / window API 觸發)、保留原狀。

### 4 檔邊界字面(既有規則)

本 ADR 不重抄、boundary.md §4 索引引用:
- `docs/patterns/general.md` L134-L144(§4-1 Client component 不得 import server-only 模組)
- `docs/patterns/pcm-specific.md` L284(§7-1 service role key 走 server-only)
- `docs/architecture/security-timeline.md` L86(C3 條)
- `docs/architecture/supabase-schema-design.md` L474-L476(對齊 #C3 + 第一層編譯期 `import 'server-only';`)

字面 drift 出現時、原檔為準、boundary.md follow up(對齊 boundary.md §4 字面)。

### `packages/ui/`

目前為 stub、未來實作對齊本規則(對齊 boundary.md §1.1 字面)。

---

## 後續

### backlog #139:ADR Status 風格回收

ADR-0001 ~ 0004 用「狀態」中文 / 0005 用「Status: 🟢 拍板 /」/ 0006 採用「Status: 🟢 Accepted (YYYY-MM-DD)」格式、跨 5 ADR 共 4 種風格。下次 ADR(0007+)落地時、開獨立小 slice 統一回收 0001-0004。詳細條目見 `docs/phase-1-backlog.md` #139。

### 候選刀 3 落地後補 boundary.md §4 案例庫

候選刀 3 範圍(VehicleFinder / Header 3 button / ProductCard / HomeSelect 改 `router.push`)落地後、boundary.md §2.2「router.push 與 next/link 抉擇」段補 4 互動元件實況案例、增強規範書教學性。

### 未來爭議討論基礎

新元件邊界爭議(如:「這元件該 server 還 client?」)、優先回查本 ADR 決定段 + boundary.md §2 判定決策表;判定決策表覆蓋不到的 case、開新 ADR 補(對齊本 ADR Status 風格)、不擴張本 ADR。
