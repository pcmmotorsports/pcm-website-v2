import { anyMalformed, readSingleString } from '../forms/single-value';
import {
  PAYMENT_RAILS,
  PAY_AMOUNT_FIELD,
  PAY_CASH_RECEIVED_AT_FIELD,
  PAY_BANK_REFERENCE_FIELD,
  PAY_ORDER_ID_FIELD,
  PAY_PAYER_NOTE_FIELD,
  PAY_RAIL_FIELD,
  PAY_RECEIVED_DATE_FIELD,
  PAY_REQUEST_ID_FIELD,
  type PaymentFormValues,
  type PaymentRail,
} from './payment-action-state';

// payment-form.ts — M-4b E10 #15-B2-b:手動收款登錄的**表單解析(server 端)**。
//
// 🔴 **三層分工**(plan §3.4;`receipt-form.ts:14-17` 立過同一條規矩):
//    本層只做**形狀**——欄位在不在、是不是可解析的十進位非負整數且 ≤ int4 上限、
//    rail 是不是那兩個字面、request_id 是不是 canonical uuid、日期是不是真的日期。
//    **範圍與業務全部是 RPC 的權威**(金額 > 0、時點上下界、訂單狀態、退款態)——
//    在這裡再寫一份會變第二真相,兩份哪天漂了,症狀是「畫面說可以、送出被拒」或更糟的反向。
//
// 🔴 **「UI 構造不出違規組合」不是 server 端保證**(codex must-fix #2):FormData 可以偽造。
//    UI 那層只保證**正常操作**產不出違規 payload;真正的守門在本層,而且**有負測直接餵偽造 payload**
//    (現金軌帶單號 / amount 送兩份 / rail 亂填 / request_id 非 uuid)。

/** `integer` 的上限。**超過這個值會在進函式之前就 cast 爆**,落在 RPC 的錯誤碼表**外面**。 */
export const INT4_MAX = 2_147_483_647;

/**
 * 🔴 本解析器讀的**全部**單值欄位 —— 入口擋門(`anyMalformed`)吃這份清單。
 * ⚠️ 漏列一欄 = 那一欄的「非恰一筆字串」洞照舊且**無症狀** ⇒ 測試拿**手寫的清單**比對它。
 */
export const PAYMENT_SINGLE_FIELDS = [
  PAY_ORDER_ID_FIELD,
  PAY_RAIL_FIELD,
  PAY_AMOUNT_FIELD,
  PAY_RECEIVED_DATE_FIELD,
  PAY_CASH_RECEIVED_AT_FIELD,
  PAY_BANK_REFERENCE_FIELD,
  PAY_PAYER_NOTE_FIELD,
  PAY_REQUEST_ID_FIELD,
] as const;

/**
 * 解析結果。**依軌別分兩形**(discriminated union,plan §3.4)——
 * 不是「一個大物件、有些欄位可有可無」:那種形狀讓「現金軌帶了單號」在型別上完全合法。
 */
export type ParsedPaymentForm =
  | {
      rail: 'bank_transfer';
      orderId: string;
      amount: number;
      /** 銀行入帳日(`YYYY-MM-DD`,台北曆日)。轉成時點是 `buildReceivedAt` 的事。 */
      receivedDate: string;
      /**
       * 🔴 **匯款軌必填、且型別就是 `string`**(關卡2 codex MF2):
       * RPC `20260810200000:181-183` 對「匯款軌沒有單號」是**無 ERRCODE 的通用 RAISE**
       * ⇒ 放它進去只會換來一句含糊的「這張單現在不能登錄收款」,員工看不出是漏填單號。
       * 這是**欄位在不在**的形狀規則(與「現金軌不得有單號」同一類),不是範圍/業務規則。
       */
      bankReference: string;
      payerNote: string | null;
      requestId: string;
    }
  | {
      rail: 'cash';
      orderId: string;
      amount: number;
      /** 🔴 現金軌**沒有**日期欄,單號恆不存在。 */
      bankReference: null;
      /** 鑄表單那一刻由 server 蓋的時點(見 `PAY_CASH_RECEIVED_AT_FIELD` 的長註解)。 */
      cashReceivedAt: string;
      payerNote: string | null;
      requestId: string;
    };

function one(form: FormData, field: string): string {
  return readSingleString(form, field) ?? '';
}

/** canonical uuid(RPC 的 `p_request_id` 型別就是 **uuid**,不是 text)。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * 金額:**只收十進位數字字串**。
 *
 * 🔴 **禁 `parseFloat` / 禁指數表示 / 禁任何單位換算**(plan F1):欄位是**整數元**、全程零換算。
 * 🔴 **必須自己擋 int4 上限**(codex must-fix #7):`Number.isSafeInteger` 的上限是 2^53,
 *    而 `amount` 是 `integer` ⇒ `2147483648` 會在**進函式之前**就 cast 爆,
 *    拿到的 SQLSTATE 落在 RPC 那張碼表**外面**(映射成「可能已寫入」= 對員工說了假話)。
 * ⚠️ #352 的 `toCount` 是同形狀,但那邊 RPC 有 `≤ 100000` 的界擋著,**這邊沒有** —— 不能照抄。
 * 🔴 **不擋 0 與正負範圍**:金額 > 0 的權威在 RPC(`20260810200000` G3),本層只管形狀。
 */
function toAmount(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n > INT4_MAX) return null;
  return n;
}

/**
 * `YYYY-MM-DD` 而且**是真的存在的日期**。
 *
 * 🔴 為什麼連「這天存不存在」都要在這裡擋:`2026-02-31` 送進 PG 會噴 `22007`
 *    —— 那個碼**不在**逐碼映射表裡 ⇒ 會被 fail-closed 成 `'error'`,
 *    而 `'error'` 的文案是「**可能已經寫進去了**」= 對一筆根本沒送成的收款說了假話。
 *    形狀層擋掉才會得到誠實的 `'invalid'`。
 */
function isRealDate(raw: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return false;
  const [, y, mo, d] = m;
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return (
    dt.getUTCFullYear() === Number(y) &&
    dt.getUTCMonth() === Number(mo) - 1 &&
    dt.getUTCDate() === Number(d)
  );
}

/**
 * 帶偏移或 `Z` 的 ISO 時點,而且**真的解析得出來**。
 *
 * 🔴 **必須要求帶偏移**:沒有偏移的字面(`2026-08-11T14:30:00`)進 `timestamptz` 會用
 *    **DB 的 session TimeZone** 解讀 ⇒ 同一個字面在不同連線下是不同時點。
 *    這條與列表側「不得直接印 RPC 回來的字面」是同一個病根的兩面。
 */
function isIsoInstant(raw: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(raw)) return false;
  return !Number.isNaN(Date.parse(raw));
}

function isRail(raw: string): raw is PaymentRail {
  return (PAYMENT_RAILS as readonly string[]).includes(raw);
}

/** 空白字串 → null(RPC 那邊 `btrim` 後全空白也會正規化回 NULL,兩層同一個立場)。 */
function orNull(raw: string): string | null {
  return raw.trim() === '' ? null : raw;
}

/** 解析。回 `null` = 形狀不成立(action 回 `invalid`)。 */
export function parsePaymentForm(form: FormData): ParsedPaymentForm | null {
  // 🔴🔴 入口擋門 —— `readSingleString` 的必要搭配,不是可選的加強
  //    (`single-value.ts` 逐字)。少了它:`amount` 送兩份 ⇒ `readSingleString` 回 null
  //    ⇒ `one()` 收斂成 `''` ⇒ 後面的形狀檢查看到的是「留空」而不是「送了兩份」。
  if (anyMalformed(form, PAYMENT_SINGLE_FIELDS)) return null;

  const orderId = one(form, PAY_ORDER_ID_FIELD);
  const requestId = one(form, PAY_REQUEST_ID_FIELD);
  const rail = one(form, PAY_RAIL_FIELD);
  if (!UUID_RE.test(orderId) || !UUID_RE.test(requestId)) return null;
  if (!isRail(rail)) return null;

  const amount = toAmount(one(form, PAY_AMOUNT_FIELD));
  if (amount === null) return null;

  // 🔴 **印章的形狀在兩軌都驗**(窄 R3 MF2 的根治):`mintPaymentFormStamp` 一次蓋兩格、
  //    `paymentStampFields` 一次展開兩格 ⇒ 「只有一格」本來就不是本系統產得出來的表單。
  //    在這裡一起驗的好處是**下游可以無條件信任**:解析成功 ⇒ 印章必定完整合法
  //    ⇒ 失敗帶回時不必再判一次(不然 `invalid` 那條會把壞印章原樣還給表單、永遠重送壞的)。
  //    匯款軌不使用這個值,但仍要求它在 —— 少了它代表 B2-c 沒照契約蓋章。
  const cashReceivedAt = one(form, PAY_CASH_RECEIVED_AT_FIELD);
  if (!isIsoInstant(cashReceivedAt)) return null;

  const payerNote = orNull(one(form, PAY_PAYER_NOTE_FIELD));
  const bankReference = orNull(one(form, PAY_BANK_REFERENCE_FIELD));
  const receivedDate = one(form, PAY_RECEIVED_DATE_FIELD);

  if (rail === 'cash') {
    // 🔴 現金軌**帶了單號就是偽造 payload**(正常 UI 沒有那一欄)⇒ 當場拒。
    //    RPC 也擋(`20260810200000:185-186`),但那是**第二道**;讓它到得了 RPC
    //    只會換來一句通用的「這張單現在不能登錄收款」,員工看不出是 payload 有問題。
    // 🔴 現金軌**不讀那個日期欄**:它是匯款軌的欄位 ⇒ 塞了也一律忽略(忽略不是拒收:
    //    一個多餘的欄位不該變成阻斷,而員工的裝置時鐘本來就不該有發言權)。
    if (bankReference !== null) return null;
    return { rail: 'cash', orderId, amount, bankReference: null, cashReceivedAt, payerNote, requestId };
  }

  if (!isRealDate(receivedDate)) return null;
  // 🔴 匯款軌單號必填(見 `ParsedPaymentForm` 那段):`null` 到不了 RPC。
  if (bankReference === null) return null;
  return { rail: 'bank_transfer', orderId, amount, receivedDate, bankReference, payerNote, requestId };
}

/**
 * 送進 RPC 的 `p_received_at`(plan §3.6)。
 *
 * 🔴 **兩軌構造方式不同,而且都不碰裝置時區**:
 *  · **匯款** = 銀行入帳日的**台北 00:00**。RPC 的 G7 下限對匯款軌比的正是**台北曆日**
 *    (`20260810200000:245-250` 逐字:匯款比台北曆日、現金比精確時點)——
 *    送當日 00:00 才不會被「今天下午成立、客人立刻轉帳當日入帳」那個台灣最常見的情境誤殺。
 *  · **現金** = **鑄表單那一刻 server 蓋的章**,原樣送出。
 *
 * 🔴 **本函式是純的、不讀時鐘**(關卡2 codex MF1 之後改的)。
 *    ⚠️ plan §3.6 原字面是「現金由 server 產生(可注入的 clock)」——**照那樣做會壞掉**:
 *    在 action 裡每次 `new Date()` ⇒ 同一把冪等鍵重送時 `received_at` 不同 ⇒ RPC 的 G8
 *    逐欄比對過不了 ⇒ 首送已成功卻回一句失敗。改成「與 `request_id` 同生命週期一起鑄」,
 *    仍然是 server 產生(蓋章在 server render),但**同一把鍵重送必得同一個值**。
 *    偏離 plan 字面的理由與天花板寫在 `PAY_CASH_RECEIVED_AT_FIELD` 那段。
 *
 * 🔴 台灣固定 UTC+8、無日光節約 ⇒ 偏移是常數(同 `procurement-view.ts:35-37` 的立場),
 *    不需要時區資料庫、也不准用 `new Date(local)`(那是**裝置**時區)。
 */
export function buildReceivedAt(parsed: ParsedPaymentForm): string {
  if (parsed.rail === 'bank_transfer') return `${parsed.receivedDate}T00:00:00+08:00`;
  return parsed.cashReceivedAt;
}

/**
 * 失敗時帶回員工打的內容 + **驗過形狀的整組印章**。
 *
 * 🔴🔴 **不驗就帶回會把表單鎖死**(窄 R3 must-fix):`invalid` 那條路的 payload 依定義是壞的,
 *    印章可能只有一格、或根本不是 uuid / ISO。B2-c 的規則是「兩者皆空才重鑄」
 *    ⇒ 帶回一個壞印章 = 它**永遠不會重鑄**,而每次送出又都因為印章不合法被判 `invalid`
 *    ⇒ 員工卡在一個怎麼按都失敗、也看不出原因的表單裡。
 * ⇒ 規則:**整組合法才沿用,任一格壞掉就兩格一起清空**(清空 = 讓 B2-c 重鑄一組新的)。
 *    清空的代價是換一把新鍵,但那條路的前提是「這次根本沒送進 RPC」⇒ 沒有重複入帳的風險。
 */
export function carryBackPaymentValues(form: FormData): PaymentFormValues {
  const rawRequestId = one(form, PAY_REQUEST_ID_FIELD);
  const rawCashReceivedAt = one(form, PAY_CASH_RECEIVED_AT_FIELD);
  const stampOk = UUID_RE.test(rawRequestId) && isIsoInstant(rawCashReceivedAt);
  return {
    rail: one(form, PAY_RAIL_FIELD),
    amount: one(form, PAY_AMOUNT_FIELD),
    receivedDate: one(form, PAY_RECEIVED_DATE_FIELD),
    bankReference: one(form, PAY_BANK_REFERENCE_FIELD),
    payerNote: one(form, PAY_PAYER_NOTE_FIELD),
    // 🔴 印章也要帶回來(R2 MF2):失敗路徑會 revalidate ⇒ 表單重渲染 ⇒
    //    不帶回的話下一次送出會是**新的一把鍵**,而那正是「可能已經寫進去了」那條路
    //    ⇒ G8 認不出是重送 ⇒ 多一筆刪不掉的收款。
    requestId: stampOk ? rawRequestId : '',
    cashReceivedAt: stampOk ? rawCashReceivedAt : '',
  };
}

/**
 * 🔴🔴 **鑄一組表單印章:冪等鍵 + 現金軌時點,同一次產、同一組用**(opus R2 MF3)。
 *
 * 這支存在的理由是把 lockstep 收成**單一入口**:兩個值只有這一個地方產得出來,
 * 拆開用就要刻意繞過它。那個「拆開」的組合會讓 RPC 的 G8 逐欄比對
 * (`20260810200000:271-283`)對不上、把一次**合法的首次送出**變成通用 RAISE。
 *
 * ⚠️ **誠實邊界(窄確認輪 MF3 更正我原本的宣稱)**:本函式**擋不住**「呼叫兩次、各取一半」
 *    或「只把其中一個放進表單」——它是單一入口,**不是**物理封裝。真正的封裝只能在 B2-c:
 *    鑄章與兩個 hidden input 要包在**同一個 server 元件**裡,外面拿不到單獨的欄位。
 *    ⇒ **這是 B2-c 的驗收硬條款**,不是建議。本檔能給的是入口與成組展開(見 `paymentStampFields`)。
 *
 * 生命週期(🔴 三條都是硬規則,B2-c 照做):
 *  · **成功之後**才重鑄(整組換掉);
 *  · **換一張訂單**要重鑄 —— 冪等作用域是 `(order_id, request_id)`,不是全域;
 *  · 🔴 **失敗時一律沿用同一組**,包含「可能已經寫進去了」那種不確定的失敗 ——
 *    那時重鑄 = 下一次送出對 G8 是全新的一次 ⇒ **擋不到 ⇒ 重複入帳**(窄確認輪 MF4)。
 *    🔴🔴 **「沿用」是有機制的,不是靠表單記得**(R2 MF2):失敗 state 的 `values`
 *    會把整組印章原樣帶回(`carryBackPaymentValues`)⇒ B2-c 的 hidden input
 *    **以 `state.values.requestId / cashReceivedAt` 為優先來源**,兩者皆空才呼叫本函式鑄新的。
 *    ⚠️ 少了這條:失敗路徑的 `revalidatePath` 會讓 server component 重渲染、印章跟著換 ——
 *    而那條路正是「可能已經寫進去了」,換鍵就是多一筆刪不掉的收款。
 *    ⚠️ 這條與「重新整理頁面」直接衝突(重新整理 = 重新 render = 重鑄)
 *    ⇒ `'error'` 那句文案已經逐字寫「先不要重新整理」,兩邊要一起看。
 * ⚠️ **不要在 client 端補鑄任何一半**(姊妹片 `receipt-record-form.tsx:81` 的 `useState` 形狀)。
 */
export function mintPaymentFormStamp(now: Date): { requestId: string; cashReceivedAt: string } {
  return { requestId: crypto.randomUUID(), cashReceivedAt: now.toISOString() };
}

/**
 * 印章 → 兩個 hidden input 的資料(B2-c `map` 成 `<input type="hidden">`)。
 *
 * 🔴 成組展開的用意:讓「只放其中一個」在**寫法上**就要刻意 ——
 *    B2-c 拿到的是一個陣列,少放一格是看得見的動作,不是忘記。
 *    (仍然不是物理封裝,見 `mintPaymentFormStamp` 的誠實邊界。)
 */
export function paymentStampFields(stamp: {
  requestId: string;
  cashReceivedAt: string;
}): ReadonlyArray<{ name: string; value: string }> {
  return [
    { name: PAY_REQUEST_ID_FIELD, value: stamp.requestId },
    { name: PAY_CASH_RECEIVED_AT_FIELD, value: stamp.cashReceivedAt },
  ];
}
