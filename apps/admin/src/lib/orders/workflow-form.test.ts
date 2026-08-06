// workflow-form.test.ts — 後台改單純函式核心(M-4a Slice C;Origin 白名單 + 表單→patch 解析)。

import { describe, it, expect } from 'vitest';
import {
  isAllowedOrigin,
  parseWorkflowPatchForm,
  WF_CLEAR_VALUE,
  ORDER_ID_FIELD,
  VERSION_FIELD,
  WF_STATUS_FIELD,
  SHIPPING_METHOD_FIELD,
  INVOICE_NUMBER_FIELD,
  INVOICE_AMOUNT_FIELD,
  INVOICE_STATUS_FIELD,
  RETURN_TO_FIELD,
  type FormLike,
} from './workflow-form';

const UUID = '11111111-2222-3333-4444-555555555555';

function form(entries: Record<string, string>): FormLike {
  const m = new Map(Object.entries(entries));
  return { get: (k) => m.get(k) ?? null, has: (k) => m.has(k) };
}

describe('isAllowedOrigin — fail-closed', () => {
  it('缺 Origin(null/空)→ 拒', () => {
    expect(isAllowedOrigin(null, { devBypass: false })).toBe(false);
    expect(isAllowedOrigin('', { devBypass: true })).toBe(false);
    expect(isAllowedOrigin(undefined, { devBypass: true })).toBe(false);
  });

  it('prod 精確等值 admin 網域;近似值/子網域/host 不放行', () => {
    expect(isAllowedOrigin('https://admin.pcmmotorsports.com', { devBypass: false })).toBe(true);
    for (const bad of [
      'https://admin.pcmmotorsports.com.evil.com',
      'https://quote.pcmmotorsports.com',
      'http://admin.pcmmotorsports.com',
      'https://admin.pcmmotorsports.com/',
    ]) {
      expect(isAllowedOrigin(bad, { devBypass: false })).toBe(false);
    }
  });

  it('dev bypass 允許 localhost;非 bypass 不允許', () => {
    expect(isAllowedOrigin('http://localhost:3213', { devBypass: true })).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:3000', { devBypass: true })).toBe(true);
    expect(isAllowedOrigin('http://localhost:3213', { devBypass: false })).toBe(false);
    expect(isAllowedOrigin('http://evil.localhost.com', { devBypass: true })).toBe(false);
  });
});

describe('parseWorkflowPatchForm — 形狀守門 + 未提供≠清空', () => {
  it('order_id 非 UUID / version 非法(含上下界)→ ok:false;邊界內 → ok:true', () => {
    expect(parseWorkflowPatchForm(form({ [ORDER_ID_FIELD]: 'PCM-1', [VERSION_FIELD]: '1' })).ok).toBe(false);
    // 🔴 **上界那兩格是 A9w4a(2026-08-06)補的**:原本只有 item 層那組測到 `2147483647`,
    //    本片刪掉 item parser 後,order 層的 `> 2147483646` 變成零覆蓋 —— 把那條 clause 整個拿掉
    //    也會全綠(codex 關卡2 must-fix)。正負兩格併存才擋得住「上界改成 2147483645」這種退化。
    expect(parseWorkflowPatchForm(form({ [ORDER_ID_FIELD]: UUID, [VERSION_FIELD]: '2147483646' })).ok).toBe(true);
    for (const bad of ['0', '-1', '1.5', 'x', '', '2147483647']) {
      expect(parseWorkflowPatchForm(form({ [ORDER_ID_FIELD]: UUID, [VERSION_FIELD]: bad })).ok).toBe(false);
    }
  });

  it('🔴 D-2(Codex R1 must-fix 1):送 workflow_status(code/哨兵/非法形狀)→ 一律忽略、絕不進 patch(orders 層停寫、寫入路徑關死)', () => {
    for (const v of ['shipped_done', WF_CLEAR_VALUE, '', 'Bad Code!']) {
      const r = parseWorkflowPatchForm(
        form({ [ORDER_ID_FIELD]: UUID, [VERSION_FIELD]: '5', [WF_STATUS_FIELD]: v, [INVOICE_STATUS_FIELD]: 'issued' }),
      );
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect('workflowStatus' in r.patch).toBe(false);
        expect(Object.keys(r.patch)).toEqual(['invoiceStatus']);
      }
    }
  });

  it('明細頁全欄:invoice 空→清空(null)、非空→設定;shipping 空→ok:false', () => {
    const r = parseWorkflowPatchForm(
      form({
        [ORDER_ID_FIELD]: UUID,
        [VERSION_FIELD]: '5',
        [SHIPPING_METHOD_FIELD]: ' 宅配 ',
        [INVOICE_NUMBER_FIELD]: '',
        [INVOICE_AMOUNT_FIELD]: '',
        [INVOICE_STATUS_FIELD]: 'issued',
      }),
    );
    expect(r).toMatchObject({
      ok: true,
      patch: { shippingMethod: '宅配', invoiceNumber: null, invoiceAmount: null, invoiceStatus: 'issued' },
    });

    expect(
      parseWorkflowPatchForm(
        form({ [ORDER_ID_FIELD]: UUID, [VERSION_FIELD]: '5', [SHIPPING_METHOD_FIELD]: '   ' }),
      ).ok,
    ).toBe(false); // shipping NOT NULL
  });

  it('invoice_amount 十進位整數 → 設定;小數/負/非數字 → ok:false', () => {
    const good = parseWorkflowPatchForm(
      form({ [ORDER_ID_FIELD]: UUID, [VERSION_FIELD]: '5', [INVOICE_AMOUNT_FIELD]: '10920' }),
    );
    expect(good.ok && good.patch.invoiceAmount).toBe(10920);
    // nit-5:int4 上限 2147483647 內過、超過拒(form 層擋、不讓 RPC ::integer 溢位走 error)
    expect(
      parseWorkflowPatchForm(form({ [ORDER_ID_FIELD]: UUID, [VERSION_FIELD]: '5', [INVOICE_AMOUNT_FIELD]: '2147483647' })).ok,
    ).toBe(true);
    for (const bad of ['10.5', '-1', '1,000', 'abc', '2147483648', '9999999999']) {
      expect(
        parseWorkflowPatchForm(form({ [ORDER_ID_FIELD]: UUID, [VERSION_FIELD]: '5', [INVOICE_AMOUNT_FIELD]: bad })).ok,
      ).toBe(false);
    }
  });

  it('invoice_status 非三值 → ok:false', () => {
    expect(
      parseWorkflowPatchForm(
        form({ [ORDER_ID_FIELD]: UUID, [VERSION_FIELD]: '5', [INVOICE_STATUS_FIELD]: 'weird' }),
      ).ok,
    ).toBe(false);
  });

  it('return_to:站內 /orders 路徑保留;外部/他路徑退 /orders(防 open redirect)', () => {
    const inPath = parseWorkflowPatchForm(
      form({ [ORDER_ID_FIELD]: UUID, [VERSION_FIELD]: '5', [WF_STATUS_FIELD]: 'shipped_done', [RETURN_TO_FIELD]: `/orders/${UUID}` }),
    );
    expect(inPath.ok && inPath.returnTo).toBe(`/orders/${UUID}`);
    // nit-6:`..` 站內 redirect gadget(/orders/../../api/sso/start)拒
    for (const evil of ['https://evil.com', '//evil.com', '/customers', '/orders\n/x', '/orders/../../api/sso/start']) {
      const r = parseWorkflowPatchForm(
        form({ [ORDER_ID_FIELD]: UUID, [VERSION_FIELD]: '5', [WF_STATUS_FIELD]: 'shipped_done', [RETURN_TO_FIELD]: evil }),
      );
      expect(r.ok && r.returnTo).toBe('/orders');
    }
  });
});

// 🔴 `parseItemWorkflowForm — 形狀守門(item 層)` 4 條:**A9w4a(2026-08-06)隨受測函式一併移除**
//    (母 plan row 53)。order 層的 return_to / version 守門仍在上方 `parseWorkflowPatchForm` 那組。
