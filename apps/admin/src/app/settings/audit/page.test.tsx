// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

// 🔴 `notFound` mock 成**直接丟錯**,不是回 `undefined` ——
//    形狀照抄 `app/@panel/order-panel-wiring.test.ts:62`,該檔 `:27` 逐字寫了理由:
//    **丟錯測試才會紅,回 undefined 是靜默通過**(頁面會繼續往下 render,看起來完全正常)。
const NOT_FOUND = 'NEXT_NOT_FOUND';
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error(NOT_FOUND);
  },
}));

import AuditLogPage from './page';

// page.test.tsx — `#27` D1c-1:**「直接打網址進不進得來」的守門。**
//
// ── 🔴 本檔存在的唯一理由(主視窗 2026-08-15 派工信逐字)────────────────
//   **只擋側欄 = 擋的是「看得到入口」,不是「進得去」。**
//   判別句:**這格紅的時候,是因為「頁面真的擋住」還是「選單剛好沒渲染」?**
//   ⇒ **本檔完全不經過側欄任何一行 code** —— 直接載入頁面模組並呼叫它,
//     等同員工在網址列打 `/settings/audit`。
//   ⇒ 把 `page.tsx` 那行 `notFound()` 刪掉:**側欄那側的守門一格都不會紅**,只有本檔紅。
//
// ⚠️ **誠實邊界,不要讀成「404 已驗證」**:本檔量的是「頁面模組有沒有呼叫 `notFound()`」。
//   **真的變成 404 畫面**是 Next runtime 的行為,那要真跑 dev server / Sean 肉眼驗才算。
//   本檔擋得住的是「那道閘被刪掉 / 被寫反」,擋不住的是「`notFound()` 在真 runtime 沒生效」。

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('/settings/audit 頁本體的旗標閘', () => {
  it('🔴 旗標關 ⇒ 直接載入頁面會被 notFound() 擋下(不經過側欄)', () => {
    vi.stubEnv('AUDIT_UI_ENABLED', '');
    // 🔴 **前提斷言**:先證明我塞的值真的生效,再斷言行為。
    //    沒有這行,`stubEnv` 若沒生效,整格會在「旗標剛好也是關的」情況下**假綠**
    //    (house 現成形狀:`lib/payment/payment-list-view.test.ts:96-107`)。
    expect(process.env.AUDIT_UI_ENABLED).toBe('');

    expect(() => AuditLogPage()).toThrow(NOT_FOUND);
  });

  it('🔴 旗標開 ⇒ 頁面正常渲染(正向對照:證明上一格不是恆真)', () => {
    // 沒有這一條,把閘寫成 `if (true) notFound()`(恆擋、功能永遠打不開)上面那格照樣綠。
    vi.stubEnv('AUDIT_UI_ENABLED', '1');
    expect(process.env.AUDIT_UI_ENABLED).toBe('1');

    const { getByRole } = render(AuditLogPage());
    expect(getByRole('heading', { level: 1 }).textContent).toBe('操作紀錄');
  });

  it('🔴 旗標值不是恰好 `1` ⇒ 一律擋(`true` / `yes` 都不算開)', () => {
    // `audit-ui-flag.ts:21` 逐字「預設 off、**恰 `'1'`** 才開」。
    // 這格擋的是有人把判斷改成 `Boolean(process.env.X)` 之類的寬鬆寫法。
    vi.stubEnv('AUDIT_UI_ENABLED', 'true');
    expect(process.env.AUDIT_UI_ENABLED).toBe('true');

    expect(() => AuditLogPage()).toThrow(NOT_FOUND);
  });
});
