import type { AdminSessionSub } from './session';

/**
 * 「這張票該不該查【他還在職嗎】」的**分流決定** —— 純函式,不碰 cookie、不碰 DB、不碰 `next/headers`。
 *
 * 🔴 **本檔 2026-08-26 換過一次落點,而【分流邏輯一個字沒改】。** 留痕,因為下一個人會問為什麼:
 * ```
 * 舊(B5-b)  proxy.ts 每一個請求都查     ⇒ 停用後【立刻】擋
 * 新(B5-b′) callback 簽票那一刻查一次   ⇒ 停用後【下次換票時】才擋
 * ```
 * **Sean 2026-08-26 拍板走新的**(逐字「只有登入那一刻問一次」)。
 * 換的理由不是效能,是 codex R3 那條:每個請求都查 ⇒ `staff` 表單獨故障就會**讓整個後台停擺**,
 * 而那種故障下「有這道閘」比「沒這道閘」更糟。⇒ 詳 `#935`。
 *
 * ## 規格來源(逐字,兩種落點都適用)
 * `docs/specs/2026-08-17-m4b-e8b-b5-spec.md` §7.1「read / write 矩陣」三條硬規定:
 * 1. **先 branch `sub.kind`,再決定要不要查名單** —— 不是「一律查」。
 *    一律查 ⇒ `fallback` / `bootstrap` 沒有 `staff_id`,連唯讀都進不去(規格點名的壞世界①)。
 * 2. `fallback` 那一支**不得**沿用 `ACTOR_COOKIE` 補身分(壞世界②)。
 *    ⇒ 本函式**完全不知道 `ACTOR_COOKIE` 的存在**,所以那條路在這裡構造不出來。
 * 3. `bootstrap` 同 `fallback`:它**沒有** `staff_id`,查它本身就是型別錯誤。
 */
export type StaffGatePlan =
  /** 直接放行(唯讀能力;寫入另有閘)。 */
  | { readonly kind: 'allow'; readonly why: 'no-identity' | 'fallback' | 'bootstrap' }
  /** 要拿這個 `staffId` 去問 A 庫「他還在職嗎」,回 null ⇒ 不簽票。 */
  | { readonly kind: 'require-active-staff'; readonly staffId: string };

/**
 * 依上游送來的身分決定簽票前要不要查名單。
 *
 * 🔴 **`sub` 是 `undefined`(上游沒送身分)⇒ `allow`,而這【不是】疏漏。**
 *    旗標 `ADMIN_REQUIRE_REAL_IDENTITY` 開著時,「沒有 `sub`」在**更上游**就被拒了
 *    (`callback/route.ts` 的 `requireRealIdentity() && !result.sub` ⇒ 顯式 500)。
 *    ⇒ 走得到本函式的 `undefined` 只存在於**旗標關著**的世界 = 改動前的今天。
 *    ⇒ 在那個世界回 `allow` = **本片對舊行為零改變**(回歸格 `[R1]` 守這一句)。
 *    ⚠️ 反過來說:**本函式不是旗標的替身**。它不讀旗標,也不該讀 ——
 *       讀了就會有兩個地方決定同一件事,而它們會漂。
 */
export function planStaffGate(sub: AdminSessionSub | undefined): StaffGatePlan {
  if (sub === undefined) return { kind: 'allow', why: 'no-identity' };

  switch (sub.kind) {
    case 'user':
      return { kind: 'require-active-staff', staffId: sub.staff_id };
    case 'fallback':
      // 共用密碼備援登入:一種明確的身分,而它沒有具名操作者 ⇒ 唯讀放行,不查名單。
      // ⚠️ **本片的射程就卡在這一格**:停用的員工若仍知道共用密碼,走這條路照樣讀得到。
      //    那是規格 §7.1 明文拍過的,本片不改它;登記在 `#935`,與 `#645` 一起看。
      return { kind: 'allow', why: 'fallback' };
    case 'bootstrap':
      // 首次建置(SETUP_SECRET):同上,它沒有 staff_id。
      return { kind: 'allow', why: 'bootstrap' };
    default: {
      // 🔴 **exhaustive check,不是防禦性編程**(形狀抄 `actor.ts` 的同一段):
      //    日後 `AdminSessionSub` 加第四種變體時**這一行會編譯紅**。
      //    而規格點名的病正是「寫成 if (kind==='fallback') 之後,新變體【靜默】走到 user 那一支」。
      // ⚠️ runtime 走到這裡是不可達的(`sanitizeSub` 已擋掉不認得的 kind);
      //    萬一到了 ⇒ **當成要查名單(fail-closed),不是放行**。
      //    空 `staffId` 下游會被 `resolveActiveStaffById` 的 `if (!id) return null` 擋掉 ⇒ 一定不簽票。
      const exhaustive: never = sub;
      void exhaustive;
      return { kind: 'require-active-staff', staffId: '' };
    }
  }
}
