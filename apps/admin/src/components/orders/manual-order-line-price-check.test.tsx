// @vitest-environment jsdom
// ⟦b4-PURCHTAX1⟧ 甲案的守門(Sean 2026-09-03 批)。
//
// 🔴 判準是本片自己立的:
//    **「這一道在【他填錯了】與【他填對了】兩個世界裡, 會不會印不同的東西?」**
//    ⇒ 所以【五種讀數各一格】, 不是只測 mismatch 那一種。
// 🛑 而**沒有任何一格斷言「送出被擋住」** —— 它不該擋, 那是規格不是疏漏。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// 🔴 本元件 import 那支 server action, 而它那條鏈上有 `server-only`(同隔壁兩支測)。
vi.mock('server-only', () => ({}));

import {
  ManualOrderLinePriceCheck,
  linePriceCheckMessage,
  resolveLinePriceCheck,
} from './manual-order-line-price-check';
import {
  MANUAL_ORDER_LINE_SKU_BASE,
  MANUAL_ORDER_LINE_UNIT_PRICE_BASE,
  manualOrderLineField,
} from '@/lib/orders/manual-order-form';

afterEach(cleanup);

const hit = (over: Record<string, unknown> = {}) => ({
  variantId: 'v-1',
  sku: 'SKU-A',
  title: '測試品',
  unitPrice: 1050,
  dealerPriceUntaxed: 900,
  ...over,
});

// ── 純函式層:五種讀數 ────────────────────────────────────────────
describe('resolveLinePriceCheck — 五個世界各一個名字', () => {
  it('填對 ⇒ match', () => {
    expect(resolveLinePriceCheck('SKU-A', 1050, { ok: true, hits: [hit()] }).kind).toBe('match');
  });

  it('🔴 填了未稅價 ⇒ mismatch, 且帶著兩個數字', () => {
    const c = resolveLinePriceCheck('SKU-A', 1000, { ok: true, hits: [hit()] });
    expect(c).toEqual({ kind: 'mismatch', sku: 'SKU-A', typed: 1000, authority: 1050 });
  });

  it('🛑 型錄查無(代購)⇒ unmatched, **不是** match', () => {
    expect(resolveLinePriceCheck('SKU-X', 1000, { ok: true, hits: [] }).kind).toBe('unmatched');
  });

  it('🔵 有商品但沒定價 ⇒ no_price(第三個世界)', () => {
    expect(
      resolveLinePriceCheck('SKU-A', 1000, { ok: true, hits: [hit({ unitPrice: null })] }).kind,
    ).toBe('no_price');
  });

  it('🔴 查不動 ⇒ check_failed, **不得**變成 unmatched(那會把型錄品項講成代購)', () => {
    const c = resolveLinePriceCheck('SKU-A', 1000, {
      ok: false,
      reason: 'denied',
      message: '沒有權限查商品,請重新登入或找人開權限。',
    });
    expect(c.kind).toBe('check_failed');
    expect(linePriceCheckMessage(c)).toContain('沒有權限查商品');
  });

  it('🔴 查詢【滿了】而沒撈到相等那筆 ⇒ inconclusive, **不是** unmatched', () => {
    // 逐字相等那筆可能排在 limit 之外 ⇒ 說成「不在型錄裡」= 把型錄品項講成代購。
    const many = Array.from({ length: 20 }, (_, i) => hit({ sku: `SKU-OTHER-${i}` }));
    expect(resolveLinePriceCheck('SKU-A', 1000, { ok: true, hits: many }).kind).toBe('inconclusive');
  });

  it('🔵 對照:沒滿而沒撈到 ⇒ 那才是真的 unmatched(代購)', () => {
    expect(resolveLinePriceCheck('SKU-A', 1000, { ok: true, hits: [hit({ sku: 'SKU-B' })] }).kind).toBe(
      'unmatched',
    );
  });

  it('🔴🔴 模糊比對回一堆 ⇒ 只認【逐字相等】那一筆, 不能拿第一筆', () => {
    // `ilike '%SKU-A%'` 會把 `SKU-A-LONG` 一起撈回來, 而它排在前面。
    const c = resolveLinePriceCheck('SKU-A', 1050, {
      ok: true,
      hits: [hit({ sku: 'SKU-A-LONG', unitPrice: 9999 }), hit({ sku: 'SKU-A', unitPrice: 1050 })],
    });
    expect(c.kind, '拿了第一筆 ⇒ 會把一個填對的人判成填錯').toBe('match');
  });
});

// ── 文案層:兩個世界要印不同的東西 ──────────────────────────────
describe('linePriceCheckMessage — 五種都要出聲', () => {
  it('🔴 對得上【也要】出聲(沉默在三個世界印同一個東西)', () => {
    expect(linePriceCheckMessage({ kind: 'match', sku: 'SKU-A' })).toContain('對得上');
  });

  it('🔴 mismatch 要講出我們懷疑的是哪一種錯, 不只說「不一樣」', () => {
    const m = linePriceCheckMessage({
      kind: 'mismatch',
      sku: 'SKU-A',
      typed: 1000,
      authority: 1050,
    });
    expect(m).toContain('1,000');
    expect(m).toContain('1,050');
    expect(m, '沒指出「像未稅」⇒ 員工會直接改成一樣, 而那不一定對').toContain('未稅');
  });

  it('🔴 「像未稅」要精確 —— 1000 對 1049/1051 都【不是】未稅(容差會把猜測講成指示)', () => {
    for (const authority of [1049, 1051]) {
      expect(
        linePriceCheckMessage({ kind: 'mismatch', sku: 'S', typed: 1000, authority }),
        `1000×1.05=1050 ≠ ${authority} ⇒ 不該說像未稅`,
      ).not.toContain('未稅');
    }
    expect(linePriceCheckMessage({ kind: 'mismatch', sku: 'S', typed: 1000, authority: 1050 })).toContain('未稅');
  });

  it('🔴 typed=0 不得被說成「像未稅」(0×1.05 四捨五入會撞上 0/1)', () => {
    expect(linePriceCheckMessage({ kind: 'mismatch', sku: 'S', typed: 0, authority: 1 })).not.toContain('未稅');
  });

  it('🔵 而【不像未稅】的差異不得硬說成未稅', () => {
    const m = linePriceCheckMessage({ kind: 'mismatch', sku: 'SKU-A', typed: 300, authority: 1050 });
    expect(m, '300×1.05 不等於 1050 ⇒ 那不是稅的問題').not.toContain('未稅');
    expect(m).toContain('確定要用你填的那個就直接送出');
  });

  it('🛑 代購那句**不得**說成「沒問題」—— 它沒有被檢查過, 只是無從檢查', () => {
    const m = linePriceCheckMessage({ kind: 'unmatched', sku: 'SKU-X' });
    expect(m).toContain('沒有權威價可以比');
    expect(m).not.toContain('沒問題');
  });
});

// ── 接線層:focusout 真的有接上 ──────────────────────────────────
describe('接線(focusout)', () => {
  function renderInForm(searchAction: Parameters<typeof ManualOrderLinePriceCheck>[0]['searchAction']) {
    return render(
      <form>
        <input name={manualOrderLineField(MANUAL_ORDER_LINE_SKU_BASE, 0)} aria-label='料號' />
        <input name={manualOrderLineField(MANUAL_ORDER_LINE_UNIT_PRICE_BASE, 0)} aria-label='單價' />
        <ManualOrderLinePriceCheck index={0} searchAction={searchAction} />
      </form>,
    );
  }

  it('🔴 兩格都填了 ⇒ 失焦時問一次', async () => {
    renderInForm(async () => ({ ok: true, hits: [hit()] }));
    fireEvent.change(screen.getByLabelText('料號'), { target: { value: 'SKU-A' } });
    fireEvent.change(screen.getByLabelText('單價'), { target: { value: '1000' } });
    fireEvent.focusOut(screen.getByLabelText('單價'));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeNull());
    expect(screen.getByRole('alert').textContent).toContain('1,050');
  });

  it('🔵 只填了料號 ⇒ 不出聲(員工還在打字時噴話很吵)', async () => {
    renderInForm(async () => ({ ok: true, hits: [hit()] }));
    fireEvent.change(screen.getByLabelText('料號'), { target: { value: 'SKU-A' } });
    fireEvent.focusOut(screen.getByLabelText('料號'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('manual-order-line-price-check-0').textContent).toBe('');
  });

  it('🔴 別列的欄位失焦 ⇒ 這一列不動(名字比對要逐字, 不能用 includes)', async () => {
    // 🔴🔴 **這一格原本是恆真的**(codex must-fix):我把「別列」那個 input 放進
    //    **另一張 form** ⇒ 監聽器本來就收不到 ⇒ 就算程式改成 `includes` 也照樣綠。
    //    🎯 **一個測試若在【它要防的那個 bug 存在時】也會綠, 它測的不是那個 bug。**
    //    ✅ 改成放進**同一張 form** —— 那才是真實形狀(所有列共用一張表單)。
    render(
      <form>
        <input name={manualOrderLineField(MANUAL_ORDER_LINE_SKU_BASE, 0)} aria-label='料號' />
        <input name={manualOrderLineField(MANUAL_ORDER_LINE_UNIT_PRICE_BASE, 0)} aria-label='單價' />
        <input
          name={manualOrderLineField(MANUAL_ORDER_LINE_UNIT_PRICE_BASE, 1)}
          aria-label='別列單價'
        />
        <ManualOrderLinePriceCheck
          index={0}
          searchAction={async () => ({ ok: true, hits: [hit()] })}
        />
      </form>,
    );
    // 第 0 列兩格都填好(這樣「有沒有出聲」才由【是誰失焦】決定, 而不是由「沒填」決定)。
    fireEvent.change(screen.getByLabelText('料號'), { target: { value: 'SKU-A' } });
    fireEvent.change(screen.getByLabelText('單價'), { target: { value: '1000' } });
    fireEvent.focusOut(screen.getByLabelText('別列單價'));
    await new Promise((r) => setTimeout(r, 20));
    expect(
      screen.getByTestId('manual-order-line-price-check-0').textContent,
      '別列失焦不該觸發這一列',
    ).toBe('');
  });

  it('🔴 大小寫不同的料號 ⇒ 仍算找到(ilike 不分大小寫, 用 === 比會誤判成代購)', async () => {
    renderInForm(async () => ({ ok: true, hits: [hit({ sku: 'SKU-A' })] }));
    fireEvent.change(screen.getByLabelText('料號'), { target: { value: 'sku-a' } });
    fireEvent.change(screen.getByLabelText('單價'), { target: { value: '1000' } });
    fireEvent.focusOut(screen.getByLabelText('單價'));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeNull());
    expect(screen.getByRole('alert').textContent, '被判成代購 ⇒ 方向是危險的那一側').toContain(
      '1,050',
    );
  });

  it('🔵 送出解析器收不下的寫法(1e3)⇒ 不出聲, 不得說「對得上」', async () => {
    renderInForm(async () => ({ ok: true, hits: [hit({ unitPrice: 1000 })] }));
    fireEvent.change(screen.getByLabelText('料號'), { target: { value: 'SKU-A' } });
    fireEvent.change(screen.getByLabelText('單價'), { target: { value: '1e3' } });
    fireEvent.focusOut(screen.getByLabelText('單價'));
    await new Promise((r) => setTimeout(r, 20));
    expect(
      screen.getByTestId('manual-order-line-price-check-0').textContent,
      "`1e3` 送出時會被 NON_NEG_INT_RE 拒掉 ⇒ 對它說「對得上」是騙人的",
    ).toBe('');
  });

  it('🔴 用 `focusout` 不是 `blur` —— blur 不冒泡, 掛在 form 上收不到', () => {
    // 🔴 這一格**原本我寫成 `expect(true).toBe(true)`** —— 那是一句在兩個世界印同一個綠的話,
    //    而它就掛在一段解釋得很好的註解下面。**解釋不是斷言。** 改成讀原始碼。
    //    (本 repo 記過同一個坑:memory 關鍵字「focusout 非 blur」。)
    // 🔵 用 `__dirname` 不是 `process.cwd()` —— vitest 的 cwd 是 **repo 根**不是 `apps/admin`
    //    (我第一版寫 cwd ⇒ ENOENT)。形狀抄隔壁 `manual-order-lines.test.tsx:29`。
    const code = readFileSync(join(__dirname, 'manual-order-line-price-check.tsx'), 'utf8');
    expect(code, "掛 'blur' 在 form 上收不到 —— blur 不冒泡").toContain("'focusout'");
    expect(code).not.toContain("addEventListener('blur'");
  });
});
