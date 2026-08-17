import { describe, expect, it } from 'vitest';

// 🔴 #606 前置錨點(storefront project):vitest.config.ts 拆 projects 後,
//    `env: { TZ: 'Asia/Taipei' }` 靠各 project `extends: true` 繼承 root。
//    繼承失效不會讓任何既有測試紅 —— 時區類守門會【靜默失去判別力】
//    (#352-b-1 R3 實錘:錯式在 UTC 下恰好等價於正確)。
//    admin project 已有同款錨點(receipt-record-form.test.tsx);本檔守 storefront project。
//    拿掉 root 的 TZ 行、或本 project 的 extends 繼承壞掉,這格會紅。
describe('vitest projects 繼承(storefront)', () => {
  it('🔴 前置:測試時區釘在 Asia/Taipei(TZ 繼承失效這格會紅)', () => {
    // 🔴 判別力備忘(突變 B 實測):只斷言 Intl/offset 的話,在系統時區=台北的機器上
    //    拿掉 config 那行【照樣綠】(系統時區遮住 config 失效)⇒ 必須同時斷言
    //    process.env.TZ —— 它只會由 vitest config 的 env 注入,系統時區不會替你設。
    expect(process.env.TZ).toBe('Asia/Taipei');
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Asia/Taipei');
    expect(new Date('2026-08-11T02:22:00.000Z').getTimezoneOffset()).toBe(-480);
  });
});
