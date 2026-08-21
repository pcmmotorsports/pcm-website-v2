import { describe, expect, it } from 'vitest';
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
