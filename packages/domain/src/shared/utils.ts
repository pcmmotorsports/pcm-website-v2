/**
 * @module @pcm/domain/shared/utils — 跨層字面 mapping 工具
 *
 * design 視覺真權威(snake_case)與 schema/domain(camelCase)之間的 tier 字面 mapping。
 *
 * 三層字面分歧背景:
 * - schema / wire / TS type: `'premiumStore'`(camelCase、`MemberTier` 列舉真權威、shared/types.ts L70)
 * - 後台 UI / 業務語意:高級店家(中文)
 * - design-handoff 慣例:`'premium_store'`(snake_case、design Pricing.jsx / TierComponents.jsx / WalletTab.jsx 字面)
 *
 * 對齊 lessons-learned.md §12-5 + working-style.md 第 15 條三層字面對應教訓。
 *
 * 跨 package re-export 規則:domain/src/index.ts 必加具名
 * `export { designTierToSchema, schemaTierToDesign, toMemberTier }`(對齊 ADR-0003 §3.1.1
 * runtime helper 規則、避免 M-1-02 toMoneyAmount typecheck fail 同類踩坑)。
 * ⚠️ ~~原本這裡只列兩個~~ —— **本檔新增函式時,這一行要跟著改**:
 *    照它補的人會漏掉沒列出來的那個,而 `index.ts` 少一行 export **不會有任何東西紅**
 *    (它只在有人 import 那個名字的那一刻才炸)。
 *
 * @see docs/lessons-learned.md §12-5
 * @see docs/working-style.md §6.3 第 15 條
 * @see packages/domain/src/shared/types.ts:MemberTier
 * @see design-reference/components/Pricing.jsx
 */

import type { MemberTier } from './types';

/**
 * design 視覺真權威 tier 字面(snake_case)→ schema/domain tier 列舉(camelCase)。
 *
 * design Pricing.jsx / TierComponents.jsx / WalletTab.jsx 用 `'premium_store'` snake_case、
 * schema/domain MemberTier 用 `'premiumStore'` camelCase(對齊 packages/domain/src/shared/types.ts:70)。
 * 對齊 lessons §12-5 + working-style.md 第 15 條三層字面對應教訓。
 *
 * mapping table:
 * - `'general'`       → `'general'`
 * - `'store'`         → `'store'`
 * - `'premium_store'` → `'premiumStore'`
 *
 * 非法輸入處置:throw TypeError、不 fallback 不回 null(對齊 toMoneyAmount 嚴格 guard 慣例)。
 *
 * @param design tier 字面(`'general'` | `'store'` | `'premium_store'`)
 * @returns MemberTier(`'general'` | `'store'` | `'premiumStore'`)
 * @throws TypeError 若 design tier 不在 3 個合法值內
 */
export function designTierToSchema(design: string): MemberTier {
  switch (design) {
    case 'general':
      return 'general';
    case 'store':
      return 'store';
    case 'premium_store':
      return 'premiumStore';
    default:
      throw new TypeError(
        `designTierToSchema: invalid tier ${JSON.stringify(design)}, expected 'general' | 'store' | 'premium_store'`,
      );
  }
}

/**
 * 把**來源不可信的值**(DB 讀出來的 `customers.tier`、外部 API、JSON)收斂成 `MemberTier`。
 * 認不得就回 `null` —— **不 throw**。
 *
 * 🔴 **為什麼它與 `designTierToSchema` / `schemaTierToDesign` 的處置相反(那兩支 throw)**:
 *    那兩支的輸入是**程式自己**產生的(已經是 `MemberTier` 或 design 字面)⇒ 到不了 `default` 就是 bug
 *    ⇒ **大聲炸掉是對的**。而本支的輸入是**信任邊界外面**來的
 *    ⇒ 它拿到不認得的值是**正常會發生的事**(DB 的 enum 多一個值就會),不是 bug。
 *    ⚠️ **不要把這支拿去「簡化」那兩支** —— 三支的輸入來源不同,處置本來就該不同。
 *
 * 🔴 **`#873`:它存在的理由是一個真的缺陷,不是防禦性編程。**
 *    2026-08-24 實測(`apps/storefront/src/components/CheckoutSummaryAside.test.tsx`):
 *    餵一個 DB 有、TS 不認得的 tier 進結帳頁 ⇒
 *    `TypeError: schemaTierToDesign: unreachable tier …` **在 render 當下丟出**。
 *    ⇒ 那位客人的結帳頁掛掉,**他結不了帳**。而 `as MemberTier` 裸 cast **編譯照樣綠**。
 *
 * ⚠️ **退化方向由呼叫端決定,而本 repo 已有拍板**:
 *    `apps/storefront/src/lib/tier.ts` 逐字「**退化方向只准往下** —— 任何不確定都回 `'general'`,
 *    **不得回經銷 tier**」。⇒ 呼叫端拿到 `null` 時請照那條走,並**留一行 log**(同檔 codex R2 nit:
 *    「enum 漂移/版本落後會**無聲把一個經銷會員降級**。降級方向是對的,但它不該安靜」)。
 *
 * 📌 已知重複:`apps/storefront/src/lib/tier.ts` 有一支同義的私有 `toSchemaTier`。
 *    **本片沒有合併它** —— 那支檔當下正被 `#215` 那條線改著。合併是它收工之後的事。
 */
export function toMemberTier(raw: unknown): MemberTier | null {
  return raw === 'general' || raw === 'store' || raw === 'premiumStore' ? raw : null;
}

/**
 * schema/domain MemberTier(camelCase)→ design 視覺真權威 tier 字面(snake_case)。
 *
 * 反向 mapping、storefront 需要傳 tier 字串給 design 元件時用。
 *
 * mapping table:
 * - `'general'`       → `'general'`
 * - `'store'`         → `'store'`
 * - `'premiumStore'`  → `'premium_store'`
 *
 * exhaustive check 用 `never` assertion(TypeScript 編譯時擋未列舉 case;
 * runtime 不應到 default、若到表示 MemberTier 列舉擴張未同步本函式)。
 *
 * @param tier MemberTier(`'general'` | `'store'` | `'premiumStore'`)
 * @returns design tier 字面(`'general'` | `'store'` | `'premium_store'`)
 * @throws TypeError 若 tier 不在 MemberTier 列舉內(unreachable、防 MemberTier 擴張未同步)
 */
export function schemaTierToDesign(
  tier: MemberTier,
): 'general' | 'store' | 'premium_store' {
  switch (tier) {
    case 'general':
      return 'general';
    case 'store':
      return 'store';
    case 'premiumStore':
      return 'premium_store';
    default: {
      // exhaustive check:MemberTier 列舉若擴張、此處 TypeScript 編譯時 fail
      const _exhaustive: never = tier;
      throw new TypeError(
        `schemaTierToDesign: unreachable tier ${String(_exhaustive)}`,
      );
    }
  }
}
