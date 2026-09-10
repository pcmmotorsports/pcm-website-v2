// invoice-title-lookup.ts — ⟦b4-INVOICE5PCT⟧三:統編查抬頭的**失敗殼**。
//
// 🔴🔴 **這一片的靈魂是 fail-open, 不是查抬頭。**
//    plan §3-b 逐字:「那支 API 掛掉時, 建單流程**會不會跟著卡住** ⇒ **必須 fail-open**」
//    ⇒ 📌 **驗收的主格【不是】「查得到」, 是「查不到的時候他照樣建得出單」。**
//    ⇒ ⇒ 所以本檔的每一條路徑都**回值, 不 throw**。呼叫端沒有 catch 可以忘記寫。
//
// 🛑 **本檔【刻意沒有任何網址】** —— 打誰、由誰打(瀏覽器 or server route),
//    是一個**新的對外相依**的選擇:牽到錢(第三方可能收費)與隱私(從瀏覽器打會暴露我們的來源)。
//    ⇒ 那是 Sean 的題, 不是我的。**在他挑之前, 這支模組收一個 `fetcher` 進來。**
//    🔵 而那個形狀不是為了「可測試」才這樣寫 —— 是因為**我還不知道要打誰**,
//      而 fail-open 的殼與那五種失敗**跟打誰無關** ⇒ 這一半現在就驗得完。
//
// 🔴 **逾時上限是硬需求** —— 一個沒有上限的 fetch, 它的 fail-open 是假的:
//    畫面不會報錯, 它只是**永遠不回來**, 而員工看著一顆轉圈的鈕不知道能不能按送出。

/**
 * 🔴 **1.5 秒**。理由(不要改成「反正大一點比較保險」):
 *    · 他**在打字**, 不是在等報表 —— 打完 8 碼到伸手去打抬頭, 中間就這麼長。
 *    · 超過這個數, 他會**先自己打**, 然後查詢結果才回來 ⇒ 那正是「帶入」最危險的時刻。
 *    · 而查不到的代價很小(自己打八個字), 查太久的代價是**他停在那裡**。
 *    ⇒ 🎯 **寧可太早放棄。** 這一格失敗是常態, 不是例外。
 */
export const INVOICE_TITLE_LOOKUP_TIMEOUT_MS = 1_500;

/** 統編是 8 碼數字。🔵 這裡**只擋明顯不是的**, 不驗檢查碼 —— 驗錯了會擋掉合法統編。 */
const TAX_ID_RE = /^\d{8}$/;

export type InvoiceTitleLookupResult =
  | { readonly ok: true; readonly title: string }
  /**
   * 🔴 `reason` 是給**檔案與人看**的, 不是給畫面看的 ——
   *    畫面對這六種的反應**必須一模一樣**(讓他自己打), 否則 fail-open 就分岔了。
   */
  | { readonly ok: false; readonly reason: 'invalid' | 'timeout' | 'network' | 'http' | 'empty' | 'garbage' };

/** 呼叫端注入。🔴 回傳 `Response`, 而**它可以 throw** —— 本檔負責把 throw 變成值。 */
export type InvoiceTitleFetcher = (taxId: string, signal: AbortSignal) => Promise<Response>;

/**
 * 統編 → 抬頭。**永遠不 throw, 永遠在上限內回來。**
 *
 * 🛑 **不快取、不重試。** 重試會把 1.5 秒的上限變成 3 秒或 4.5 秒
 *    ⇒ 📌 **一個帶重試的逾時上限, 不是上限。**
 */
export async function lookupInvoiceTitle(
  taxId: string,
  fetcher: InvoiceTitleFetcher,
  pickTitle: (body: unknown) => string | null,
): Promise<InvoiceTitleLookupResult> {
  if (!TAX_ID_RE.test(taxId)) return { ok: false, reason: 'invalid' };

  let res: Response;
  try {
    res = await fetcher(taxId, AbortSignal.timeout(INVOICE_TITLE_LOOKUP_TIMEOUT_MS));
  } catch (e) {
    // 🔴 逾時與網路不通**分開記** —— 兩者對畫面一樣, 而對「要不要換一家」不一樣。
    const name = e instanceof Error ? e.name : '';
    return { ok: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network' };
  }

  if (!res.ok) return { ok: false, reason: 'http' };

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    // 🔴 回垃圾(HTML 錯誤頁 / 半截 JSON)⇒ 這裡就吃掉。`res.json()` 會 throw, 而它常常被忘記。
    return { ok: false, reason: 'garbage' };
  }

  let title: string | null;
  try {
    // 🛑 `pickTitle` 是**別人寫的**(它跟著選哪一家 API 走)⇒ 它 throw 也不准穿出去。
    title = pickTitle(body);
  } catch {
    return { ok: false, reason: 'garbage' };
  }

  // 🔴 `''` 與只有空白都算查不到 —— 帶一個空字串進抬頭欄比不帶更糟(他看不出來查失敗了)。
  const trimmed = typeof title === 'string' ? title.trim() : '';
  return trimmed === '' ? { ok: false, reason: 'empty' } : { ok: true, title: trimmed };
}
