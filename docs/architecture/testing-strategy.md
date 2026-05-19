# Testing Strategy(minimum 版 / Phase 1 階段 1)

> **Status:** 🟢 落地 / 2026-05-03 / ADR-0004 Q5=A3 minimum 版
> **層級:** docs/architecture/、衝突仲裁在 ADR 之下
> **本檔角色:** ADR-0002 §7 列「testing-strategy.md 待寫(M-6 / G2 拍板後)」之 minimum 版前置落地、避免 M-1 起 test 風格散
> **不寫:** coverage 目標(M-6 / G2 拍板)、contract test 框架(Phase 2 / backlog #55)
> **寫:** test 位置、vitest 設定、mock 風格、test description 慣例
>
> 配合閱讀:
> - `docs/decisions/0004-m1-pre-launch-decisions.md` Q5=A3(本檔落地依據)
> - `docs/decisions/0002-architecture-pivot.md` §4.1(in-memory adapter 是真實作、非 mock)
> - `docs/decisions/0003-domain-entity-naming.md`(domain 命名規則、test description 用 domain entity 名)
> - `docs/patterns/slice-checkpoint.md`(L1 lint / typecheck / build 三綠 vs 本檔 test 是兩件事)
> - `docs/phase-1-backlog.md` #45(本檔落地解)

---

## §1 Test 位置

- **同層 `*.test.ts` / `*.test.tsx` / `*.spec.ts` / `*.spec.tsx`**(對齊 vitest 預設)、不放 `__tests__/` folder
- 例:`packages/domain/src/catalog/types.test.ts`(若 catalog 有 entity 邏輯)
- adapters 可放 `packages/adapters/src/medusa/MedusaProductAdapter.test.ts`(同層)
- use-cases 可放 `packages/use-cases/src/place-order/place-order.test.ts`(同層)
- React component test 用 `.test.tsx`(M-1-05+ storefront / packages/ui)
- apps server-side test 用 `.test.ts`(`apps/storefront` / `apps/admin` / `apps/sync-engine`、M-1-01-true / M-4a-01 / M-5-01 起)

理由:同層 *.test.ts 比 __tests__/ folder 更容易 grep、改檔時 test 跟著一起見、不會散到隔壁目錄。

**vitest config include glob 字面對齊(M-1-02-audit E1 規範類落地):**

`vitest.config.ts` 的 `include` glob 必涵蓋兩維度:
- 副檔名:`{ts,tsx}` + `{test,spec}` 兩慣例都收(對齊 vitest 預設)
- 路徑:`{packages,apps}/**` 涵蓋兩 workspace(M-1-02 起 packages 寫、M-1-01-true 起 apps 寫)

具體 glob 字面:`'{packages,apps}/**/*.{test,spec}.{ts,tsx}'`

教訓來源:M-1-02 vitest config include 只寫 `packages/**/*.test.ts`、漏 .tsx + .spec + apps/**、M-1-03+ storefront / ui React component test 會 silently skipped(M-1-02-audit E1 抓出、立即修)。

**前台元件 smoke test 慣例(2026-05-18 WO-1 落地、對應 STATUS Sean 待決策 #2):**

Phase 1 期間,動到 storefront 前台元件的每個 slice,收工三綠前順手補 / 更新該元件的
`*.test.tsx` smoke test —— 驗「能正常 render 不報錯 + 關鍵互動不報錯」,作為剩餘 50+ 個
前台 slice 連續開發的 regression 安全網。

此慣例 **≠ coverage 數字目標**:smoke test 是「測試檔案存在、擋 regression」;coverage
百分比門檻仍依 §5 留 G2 / M-6 拍板。

---

## §2 vitest 設定

(M-1-02 落地 vitest 時補實際 `vitest.config.ts` 字面;本檔規範:走 monorepo 統一、vitest 走 root config + workspace inheritance)

預期結構:

```
pcm-website-v2/
├── vitest.config.ts          ← root config(M-1-02 落地)
└── packages/
    ├── domain/
    │   └── vitest.config.ts  ← 繼承 root、可 override(若需)
    └── ...
```

具體欄位(test 包含 / coverage 排除 / globals 等)由 M-1-02 第一個 test slice 落地。

---

## §3 Mock 風格

### 3.1 純 stub function

```typescript
import { vi } from 'vitest';

const stubFindById = vi.fn().mockResolvedValue({ id: 'p1', name: '...' });
```

### 3.2 邊界 mock(adapter)

mock SDK module、**不 mock domain entity**:

```typescript
// ✅ 正確:mock Medusa SDK
vi.mock('@medusajs/medusa', () => ({ ... }));

// ❌ 錯誤:mock domain entity
vi.mock('@pcm/domain', () => ({ Product: { ... } }));  // domain 是純資料、不需 mock
```

### 3.3 InMemory adapter 不算 mock

InMemoryProductRepository 是**真實作**(對齊 ADR-0002 §4.1)、不算 mock:

```typescript
// ✅ 正確:use-case test 用 InMemory adapter
const repo = new InMemoryProductRepository([fakeProduct1, fakeProduct2]);
const result = await placeOrder(input, { productRepo: repo });
```

理由:InMemory adapter 跟 Medusa adapter 共用同一個 `IProductRepository` 介面、test 過 = 介面合約過、不需 mock。

### 3.4 in-memory 樣板不搬到真實 adapter(M-1-02-audit Q2/E2/E5 規範類落地)

InMemory adapter 內部慣用 `Array.from(this.products.values()).filter(predicate)` 樣板(O(n) 記憶體 filter)、合理對 in-memory + test scope。

**禁止把此樣板搬到 Medusa / Supabase 等真實 adapter:**

- ❌ MedusaProductAdapter.listByCategory:fetch all products + JS filter(N+1 / over-fetch、對 200 SKU 已痛、對 5w SKU 災難)
- ❌ MedusaProductAdapter.searchByKeyword:fetch all + `toLowerCase().includes()` JS filter(完全走偏 ADR-0004 Q3=A1 PG ILIKE → tsvector + GIN + pg_jieba 拍板路徑)
- ✅ MedusaProductAdapter.listByCategory:走 Medusa SDK `products.list({ category_id: ... })`、PG WHERE 過濾、O(log n) index lookup
- ✅ MedusaProductAdapter.searchByKeyword:M-1-03 走 PG ILIKE(對齊 ADR-0004 Q3=A1 dev 期 / IProductRepository.searchByKeyword JSDoc 兩階段註記)、M-6 切 tsvector

理由:in-memory + test scope 用 O(n) 樣板無問題;但 production adapter 必走 wire-level filter(SDK / SQL / 索引),否則效能災難 + 違反 ADR 拍板路徑。

教訓來源:M-1-02-audit simplify 視角抓出 4 個 list method 樣板若 leak 進 MedusaProductAdapter 必踩 anti-pattern;規範化防 M-1-03 開發者照 InMemory 樣板抄。

---

## §4 Test description 慣例

- `describe('X')`—— X 是 entity / module / use-case 名(對齊 ADR-0003 §3.1 命名規則、用 domain camelCase)
- `it('should ...')`—— 業務語意敘述、不寫技術細節

範例:

```typescript
describe('Money', () => {
  it('should reject negative amount', () => { ... });
  it('should reject non-integer amount', () => { ... });
  it('should accept zero amount', () => { ... });
});

describe('placeOrder', () => {
  it('should reject when cart is empty', () => { ... });
  it('should mark order as paid when TapPay returns success', () => { ... });
});
```

---

## §4.1 Test 驗意圖、不只驗行為(M-2/M-3 商業邏輯落地前置)

§4 管「test 怎麼命名」;本節管「test 該驗什麼」。

原則:**牽涉商業規則的 test、必須在規則被改錯時會紅。** 一個無論商業邏輯怎麼改都不會 fail 的 test 是壞 test(同義反覆 / 純快照)。

- ❌ 壞例:`expect(price).toBeDefined()` —— 經銷價隔離邏輯整個拿掉它也綠
- ✅ 好例:`it('should never expose store price to a general member')` —— 斷言一般會員 payload 不含經銷價欄位;隔離一壞就紅

特別適用(M-2 / M-3 起):

- M-2 三級價格:驗「一般會員 server 端重查 tier 後、拿不到經銷價」
- M-3 訂單 8 狀態機:驗「非法狀態轉移被拒」、非只驗合法轉移成功

與 §1 smoke test 分工:smoke test 驗「畫得出來、不報錯」;本節驗「商業規則正確、改錯會被擋」。前台元件兩者都要;domain / use-cases 以本節為主。

---

## §5 待 G2 / M-6 拍板擴

以下項目本檔不寫、Phase 1 後段或 G2 拍板後再擴:

- coverage 目標(STATUS Sean 待決策 #2 / G2)
- E2E 範圍(M-6-05 happy path、G2 拍板後決定 critical bug regression 是否含)
- contract test 框架(Phase 2 多 vendor adapter 進來、需契約測試;backlog 候選 #55)
- 效能 / 壓力 test(Phase 2 流量上來再規劃)

---

## §6 變更紀錄

| 日期 | 變更 | 變更者 |
|---|---|---|
| 2026-05-03 | 初始化 minimum 版(test 位置 / vitest 設定 / mock 風格 / description 慣例) | ADR-0004 Q5=A3 落地、由 Claude Code(M-0-10a)寫 |
| 2026-05-04 | §1 擴 .tsx + .spec + apps/** 字面(E1 規範類);加 vitest config include glob 字面對齊段(M-1-02 教訓);§3.4 新節「in-memory 樣板不搬到真實 adapter」(Q2/E2/E5 規範類、防 M-1-03 開發者照 InMemory 樣板抄 leak 進 MedusaProductAdapter) | Claude Code(M-1-02-audit) |
| 2026-05-18 | §1 補「前台元件 smoke test 慣例」(WO-1 工作流優化、對應 STATUS Sean 待決策 #2;Phase 1 動前台 slice 順手補 `*.test.tsx`、≠ coverage 目標) | Claude Code(WO-1) |
| 2026-05-19 | 新增 §4.1「Test 驗意圖、不只驗行為」(Codex 審查後續處置 Slice B、M-2/M-3 商業邏輯落地前置) | Claude Code(Slice B) |

— END —
