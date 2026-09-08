// hct-unknown-kind.ts — 一箱 `unknown` 的兩型:新竹【沒回】(甲)vs 新竹【回過話而我們讀不懂】(乙)。
//    ⟦ship-UNKNOWNTYPEUNREAD⟧。
//
// 🔴🔴 **為什麼要分, 而且是現在**:兩型在畫面上長得一模一樣, 而值班的處置【相反】——
//    甲型 runbook 教他打電話問「新竹是不是沒收到」, 然後把箱放回草稿重送;
//    而**乙型的箱新竹收到了** ⇒ 📌 **重送 = 第二張託運單 = 客人收到兩箱、兩個追蹤號。**
//    🛑 而 `shipment-hct-unknown-notice.tsx` 的註解**早就寫著**「乙型那顆鈕不出現」——
//      🎯 **那句話今天是【假的】**:佔位標記 `placeholder: true` 是我們在 HTTP 發出去
//      **之前**自己寫的, 窄門(`recordHctUnknownReason`)只往 raw 加一把 `unknownReason` 鑰匙、
//      **不會把它拿掉**, 而 `hct_request_id` 兩型都是 `null`
//      ⇒ 📌 **舊判定的三個條件, 乙型【全部】命中 ⇒ 那顆鈕對乙型照樣亮。**
//
// 🔴 **它是【白名單】不是黑名單, 而那個方向是刻意的**:
//    列在下面的值 ⇒ 乙型;**沒列到的一律落甲型**。
//    ⇒ 🎯 新增一種 `flowReason` 時, 預設行為 = **今天的行為**(甲型), 不是一個沒有人驗過的新斷言。
//    ⚠️ 黑名單會反過來:漏列一個 ⇒ 新的值被判成「新竹回了」⇒ 值班照乙型處置,
//      而**乙型是沒有出口的那一型 ⇒ 那個誤判會安靜地把箱鎖住, 沒有人會發現。**

/**
 * 這一箱的 `unknown` 屬於哪一型。
 *
 * · `placeholder-no-reply`(甲)新竹**沒回**(或我們證不到它回了)⇒ 舊有的重設出口適用。
 * · `carrier-replied`(乙)新竹**確定回過話**而我們讀不懂 ⇒ 🛑 **不准給重設出口。**
 */
export type HctUnknownKind = 'placeholder-no-reply' | 'carrier-replied';

/**
 * 「新竹的 SOAP 服務**確定回過話**」的那幾種 `flowReason`。
 * 🔬 值域**量自 `hct-client.ts`(2026-09-08)**, 不是憑印象列的:
 *    `:285 soap_fault` · `:321 row_count_<n>` · `:330 epino_mismatch`
 *    · `:345 unrecognised_success_<x>` · `:397 unrecognised_query_<x>`
 *    —— 這五種的共同點是**我們已經把回應解析到應用層了**, 只是內容不合預期。
 *
 * 🛑 **刻意【不】列進來的四種, 各有理由**(它們落甲型 = 維持今天的行為):
 *    `network: *`(`:259`)連線層就炸了 ⇒ 對面可能什麼都沒看到。
 *    `http_*`(`:270`)有 HTTP 回應, 而 5xx 可能來自中間的 gateway ⇒ **不代表新竹的應用收到**。
 *    `body_read: *`(`:280`)header 回來了而 body 讀不到 ⇒ 讀不到就不知道對面做了什麼。
 *    `body_not_soap_json`(`:288`)拿到 body 而它不是 SOAP ⇒ 可能是 WAF 的錯誤頁, 不是新竹回的。
 */
const CARRIER_REPLIED_EXACT: ReadonlySet<string> = new Set(['soap_fault', 'epino_mismatch']);
const CARRIER_REPLIED_PREFIX: readonly string[] = [
  'row_count_',
  'unrecognised_success_',
  'unrecognised_query_',
];

/**
 * 從 `shipments.hct_raw_response` 整包裡挖出窄門寫的那個原因字串。
 *
 * 🔴 形狀是**兩層**, 而那是 `20260908020000` 那支 RPC 決定的:
 *    `{ unknownReason: { flowReason: '<字串>', evidence?: '<原文>' } }`
 *    ⇒ 📌 RPC 逐字 `jsonb_build_object('unknownReason', p_reason)`, 而 `p_reason`
 *      來自 `hct-submit-flow.ts:163-167` 的 `{ flowReason: out.reason }`。
 * 🔵 每一層都先確認**是物件而不是陣列**(`typeof [] === 'object'`), 挖不到就回 `null`
 *    ⇒ 挖不到 ⇒ 落甲型(保守側)。
 */
function readFlowReason(raw: unknown): string | null {
  const obj = (v: unknown): Record<string, unknown> | null =>
    v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  const wrap = obj(obj(raw)?.['unknownReason']);
  const reason = wrap?.['flowReason'];
  return typeof reason === 'string' && reason !== '' ? reason : null;
}

/**
 * 判這一箱的 `unknown` 是哪一型。**永遠回得出一型** —— 挖不到原因就是甲型。
 *
 * 🔴 **它讀的是那個字串的【值】, 不是「有沒有原因這個欄位」** ——
 *    因為 `unknownReason` 對**沒回**的那幾種(`network:*` / `http_*` / `body_read:*`)
 *    **也會有值**, 而那些仍然是甲型。⇒ 📌 存在與否零判別力, 值才有。
 */
export function classifyHctUnknown(raw: unknown): HctUnknownKind {
  const reason = readFlowReason(raw);
  if (reason === null) return 'placeholder-no-reply';
  if (CARRIER_REPLIED_EXACT.has(reason)) return 'carrier-replied';
  return CARRIER_REPLIED_PREFIX.some((p) => reason.startsWith(p))
    ? 'carrier-replied'
    : 'placeholder-no-reply';
}
