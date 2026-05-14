# Server / Client Component Boundary

Status: 🟢 Active (2026-05-14)
ADR: docs/decisions/0006-server-component-default.md
Stack: Next.js 16.2.6 / React 19.2.6
Related: [lessons §12-24](../lessons-learned.md#12-24-audit-推翻先前拍板時必同步更新-stale-字面--4-處-stale-處置分流)(audit-aftermath stale alignment)

storefront 元件邊界判定的真權威。新元件先讀本檔、再寫 code。

---

## §1 範圍與前提

### §1.1 適用範圍

- `apps/storefront/src/components/` 所有 React 元件
- `apps/storefront/src/app/` 所有 page / layout / template
- `packages/ui/`(目前為 stub、未來實作對齊本規則)

### §1.2 不適用

- `apps/api/` / `packages/adapters/` / `packages/domain/` / `packages/use-cases/`:非 React 元件、不涉 server/client component 邊界
- `packages/schemas/`:純 type、無 runtime 邊界

### §1.3 前提

- Next.js 16 default = Server Component(無 `'use client'` 標記者)
- 'use client' 標記為 file-level、放檔頭第一行
- ADR-0006 已採用 server-component-default

---

## §2 判定決策表

新元件先依此表判定、不確定時預設 server component、加 'use client' 必有具體理由。

| API / 特徵 | 該標 'use client' | 範例元件 | 判定理由 |
|---|---|---|---|
| React Hooks(useState / useEffect / useReducer / useCallback / useMemo / useRef) | ✅ 標 'use client' | Header(useState×2 / useEffect)、VehicleFinder(useState / useCallback)、ProductCard(useState×3 / useMemo)、HomeSelect(useCallback) | Hooks 是 client-only React feature |
| DOM event handler(onClick / onChange / onSubmit 等) | ✅ 標 'use client' | Header(onClick×3)、VehicleFinder(onChange×3 / onClick)、ProductCard(onClick×4)、HomeSelect(onClick×2) | event handler 需 hydration |
| browser-only API(window / document / localStorage / matchMedia / dispatchEvent) | ✅ 標 'use client' | Header(window×3 / document.querySelector) | server 端無 window / document |
| React 19 client feature(use Context / Form Actions client-side) | ✅ 標 'use client' | (storefront 暫無) | client-only |
| `next/link` 純 nav(`<Link href>`) | ❌ server 即可 | HomeHero / HomeStatement / HomeFooter / FeatureEditorial / CategoryGrid / BrandIndex / Header(9 a → Link 部分) | Link 是 server-friendly、不需 'use client' |
| 純資料展示(props in / JSX out / 無 state 無 effect) | ❌ server | HomeHero / HomeStatement / HomeFooter / FeatureEditorial / CategoryGrid / BrandIndex | RSC 原生情境 |
| Server-only data fetch(Supabase / @pcm/adapters) | ❌ server(且必要時加 server-only 編譯期擋) | apps/storefront/src/lib/products.ts | server-only 紀律(見 §3) |

### §2.1 判定優先序

當元件同時觸發多條判定:

- 「✅ 標 'use client'」優先「❌ server 即可」(任一條觸發 client 即標 client)
- 不可半標(無 file-level server-and-client、Next 16 不支援)
- 大型元件含小區塊互動時、考慮拆檔(父 server / 子 client)、不可父 client 強塞所有子元件進 client bundle

### §2.2 router.push 與 next/link 抉擇

候選刀 3 範圍重點。

| 情境 | 用什麼 |
|---|---|
| 純 nav、無條件分支、無 form data 處理 | `<Link href="...">` server-friendly |
| 互動後 nav(條件分支、event handler 內判定)、需 useState | `router.push('...')` + 'use client' |
| 表單提交後 nav | `router.push` 或 server action(Phase 1 用 router.push 為主) |

候選刀 3 4 元件預測:VehicleFinder(條件 nav)/ Header 3 button(互動 + nav)/ ProductCard onClick / HomeSelect onClick 全屬 router.push 情境、保留 'use client'。

---

## §3 server-only 編譯期擋雙層保護

敏感 module(含 service_role key / 三 tier 價格計算 / PII 處理)必須:

1. **第一層 編譯期擋**:`import 'server-only';` 放檔頭(或 transitively 經 server-only-marked module import)
2. **第二層 runtime guard**:`if (typeof window !== 'undefined') throw new Error(...)` 次層保險

雙層架構與時間軸細節、見:

- 規則來源:[lessons §12-24](../lessons-learned.md#12-24-audit-推翻先前拍板時必同步更新-stale-字面--4-處-stale-處置分流)(audit 推翻先前拍板的 stale 同步義務)
- audit B-1 commit:`89a20a8` (2026-05-10) 推翻 d2 `1147fbe` (2026-05-09)「不裝」拍板
- 落地位置:`packages/adapters/src/supabase/client.ts` 檔頭(transitive 經 @pcm/adapters)
- 雙層解釋:`apps/storefront/src/lib/products.ts` L22-27 註解

---

## §4 相關文件索引

既有邊界規則散在 4 檔、本檔不重抄、原檔為字面唯一源:

| 主題 | 原檔 link | 一句摘要 |
|---|---|---|
| Client component 不得 import server-only | [docs/patterns/general.md#L134-L144](../patterns/general.md#L134-L144) | 通用 React 規則 |
| service_role key server-only 紀律 | [docs/patterns/pcm-specific.md#L284](../patterns/pcm-specific.md#L284) | PCM 安全規則 |
| 安全 timeline C3 條 | [docs/architecture/security-timeline.md#L86](./security-timeline.md#L86) | 31 條安全項之一 |
| 編譯期 import 'server-only' 紀律 | [docs/architecture/supabase-schema-design.md#L474-L476](./supabase-schema-design.md#L474-L476) | schema-level 安全 |
| audit 推翻先前拍板的 stale 同步義務 | [lessons §12-24](../lessons-learned.md#12-24-audit-推翻先前拍板時必同步更新-stale-字面--4-處-stale-處置分流) | 規則來源(雙層保護字面源頭) |

字面 drift 出現時、原檔為準、本檔 follow up。

---

## §5 違反規則的失敗模式

| 違反 | 失敗模式 |
|---|---|
| client component 標 'use client' 後 import @pcm/adapters | build 紅(server-only 編譯期擋觸發) |
| server component 用 useState | build 紅(React 報 hooks 只能在 client 用) |
| server component 用 window | runtime 紅(server 端 window undefined)+ products.ts runtime guard 抓到時 throw |
| 漏標 'use client' 但用 onClick | hydration 不會發生、onClick 不觸發、互動失效 |

---

## §6 未來新元件 checklist

寫新元件時自問:

1. 元件需要 state / effect / hooks?→ Y 加 'use client'
2. 元件綁 DOM event?→ Y 加 'use client'
3. 元件用 window / document / localStorage?→ Y 加 'use client'
4. 元件 nav?→ 條件分支 → router.push + 'use client' / 純 nav → `<Link href>`(server)
5. 元件 fetch 敏感資料?→ server + 確認 transitive server-only 編譯期擋已生效

5 題全 N → server component default、無 'use client' 標記。

---

## §7 變更紀錄

| 日期 | 變更 | 來源 |
|---|---|---|
| 2026-05-14 | 初版、對齊刀 1 完工(6 server + 4 client)+ ADR-0006 採用 | M-1-04 slice 4 |
