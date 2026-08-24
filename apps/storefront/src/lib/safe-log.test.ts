// safe-log.test.ts — `#900` codex R1 findings 1/2/3/4 的修法本體的守門。
//
// 🔴 為什麼這支要獨立存在:兩個呼叫端(`charge-actions.ts` / `payment-status/route.ts`)
//   各自的測試證的是「**我這條路上有接**」;它們證不出「這支工具本身在極端輸入下不會拋」。
//   而它一拋, 兩條路就同時退回修之前的樣子 —— 而**兩邊的測試都還是綠的**
//   (它們餵的是普通 `Error`, 那個世界裡 `safeErrorName` 不會拋)。

import { describe, expect, it, vi } from 'vitest';
import { safeErrorName, safeLog } from './safe-log';

describe('safeErrorName — 白名單而不是「類別名」', () => {
  it('規格內建的錯誤類別照實回', () => {
    expect(safeErrorName(new Error('x'))).toBe('Error');
    expect(safeErrorName(new TypeError('x'))).toBe('TypeError');
    expect(safeErrorName(new RangeError('x'))).toBe('RangeError');
  });

  it('🔴 `name` 被寫成祕密 ⇒ 壓成 other(`name` 是一般可寫欄位, 這是它存在的理由)', () => {
    const e = new Error('safe');
    e.name = 'SECRET_IN_NAME';
    expect(safeErrorName(e)).toBe('other');
  });

  it('🔴 自訂子類也壓成 other(白名單【由這裡造出來】, 不是假設它本來就封閉)', () => {
    class MyPaymentError extends Error {
      override name = 'MyPaymentError';
    }
    expect(safeErrorName(new MyPaymentError('boom'))).toBe('other');
  });

  it('非 Error 的東西不會讓它拋', () => {
    expect(typeof safeErrorName('just a string')).toBe('string');
    expect(typeof safeErrorName(null)).toBe('string');
    expect(typeof safeErrorName(undefined)).toBe('string');
    expect(typeof safeErrorName(Symbol('s'))).toBe('string');
  });

  it('🔴 連「讀 err 本身就會爆」都不得拋(Proxy / getter throw)', () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('reading me explodes');
        },
        has() {
          throw new Error('instanceof me explodes');
        },
        getPrototypeOf() {
          throw new Error('proto me explodes');
        },
      },
    );
    expect(() => safeErrorName(hostile)).not.toThrow();
    expect(safeErrorName(hostile)).toBe('other');
  });

  it('🔴 祕密**永遠不會**從 message 那條路出來(它根本沒讀 message)', () => {
    expect(safeErrorName(new Error('prime=abc123 rec_trade_id=xyz'))).toBe('Error');
  });

  // ── 🔴🔴 codex 關卡2 R2 finding 1(must-fix)的守門 ──────────────────────────
  // codex 逐字:「`name` getter 若先把 `Array.prototype.includes` 改成永遠回 true,
  //   再回傳 `prime=SECRET`, 白名單會放行並把敏感字串寫入 log。
  //   白名單判斷不能依賴可被覆寫的 prototype method。」
  //
  // 📌 這是這一族的**第三次**(①`err.name` 可寫 ②`Array.prototype.includes` 可覆寫)⇒
  //   母題:**白名單若靠一個「可以被外面換掉的東西」來判斷, 那它就不是白名單。**
  // 🔴 修法 = 改用 `switch`(規格層嚴格相等, 沒有方法查找)。本段兩格是它的驗收。

  it('🔴 活性對照(必須排在下一格【之前】):覆寫 `Array.prototype.includes` 真的生效了', () => {
    // 🔴 少了這一格, 下一格可能是「我根本沒覆寫成功」造成的假綠 ——
    //   而假綠與真綠長得一模一樣。**正對照要用你要量的那把尺打一個你知道答案的東西。**
    const orig = Array.prototype.includes;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 蓄意汙染 prototype, finally 還原
      (Array.prototype as any).includes = () => true;
      expect(['a', 'b'].includes('這個字根本不在陣列裡')).toBe(true); // ← 覆寫確實生效
    } finally {
      Array.prototype.includes = orig;
    }
    expect(['a', 'b'].includes('這個字根本不在陣列裡')).toBe(false); // ← 還原也確實生效
  });

  it('🔴 R2 finding 1:`Array.prototype.includes` 被換成永遠回 true ⇒ 仍然【不得】放行', () => {
    const orig = Array.prototype.includes;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 蓄意汙染 prototype, finally 還原
      (Array.prototype as any).includes = () => true;
      const e = new Error('safe');
      e.name = 'prime=SECRET';
      // 🔴 承重:舊實作(KNOWN.includes(name))在這個世界會回 'prime=SECRET' ⇒ 祕密進 log。
      expect(safeErrorName(e)).toBe('other');
      // 正向:同一個被汙染的世界裡, 認得的名字仍要照實回(否則「永遠回 other」也能讓本格綠)。
      expect(safeErrorName(new TypeError('x'))).toBe('TypeError');
    } finally {
      Array.prototype.includes = orig;
    }
  });

  it('🔴 同族的另外三個也不得成為判斷依據(indexOf / some / hasOwnProperty)', () => {
    // ⚠️ 本格不證明「碼裡沒有用到它們」—— 那要用 grep 去數(交件檔附了那條命令)。
    //   本格證的是:就算它們全被汙染, 結果仍不變。
    const oi = Array.prototype.indexOf;
    const os = Array.prototype.some;
    const oh = Object.prototype.hasOwnProperty;
    try {
      /* eslint-disable @typescript-eslint/no-explicit-any -- 蓄意汙染, finally 還原 */
      (Array.prototype as any).indexOf = () => 0;
      (Array.prototype as any).some = () => true;
      (Object.prototype as any).hasOwnProperty = () => true;
      /* eslint-enable @typescript-eslint/no-explicit-any */
      const e = new Error('safe');
      e.name = 'rec_trade_id=SECRET';
      expect(safeErrorName(e)).toBe('other');
      expect(safeErrorName(new RangeError('x'))).toBe('RangeError');
    } finally {
      Array.prototype.indexOf = oi;
      Array.prototype.some = os;
      Object.prototype.hasOwnProperty = oh;
    }
  });

  it('🔴 `instanceof` 被騙(Symbol.hasInstance)⇒ 兩個方向都只會往【少講一點】倒', () => {
    // 🔴🔴 **我第一版把覆寫掛在【子類】上, 而那是錯的** ——
    //   `err instanceof Error` 查的是 **`Error[Symbol.hasInstance]`**, 不是子類的。
    //   後果分兩半, 而兩半都值得留著:
    //     · 「騙成 false」那格**紅了**(收到 'Error'), 是它救了我
    //     · 「騙成 true」那格**綠了 —— 而綠的理由與我寫的失敗情境無關**:
    //       那個 FakeError 只是「不是 Error」所以掉到 `other`, 跟 Symbol.hasInstance 一點關係都沒有。
    //   📌 形狀:**一格綠的測試, 綠的理由可以跟它的標題完全無關。** 只有紅的那半會告訴你。
    const hasInstance = Symbol.hasInstance;
    const spoof = (value: boolean) =>
      Object.defineProperty(Error, hasInstance, { value: () => value, configurable: true });

    try {
      // 方向①「騙成 true」:一個普通物件被當成 Error ⇒ 讀到它那個帶祕密的 name ⇒ 仍須壓成 'other'
      spoof(true);
      const notAnError = { name: 'prime=SECRET' };
      expect(notAnError instanceof Error).toBe(true); // ← 活性:覆寫真的生效了
      expect(safeErrorName(notAnError)).toBe('other');

      // 方向②「騙成 false」:真的 TypeError 被當成非 Error ⇒ 掉到最後那行 ⇒ 'other'
      spoof(false);
      expect(new TypeError('x') instanceof Error).toBe(false); // ← 活性
      expect(safeErrorName(new TypeError('x'))).toBe('other');
    } finally {
      delete (Error as unknown as Record<symbol, unknown>)[hasInstance];
    }

    // 還原也要驗(否則後面的測試會在一個被汙染的世界裡跑)
    expect(new TypeError('x') instanceof Error).toBe(true);
    expect(safeErrorName(new TypeError('x'))).toBe('TypeError');
  });
});

describe('safeLog — 印不出來永遠不改變控制流', () => {
  it('正常時就是 console 那一支, 兩個參數逐字傳過去', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    safeLog('error', '[t] hi', { a: 1 });
    expect(spy).toHaveBeenCalledWith('[t] hi', { a: 1 });
    spy.mockRestore();
  });

  it('level 選得對(info 不會跑去打 error)', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    safeLog('info', '[t] hi', {});
    expect(info).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
    info.mockRestore();
    error.mockRestore();
  });

  it('🔴 `console.error` 自己拋 ⇒ safeLog 不拋(這就是 findings 1/2 的整個修法)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('console is broken');
    });
    expect(() => safeLog('error', '[t] hi', {})).not.toThrow();
    spy.mockRestore();
  });

  it('🔴 `console.info` 自己拋 ⇒ 也不拋(兩個 level 都要, 不能只驗一個)', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {
      throw new Error('console is broken');
    });
    expect(() => safeLog('info', '[t] hi', {})).not.toThrow();
    spy.mockRestore();
  });

  it('🔴 突變的反向:負對照 —— 裸 console 在同一個世界【真的會拋】', () => {
    // 這一格證的是上面兩格的**尺是活的**:若 console 其實沒被弄壞,
    // 上面兩格用「什麼都不做的 safeLog」也會綠。
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('console is broken');
    });
    expect(() => console.error('[t] hi', {})).toThrow('console is broken');
    spy.mockRestore();
  });
});
