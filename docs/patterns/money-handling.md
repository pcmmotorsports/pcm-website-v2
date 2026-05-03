# Money Handling(brand type 守門規範)

> **Status:** 🟢 落地 / 2026-05-03 / ADR-0004 Q4=A3
> **層級:** docs/patterns/、衝突仲裁在 ADR 之下
> **本檔角色:** ADR-0004 Q4 拍板「brand type MoneyAmount + helper toMoneyAmount(n) 集中守門」之規範字面、所有 use-case 跑 Money 運算統一遵守
>
> 配合閱讀:
> - `docs/decisions/0004-m1-pre-launch-decisions.md` Q4=A3(本檔落地依據)
> - `CLAUDE.md`「Server 端鐵則(會員與價格)」§ 三級會員價格驗證(精神對齊「整數運算避免浮點誤差」)
> - `packages/domain/src/shared/types.ts`(brand type 字面落地、M-0-10b)
> - `docs/phase-1-backlog.md` #13(本檔落地解)

---

## §1 規範字面

### 1.1 brand type 定義

字面落於 `packages/domain/src/shared/types.ts`(M-0-10b 落地):

```typescript
export type MoneyAmount = number & { readonly __brand: 'MoneyAmount' };

export type Money = {
  amount: MoneyAmount;  // brand type、整數、最小貨幣單位(TWD 元位)
  currency: 'TWD';
};

/**
 * 將 number 守門轉成 MoneyAmount。
 * - 必為 integer(浮點誤差防呆)
 * - 必為 ≥ 0(非負)
 * - 不在 use-case 散寫 Number.isInteger guard、統一走 toMoneyAmount()
 */
export function toMoneyAmount(n: number): MoneyAmount {
  if (!Number.isInteger(n)) {
    throw new Error(`MoneyAmount must be integer, got ${n}`);
  }
  if (n < 0) {
    throw new Error(`MoneyAmount must be non-negative, got ${n}`);
  }
  return n as MoneyAmount;
}
```

### 1.2 use-case 用法

```typescript
// ✅ 正確
const price = toMoneyAmount(1500);
const total = toMoneyAmount(price * qty);  // 運算後再守門一次

// ❌ 錯誤
const price: MoneyAmount = 1500.5 as MoneyAmount;  // 繞過 guard
const total = (price * qty) as MoneyAmount;          // 運算結果可能溢位整數、未守門
```

理由:`as MoneyAmount` 強轉繞過 guard、TypeScript 不阻擋但跟本規範違背。所有 number → MoneyAmount 的轉換**必過 toMoneyAmount() helper**、不允許 `as` 強轉。

---

## §2 跨邊界守則

| 邊界 | 方向 | 守則 |
|---|---|---|
| domain → wire(adapter) | MoneyAmount → number | Medusa wire 用 plain int(`amount` 欄位)、adapter 直接讀 `.amount`(MoneyAmount 是 number 子類、JS runtime 是 plain number、不需轉) |
| wire → domain | number → MoneyAmount | adapter 邊界**必過 `toMoneyAmount()` guard**、不直接 `as MoneyAmount` |
| JSON serialization | MoneyAmount → JSON int | MoneyAmount 是 number 子類、`JSON.stringify` 直接出 int、無特殊處理;反序列化時 `JSON.parse` 出 number、若送回 domain 必過 `toMoneyAmount()` guard |

---

## §3 對應 backlog #13

backlog #13「Money.amount 守門策略」標 ✅ 完成於 2026-05-03 / ADR-0004 Q4=A3 / M-0-10c commit 落地紀錄。

選擇邏輯(對齊 backlog #13 三候選):
- (a) 維持 number + 各 use-case 寫 `Number.isInteger(amount)` guard — **不選**(守門責任分散、漏守風險高)
- (b) 升 bigint(運算精確、JSON serialization 要 toString) — **不選**(JSON 處理麻煩、TWD 整數規模 number 已夠)
- (c) **brand type MoneyAmount + helper toMoneyAmount(n)** — **選此**(集中守門、type-level 防混用、JSON 友善)

---

## §4 變更紀錄

| 日期 | 變更 | 變更者 |
|---|---|---|
| 2026-05-03 | 初始化(brand type + helper 規範 + 跨邊界守則) | ADR-0004 Q4=A3 落地、由 Claude Code(M-0-10a)寫 |

— END —
