// workflow-form.test.ts — 後台改單純函式核心(M-4a Slice C;Origin 白名單 + 表單→patch 解析)。

import { describe, it, expect } from 'vitest';
import {
  isAllowedOrigin,
  parseWorkflowPatchForm,
  parseItemWorkflowForm,
  WF_CLEAR_VALUE,
  ORDER_ID_FIELD,
  ITEM_ID_FIELD,
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
  it('order_id 非 UUID / version 非法 → ok:false', () => {
    expect(parseWorkflowPatchForm(form({ [ORDER_ID_FIELD]: 'PCM-1', [VERSION_FIELD]: '1' })).ok).toBe(false);
    expect(parseWorkflowPatchForm(form({ [ORDER_ID_FIELD]: UUID, [VERSION_FIELD]: '0' })).ok).toBe(false);
    expect(parseWorkflowPatchForm(form({ [ORDER_ID_FIELD]: UUID, [VERSION_FIELD]: 'x' })).ok).toBe(false);
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

// ── parseItemWorkflowForm — per-item 改狀態表單(M-4a Slice D-2;鏡像 order 層、單欄必送)──

describe('parseItemWorkflowForm — 形狀守門(item 層)', () => {
  const base = { [ITEM_ID_FIELD]: UUID, [VERSION_FIELD]: '3' };

  it('合法 code → 設定;__clear__ 哨兵 → null(清空);returnTo 站內守門', () => {
    const set = parseItemWorkflowForm(form({ ...base, [WF_STATUS_FIELD]: 'shipped_done' }));
    expect(set).toEqual({
      ok: true,
      itemId: UUID,
      expectedVersion: 3,
      workflowStatus: 'shipped_done',
      returnTo: '/orders',
    });
    const clear = parseItemWorkflowForm(
      form({ ...base, [WF_STATUS_FIELD]: WF_CLEAR_VALUE, [RETURN_TO_FIELD]: `/orders/${UUID}` }),
    );
    expect(clear).toEqual({
      ok: true,
      itemId: UUID,
      expectedVersion: 3,
      workflowStatus: null,
      returnTo: `/orders/${UUID}`,
    });
  });

  it('item_id 非 UUID / version 非法(0、負、非整數、超界)→ ok:false', () => {
    expect(parseItemWorkflowForm(form({ [ITEM_ID_FIELD]: 'not-uuid', [VERSION_FIELD]: '3', [WF_STATUS_FIELD]: 'x' })).ok).toBe(false);
    for (const v of ['0', '-1', '1.5', 'abc', '2147483647', '']) {
      expect(parseItemWorkflowForm(form({ [ITEM_ID_FIELD]: UUID, [VERSION_FIELD]: v, [WF_STATUS_FIELD]: 'x' })).ok).toBe(false);
    }
  });

  it('workflow_status 缺欄 / 空 / 非法形狀(大寫、空白、注入字元)→ ok:false(單欄必送、不靜默吞)', () => {
    expect(parseItemWorkflowForm(form(base)).ok).toBe(false);
    for (const bad of ['', 'BAD CODE', 'ghost!', 'a'.repeat(65), 'x;drop']) {
      expect(parseItemWorkflowForm(form({ ...base, [WF_STATUS_FIELD]: bad })).ok).toBe(false);
    }
  });

  it('return_to 外部/他路徑/`..` gadget → 退 /orders(與 order 層共用守門)', () => {
    for (const evil of ['https://evil.com', '//evil.com', '/customers', '/orders/../../api/sso/start']) {
      const r = parseItemWorkflowForm(form({ ...base, [WF_STATUS_FIELD]: 'shipped_done', [RETURN_TO_FIELD]: evil }));
      expect(r.ok && r.returnTo).toBe('/orders');
    }
  });
});
