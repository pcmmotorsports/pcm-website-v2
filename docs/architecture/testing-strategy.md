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

- **同層 `*.test.ts`**(對齊 vitest 預設)、不放 `__tests__/` folder
- 例:`packages/domain/src/catalog/types.test.ts`(若 catalog 有 entity 邏輯)
- adapters 可放 `packages/adapters/src/medusa/MedusaProductAdapter.test.ts`(同層)
- use-cases 可放 `packages/use-cases/src/place-order/place-order.test.ts`(同層)

理由:同層 *.test.ts 比 __tests__/ folder 更容易 grep、改檔時 test 跟著一起見、不會散到隔壁目錄。

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

— END —
