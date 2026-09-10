'use server';

// invoice-title-lookup-action.ts — 統編查抬頭那一發(⟦b4-INVOICE5PCT⟧三 片二)。
//
// 🔴🔴 **它今天【還沒有來源】, 而那是刻意的一個狀態, 不是沒做完。**
//    Sean 拍 ③甲:把政府開放資料**整包匯進我們自己的庫**。而那件事的成本
//    (資料多大 · 多久更新 · 授權條款 · 誰跑那支同步)**還沒量完**
//    ⇒ 📌 **在來源定案之前, 這一支走一條【明白說出「還沒接上」】的路** ——
//      而**不是**回一個看起來像「查不到」的答案。
//    🎯 兩者對員工是不同的指示:「還沒接上」⇒ 你自己打;「查不到」⇒ 你統編是不是打錯了。
//
// 🛑 **從 server 打, 不從瀏覽器打** —— 而這一格已經定了:
//    瀏覽器打會把**我們的來源**暴露給那個站, 而那是一個我們不需要付的代價。
//    ⇒ 本檔是 server action ⇒ 來源接上去的那天, 那一發從我們的機器出去。
//
// 🔵 **fail-open 的殼在 `invoice-title-lookup.ts`, 而它已經驗完了**(六格 + 一發突變)——
//    本檔只負責「用哪一個 fetcher」與「怎麼把結果講給員工聽」。

import { authorizeAdminMutation } from '../session/authorize';
import { lookupInvoiceTitle, type InvoiceTitleLookupResult } from './invoice-title-lookup';

export type InvoiceTitleActionResult =
  | { ok: true; title: string }
  /**
   * 🔴 `reason` 只有兩種對員工有意義的分別:
   *    · `not_wired` = **我們還沒接來源** ⇒ 你自己打, 而這不是你的錯
   *    · 其餘一律 `lookup_failed` ⇒ 你自己打
   *    📌 六種內部 reason **不往上報** —— 畫面對它們的反應必須一模一樣,
   *      分開講只會讓員工去猜哪一種要重試(而答案是:都不要, 自己打)。
   */
  | { ok: false; reason: 'not_wired' | 'invalid' | 'lookup_failed' | 'denied' };

/**
 * 來源。🔴 **`null` = 還沒接** —— 而它不是一個開關,是一個**還沒做的決定**。
 * ⇒ 接上去的那天,這裡回一個真的 fetcher + 一個對得上那家 API 的 `pickTitle`。
 */
function readSource(): null {
  return null;
}

export async function lookupInvoiceTitleAction(args: {
  taxId: string;
}): Promise<InvoiceTitleActionResult> {
  // 🔴🔴 **要授權 —— 而理由不是「它改了什麼」, 是【它用我們的機器對外打一發】。**
  //    ⛔ ~~「這只是查詢, 不改任何東西, 不用授權」~~ ⇒ 那句話漏掉了受詞:
  //      來源接上去之後, 任何人都叫得動這一支 ⇒ 📌 **他就把我們當成一台免費的代理**,
  //      而那家 API 看到的來源是**我們**。配額、封鎖、對方的紀錄, 全部算在我們頭上。
  //    ✅ 而 `server-action-guard-sweep` 那道閘當場抓到我 —— 它掃的是
  //      「每一支 `'use server'` 都要有 `authorize*Mutation(`」。**修法是加授權, 不是進白名單。**
  const auth = await authorizeAdminMutation();
  if (auth === null) return { ok: false, reason: 'denied' };

  // 🔵 統編明顯不對 ⇒ **在這裡就答完**, 一發都不打(殼裡也擋一次, 兩層都要)。
  if (!/^\d{8}$/.test(args.taxId.trim())) return { ok: false, reason: 'invalid' };

  const source = readSource();
  if (source === null) return { ok: false, reason: 'not_wired' };

  // 🛑 走到這裡代表來源接上了。而下面這段在那天才會被寫出來 ——
  //    現在留一條**型別上到不了**的路,比留一個半成品的 fetcher 誠實。
  const out: InvoiceTitleLookupResult = await lookupInvoiceTitle(
    args.taxId.trim(),
    source,
    () => null,
  );
  return out.ok ? { ok: true, title: out.title } : { ok: false, reason: 'lookup_failed' };
}
