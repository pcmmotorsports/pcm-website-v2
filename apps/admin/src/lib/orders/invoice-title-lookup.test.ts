import { describe, it, expect } from 'vitest';
import {
  INVOICE_TITLE_LOOKUP_TIMEOUT_MS,
  lookupInvoiceTitle,
  type InvoiceTitleFetcher,
} from './invoice-title-lookup';

// invoice-title-lookup.test.ts — ⟦b4-INVOICE5PCT⟧三的驗收。
//
// 🔴🔴 **主格是「查不到的時候他照樣建得出單」, 不是「查得到」。**
//    ⇒ 📌 所以本檔**先寫五種失敗, 最後才寫成功那一格** —— 順序是刻意的。
// 🛑 **一發真的對外請求都沒有** —— `fetcher` 全是假的。本片在 Sean 挑定要打誰之前不准對外。

/** 假的抬頭挑法:照最常見的形狀取一個欄位。真的那一支跟著選哪一家 API 走。 */
const pick = (b: unknown): string | null =>
  typeof b === 'object' && b !== null && 'title' in b ? ((b as { title: unknown }).title as string) : null;

const fetcherThatThrows = (name: string): InvoiceTitleFetcher => () => {
  const e = new Error('boom');
  e.name = name;
  return Promise.reject(e);
};
const fetcherReturning = (res: Partial<Response>): InvoiceTitleFetcher => () =>
  Promise.resolve(res as Response);

const ok = (body: unknown): Partial<Response> => ({ ok: true, json: () => Promise.resolve(body) });

describe('⟦b4-INVOICE5PCT⟧三 統編查抬頭:fail-open 的殼', () => {
  it('🔴🔴 五種失敗【全部回值, 一個都不 throw】—— 這是本片存在的理由', async () => {
    const cases: ReadonlyArray<readonly [string, InvoiceTitleFetcher, string]> = [
      ['逾時', fetcherThatThrows('TimeoutError'), 'timeout'],
      ['網路不通', fetcherThatThrows('TypeError'), 'network'],
      ['500', fetcherReturning({ ok: false }), 'http'],
      ['回垃圾(半截 JSON / HTML 錯誤頁)', fetcherReturning({ ok: true, json: () => Promise.reject(new Error('bad')) }), 'garbage'],
      ['回空', fetcherReturning(ok({ title: '   ' })), 'empty'],
    ];
    for (const [label, f, reason] of cases) {
      // 🔴 `await` 直接接, **沒有 try/catch** —— 它若 throw, 這一格就紅在這裡。
      const r = await lookupInvoiceTitle('22099131', f, pick);
      expect(r, label).toEqual({ ok: false, reason });
    }
  });

  it('🔴 `pickTitle` 自己 throw 也不准穿出去 —— 那一支跟著選哪一家 API 走, 不是我寫的', async () => {
    const r = await lookupInvoiceTitle('22099131', fetcherReturning(ok({ title: 'x' })), () => {
      throw new Error('別人寫的挑法炸了');
    });
    expect(r).toEqual({ ok: false, reason: 'garbage' });
  });

  it('🔴 統編明顯不對 ⇒ 【連打都不打】', async () => {
    let called = 0;
    const spy: InvoiceTitleFetcher = () => {
      called += 1;
      return Promise.resolve(ok({ title: 'x' }) as Response);
    };
    for (const bad of ['', '1234567', '123456789', 'abcdefgh', '2209913a']) {
      expect(await lookupInvoiceTitle(bad, spy, pick)).toEqual({ ok: false, reason: 'invalid' });
    }
    expect(called, '不合法的統編不該打出去').toBe(0);
  });

  it('🔴🔴 逾時上限【真的傳給了 fetcher】—— 一個沒傳下去的上限是假的', async () => {
    let signal: AbortSignal | null = null;
    await lookupInvoiceTitle('22099131', (_t, s) => {
      signal = s;
      return Promise.resolve(ok({ title: 'x' }) as Response);
    }, pick);
    // 🔵 正對照:它是一個真的 AbortSignal, 不是 undefined 被我當成過了。
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(INVOICE_TITLE_LOOKUP_TIMEOUT_MS).toBeLessThanOrEqual(2_000);
  });

  it('🔴 逾時上限【不准被重試放大】—— 一次呼叫只准打一發', async () => {
    let calls = 0;
    await lookupInvoiceTitle('22099131', () => {
      calls += 1;
      return Promise.reject(Object.assign(new Error('t'), { name: 'TimeoutError' }));
    }, pick);
    expect(calls, '重試會讓 1.5 秒變成 3 秒或 4.5 秒 ⇒ 那不是上限').toBe(1);
  });

  it('🟢 正對照:查得到的時候真的回得來, 而**前後空白會修掉**', async () => {
    const r = await lookupInvoiceTitle('22099131', fetcherReturning(ok({ title: ' 台灣積體電路製造股份有限公司 ' })), pick);
    expect(r).toEqual({ ok: true, title: '台灣積體電路製造股份有限公司' });
  });
});
