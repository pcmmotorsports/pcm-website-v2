'use server';

// invoice-title-lookup-action.ts — 統編查抬頭那一發(⟦b4-INVOICE5PCT⟧三 片二)。
//
// ⛔ ~~🔴🔴 **它今天【還沒有來源】, 而那是刻意的一個狀態, 不是沒做完。**~~
//    ⛔ ~~Sean 拍 ③甲:把政府開放資料**整包匯進我們自己的庫**。~~
//    ✅ **⇒ 2026-09-10 他改拍 甲′, 逐字:「查的當下去問政府 API, **自己不存**」(推薦)。**
//       📌 **差別不是實作細節, 是【我們存不存那份資料】** —— 甲′ 不存 ⇒ 零同步、零保管。
//       ⇒ **來源已接上**:`./invoice-title-source-gcis`(經濟部商業發展署「統編查公司名稱」)。
//    🔵 **而 `not_wired` 那條路【留著】** —— 它今天到不了, 而它是**下一次換來源時**
//      那個「還沒接上」與「查不到」分得開的位置。🎯 兩者對員工是不同的指示:
//      「還沒接上」⇒ 你自己打;「查不到」⇒ 你統編是不是打錯了。
//
// 🛑 **從 server 打, 不從瀏覽器打** —— 而這一格已經定了:
//    瀏覽器打會把**我們的來源**暴露給那個站, 而那是一個我們不需要付的代價。
//    ⇒ 本檔是 server action ⇒ 來源接上去的那天, 那一發從我們的機器出去。
//
// 🔵 **fail-open 的殼在 `invoice-title-lookup.ts`, 而它已經驗完了**(六格 + 一發突變)——
//    本檔只負責「用哪一個 fetcher」與「怎麼把結果講給員工聽」。

import { authorizeAdminMutation } from '../session/authorize';
import {
  lookupInvoiceTitle,
  type InvoiceTitleFetcher,
  type InvoiceTitleLookupResult,
} from './invoice-title-lookup';
import { gcisFetcher, pickGcisTitle } from './invoice-title-source-gcis';

/**
 * 🔴 授權那一段的上限。**與查詢那 1,500 ms 是兩段** ⇒ 最壞 3 s。
 *    ⚠️ **不要把它讀成「查抬頭 1.5 秒」** —— 那句話只對查詢那一半成立(codex R1 must-fix ③)。
 */
const AUTHORIZE_BUDGET_MS = 1_500;

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

type InvoiceTitleSource = {
  readonly fetcher: InvoiceTitleFetcher;
  readonly pickTitle: (body: unknown) => string | null;
};

/**
 * 來源。🔴 **`null` = 還沒接** —— 它今天回得出東西(經濟部那支),
 * 而**這個回傳型別留著 `null`**:換來源的那一天,「還沒接上」與「查不到」要分得開。
 *
 * 🛑 **fetcher 與 pickTitle 一定要成對** —— `pickTitle` 認的是**那一家**的回傳形狀,
 *    換了一家而忘了換解析 ⇒ 它會**每一次都回 `null`**, 而畫面說的是「查不到」
 *    ⇒ 📌 **一個看起來完全正常的全盤失效。** 綁在同一個物件裡, 換的時候換不掉一半。
 */
function readSource(): InvoiceTitleSource | null {
  return { fetcher: gcisFetcher, pickTitle: pickGcisTitle };
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
  //
  // 🔴🔴 **[codex R1 must-fix ③]**:那 1,500 ms 是**查詢**的上限, **它沒有涵蓋這一段等待**。
  //    codex 離線探針:讓授權一直 pending ⇒ 超過 1,650 ms 本 action 仍未回;
  //    而 Next 會把後續 server action **排隊**, 建單本身也是 server action
  //    ⇒ 📌 **「送出鈕沒有 disabled」證不到建單沒被拖住。**
  //    ✅ ⇒ 這一段自己也要有上限。**總上限因此是兩段相加(≤3 s), 而不是 1.5 s** —— 寫出來不含糊。
  //    🛑 而逾時**不繼續往下打政府那一發** —— 一個已經拖了 1.5 秒的人, 不該再等 1.5 秒。
  //    🛑 **而它擋不住的那一半, 寫在這裡不遮**(codex R2 must-fix ②):
  //      這一層只讓**回應**有上限;底下 `authorizeAdminMutation → … → listStaffRows`
  //      那條查詢**沒有收取消訊號** ⇒ 逾時之後它還在跑, 慢資料庫時重按會**疊請求**。
  //      ⇒ 📌 **真正的修法是把取消訊號傳到底層** —— 而那要動 `staff-repository` 那一族(共用),
  //        **是鐵則 8 的射程, 要先寫 plan** ⇒ 不在這一片。
  let auth: Awaited<ReturnType<typeof authorizeAdminMutation>>;
  // 🔵 [codex R2 nit③] handle 留著並在 finally 清掉 —— 它會自己到期, 而留著一顆沒人清的
  //    計時器是那種「不是錯而每次都要重想一遍」的東西。
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    auth = await Promise.race([
      authorizeAdminMutation(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), AUTHORIZE_BUDGET_MS);
      }),
    ]);
  } catch {
    // 🔴 **[codex R1 must-fix ②]** 授權自己 reject(DB 掛了 / 網路斷)⇒ 舊寫法直接穿出去,
    //    而呼叫端沒有 catch ⇒ 📌 **fail-open 在這一格是破的。** 這裡吃掉它。
    return { ok: false, reason: 'denied' };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  if (auth === null) return { ok: false, reason: 'denied' };

  // 🔵 統編明顯不對 ⇒ **在這裡就答完**, 一發都不打(殼裡也擋一次, 兩層都要)。
  // 🔴 **[codex R1 must-fix ②]** `typeof` 那一格不能省 —— server action 的參數**來自網路**,
  //    型別註記在執行期什麼都不是。codex 實測:傳 `null` / `{}` / 數字 ⇒ `.trim()` 直接 `TypeError`。
  const taxId = typeof args?.taxId === 'string' ? args.taxId.trim() : '';
  if (!/^\d{8}$/.test(taxId)) return { ok: false, reason: 'invalid' };

  const source = readSource();
  if (source === null) return { ok: false, reason: 'not_wired' };

  // 🛑 走到這裡代表來源接上了。**而這一支永遠不 throw** —— 那是殼的承諾(見殼檔頭),
  //    不是這裡的 try/catch。⇒ 📌 呼叫端沒有 catch 可以忘記寫。
  //    🔴 送出去的是**上面驗過的那一個** `taxId`, 不是 `args.taxId` —— 兩者不同步就是下一個坑。
  const out: InvoiceTitleLookupResult = await lookupInvoiceTitle(
    taxId,
    source.fetcher,
    source.pickTitle,
  );
  return out.ok ? { ok: true, title: out.title } : { ok: false, reason: 'lookup_failed' };
}
