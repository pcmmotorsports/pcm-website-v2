import { describe, expect, it } from 'vitest';

// 🔴 #606 前置錨點(node project:packages/scripts/其餘 apps):
//    vitest.config.ts 拆 projects 後,`env: { TZ: 'Asia/Taipei' }` 靠
//    `extends: true` 繼承 root;繼承失效是【靜默的】(不紅、只失去判別力)。
//    三個 project 各一支錨點:admin=receipt-record-form.test.tsx、
//    storefront=apps/storefront/src/tz-config-inheritance.test.ts、node=本檔。
describe('vitest projects 繼承(node)', () => {
  it('🔴 前置:測試時區釘在 Asia/Taipei(TZ 繼承失效這格會紅)', () => {
    // 🔴 判別力備忘(突變 B 實測):系統時區=台北的機器會遮住「config 那行失效」,
    //    Intl/offset 斷言在那種機器上恆綠 ⇒ 加斷 process.env.TZ(只會由 config 注入)。
    expect(process.env.TZ).toBe('Asia/Taipei');
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Asia/Taipei');
    expect(new Date('2026-08-11T02:22:00.000Z').getTimezoneOffset()).toBe(-480);
  });
});
