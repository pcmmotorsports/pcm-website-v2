import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import { listRefundExceptions } from '../payment/refund-read';
import { todayTaipeiRange } from './today-view';

// today-read.ts — `#16` 今日對帳:首頁**三格**的唯讀查詢(IO 層)。
//    🪦 原本四格;「今日退款」於 2026-08-15 拆掉(見 `today-view.ts` 墓碑段)。
//    🔴 **「四格 / 四支」的過期字面已掃過改齊 —— 而這句話本身被審查打過一次,值得留著**:
//       ① codex 點名 4 處 → 我在**本檔**概念詞掃描實得 **8 處**(`四格|四支|另外三格`)
//       ② 我於是寫下「**所有**四格/四支的字面已一併掃過改齊」——
//          🔴 **而我掃的是一支檔,句子讀起來像整片。** SOP ⑥ 的 code-reviewer 抓到
//          姊妹檔(`page.tsx` / `page.test.tsx` / `today-summary.tsx` / `today-summary.test.tsx`)
//          **還殘留 8 處**,後續又自己補到 **10 處**(`四個數`、「走下一格」)。
//       ⇒ **「宣稱的作用域 > 實際查過的範圍」,而這次連指揮者一起沒看出來。**
//       ⇒ 現行事實:**已用 `bash scripts/literal-sweep.sh '四格'` 掃全樹**、逐類看完;
//          admin 側殘留 0(storefront 品牌頁的「信任狀四格」是不相干的同字面,不動)。
//
// 🔴 **形狀層在隔壁 `today-view.ts`**(日界換算 + 兩個加總,純函式)。
//    分兩支的理由 = **純函式的測試不需要任何 mock**;混在一起會讓算術那幾格也被迫扛 mock 樣板。
//    ⚠️ **本檔第一版寫的分檔理由是假的**(reviewer MF3):它宣稱「`server-only` 在 vitest 會 throw
//    ⇒ 純函式留在這裡一格都測不到」。**不成立** —— `vi.mock('server-only', () => ({}))` 在本 repo
//    有 **90 支測試檔**在用(數法
//    `grep -rln "vi.mock('server-only'" apps packages --include='*.test.ts' --include='*.test.tsx' | wc -l`),
//    最近的一支就在同一條線的隔壁:`lib/payment/refund-recovery-read.test.ts:1-10`。
//    那個假理由當時還被我拿來當「IO 層零覆蓋」的免責依據 ⇒ **兩者一起作廢,本檔現在有測試。**
//
// 🔴 **承重不變式:「已收 = SUM(amount)」**(`20260810100000_m4b_e10_op1_order_payments_m.sql:197`;
//    同檔 `:82` 舉 `500-500+500=500`)。沖銷列帶負值(`:199` `CHECK (amount <> 0)`)
//    ⇒ **不得**過濾負列、**不得**改用 COUNT。
//    ⚠️ **但那是「全表」不變式,套上日期窗之後語意會變** —— 跨日沖銷見 `today-view.ts` 的說明段。
//
// 🔴 **三個時點欄各不相同,而且都要取「事情真的發生的那一刻」、不是「這列被建出來的那一刻」**:
//    · 收款 → `received_at`(`20260810100000:217-218` 逐字「實際收到錢的時點,不是登錄時間」;
//      `:427` COLUMN COMMENT 逐字「**對帳看這欄**」)
//    · 🪦 **退款 → `confirmed_at`(這條 2026-08-15 隨查詢一起拆掉,以下保留為重做時的依據)**
//      (🔴 **reviewer MF1 更正:第一版錯用 `created_at`**)。
//      `confirmed_at` 由 **DB 決定**:`20260803150000:381-383` 逐字「confirmed_at 由 DB 決定
//      (凍結呼叫端可造假的時間=沒有意義)」+ `NEW.confirmed_at := now()`;且 write-once
//      (`20260801120000:325-329` 的 `a7c_update_settlement_fields_write_once`)
//      ⇒ **與 `received_at` 完全同構,而我原本只把那套論證套在收款上、沒套到退款。**
//      🔴 用 `created_at` 的實際後果:TapPay 退款**隔日生效**、隔日才 confirmed 是常態
//      ⇒ 昨天建今天完成的看不到、今天建但仍 `processing` 的也看不到
//      ⇒ **這格會幾乎每天恆為 0,而且零錯誤訊號。**
//    · 新單 → `orders.created_at`(建單就是那一刻,沒有第二個時點)。
//
// 🔴 **顯式 `.limit()`**(reviewer MF4):PostgREST 有 `db-max-rows`,不帶 `.limit`
//    **不是**「無截斷」而是「在那個上限處被平台靜默截斷」——house 字面在 `../payment/refund-read.ts:67-70`。
//    🔴 **那個上限現在是 2000,不是 1000**(V 窗 2026-08-18 對正式站實測:
//    `products?select=id&limit=5000` ⇒ HTTP 206、`content-range 0-1999/19777`;~~2026-08-02 記載的 1000~~ 已過期。
//    **本檔作者未自驗,轉錄 V 窗量測**)。⚠️ 而**本段的結論不依賴那個數字是多少** ——
//    它依賴的是「不帶 `.limit` 會被靜默截斷」這件事,而那件事與上限的值無關。
//    對**加總**而言截斷 = **金額只會偏小、且不報錯**,正是本檔最怕的壞法。
//    ⇒ 取 N+1 判斷,超過就把旗標送到畫面,**寧可說「這個數字不完整」也不給一個安靜的錯數字**。

// ══ 🪦 `TODAY_REFUNDS_LIMIT` 隨「今日退款」那一格一起拆掉(2026-08-15)═══════
//
// 它是**退款**加總查詢的顯式上限(取 500,嚴格低於伺服器 `db-max-rows`
// —— 當時記載 1000,2026-08-18 起實測 **2000**;**兩個值之下 500 都嚴格更小 ⇒ 本段結論不受影響**),
// 存在理由 = 撞到上限時**旗標亮得起來**、而不是把超出的錢靜默吃掉。
// 🔴 **拆掉它不是因為那條守門沒用,是因為它守的那個查詢整個不見了** ——
//    現在**三支**查詢裡**沒有任何一支在 TS 端撈列再加總**:收款走 RPC(SQL 端加總、物理上無列可截)、
//    新單走 `count: 'exact', head: true`、異常那支的上限與截斷由 `refund-read.ts` 自己擁有。
// ⚠️ **重做退款那格時**:若走 RPC(正解方向)⇒ **不需要**這個常數;
//    若又變成撈列再加總 ⇒ **必須把它連同 `toBeLessThan(1000)` 那格守門一起帶回來**,
//    理由見 `order-notes.ts:29` 逐字「請求端自己夾一個**嚴格低於實測上限**的值」。
//    🔴 那條坑我踩過:第一版寫 `1000` + `.limit(1001)` ⇒ 伺服器最多回 1000
//       ⇒ `length > 1000` **恆假** ⇒ 旗標恆不亮、測試照樣全綠。**別再踩一次。**

// 🔴🔴 **`null` = 「這一格沒讀到」,絕不等於 0**(R2 nit7 的型別地基)。
//    三支查詢彼此獨立,一支掛掉不該讓另外兩支跟著消失 —— 但**更不能**把讀取失敗顯示成 `0`,
//    那正是「一個安靜的錯數字」。⇒ 失敗用 `null` 表達,顯示端渲染「讀取失敗」而不是數字。
//    ⚠️ **這修正了本檔上一版的一句話**:原寫「任何一個失敗就整個拋 —— 寧可讓這一區顯示錯誤」。
//    **原則沒變**(絕不顯示少算過的數字),但「整區一起倒」不是實現它的唯一方式,
//    而且它讓退款查詢掛掉時連帶蓋掉**今天收了多少錢** —— 那格明明是好的。
//    🔴 與 §3.1a 的「TS 端不寫 `number | null`」**不衝突**:那句講的是 **RPC 回來的 `total`**
//    (SQL 端 `COALESCE` 已保證非 NULL、TS 不該再補一層 `?? 0`);
//    這裡的 `null` 是**「這格失敗」的顯式表達**,語意完全不同,而且它**不會**被兜成 0。

/** 三格的資料;任一欄為 `null` 表示**那一格讀取失敗**(不是零)。 */
export type TodaySummary = {
  /** 台北曆面的今天(顯示用,例:`2026-08-14`)。 */
  ymd: string;
  /**
   * 今日實收淨額(整數元);`null` = **讀取失敗或值不可信**。
   *
   * 🔴 `null` 涵蓋三種:查詢錯 / RPC 沒回列 / `total` 讀不出安全整數。
   *    **三種都不得顯示成 `0`** —— 「0」在這一格的意思是「今天還沒收到錢」,是每天早上的常態。
   */
  receivedAmount: number | null;
  // 🪦 `receivedRowCount` 於 2026-08-15 移除(codex 關卡2 nit5:顯示端零消費 = 死碼)。
  //    重新需要它時**要連同 `readRpcInteger` 一起用**,不要寫 `Number(row.row_count)`。
  // 🪦 `refundedAmount` 於 2026-08-15 拆掉;理由與重做方向見 `today-view.ts` 的墓碑段。
  //    **不要因為「畫面看起來少一格」就把它加回來** —— 它是刻意拿掉的。
  /** 今日新單數;`null` = 讀取失敗。 */
  newOrderCount: number | null;
  /**
   * 待處理的退款異常筆數;`null` = 讀取失敗。
   *
   * 🔴 **這一格不是「今日」** —— 它是**當下累積的待辦量**(述詞在 `../payment/refund-read.ts`
   *    的 `listRefundExceptions`,本片**不另寫一份述詞**)。**顯示文案不得寫成「今日異常」。**
   */
  refundExceptionCount: number | null;
  /** 異常清單被上限截斷 ⇒ 上面那個數字是**下限**,不是總數。 */
  refundExceptionTruncated: boolean;
  // 🪦 `amountsTruncated` 於 2026-08-15 隨退款那格一起拆掉。
  //    它上一版的註解逐字寫著「**刻意不整個拿掉** —— 拿掉會讓退款的截斷變回靜默」——
  //    🔴 **那句在當時是對的,現在不成立了**:它守的那個查詢已經不存在,
  //       留著會變成一個**恆假**的旗標(沒有任何路徑能讓它變 true)= 恆綠格。
  //    ⚠️ 退款那格重做時,**截斷語意要跟著新的實作重新決定**,不要沿用這個名字。
  /** 🔴 哪幾格沒讀到(顯示端要講得出來,不能只說「對帳壞了」)。全部成功 ⇒ 空陣列。 */
  failedSections: string[];
};

// 🪦 這裡原本有一段「已完成退款這格漏一種『錢真的動了』的情況」的誠實邊界(reviewer R2 nit6)。
//    🔴 **那段最後不是被寫下來就算了 —— 它就是這一格被拆掉的直接原因。**
//    完整理由與重做方向搬到 `today-view.ts` 的墓碑段(單一載體,不兩處全文)。
//    ⚠️ 留這行是因為:**下一個人可能是從本檔開始讀的**,而墓碑在隔壁。

// 🔴 **成本註記**(reviewer R2 nit3):`listRefundExceptions()` 只被用來取 `.length`,
//    但它內部會撈最多 251+51 列**全欄位**再 `map`(`../payment/refund-read.ts:157-184`),
//    而這是**每次進站都跑**的首頁。現在量體小(每月 100-300 筆)不痛,
//    但要換成 `count: 'exact', head: true` 就得在那支開一個新述詞 ⇒ 不在本片範圍,**記著**。

/**
 * RPC 回來的整數純量 → `number`;**任何不是安全整數的東西一律 `null`**(codex 關卡2 MF1/MF2)。
 *
 * 🔴🔴 **這支存在的理由是 `Number(null) === 0`** —— 而「0」在這一格的意思是
 *    **「今天還沒收到錢」,那是每天早上的常態** ⇒ **拿不到值會偽裝成一個完全正常的早上。**
 *    `Number('')`、`Number(false)`、`Number([])` 同樣全是 `0`。
 *    ⚠️ **修法不是 `?? 0`** —— 那只是把假 0 寫得更明白。
 *    **分不出「真的是 0」與「拿不到值」的時候,那格必須是 `null`,不是 0。**
 *
 * 🔴 **與今早 SQL 端 `STRICT` 那條是同一個病、只是換一層**(主視窗 2026-08-15 抓到):
 *      SQL 層(**`STRICT` 之前**):參數 NULL ⇒ 零列 ⇒ `COALESCE` 收成「一列 `total=0`」⇒ 畫面 NT$ 0
 *      應用層:`total` 是 null ⇒ `Number(null)` ⇒ 0                              ⇒ 畫面 NT$ 0
 *    ⚠️ **上面第一行講的是【病】,不是現況**(2026-08-19 補清楚:原字面沒寫「之前」,
 *      而「零列 ⇒ 一列」單獨讀起來自相矛盾)。**現況**是那支 RPC 已經是 `STRICT`
 *      ⇒ NULL 參數讓**函式本體不執行、回 0 列**,`COALESCE` 根本沒跑
 *      (`20260815010000_m4b_e10_16_admin_today_payment_total.sql:91`,實測對照在同檔 `:53-54`)。
 *    **我們在 SQL 那層堵死了,而同一個 fail-open 在這一層原封不動。**
 *    ⇒ 教訓:**修好一層之後要去問「同一個形狀在相鄰的層還在不在」。**
 *
 * ⚠️ **`Number.isSafeInteger` 那一半的限度,講清楚不要誇大**:
 *    金額若真的大到超過 `2^53`,**精度在 `JSON.parse` 那一刻就已經掉了**,本函式**救不回真值** ——
 *    它能做的只有**不讓一個已經錯掉的數字被當成對的顯示出去**。
 *    🔴 而「大到超過」在本 repo 實際上極難達到:`order_payments.amount` 是 **`integer`**
 *    (`20260810100000:199` 逐字 `amount integer NOT NULL CHECK (amount <> 0)`)⇒ 單列上限 21 億,
 *    要突破 `2^53` 需要單日約 **420 萬列**。**但我不拿「打不到」當不修的理由** ——
 *    house 已有 12 支檔在用這個判準(形狀抄 `lib/orders/receipt-form.ts:94-100`
 *    與 `apps/storefront/.../tappay-notify/[secret]/route.ts:66-73`),**一併擋掉才是便宜的做法。**
 */
/**
 * 把一個「平常回 `{ data, error }`、但 transport 出事會 reject」的 thenable 收成值。
 *
 * 🔴 reject 被翻成 `{ data: null, error }` ⇒ 下游只要照常看 `error` 就好,
 *    **呼叫端不需要記得哪一支會 reject、哪一支不會** —— 那個「記得」正是 MF3 的病根。
 */
function settle<T extends { error: unknown }>(
  p: PromiseLike<T>,
): Promise<T | { data: null; count: null; error: unknown }> {
  return Promise.resolve(p).then(
    (v) => v,
    (error: unknown) => ({ data: null, count: null, error }),
  );
}

/**
 * 把任意值變成一段**安全的**錯誤訊息文字(codex R2 nit2)。
 *
 * 🔴 **`JSON.stringify()` 自己會拋**:`bigint` ⇒ `TypeError`、循環物件 ⇒ `TypeError`。
 *    而它出現在 `fail()` 的訊息裡 ⇒ **一格的壞資料會讓整個 `loadTodaySummary` 拋**
 *    ⇒ **「單格失敗隔離」當場被破壞** —— 那正是 MF3 剛修好的東西。
 *    ⚠️ **形狀諷刺但真實:防禦性訊息本身變成新的失敗來源。**
 */
function describe(v: unknown): string {
  try {
    return typeof v === 'bigint' ? `${v}n` : JSON.stringify(v) ?? String(v);
  } catch {
    return `[無法序列化的 ${typeof v}]`;
  }
}

function readRpcInteger(v: unknown): number | null {
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^-?\d+$/.test(v)) n = Number(v);
  else return null; // null / undefined / '' / boolean / object 全部落這裡
  return Number.isSafeInteger(n) ? n : null;
}

/** 顯示端會原樣印出來的格名 —— 失敗時員工要知道**是哪一格**沒讀到。 */
export const TODAY_SECTION = {
  received: '今日實收',
  // 🪦 `refunded: '今日退款'` 於 2026-08-15 拆掉(見 `today-view.ts` 墓碑段)。
  newOrders: '今日新單',
  exceptions: '退款異常',
} as const;

/**
 * 首頁三格的資料。
 *
 * 🔴 三支查詢**平行跑,而且各自獨立失敗**(R2 nit7):一支掛掉只讓**那一格**變「讀取失敗」,
 *    另外兩格照常顯示。**絕不把讀取失敗兜成 0** —— 那才是這一區最怕的壞法。
 * 🔴 本函式**只在日界換算失敗時拋**(那是真 bug、不是資料問題)⇒ 呼叫端的 try/catch 仍要留著。
 * ⚠️ 「哪一格掛了」透過 `failedSections` 出去,不靠呼叫端去猜 `null` 的意思。
 */
export async function loadTodaySummary(now: Date = new Date()): Promise<TodaySummary> {
  // 🔴 `ymd` 從 `todayTaipeiRange` 一起拿(nit2):不在這裡再算一次,免得畫面標題的日期
  //    與查詢區間出自**兩份**日界規格、改一處就靜默不同天。
  const { ymd, fromIso, toIso } = todayTaipeiRange(now);
  const supabase = createSupabaseServiceClient();

  // 🪦 原本是四支查詢,退款那支於 2026-08-15 拆掉 ⇒ 現在三支。
  const [payments, orders, exceptions] = await Promise.all([
    // 🔴 **收款走 RPC、不直查表**(R2 MF-A):`order_payments` 對 service_role **零表權**
    //    (`20260810100000:410` REVOKE ALL 含 service_role)⇒ 直查必回 `42501`,而全 mock 的單測全綠。
    //    加總在 SQL 端做 ⇒ **沒有 `max-rows` 可截** ⇒ 收款這支不需要 `.limit()` 與截斷旗標。
    //    零列時 RPC 回 `0` 不回 `NULL`(migration 內 `COALESCE`)。
    // 🔴🔴 **每一支都要自己接住 reject(codex 關卡2 MF3)**。
    //    supabase builder **平常**把錯誤放進 `{ error }` 回來 —— 但那只涵蓋「伺服器有回話」。
    //    **網路斷、DNS 失敗、fetch abort ⇒ 它是真的 reject**,而 `Promise.all` **一支 reject 整包 reject**
    //    ⇒ 整個 `loadTodaySummary` 拋 ⇒ **「逐格獨立失敗」那個設計當場失效,三格一起消失。**
    //    ⚠️ 上一版只有 `listRefundExceptions()` 接了,理由寫的是「它是會 reject 的、不像 builder」——
    //       **那句話把「平常不 reject」讀成了「不會 reject」。** 兩者差的正是 transport 層。
    //    ⇒ 統一用 `.then(ok, err)` 收成值,**沒有任何一支能把整頁拖下水**。
    settle(supabase.rpc('admin_today_payment_total', { p_from: fromIso, p_to: toIso })),
    settle(
      supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', fromIso)
        .lt('created_at', toIso),
    ),
    listRefundExceptions().then(
      (r) => ({ ok: true as const, ...r }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
  ]);

  const failedSections: string[] = [];
  /** 一格失敗 ⇒ 記名 + 回 `null`。**不得**在這裡兜任何預設值。 */
  function fail(section: string, error: unknown): null {
    failedSections.push(section);
    console.error(`[today-read] ${section} 讀取失敗`, error);
    return null;
  }

  // 收款:RPC 回一列 `{ total, row_count }`。
  const paymentRow = payments.error ? null : ((payments.data as { total?: unknown }[] | null)?.[0] ?? null);
  // 🔴🔴 **`data` 是空陣列也算失敗** —— 而**理由不是「RPC 恆回一列」**(2026-08-19 更正)。
  //    ~~原字面:「RPC 恆回一列(`COALESCE` 保證)」~~ ⇒ **不成立**。
  //    那支 RPC 是 **`STRICT`**(`20260815010000_m4b_e10_16_admin_today_payment_total.sql:91`)
  //    ⇒ **任一參數是 NULL,函式本體【根本不執行】** ⇒ **回 0 列**,`COALESCE` 沒有機會跑。
  //    同檔 `:53-54` 有實測對照:無 `STRICT` + `p_from = NULL` ⇒ 回 **1 列 total=0**(災難);
  //    有 `STRICT` ⇒ 回 **0 列**。⇒ 空陣列**是會發生的**,不是理論邊角。
  //
  // 🔴🔴 **所以救這一格的是【上一行 `?.[0] ?? null`】,不是 `COALESCE`。**
  //    空陣列 → `?.[0]` 得 `undefined` → `?? null` → `paymentRow = null`
  //    → `receivedAmount = null` → `receivedOk = false` → 畫面顯示「讀取失敗」。
  //    ⚠️ **不要拿掉那一行,也不要把它改成 `?? { total: 0 }` 之類的「補一個預設」** ——
  //    那一刻 NULL 參數就變成畫面上一個**安靜的 NT$ 0**,正是下面那句話最怕的東西。
  //    📌 **這段註解是修給【理由】的,行為一個字沒動** —— 因為下一個人是照理由決定要不要留這道檢查。
  //    (結論一直是對的,而錯的理由會讓對的檢查被合理地拆掉。)
  // 🔴🔴 **`total` 本身讀不出安全整數,同樣算失敗**(codex MF1/MF2):
  //    `Number(null)`、`Number('')` 都是 `0`,而 `0` 在這一格看起來完全正常。
  //    ⇒ 讀不出來就讓這格變 `null`(顯示「讀取失敗」),**絕不顯示一個安靜的 0**。
  const receivedAmount = paymentRow === null ? null : readRpcInteger(paymentRow.total);
  const receivedOk = !payments.error && receivedAmount !== null;

  return {
    ymd,
    receivedAmount: receivedOk
      ? receivedAmount
      : fail(
          TODAY_SECTION.received,
          payments.error ??
            new Error(
              paymentRow === null
                ? 'RPC 沒有回任何列'
                : `RPC 的 total 不是安全整數(收到 ${describe(paymentRow.total)})`,
            ),
        ),
    // 🪦 `receivedRowCount` 於 2026-08-15 移除(codex 關卡2 nit5)——
    //    **顯示端零消費 = 死碼**,而它自己的註解宣稱用途是「本支真的跑過的證據」。
    //    🔴 那個用途現在由 `receivedAmount !== null` 直接承擔:讀不出安全整數就是失敗、不是 0。
    //    ⚠️ 它原本也吃 nit4 的同一顆雷(`Number(null)` → `0`,一個看起來很正常的「今天 0 筆」)。
    // `head: true` + `count: 'exact'` ⇒ 只回筆數、不搬列(首頁每次進站都跑)。
    // 🔴 **拿不到一個可信的筆數 = 那格失敗,不得兜成 0**(codex R2 nit1)。
    //    上一版只擋 `=== null` ⇒ **`undefined`(欄根本沒回來)或型別不對就漏出去**,
    //    而漏出去的值會變成畫面上的「今日新單 0 筆」—— 又是一個看起來很正常的早上。
    //    ⚠️ **我判它與 `total` 同一類、共用同一支 helper,理由寫出來讓你可以反駁**:
    //       兩者都是「**一個本來就該回來的整數**」,而**分不出「真的是 0」與「沒拿到」時,
    //       兩邊的正確行為都是讓那格失敗**。⇒ 不同判準會讓同一頁上兩格的可信度不一致。
    //    ⚠️ **但範圍別擴張**:`0` 是**合法值**(今天還沒有新單),由 `readRpcInteger` 保留為 `0`
    //       —— `today-read.test.ts` 有正向對照釘住,否則這裡就是「永遠失敗」也全綠。
    newOrderCount: orders.error
      ? fail(TODAY_SECTION.newOrders, orders.error)
      : (readRpcInteger(orders.count) ??
        fail(
          TODAY_SECTION.newOrders,
          new Error(`count 不是安全整數(收到 ${describe(orders.count)})`),
        )),
    refundExceptionCount: exceptions.ok
      ? exceptions.rows.length
      : fail(TODAY_SECTION.exceptions, exceptions.error),
    refundExceptionTruncated: exceptions.ok ? exceptions.truncated : false,
    failedSections,
  };
}
