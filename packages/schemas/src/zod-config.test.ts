// ⟦後台 CSP 改強制⟧ 2026-10-04(Sean 批 計畫-網站安全標頭與網域-20261004.md Q1 甲):
//   zod 4 建立 object schema 時會跑一次 `new Function("")` 測試瀏覽器准不准 eval(zod/v4/core/util.js allowsEval),
//   CSP 強制後那一下會被擋、每次載入都送一則違規回報。設 jitless 就不跑, 但必須在任何 schema 建立【之前】設。
import { describe, it, expect, vi, afterEach } from 'vitest';

describe('@pcm/schemas — zod jitless(不跑 eval 測試)', () => {
  const RealFunction = globalThis.Function;
  afterEach(() => {
    globalThis.Function = RealFunction;
    vi.resetModules();
  });

  // 只守 index:zod 只在建立 object schema 時跑測試(schemas.js:970-972), notification-email 只建字串 schema,
  //   拿掉它的 import 也不會紅(Fable R1 nit)⇒ 不放進來假裝有守。index 會建 object schema, 也會載入 notification-email。
  it.each(['./index'])('載入 %s 時, zod 不會呼叫 new Function 做 eval 測試', async (entry) => {
    vi.resetModules();
    let constructed = 0;
    globalThis.Function = new Proxy(RealFunction, {
      construct(target, args) {
        constructed++;
        return Reflect.construct(target, args);
      },
      apply(target, thisArg, args) {
        constructed++;
        return Reflect.apply(target, thisArg, args);
      },
    });
    const mod = await import(entry);
    expect(Object.keys(mod).length).toBeGreaterThan(0); // 真的載入了東西(不是空模組而假綠)
    expect(constructed).toBe(0);
  });

  it('載入後 zod 全域設定 jitless = true', async () => {
    vi.resetModules();
    await import('./index');
    const { z } = await import('zod');
    expect(z.config().jitless).toBe(true);
  });
});
