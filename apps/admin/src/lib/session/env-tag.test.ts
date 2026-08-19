import { afterEach, describe, expect, it } from 'vitest';

import { resolveEnvTag } from './session';

// 片 0b:`resolveEnvTag()` 的白名單行為。**它今天還沒有接進金鑰** ——
// 本片只把它算出來放進一個 response header,為了量【proxy runtime 讀不讀得到 VERCEL_ENV】。
//
// 🔴 六格是一組:認得的值要回它自己、認不得的一律 null。
//    沒有「認得的」那幾格,「全都 null」與「這把尺對什麼都回 null」印出同一個畫面。
describe('resolveEnvTag(白名單,不是黑名單)', () => {
  const v0 = process.env.VERCEL_ENV;
  const n0 = process.env.NODE_ENV;
  afterEach(() => {
    if (v0 === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = v0;
    (process.env as Record<string, string | undefined>).NODE_ENV = n0;
  });

  it.each(['production', 'preview', 'development'])('✅ 認得的值 %s ⇒ 原樣回傳', (v) => {
    process.env.VERCEL_ENV = v;
    expect(resolveEnvTag()).toBe(v);
  });

  it.each([
    ['空字串', ''],
    ['只有空白', '   '],
    ['未知值(Vercel Custom Environments 是真實功能)', 'staging'],
    ['大小寫不符', 'Production'],
  ])('🔴 VERCEL_ENV 是%s ⇒ null,而且【不得】掉進 NODE_ENV 啟發式', (_l, v) => {
    process.env.VERCEL_ENV = v;
    // 🔴 這一行是這幾格的重點:把 NODE_ENV 設成會讓啟發式回 'local' 的值。
    //    若實作是「不在白名單就往下掉」,這裡會回 'local' ⇒ 而那正是 W6 nit② 那條路。
    (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
    expect(resolveEnvTag()).toBeNull();
  });

  it('✅ VERCEL_ENV 缺 + NODE_ENV=development ⇒ local(對照:證上面 null 不是因為它永遠回 null)', () => {
    delete process.env.VERCEL_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
    expect(resolveEnvTag()).toBe('local');
  });

  it.each([
    ['undefined', undefined],
    ['staging', 'staging'],
    ['拼錯', 'prodction'],
    ['production', 'production'],
  ])('🔴 VERCEL_ENV 缺 + NODE_ENV 是 %s ⇒ null(黑名單寫法會在這裡回 local)', (_l, n) => {
    delete process.env.VERCEL_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = n;
    expect(resolveEnvTag()).toBeNull();
  });
});
