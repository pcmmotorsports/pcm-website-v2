import { describe, expect, it } from 'vitest';
import { TapPayRefundUnknownStateError } from '@pcm/domain';
import {
  REFUND_ERROR_CLASSES,
  UNKNOWN_VALUE_TYPES,
  classifyRefundError,
  describeUnknownValue,
  type RefundErrorClass,
} from './refund-error-class';

// 🔴 本檔釘的是**穿透面 = 0**,不是「分類分得準」。
//    分類不準 ⇒ 下一個人方向被誤導;穿透 ⇒ 祕密進稽核表。兩者嚴重度不同,不要混講。

const CLASSES = new Set<string>(REFUND_ERROR_CLASSES);

describe('classifyRefundError — 認得出來的那幾格', () => {
  it('內建型別各自有格', () => {
    expect(classifyRefundError(new TypeError('fetch failed'))).toBe('network_or_type');
    expect(classifyRefundError(new SyntaxError('Unexpected token'))).toBe('malformed_response');
    expect(classifyRefundError(new Error('something'))).toBe('error_unclassified');
  });

  it('AbortError(逾時/中止)有自己的格', () => {
    expect(classifyRefundError(new DOMException('aborted', 'AbortError'))).toBe(
      'aborted_or_timeout',
    );
    // 同樣是 DOMException、但不是 AbortError ⇒ 不得落進那一格。
    expect(classifyRefundError(new DOMException('boom', 'DataError'))).not.toBe(
      'aborted_or_timeout',
    );
  });
});

describe('🔴 default 分支:沒見過的東西一律落封閉字集,不原文穿透', () => {
  // 🔴 這一發就是 codex 對告警線示範過的攻擊:`name` 是一般可寫欄位。
  it('把祕密塞進 error.name,不得出現在回傳值裡', () => {
    const e = new Error('safe');
    e.name = 'SECRET_IN_NAME';
    const got = classifyRefundError(e);
    expect(got).toBe('error_unclassified');
    expect(got).not.toContain('SECRET');
  });

  it('把祕密塞進 message,不得出現在回傳值裡', () => {
    const got = classifyRefundError(new Error('sk_live_DEADBEEF_TOKEN'));
    expect(got).not.toContain('sk_live');
    expect(CLASSES.has(got)).toBe(true);
  });

  it('連 Error 都不是的東西落 other', () => {
    for (const weird of [null, undefined, 'a string', 42, { name: 'LOOKS_LIKE_ERROR' }, []]) {
      expect(classifyRefundError(weird)).toBe('other');
    }
  });

  it('🔴 全稱:餵一堆惡意形狀,輸出【永遠】在封閉字集裡', () => {
    const nasty: unknown[] = [
      null,
      undefined,
      Symbol('s'),
      () => 'fn',
      new Map([['k', 'v']]),
      Object.assign(new Error('x'), { name: 'X'.repeat(5000) }),
      Object.assign(new Error('x'), { toString: () => 'PWNED' }),
      { [Symbol.toStringTag]: 'Error' },
      new Proxy({}, { get: () => 'PWNED' }),
      // 🔴 codex R1 F6:上面那個 Proxy 只有 `get` trap,**打不到真正危險的那條路**。
      //    `instanceof` 走的是 `getPrototypeOf` —— 這兩個才會讓 instanceof 自己 throw。
      new Proxy({}, {
        getPrototypeOf() {
          throw new Error('getPrototypeOf trap 爆了');
        },
      }),
      (() => {
        const r = Proxy.revocable({}, {});
        r.revoke();
        return r.proxy;
      })(),
    ];
    for (const input of nasty) {
      const got: RefundErrorClass = classifyRefundError(input);
      expect(CLASSES.has(got), `輸入回了不在字集裡的 ${String(got)}`).toBe(true);
    }
  });
});

describe('字集本身', () => {
  it('沒有重複、全部小寫底線、且 other 在裡面(它是 default 的落點)', () => {
    expect(new Set(REFUND_ERROR_CLASSES).size).toBe(REFUND_ERROR_CLASSES.length);
    for (const c of REFUND_ERROR_CLASSES) expect(c).toMatch(/^[a-z][a-z_]*$/);
    expect(CLASSES.has('other')).toBe(true);
  });

  // 🔴 措辭紀律(主視窗 Q9=甲)的機械化:碼名不得描述「對方怎麼了」。
  it('碼名不得出現對方的名字或斷定對方行為的字眼', () => {
    for (const c of REFUND_ERROR_CLASSES) {
      expect(c, `${c} 描述了對方而不是我們的觀察`).not.toMatch(
        /tappay|provider|bank|no_answer|never|refus/,
      );
    }
  });
});

describe('🔴 codex R1 F6:instanceof 自己會 throw 的那兩種值', () => {
  it('拋錯的 getPrototypeOf trap ⇒ 不得 throw,且落 other', () => {
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('boom');
        },
      },
    );
    expect(() => classifyRefundError(hostile)).not.toThrow();
    expect(classifyRefundError(hostile)).toBe('other');
  });

  it('revoked Proxy ⇒ 不得 throw,且落 other', () => {
    const r = Proxy.revocable({}, {});
    r.revoke();
    expect(() => classifyRefundError(r.proxy)).not.toThrow();
    expect(classifyRefundError(r.proxy)).toBe('other');
  });
});

describe('describeUnknownValue — 封閉描述,零字元來自那個值(F1/F2/F8)', () => {
  const TYPES = new Set<string>(UNKNOWN_VALUE_TYPES);

  it('字串只留長度,內容一個字都不留', () => {
    const got = describeUnknownValue('sk_live_DEADBEEF');
    expect(got).toEqual({ type: 'string', length: 16 });
    expect(JSON.stringify(got)).not.toContain('sk_live');
  });

  it('🔴 空字串與「沒帶」分得開(F8)', () => {
    expect(describeUnknownValue('')).toEqual({ type: 'string', length: 0 });
    expect(describeUnknownValue(undefined)).toEqual({ type: 'undefined', length: null });
    expect(describeUnknownValue(null)).toEqual({ type: 'null', length: null });
  });

  it('🔴 不得呼叫值身上的任何方法(F2:String() 會執行 toString 且可能 throw)', () => {
    let called = false;
    const trap = {
      toString() {
        called = true;
        throw new Error('toString 爆了');
      },
      [Symbol.toPrimitive]() {
        called = true;
        throw new Error('toPrimitive 爆了');
      },
    };
    expect(() => describeUnknownValue(trap)).not.toThrow();
    expect(describeUnknownValue(trap).type).toBe('object');
    expect(called, '它去碰了那個值身上的方法').toBe(false);
  });

  it('🔴 全稱:任何輸入的 type 都在封閉字集裡,length 只可能是 number 或 null', () => {
    const r = Proxy.revocable({}, {});
    r.revoke();
    const inputs: unknown[] = [
      null, undefined, '', 'x', 0, -1, 1n, true, Symbol('s'), () => 1, {}, [],
      new Error('e'), r.proxy,
      new Proxy({}, { getPrototypeOf() { throw new Error('boom'); } }),
    ];
    for (const v of inputs) {
      const got = describeUnknownValue(v);
      expect(TYPES.has(got.type), `type ${got.type} 不在字集裡`).toBe(true);
      expect(got.length === null || typeof got.length === 'number').toBe(true);
    }
  });
});

// ═══ ⟦b4-REFUND10016⟧ 乙:兩個 throw 點的金錢意義相反 ═══════════════════════════
//
// 🔴 **期望值從【規格】推,不是從實作抄** —— 下面兩格的第二欄是「值班要做什麼」,
//    而分類碼是第三欄。先答第二欄,分類碼才有意義。
//    (抄實作 = 讓被測的碼自己出考題;那格測試從出生起就抓不到它的缺陷。)
//
//   TapPay 受理了(status === 0)、回應形狀壞掉 ⇒ 先查**那一筆退款**的下落
//   TapPay 回了**沒實證過的非 0 碼**            ⇒ 先查**那個碼是什麼意思**
// 🛑 **兩格都是「已送出、狀態未知」⇒ 都不得自動重發、都不該叫人直接重退**(codex R2 打掉我原本的
//    「錢沒動 ⇒ 要重退」—— 乾淨拒絕的碼走的是別條路, 走到這裡的是我們沒見過的碼)。
//
// 🛑 這兩件事**共用同一列稽核資料**,在本片之前都落 `error_unclassified`。
describe('⟦b4-REFUND10016⟧ 乙 — 兩條路的【先查哪裡】不同,必須分得出來', () => {
  it('TapPay 受理了 ⇒ 先查那一筆退款的下落 ⇒ accepted_malformed', () => {
    const err = new TapPayRefundUnknownStateError('受理回應格式異常', 'r_1', 'accepted_malformed');
    expect(classifyRefundError(err)).toBe('accepted_malformed');
  });

  it('TapPay 回了沒實證過的碼 ⇒ 先查那個碼 ⇒ unknown_wire_status', () => {
    const err = new TapPayRefundUnknownStateError('未實證回應碼 10016', null, 'unknown_wire_status');
    expect(classifyRefundError(err)).toBe('unknown_wire_status');
  });

  it('🔴 兩者不得相等 —— 這一格才是本片存在的理由', () => {
    const accepted = new TapPayRefundUnknownStateError('a', null, 'accepted_malformed');
    const rejected = new TapPayRefundUnknownStateError('b', null, 'unknown_wire_status');
    expect(classifyRefundError(accepted)).not.toBe(classifyRefundError(rejected));
  });

  it('🔵 負對照:一般 Error 不受影響,仍是 error_unclassified', () => {
    expect(classifyRefundError(new Error('plain'))).toBe('error_unclassified');
  });

  it('🔵 負對照:帶一個【不在字集裡】的 outcome ⇒ 不得穿透,退回 error_unclassified', () => {
    // 🔴 JS 呼叫端繞過型別層塞進來的值。本函式對外的承諾是「回傳值恆在字集內」,
    //    而**穿透**(把外來字串原樣回傳)是本檔真正在防的那件事。
    const weird = Object.assign(new Error('x'), { outcome: 'sk_live_LEAKED' });
    const got = classifyRefundError(weird);
    expect(got).toBe('error_unclassified');
    expect(CLASSES.has(got)).toBe(true);
  });

  it('🔴🔴 codex R1 must-fix:【撞名】的 Error 不得被判成 unknown_wire_status', () => {
    // 情境(codex 給的):某個自訂 abort reason 剛好也有 `outcome` 欄, 值恰好撞上。
    // 🛑 若它被判成 unknown_wire_status ⇒ 值班被送去查錯的東西, 而這條路動的是錢。
    // 🎯 撞名必須落在安全的那一側(退回「分不出是哪一類」)—— 動錢那一側的代價是雙退。
    const impostor = Object.assign(new Error('some other failure'), {
      outcome: 'unknown_wire_status',
    });
    expect(classifyRefundError(impostor)).toBe('error_unclassified');
    expect(classifyRefundError(impostor)).not.toBe('unknown_wire_status');
  });

  it('🔴 而【身分對而值不對】也不得穿透', () => {
    const wrongValue = Object.assign(new Error('x'), {
      name: 'TapPayRefundUnknownStateError',
      outcome: 'sk_live_LEAKED',
    });
    const got = classifyRefundError(wrongValue);
    expect(got).toBe('error_unclassified');
    expect(CLASSES.has(got)).toBe(true);
  });

  it('🔵 兩個新分類碼都在封閉字集裡', () => {
    expect(CLASSES.has('accepted_malformed')).toBe(true);
    expect(CLASSES.has('unknown_wire_status')).toBe(true);
  });
});
