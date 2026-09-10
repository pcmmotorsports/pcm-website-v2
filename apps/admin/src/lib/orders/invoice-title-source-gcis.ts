// invoice-title-source-gcis.ts — 統編查抬頭的【來源】(⟦b4-INVOICE5PCT⟧三 片四)。
//
// ══ 🔴 Sean 拍的是 甲′, 而它推翻了同一件事的舊裁定 ═════════════════════
//    2026-09-10 逐字:「**甲′ = 查的當下去問政府 API, 自己不存**(推薦)」
//    ⛔ ~~舊裁定 ③甲:把政府開放資料【整包匯進我們自己的庫】~~
//      —— 那一句還留在 `invoice-title-lookup-action.ts` 的檔頭, 已在同一顆 commit 訂正。
//    ⇒ 📌 **兩者的差別不是實作細節, 是【我們存不存那份資料】** —— 甲′ 不存 ⇒ 零同步、零保管。
//
// ══ 🔴 為什麼是【經濟部官方】而不是那個工具在用的 g0v ═══════════════════
//    🔬 2026-09-10 兩支各實測一發(統編 `90003020` = 我們自己公司, 沒有拿客人的試):
//      官方  200 · **0.085 s** · **75 B** · 回傳逐字
//            [{"Business_Accounting_NO":"90003020","Company_Name":"派達有限公司"}]
//      g0v   200 · 0.484 s · 3,801 B · 含**代表人姓名 · 公司所在地 · 董監事名單**
//    🎯 **而選官方的第一個理由不是快** —— 是它回的**剛好只有我們要的兩個欄位**。
//       📌 **一個不抓回來的個資, 是最便宜的個資保護。** 快 5.7 倍只是附帶好處。
//    ⚠️ **而 Sean 看到的那個工具用的是 g0v** —— 那與他的字面(「政府 API」)不同,
//       主視窗 2026-09-10 裁:**照他的字面走官方**。要推翻的話推翻那一句, 不是這一支。
//
// ══ 🛑 「我打通了」不等於「不用申請」 ═══════════════════════════════════
//    開發指引(https://data.gcis.nat.gov.tw/od/rule)逐字:
//      「本平臺**系統介接 API** 係透過**來源 IP 進行白名單管控**…」
//      + 要遞「資料介接使用告知書」+ 表格有「**介接使用者每日最大介接次數**」(**數字未標**)
//    🔴 而 2026-09-10 我**沒有申請、沒有白名單**, 那一發照樣 200。
//       兩種解釋我**分不出**:①白名單只管另一族 API ②它有限制而我今天沒撞到。
//    📌 **⇒ 一發成功不等於沒有限制。一個 0 要先問分母, 一個 200 要先問次數。**
//    ✅ 而 fail-open 讓這一格**不擋任何人建單**:真的被擋時, 畫面的行為與「查不到」一模一樣。
//
// ══ 🔴 而這個做法【不會自動滿足】那個白名單, 寫在這裡讓下一個人看得到 ═══
//    我們從 server 打(不從瀏覽器打:①不暴露員工的來源 ②官方管的是來源 IP
//    ③CORS 我沒測)—— **而 Vercel 的 serverless 沒有固定 egress IP**。
//    ⇒ 📌 哪天真的要申請白名單, **這一支不會自動符合它** —— 那是另一件事, 不是這一片。
//
// ══ 🔴 授權條款與顯名標示 —— **我們刻意不標, 而下一個人不必重查一次條款** ═══
//    本資料採「**政府資料開放授權條款－第 1 版**」(https://data.gov.tw/license)。
//    其**第三條(課予義務)第(二)項**逐字:
//      「使用者利用依本條款提供之開放資料, 及後續之衍生物, 應以符合附件所示『顯名聲明』
//        要求之方式, 明確標示原資料提供機關之相關聲明;
//        **未盡顯名標示義務者, 視為自始未取得開放資料之授權。**」
//    ⛔ ~~主視窗 2026-09-10 裁甲:在建單頁統編那一格旁邊加一行小字~~
//    ✅ **Sean 2026-09-10 拍乙 = 不加**, 逐字「**資料來源那一行 -> 拿掉**」(推翻主視窗)。
//    📌 **⇒ 這是一個【被知道而選擇不做】的事, 不是一個【沒有人想過】的事** ——
//       而那兩者在檔案上長得一模一樣, 所以寫在這裡。
//    🔵 **要改回來只需在建單頁加一行小字**, 應標三項(附件「顯名聲明」的格式):
//      ① 提供機關／單位 [年份] [開放資料釋出名稱與版本號]
//         ⇒ 「經濟部商業發展署 2026 統編查公司名稱」(⚠️ **版本號資料集頁面沒有標**)
//      ② 「此開放資料依政府資料開放授權條款進行公眾釋出, 使用者於遵守本條款各項規定
//         之前提下, 得利用之。」
//      ③ 「政府資料開放授權條款:https://data.gov.tw/license」
//    ⚠️ **條款【沒有區分】對外網站與內部工具, 也【沒有規定】標示位置** —— 那一格不是我判的,
//       是條款原文就沒寫。
//
// 🛑 **這支 API 不需要金鑰** ⇒ 本檔與 `.env*` 零關係, 沒有任何值要設。

import type { InvoiceTitleFetcher } from './invoice-title-lookup';

/**
 * 經濟部商業發展署 · 開放資料集「統編查公司名稱」。
 * 出處 https://data.gov.tw/dataset/108337 · 介接說明 https://data.gcis.nat.gov.tw/od/rule
 */
const GCIS_DATASET_URL =
  'https://data.gcis.nat.gov.tw/od/data/api/9D17AE0D-09B5-4732-A8F4-81ADED04B679';

/** 🔵 OData 的 `$filter` 是**一整個字串**(含空白)⇒ 整串編碼, 不要只編中間那一段。 */
export function gcisLookupUrl(taxId: string): string {
  const filter = encodeURIComponent(`Business_Accounting_NO eq ${taxId}`);
  return `${GCIS_DATASET_URL}?%24format=json&%24filter=${filter}&%24skip=0&%24top=1`;
}

/**
 * 🔴 **查不到不是 404** —— 2026-09-10 實測統編 `00000000` ⇒ **HTTP 200 而 body 0 B**。
 *    ⛔ ~~而我第一版把那句寫成「200 + 空陣列」~~ **⇒ [codex R1 nit⑥] 訂正:那是【推的】。**
 *    📌 **我量到的是「200 + 零位元組」, 我沒有看到 `[]`** —— 兩者走的路不同:
 *      · `[]`   ⇒ `res.json()` 成功 ⇒ `pickTitle` 回 `null` ⇒ 殼判 `empty`
 *      · 0 B    ⇒ `res.json()` **throw** ⇒ 殼判 `garbage`
 *      ⇒ ✅ **兩條路最後都是 `lookup_failed`(畫面一樣), 而【它們不是同一件事】。**
 *    ⇒ 🛑 所以「空」不能指望 HTTP 狀態碼, 兩種形狀都要接得住 —— 測試兩種都測。
 */
export function pickGcisTitle(body: unknown): string | null {
  if (!Array.isArray(body) || body.length === 0) return null;
  const first: unknown = body[0];
  if (typeof first !== 'object' || first === null) return null;
  const name: unknown = (first as Record<string, unknown>).Company_Name;
  return typeof name === 'string' ? name : null;
}

/**
 * 🛑 **不設 header、不帶 cookie、不帶認證** —— 這是公開開放資料, 而多送任何東西
 *    都是在告訴對方我們是誰。`fetch` 的 `signal` 由殼給(1,500 ms 上限, 見殼檔頭)。
 */
export const gcisFetcher: InvoiceTitleFetcher = (taxId, signal) =>
  fetch(gcisLookupUrl(taxId), { signal, cache: 'no-store' });
