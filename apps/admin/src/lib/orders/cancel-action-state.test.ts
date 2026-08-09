import { describe, expect, it } from 'vitest';
import {
  CANCEL_NOT_SENT_CODES,
  CANCEL_SENT_CODES,
  cancelledResultQuery,
  cancelNotSentFailure,
  cancelSentFailure,
  FAILURE_MESSAGES,
  notSentResultQuery,
  sentResultQuery,
  generateCancelRequestToken,
  isCancelRequestToken,
  ORDER_CANCELLED_RESULT_CODE,
  toOrderCancelResultCode,
  type CancelFailureCode,
  type CancelFormInput,
} from './cancel-action-state';

const INPUT: CancelFormInput = {
  cancelMode: 'partial',
  reasonCode: 'other',
  reasonDetail: '客人改買別款',
  items: ['33333333-3333-4333-8333-333333333333:2'],
};

describe('cancel-action-state — A9d2-2a', () => {
  it('產生器與驗證器同源:產出來的一定過得了驗證', () => {
    const token = generateCancelRequestToken();
    expect(isCancelRequestToken(token)).toBe(true);
  });

  // 🔴 關卡2 must-fix:把產生器換成回一顆固定合法 uuid,原本所有測試仍全綠 ——
  //    而那正是「同一張單下一次不同 payload 撞既有 token/hash」的形狀。
  it('🔴 產生器每次都不同(換成固定 uuid 要紅)', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateCancelRequestToken()));
    expect(tokens.size).toBe(50);
  });

  it('🔴 `req_<uuid>` 形狀不算 token(前例 Fable F3:重用 generateRequestId 會讓整個功能死掉)', () => {
    expect(isCancelRequestToken(`req_${generateCancelRequestToken()}`)).toBe(false);
  });

  // 🔴 關卡2 nit:原本用純數字 uuid,`toUpperCase()` 是 no-op ⇒ 這條根本沒在測大小寫
  //    (與 cancel-form.test.ts 同款的 fixture 坑,當時只修了那一支)。
  it('大小寫 uuid 皆收(手上有一把合法 uuid 卻被擋掉 = 難查的 bug)', () => {
    const withLetters = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';
    expect(withLetters.toUpperCase()).not.toBe(withLetters);
    expect(isCancelRequestToken(withLetters.toUpperCase())).toBe(true);
  });

  // ── §2.1 的執行機制:兩種 failed 形狀 ──

  it('沒送到 RPC(denied / invalid)→ 帶回輸入 + 新 token,表單可編輯', () => {
    const state = cancelNotSentFailure('invalid', INPUT);
    expect(state.status).toBe('failed');
    expect(state.outcome).toBe('not_sent');
    expect(state.code).toBe('invalid');
    expect(state.message).toBe('表單內容不正確,取消沒有送出。');
    expect(state.input).toEqual(INPUT);
    expect(isCancelRequestToken(state.requestToken)).toBe(true);
  });

  // 🔴 關卡2 must-fix:原本 token 由呼叫端傳入 ⇒ 片 5 把舊的原樣傳回來型別與測試都不會紅。
  //    現在由 builder 自己鑄 ⇒ 兩次呼叫必不同,「換新」是機制不是願望。
  it('🔴 not_sent 的 token 每次都是新鑄的(呼叫端無從指定舊的那把)', () => {
    const a = cancelNotSentFailure('invalid', INPUT);
    const b = cancelNotSentFailure('invalid', INPUT);
    expect(a.requestToken).not.toBe(b.requestToken);
  });

  // 🔴 關卡2 R2 推翻了前一版(「sent 不帶 token/input」):那擋不住重送(prevState 由 client 送、
  //    可偽造;片 5 也能自己鑄鍵),卻毀掉災難當天的對帳證據。改成**原樣帶回**,
  //    而且刻意**不鑄新鍵** —— 新鍵 = 全新 payload_hash = 同一份 payload 會真的再取消一次。
  it('🔴 已送到 RPC → 原樣帶回這次用的 token(絕不鑄新的)與員工輸入', () => {
    const used = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';
    for (const code of ['rejected', 'retry', 'bug', 'error'] as const) {
      const state = cancelSentFailure(code, INPUT, used);
      expect(state.requestToken, `${code} 必須是原本那一顆`).toBe(used);
      expect(state.input).toEqual(INPUT);
      expect(state.outcome).toBe('sent');
    }
  });

  // 🔴 兩個 builder 對 token 的處置**相反**,而且必須相反:
  //    not_sent 換新(舊的沒送出)、sent 原樣(換新就是再取消一次)。把 sent 改成也鑄新的,本條紅。
  it('🔴 sent 不鑄新鍵、not_sent 一定鑄新鍵(兩者相反)', () => {
    const used = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';
    expect(cancelSentFailure('rejected', INPUT, used).requestToken).toBe(used);
    expect(cancelNotSentFailure('invalid', INPUT).requestToken).not.toBe(used);
  });

  // ── 訊息表與碼一對一(驗收條件)──

  // 🔴 R1 nit:原本只驗「六句非空且互異」⇒ 把 rejected 與 error 的字串**對調**也全綠
  //    (兩句都含「重新整理」、都不含「稍後再試」)。⇒ 改成對 plan §4.2 的表**逐字**釘死。
  it('🔴 六句文案與 plan §4.2 的表逐字相同(對調兩句也要紅)', () => {
    const expected: Record<CancelFailureCode, string> = {
      denied: '沒有權限或登入已失效,取消沒有送出。',
      invalid: '表單內容不正確,取消沒有送出。',
      rejected: '這張單目前不能取消(狀態可能剛變動)。請重新整理本單確認後再決定,不要重複按。',
      bug: '系統狀態異常,取消可能已經寫進去了。請重新整理確認,並通知系統維護,不要重複按。',
      retry: '系統忙碌,這次沒完成。請重新整理本單確認後再送一次。',
      error: '取消可能已經寫進去了。請重新整理本單確認之後再決定要不要重送。',
    };
    for (const code of Object.keys(expected) as CancelFailureCode[]) {
      const actual =
        code === 'denied' || code === 'invalid'
          ? cancelNotSentFailure(code, INPUT).message
          : cancelSentFailure(code, INPUT, '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b').message;
      expect(actual, `${code} 的文案`).toBe(expected[code]);
    }
  });

  // 🔴 plan §4.2:取消帳本 append-only ⇒ 已送達那四支一律叫他「重新整理確認」,
  //    不得出現「稍後再試」這種誘導重按的字。
  it('🔴 已送達的四支訊息都叫他重新整理、且都沒有「稍後再試」', () => {
    for (const code of ['rejected', 'retry', 'bug', 'error'] as const) {
      const { message } = cancelSentFailure(code, INPUT, '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b');
      expect(message, `${code} 應叫員工重新整理`).toContain('重新整理');
      expect(message, `${code} 不得誘導重按`).not.toContain('稍後再試');
    }
  });

  // ⚠️ 名稱已更正(D1 關卡2 R2):`result-banner` **不再**匯入這顆常數(成功訊息移交 D5)。
  //    本條現在守的是「字面穩定」——action 的 redirect 與 D5 的面板要對得上同一顆字串。
  it('成功結果碼字面穩定(action 與 D5 面板共用同一顆,結構上 typo 不可能)', () => {
    expect(ORDER_CANCELLED_RESULT_CODE).toBe('order_cancelled');
  });
});

describe('cancel-action-state — A13b D1 的碼清單與 namespaced 結果碼', () => {
  // 🔴 窮舉守門。**兩層都實測過紅法**,從 `CANCEL_SENT_CODES` 拿掉 `bug`:
  //    ①`tsc` 紅 —— `cancel-action-state.ts` 的 `FAILURE_MESSAGES_SOURCE` 多出一顆
  //      `Record<CancelFailureCode, string>` 不認得的鍵(TS2353);②**本條也紅**(鍵集合對不上)。
  //    兩層各自獨立:型別那層擋「碼從此不存在」,本條擋「陣列與訊息表分岔」。
  //
  //    ⚠️ **這句話曾經有一段時間是假的**(窄 R3 抓到):R2 把訊息表寫成 `Object.freeze({ ... })`,
  //    而 freeze 包住物件字面會讓 **excess-property check 整個消失** ⇒ ①那層當時**不會紅**,
  //    註解卻還宣稱驗過。修法是把字面先宣告成 `FAILURE_MESSAGES_SOURCE` 再 freeze,兩層才都回來。
  //    教訓與 `feedback_fix-that-moves-gate-earlier-erases-evidence` 同族:
  //    **加防護時要回頭確認原本那道觀測還在**,不然是拿掉一道閘、換上一句宣稱。
  it('兩組碼合起來 = FAILURE_MESSAGES 的鍵集合(少寫一顆會紅)', () => {
    const listed = [...CANCEL_NOT_SENT_CODES, ...CANCEL_SENT_CODES].sort();
    const authoritative = (Object.keys(FAILURE_MESSAGES) as CancelFailureCode[]).sort();

    expect(listed).toEqual(authoritative);
  });

  // 🔴 兩組**互斥**:同一顆碼不能既算「沒送到」又算「已送到」——
  //    那個分組就是「要不要凍結 / 要不要查帳本」的判準本身(見來源檔 `cancel-action-state.ts` 的失敗碼 docstring)。
  //    ⚠️ 本條就是關卡2 抓到的那個洞的守門:實測把 `invalid` 加進 `CANCEL_SENT_CODES` ⇒ 本條與上一條同時紅。
  it('兩組零交集', () => {
    const overlap = CANCEL_NOT_SENT_CODES.filter((c) =>
      (CANCEL_SENT_CODES as readonly string[]).includes(c),
    );

    expect(overlap).toEqual([]);
  });

  it.each([...CANCEL_NOT_SENT_CODES, ...CANCEL_SENT_CODES])(
    '%s 的結果碼帶 order_cancel_ 前綴且原樣接在後面',
    (code) => {
      expect(toOrderCancelResultCode(code)).toBe(`order_cancel_${code}`);
    },
  );

  // 🔴 D5 路由用完整前綴,`order_cancel` 會吞掉成功碼(窄 R3 nit)。
  it('成功碼不得被 `order_cancel_` 前綴掃到(但會被少一個底線的 `order_cancel` 掃到)', () => {
    expect(ORDER_CANCELLED_RESULT_CODE.startsWith('order_cancel_')).toBe(false);
    expect(ORDER_CANCELLED_RESULT_CODE.startsWith('order_cancel')).toBe(true);
  });
});

// ── D2 的導頁 query 合約(D1 交付面;窄 R3 must-fix F2)──────────────────────────
describe('cancel-action-state — 導頁 query 三支不相交的建構器', () => {
  const TOKEN = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';

  it.each(CANCEL_NOT_SENT_CODES)('沒送到 RPC 的 %s → 只帶 r、不帶 rt', (code) => {
    const query = notSentResultQuery(code);

    expect(query).toBe(`r=order_cancel_${code}`);
    // 🔴 反向:沒送到 RPC 的碼**不該**帶 token —— 帶了等於叫 D5 去帳本找一筆從來沒寫過的紀錄。
    expect(query).not.toContain('rt=');
  });

  it.each(CANCEL_SENT_CODES)('已送到 RPC 的 %s → r 與 rt 都要有', (code) => {
    expect(sentResultQuery(code, TOKEN)).toBe(`r=order_cancel_${code}&rt=${TOKEN}`);
  });

  it('成功 → r 與 rt 都要有(D5 要分得出這次成功 / 舊紀錄 / 偽造網址)', () => {
    expect(cancelledResultQuery(TOKEN)).toBe(`r=order_cancelled&rt=${TOKEN}`);
  });

  // 🔴🔴 **本組真正的守門是型別,不是上面那幾條斷言**(窄 R3 F2 的重點)。
  //    `sentResultQuery(code)` / `cancelledResultQuery()` 少傳 token = **編譯期紅**;
  //    `notSentResultQuery('retry')` 也是紅(union 不相交)。
  //    ⚠️ 這件事**測試證不了**(寫得出來就編譯不過)⇒ 用 `@ts-expect-error` 反向釘:
  //    哪天有人把 token 改成 optional、或把三支合回一支扁平的,下面這三行會因為
  //    「預期的錯誤沒有發生」而**編譯期轉紅**。這是本組唯一擋得住 D2 忘帶 rt 的東西。
  it('型別層:少傳 token / 錯類的碼都必須編譯不過', () => {
    // @ts-expect-error 已送到 RPC 的碼少傳 requestToken
    expect(() => sentResultQuery('retry')).not.toThrow();
    // @ts-expect-error 成功碼少傳 requestToken
    expect(() => cancelledResultQuery()).not.toThrow();
    // @ts-expect-error 「已送到」的碼不得走「沒送到」那支
    expect(() => notSentResultQuery('retry')).not.toThrow();
  });
});
