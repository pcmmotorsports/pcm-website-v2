/**
 * 【不准進顧客站】的商品群名單 —— 而它是一道**會紅的門**, 不是一個會變的旗標。
 *
 * ══ 🔴 為什麼要有這一份(2026-09-04)══════════════════════════════════════════
 *
 * `docs/runbooks/supplier-storefront-onboarding.md` 的 preflight `0-b` 逐字寫著:
 *   「**今天擋住它們的是 `is_listed = false` 這個【會變的旗標】, 不是一道守門**
 *     ⇒ 源頭哪天上架它們, 錯的顏色就跟著上, 而**首灌流程本身不會叫**。」
 *
 * 📌 **⇒ 那句話描述的是一個【沒有守門的狀態】, 而不是一個已經被擋住的狀態。**
 *    這份名單把它變成:那幾群只要走到寫入那一步, **當場 throw**。
 *
 * ══ 天花板:它證不到什麼 ═══════════════════════════════════════════════════
 *   ① 它只擋 `syncVariantGroupAtomic` 這一條路。**手動 SQL、Supabase dashboard、
 *      或任何不經過這支腳本的寫入, 它一句話都不會說。**
 *   ② 它認的是 `(supplierSlug, externalId)` 這一對**字面**。源頭若換了群編號,
 *      這份名單**當場失效而不會叫** —— 而那正是它最可能靜靜失效的方式。
 *   ③ 它不驗「那個缺陷還在不在」。**關閉條件寫在每一筆的 `closeCondition` 裡, 靠人去跑。**
 */

export type DeniedGroup = {
  supplierSlug: string;
  /** 來源的群編號(`main_sku` / `external_id`)—— 逐字, 不做正規化。 */
  externalId: string;
  /** 一句話:為什麼不准上。 */
  reason: string;
  /** 🔴 什麼時候可以把這一筆刪掉 —— 逐字抄板列, 不要改寫。 */
  closeCondition: string;
  /** 板上那一列的錨, 讓撞到的人找得到全文。 */
  boardAnchor: string;
};

export const DENIED_GROUPS: DeniedGroup[] = [
  {
    supplierSlug: 'rizoma',
    externalId: 'DM-PW101',
    reason: '「紅色」變體的 spec 在源頭寫成「黑」⇒ 上了會賣錯顏色。',
    closeCondition: '那四支 sku 的 spec 與 sku 尾碼一致, 而重跑本列的 SQL ⇒ rizoma 0。',
    boardAnchor: '⟦supply-RIZOMASPECWRONG⟧',
  },
  {
    supplierSlug: 'rizoma',
    externalId: 'DM-PW201',
    reason: '「紅色」變體的 spec 在源頭寫成「黑」⇒ 上了會賣錯顏色。',
    closeCondition: '那四支 sku 的 spec 與 sku 尾碼一致, 而重跑本列的 SQL ⇒ rizoma 0。',
    boardAnchor: '⟦supply-RIZOMASPECWRONG⟧',
  },
];

/** 在名單上就回那一筆, 不在就回 `null`。 */
export function findDeniedGroup(
  supplierSlug: string,
  externalId: string,
): DeniedGroup | null {
  return (
    DENIED_GROUPS.find(
      (d) => d.supplierSlug === supplierSlug && d.externalId === externalId,
    ) ?? null
  );
}

/** 擋下時要說的話 —— 印【關閉條件】與【板列錨】, 不然被擋的人只知道「不准」。 */
export function deniedGroupMessage(d: DeniedGroup): string {
  return (
    `🔴 ${d.supplierSlug} 的群 ${d.externalId} 在【不准上架名單】上, 拒絕寫入。\n` +
    `   原因:${d.reason}\n` +
    `   關閉條件(逐字抄自板列 ${d.boardAnchor}):${d.closeCondition}\n` +
    `   ⇒ 條件成立之後, 把 scripts/supplier-group-denylist.ts 裡那一筆刪掉再跑。\n` +
    `   🛑 不要改成「跳過這一群繼續跑」—— 那會讓下一次沒有人知道它被跳過了。`
  );
}
