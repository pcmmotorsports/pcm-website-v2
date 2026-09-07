// manual-refund-form.test.ts — `parseManualRefundForm` 的直接測試。
//
// 🔴🔴 **為什麼這支檔在 2026-09-01 才出現(而那件事本身是這支檔的一半價值)**
//    `parseManualRefundForm` 是非卡退款那一側**唯一**擋住形狀錯誤的地方,而在本檔之前
//    它在全測試語料裡出現 **1 次**,而那一次是一句 **JSDoc 註解**:
//      `manual-refund-787-server-gate.test.ts:65` 逐字
//      「形狀合法的表單——用意是確保它能走過 `parseManualRefundForm`,一路推進到 repository 那一步」
//    ⇒ 📌 **那不是覆蓋,那是【引用】** —— 那支測試把這道閘當成**前提**在用。
//    🔴 而更遠的一處把它當成**論證**在用:`manual-refund-repository.test.ts:133` 逐字寫
//      「`manual-refund-form.ts:29,85` 在解析階段就擋掉 > 2_147_483_647」
//      ⇒ ⇒ **一支測試靠這道閘成立,而這道閘自己零測試。**
//    ⚠️ 而卡片那一側的雙胞胎 `refund-form.ts` / `refund-read.ts` **都有**測試
//      ⇒ 📌 **分檔跟著做了,測試沒有跟著分。**
//
// 🛑 **本檔的射程**:只驗「形狀」,與被測檔自己的紀律一致(檔頭逐字「只做形狀 …
//    業務判定單一真相在 RPC,本檔不重做」)。⇒ **金額有沒有超過帳本未登記額、actor 在不在職、
//    request_id 有沒有重送 —— 這三件本檔一格都不驗**,它們在 DB 那一側。

import { describe, expect, it } from 'vitest';

import {
  MANUAL_REFUND_AMOUNT_FIELD,
  MANUAL_REFUND_CARD_CONFIRM_FIELD,
  MANUAL_REFUND_OCCURRED_AT_FIELD,
  MANUAL_REFUND_ORDER_ID_FIELD,
  MANUAL_REFUND_RAIL_FIELD,
  MANUAL_REFUND_REASON_FIELD,
  MANUAL_REFUND_REQUEST_TOKEN_FIELD,
} from './manual-refund-action-state';
import { MANUAL_REFUND_RAILS, parseManualRefundForm } from './manual-refund-form';

const ORDER_ID = '11111111-2222-3333-4444-555555555555';
const REQUEST_TOKEN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

/** 形狀合法的基準表單。每一格測試只動它的一欄 —— 這樣紅的時候指得出是哪一欄。 */
function validForm(overrides: Record<string, string> = {}): FormData {
  const data = new FormData();
  data.set(MANUAL_REFUND_ORDER_ID_FIELD, ORDER_ID);
  data.set(MANUAL_REFUND_REQUEST_TOKEN_FIELD, REQUEST_TOKEN);
  data.set(MANUAL_REFUND_RAIL_FIELD, 'cash');
  data.set(MANUAL_REFUND_AMOUNT_FIELD, '500');
  data.set(MANUAL_REFUND_REASON_FIELD, '客人匯錯金額,退回差額');
  data.set(MANUAL_REFUND_OCCURRED_AT_FIELD, '2026-08-20T10:00');
  for (const [k, v] of Object.entries(overrides)) data.set(k, v);
  return data;
}

describe('parseManualRefundForm — 正面路徑', () => {
  it('🟢 基準表單會過,而且欄位原樣帶出來', () => {
    const out = parseManualRefundForm(validForm());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.orderId).toBe(ORDER_ID);
    expect(out.rail).toBe('cash');
    expect(out.amount).toBe(500);
    expect(out.requestToken).toBe(REQUEST_TOKEN);
  });

  it('🟢 兩條軌都收(值域對齊 DB CHECK,刻意不含 card)', () => {
    for (const rail of MANUAL_REFUND_RAILS) {
      const out = parseManualRefundForm(validForm({ [MANUAL_REFUND_RAIL_FIELD]: rail }));
      expect(out.ok, `rail=${rail} 應該過`).toBe(true);
    }
    // 🔴 這一格是【對照】:card 走的是另一本帳(order_refunds),不得從這裡進來。
    const card = parseManualRefundForm(validForm({ [MANUAL_REFUND_RAIL_FIELD]: 'card' }));
    expect(card.ok).toBe(false);
  });

  it('🟢 原因欄前後空白會被 trim 掉(不是原樣送進 DB)', () => {
    const out = parseManualRefundForm(
      validForm({ [MANUAL_REFUND_REASON_FIELD]: '  退回差額  ' }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.reason).toBe('退回差額');
  });
});

describe('parseManualRefundForm — 金額邊界(這是別支測試拿去當前提的那一格)', () => {
  // 🔴 `manual-refund-repository.test.ts:133` 逐字說「解析階段就擋掉 > 2_147_483_647」
  //    ⇒ 這兩格就是那句話的證人。少了它們,那支測試的前提沒有人在守。
  it('🟢 恰好 2,147,483,647(PG integer 上界)要【放行】', () => {
    const out = parseManualRefundForm(
      validForm({ [MANUAL_REFUND_AMOUNT_FIELD]: '2147483647' }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.amount).toBe(2_147_483_647);
  });

  it('🔴 上界 +1 要【擋下】—— 不是在 DB 才炸', () => {
    const out = parseManualRefundForm(
      validForm({ [MANUAL_REFUND_AMOUNT_FIELD]: '2147483648' }),
    );
    expect(out.ok).toBe(false);
  });

  it('🔴 零、負數、小數、前導零、空字串、空白 —— 全部擋下', () => {
    for (const bad of ['0', '-1', '1.5', '0500', '', '   ', '1e3', '５００']) {
      const out = parseManualRefundForm(validForm({ [MANUAL_REFUND_AMOUNT_FIELD]: bad }));
      expect(out.ok, `amount=${JSON.stringify(bad)} 應該被擋`).toBe(false);
    }
  });
});

describe('parseManualRefundForm — 其餘每一欄各自的擋法', () => {
  it('🔴 order_id 不是 uuid ⇒ 擋', () => {
    for (const bad of ['', 'not-a-uuid', '11111111-2222-3333-4444-55555555555']) {
      expect(parseManualRefundForm(validForm({ [MANUAL_REFUND_ORDER_ID_FIELD]: bad })).ok).toBe(
        false,
      );
    }
  });

  it('🔴 request token 形狀不對 ⇒ 擋', () => {
    for (const bad of ['', 'tok', '1234']) {
      expect(
        parseManualRefundForm(validForm({ [MANUAL_REFUND_REQUEST_TOKEN_FIELD]: bad })).ok,
      ).toBe(false);
    }
  });

  it('🔴 原因欄空的 / 只有空白 ⇒ 擋(一筆退款不該沒有理由)', () => {
    for (const bad of ['', '   ', '\t\n']) {
      expect(parseManualRefundForm(validForm({ [MANUAL_REFUND_REASON_FIELD]: bad })).ok).toBe(
        false,
      );
    }
  });

  it('🔴 原因欄含控制字元 ⇒ 擋', () => {
    // 🔴 **控制位元組用 `String.fromCharCode` 組出來, 不放進原始碼本身。**
    //    被測檔 `hasControlChar` 上面那段註解逐字寫著這條紀律(「避免在原始碼裡放進
    //    不可見控制位元組本身」)—— 而我第一版真的把一個 `\x07` 打進了字串裡。
    //    ⇒ 📌 **測試會過, 而它同時違反了被測檔自己寫下的規矩** —— 兩者不衝突, 所以沒有東西會叫。
    for (const code of [0, 7, 9, 10, 13, 31, 127]) {
      const reason = `退款${String.fromCharCode(code)}原因`;
      expect(
        parseManualRefundForm(validForm({ [MANUAL_REFUND_REASON_FIELD]: reason })).ok,
        `控制字元 ${code} 應該被擋`,
      ).toBe(false);
    }
  });

  it('🟢/🔴 原因欄長度上界 200:恰好 200 過、201 擋', () => {
    expect(parseManualRefundForm(validForm({ [MANUAL_REFUND_REASON_FIELD]: '退'.repeat(200) })).ok)
      .toBe(true);
    expect(parseManualRefundForm(validForm({ [MANUAL_REFUND_REASON_FIELD]: '退'.repeat(201) })).ok)
      .toBe(false);
  });

  it('🔴 occurred_at 不是可解析的時刻 ⇒ 擋', () => {
    for (const bad of ['', 'not-a-date', '2026-13-45T99:99']) {
      expect(
        parseManualRefundForm(validForm({ [MANUAL_REFUND_OCCURRED_AT_FIELD]: bad })).ok,
      ).toBe(false);
    }
  });

  it('🔴 任何一欄整個缺席 ⇒ 擋(不是用預設值補)', () => {
    for (const field of [
      MANUAL_REFUND_ORDER_ID_FIELD,
      MANUAL_REFUND_REQUEST_TOKEN_FIELD,
      MANUAL_REFUND_RAIL_FIELD,
      MANUAL_REFUND_AMOUNT_FIELD,
      MANUAL_REFUND_REASON_FIELD,
      MANUAL_REFUND_OCCURRED_AT_FIELD,
    ]) {
      const data = validForm();
      data.delete(field);
      expect(parseManualRefundForm(data).ok, `缺 ${field} 應該被擋`).toBe(false);
    }
  });

  it('🔴 同一欄送兩份值 ⇒ 擋(參數污染,不是取第一個)', () => {
    const data = validForm();
    data.append(MANUAL_REFUND_AMOUNT_FIELD, '999999');
    expect(parseManualRefundForm(data).ok).toBe(false);
    // 🛑🛑 **這一格【擋住它的不是我以為的那一行】—— 突變量到的,不是讀出來的。**
    //    我原本以為它在測 `manual-refund-form.ts:68` 的 `anyMalformed` 入口擋門。
    //    ⇒ 突變 M3(把那一行整個拿掉)⇒ **14 格全過,一格都沒紅。**
    //    成因寫在共用模組自己的檔頭(`../forms/single-value.ts` 逐字):
    //      「呼叫端若**每一顆 `null` 都已經直接 `ok:false`**,入口擋門就是**零判別力**
    //        —— 拿掉它『送兩份 ⇒ 被拒』照樣成立,因為**擋的是 reader 不是 gate**。」
    //    ⇒ 📌 **所以這一格驗到的是 `readSingleString` 的三態,不是那道擋門。**
    //    🔴 而那份檔頭同時給了判準:`supplier-form.ts` 與 `parseStaffActiveForm` 屬於這一類,
    //      **刻意不加擋門**;而本檔加了 ⇒ ⇒ **本檔那一行可能是同一族的零判別力擋門。**
    //      ⚠️ **我不在這裡拿掉它** —— 那是被測檔的設計決定,不是測試檔能裁的。已開板子一列。
  });
});

/**
 * 🔴🔴 **時區(codex `gpt-6-astra` 2026-09-08 R2 must-fix)**
 *
 * **這一組守的是「員工打的是台北時間」**,而**舊實作把它交給 `new Date(local)` 去猜** ——
 * 而那支 parser 跑在**伺服器**(`manual-refund-actions.ts:1` `'use server'`)
 * ⇒ 猜的是【伺服器】的時區。Vercel 是 UTC ⇒ 員工打 10:00 會存成台北 18:00 ⇒ **差 8 小時。**
 *
 * 🛑 **而這一格【非有不可】的理由**:那個錯**不會讓任何東西紅** ——
 *    金額對、軌對、原因對,只有**時刻**錯 8 小時,而它安靜地進帳本。
 *    📌 **一個「存進去的值錯了」的缺陷,與「功能沒做」長得完全不一樣 —— 它看起來是成功的。**
 */
describe('退款時刻:員工打的是【台北時間】,不是伺服器時區', () => {
  it('🔴 10:00 要存成 02:00Z(台北 +08:00),不是 10:00Z', () => {
    const r = parseManualRefundForm(
      validForm({ [MANUAL_REFUND_OCCURRED_AT_FIELD]: '2026-08-20T10:00' }),
    );
    expect(r.ok).toBe(true);
    // 🔵 釘【完整字面】而不是只比小時 —— 只比小時的話, 一個差一天的實作也會過
    expect(r.ok && r.occurredAt, '沒有用 +08:00 解讀 ⇒ 舊實作在 UTC 機器上會給 10:00Z').toBe(
      '2026-08-20T02:00:00.000Z',
    );
  });

  it('🔵 跨日邊界:台北 00:30 是【前一天】的 16:30Z —— 差一天的實作在這裡才會現形', () => {
    const r = parseManualRefundForm(
      validForm({ [MANUAL_REFUND_OCCURRED_AT_FIELD]: '2026-08-20T00:30' }),
    );
    expect(r.ok).toBe(true);
    expect(r.ok && r.occurredAt).toBe('2026-08-19T16:30:00.000Z');
  });

  it('🔴 不存在的日子要擋:2026-02-31 形狀合法而那一天不存在', () => {
    // 🛑 `new Date('2026-02-31T10:00:00+08:00')` 【不是 NaN】—— JS 會把它捲到 3 月 3 日
    //    ⇒ 只驗 NaN 擋不掉它, 而它會安靜地存進一個【員工沒有打過】的時刻。
    expect(
      parseManualRefundForm(validForm({ [MANUAL_REFUND_OCCURRED_AT_FIELD]: '2026-02-31T10:00' })).ok,
    ).toBe(false);
  });

  it('🟢 正向對照:2026-02-28 是存在的日子 ⇒ 要過(否則上面那格可能是「一律擋」)', () => {
    expect(
      parseManualRefundForm(validForm({ [MANUAL_REFUND_OCCURRED_AT_FIELD]: '2026-02-28T10:00' })).ok,
    ).toBe(true);
  });
});

/**
 * 🔴🔴 **⟦b4-MIXEDRAILMANUALREFUND⟧:那個「我確認卡上沒退」的勾選值,要誠實地帶到。**
 *
 * 🛑 **而【不勾要送 false】那一格才是中心** ——
 *    一個【永遠傳 `true`】的實作會讓「勾了送得出去」那一格全綠,
 *    而它**等於把 Sean 拍的那道確認關掉**,且畫面上一切正常。
 */
describe('勾選「我確認卡上沒退」的解析', () => {
  it('🟢 勾了(value="1")⇒ true', () => {
    const r = parseManualRefundForm(validForm({ [MANUAL_REFUND_CARD_CONFIRM_FIELD]: '1' }));
    expect(r.ok).toBe(true);
    expect(r.ok && r.confirmCardNotRefunded).toBe(true);
  });

  it('🔴 沒勾 ⇒ false —— 而【沒勾】在 HTML 裡是「那個欄位根本不送」', () => {
    // 🛑 checkbox 沒勾時瀏覽器不送那個 name ⇒ 這裡就是「表單裡沒有它」。
    //    ⇒ 而它【不可以】被當成表單壞掉:那會讓員工看到一句與他做的事無關的錯誤。
    const r = parseManualRefundForm(validForm());
    expect(r.ok, '沒勾被當成表單畸形 ⇒ 員工會看到一句莫名其妙的錯誤').toBe(true);
    expect(r.ok && r.confirmCardNotRefunded).toBe(false);
  });

  it('🔵 瀏覽器預設值 "on" 也算勾了(防的是有人改了 value 而忘了改這裡)', () => {
    const r = parseManualRefundForm(validForm({ [MANUAL_REFUND_CARD_CONFIRM_FIELD]: 'on' }));
    expect(r.ok && r.confirmCardNotRefunded).toBe(true);
  });

  it('🔴 其他值一律當【沒勾】—— 往安全的方向偏', () => {
    // 漏勾的代價是他多按一次;誤判成勾了的代價是【繞過那道確認】⇒ 不對稱 ⇒ 偏嚴。
    for (const bad of ['0', 'true', 'yes', '', ' 1', 'ON']) {
      const r = parseManualRefundForm(validForm({ [MANUAL_REFUND_CARD_CONFIRM_FIELD]: bad }));
      // 🔴 **`r.ok` 要【另外】釘一次**(codex `gpt-6-astra` 2026-09-08 R1 nit,收下):
      //    只寫 `r.ok && r.confirmCardNotRefunded === false` 時,**`r.ok` 變 false 也是綠的**
      //    ⇒ 那個斷言在【解析成功而當作沒勾】與【解析直接失敗】兩個世界印同一個東西,
      //    而本格宣稱的是前者 —— 少了這一行,一個把怪值當成 `ok:false` 的實作會靜靜通過。
      expect(r.ok, `值 ${JSON.stringify(bad)} 讓整張表單解析失敗 —— 本格要的是「解析成功而當沒勾」`).toBe(true);
      expect(r.ok && r.confirmCardNotRefunded, `值 ${JSON.stringify(bad)} 被當成勾了`).toBe(false);
    }
  });
});
