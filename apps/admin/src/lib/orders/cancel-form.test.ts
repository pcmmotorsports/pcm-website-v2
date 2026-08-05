import { describe, expect, it } from 'vitest';
import {
  CANCEL_ITEM_FIELD,
  CANCEL_MODE_FIELD,
  CANCEL_ORDER_ID_FIELD,
  CANCEL_REASON_CODE_FIELD,
  CANCEL_REASON_DETAIL_FIELD,
  CANCEL_REQUEST_TOKEN_FIELD,
} from './cancel-action-state';
import {
  CANCEL_REASON_CODES,
  parseOrderCancelForm,
  type CancelFormLike,
} from './cancel-form';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = '22222222-2222-4222-8222-222222222222';
// 🔴 **必須含 hex 字母**:原本用純數字 uuid,`toUpperCase()` 是 no-op
//    ⇒ 「大小寫不同仍算重複」那條測試根本沒在測大小寫(突變實測:去重退回大小寫敏感,它照樣綠)。
//    同族坑 = memory `feedback_fixture-value-makes-guard-vacuous`。
const ITEM_A = '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a';
const ITEM_B = '44444444-4444-4444-8444-444444444444';

/** 最小 form:單值走 map、可重複欄位走 items 陣列。 */
function form(
  fields: Record<string, string | undefined>,
  itemEntries: string[] = [],
): CancelFormLike {
  return {
    get: (name) => fields[name] ?? null,
    getAll: (name) => (name === CANCEL_ITEM_FIELD ? itemEntries : []),
  };
}

function baseFields(over: Record<string, string | undefined> = {}) {
  return {
    [CANCEL_ORDER_ID_FIELD]: ORDER_ID,
    [CANCEL_REQUEST_TOKEN_FIELD]: TOKEN,
    [CANCEL_REASON_CODE_FIELD]: 'out_of_stock',
    [CANCEL_MODE_FIELD]: 'full',
    ...over,
  };
}

describe('parseOrderCancelForm — A9d2-2a 純解析器', () => {
  it('整單取消:七欄齊 → ok,items=null(RPC 的 p_items 送 NULL)', () => {
    const res = parseOrderCancelForm(form(baseFields()));
    expect(res).toEqual({
      ok: true,
      orderId: ORDER_ID,
      reasonCode: 'out_of_stock',
      reasonDetail: null,
      items: null,
      requestToken: TOKEN,
    });
  });

  // 🔴 R1 must-fix:下面那條迭代的是 `CANCEL_REASON_CODES` 自己 ⇒ 從陣列刪掉一個碼,
  //    它照樣全綠、卻證不了 DB 的七值都在。字面釘死才擋得住「少一個選項送不出去」。
  it('🔴 七碼字面與 DB CHECK 逐字相同(20260730130000:131-139)', () => {
    expect([...CANCEL_REASON_CODES]).toEqual([
      'customer_request',
      'out_of_stock',
      'long_leadtime',
      'price_change',
      'duplicate_order',
      'internal_error',
      'other',
    ]);
  });

  it('🔴 七個原因碼逐碼都收(配合上一條的字面釘死才有意義)', () => {
    for (const code of CANCEL_REASON_CODES) {
      const fields = baseFields({ [CANCEL_REASON_CODE_FIELD]: code });
      const res = parseOrderCancelForm(
        form(
          code === 'other'
            ? { ...fields, [CANCEL_REASON_DETAIL_FIELD]: '客人改買別款' }
            : fields,
        ),
      );
      expect(res.ok, `原因碼 ${code} 應被接受`).toBe(true);
    }
  });

  it('🔴 未知原因碼 → 擋下(不讓它到 RPC 吃一句誤導的「不能取消」)', () => {
    expect(
      parseOrderCancelForm(form(baseFields({ [CANCEL_REASON_CODE_FIELD]: 'because_i_said_so' })))
        .ok,
    ).toBe(false);
  });

  // ── other × 說明欄的配對規則(鏡像 20260805100000:133-145)──

  it('🔴 other 沒填說明 → 擋下', () => {
    expect(
      parseOrderCancelForm(form(baseFields({ [CANCEL_REASON_CODE_FIELD]: 'other' }))).ok,
    ).toBe(false);
  });

  it('🔴 other 說明只有零寬字 → 擋下(rpcTrim 剝得掉、.trim() 剝不掉)', () => {
    // U+200B / U+2060:`.trim()` 會判定「非空」而放行,到 RPC 才被擋 ⇒ 員工看到誤導訊息。
    const res = parseOrderCancelForm(
      form(
        baseFields({
          [CANCEL_REASON_CODE_FIELD]: 'other',
          [CANCEL_REASON_DETAIL_FIELD]: '​⁠',
        }),
      ),
    );
    expect(res.ok).toBe(false);
  });

  it('other 說明是原文帶回(不 trim —— RPC 的 payload_hash 量的是原文)', () => {
    const res = parseOrderCancelForm(
      form(
        baseFields({
          [CANCEL_REASON_CODE_FIELD]: 'other',
          [CANCEL_REASON_DETAIL_FIELD]: '  客人改買別款  ',
        }),
      ),
    );
    expect(res.ok && res.reasonDetail).toBe('  客人改買別款  ');
  });

  it('🔴 非 other 卻填了說明 → 擋下(不靜默丟掉:丟掉那段字會永久消失)', () => {
    expect(
      parseOrderCancelForm(
        form(baseFields({ [CANCEL_REASON_DETAIL_FIELD]: '其實是缺貨' })),
      ).ok,
    ).toBe(false);
  });

  it('非 other 的說明欄是空字串 / 純空白 → 照收,送 null', () => {
    const res = parseOrderCancelForm(form(baseFields({ [CANCEL_REASON_DETAIL_FIELD]: '   ' })));
    expect(res.ok && res.reasonDetail).toBeNull();
  });

  // 🔴 R1 nit:非 other 分支也用 rpcTrim,但原本零測試 ⇒ 改成 `.trim()` 全綠。
  //    真發生時:瀏覽器自動填入的零寬字會讓合法送出被判 invalid、員工找不到原因。
  it('🔴 非 other 的說明欄只有零寬字 → 視為空、照收送 null(.trim() 會誤擋)', () => {
    const res = parseOrderCancelForm(
      form(baseFields({ [CANCEL_REASON_DETAIL_FIELD]: '\u200b\u2060' })),
    );
    expect(res.ok).toBe(true);
    expect(res.ok && res.reasonDetail).toBeNull();
  });

  // ── 形狀守門 ──

  it('🔴 orderId / token 非 uuid → 擋下', () => {
    expect(parseOrderCancelForm(form(baseFields({ [CANCEL_ORDER_ID_FIELD]: 'nope' }))).ok).toBe(
      false,
    );
    expect(
      parseOrderCancelForm(form(baseFields({ [CANCEL_REQUEST_TOKEN_FIELD]: 'req_' + TOKEN }))).ok,
    ).toBe(false);
  });

  it('🔴 缺 mode → 擋下(不預設成整單:預設錯邊會取消掉沒被勾的品項)', () => {
    expect(parseOrderCancelForm(form(baseFields({ [CANCEL_MODE_FIELD]: undefined }))).ok).toBe(
      false,
    );
  });

  // 🔴 關卡2 must-fix:原本沒有「未知 mode + 合法品項」的案例 ⇒ 拿掉 `CANCEL_MODES.includes`
  //    這條守門,現有測試仍全綠,而未知值會走進 partial 分支被當成部分取消。
  it('🔴 未知 mode + 合法品項 → 擋下(不得當成 partial)', () => {
    expect(
      parseOrderCancelForm(
        form(baseFields({ [CANCEL_MODE_FIELD]: 'partail' }), [`${ITEM_A}:1`]),
      ).ok,
    ).toBe(false);
  });

  // ── 部分取消 ──

  it('部分取消:多筆品項逐筆解析', () => {
    const res = parseOrderCancelForm(
      form(baseFields({ [CANCEL_MODE_FIELD]: 'partial' }), [`${ITEM_A}:2`, `${ITEM_B}:1`]),
    );
    // 🔴 鍵名逐字是 RPC 的 snake_case(關卡2 R2:解析器只吐這一種形狀,
    //    片 5 沒有 camelCase 版本可以傳錯;把它改回 orderItemId,本條紅)。
    expect(res.ok && res.items).toEqual([
      { order_item_id: ITEM_A, quantity: 2 },
      { order_item_id: ITEM_B, quantity: 1 },
    ]);
  });

  it('🔴 部分取消零品項 → 擋下(鏡像 RPC「需為非空陣列」)', () => {
    expect(
      parseOrderCancelForm(form(baseFields({ [CANCEL_MODE_FIELD]: 'partial' }), [])).ok,
    ).toBe(false);
  });

  it('🔴 整單取消卻帶品項 → 擋下(不是忽略多餘欄位:會取消掉沒被勾的品項)', () => {
    expect(
      parseOrderCancelForm(form(baseFields(), [`${ITEM_A}:1`])).ok,
    ).toBe(false);
  });

  it('🔴 同一品項重複 → 擋下(RPC 會 RAISE,先擋才不會吃誤導訊息)', () => {
    expect(
      parseOrderCancelForm(
        form(baseFields({ [CANCEL_MODE_FIELD]: 'partial' }), [`${ITEM_A}:1`, `${ITEM_A}:2`]),
      ).ok,
    ).toBe(false);
  });

  // 🔴 R1 must-fix:isUuid 是 /i、RPC 去重用 ::uuid(大小寫不敏感)⇒ 同一顆 uuid
  //    一大寫一小寫原本過得了這層,到 RPC 才 RAISE、而那條路的終點是表單被凍結。
  it('🔴 同一顆 uuid 大小寫不同 → 仍算重複、擋下', () => {
    expect(
      parseOrderCancelForm(
        form(baseFields({ [CANCEL_MODE_FIELD]: 'partial' }), [
          `${ITEM_A}:1`,
          `${ITEM_A.toUpperCase()}:2`,
        ]),
      ).ok,
    ).toBe(false);
  });

  it('🔴 數量非十進位整數字面 → 逐形狀擋下(canonical hash 的單一產生式)', () => {
    for (const bad of ['0', '-1', '1.0', '+3', '3 ', ' 3', '', 'x', '1e3', '٣']) {
      const res = parseOrderCancelForm(
        form(baseFields({ [CANCEL_MODE_FIELD]: 'partial' }), [`${ITEM_A}:${bad}`]),
      );
      expect(res.ok, `數量 "${bad}" 應被擋下`).toBe(false);
    }
  });

  // 🔴 關卡2 must-fix(實測):`2147483648` 原本回 ok:true,到 RPC 才 RAISE ⇒ 表單凍結。
  //    上界是 int4 欄位型別邊界(`20260730130000:223`),不是業務值域。
  it('🔴 數量超過 int4 上界 → 擋下;恰等於上界 → 收', () => {
    const partial = { [CANCEL_MODE_FIELD]: 'partial' };
    expect(
      parseOrderCancelForm(form(baseFields(partial), [`${ITEM_A}:2147483648`])).ok,
    ).toBe(false);
    expect(
      parseOrderCancelForm(form(baseFields(partial), [`${ITEM_A}:2147483647`])).ok,
    ).toBe(true);
  });

  it('🔴 品項識別碼非 uuid / 缺分隔符 → 擋下', () => {
    for (const bad of [`nope:1`, `${ITEM_A}`, `:1`, `${ITEM_A}:`]) {
      expect(
        parseOrderCancelForm(form(baseFields({ [CANCEL_MODE_FIELD]: 'partial' }), [bad])).ok,
        `品項 "${bad}" 應被擋下`,
      ).toBe(false);
    }
  });

  // 🔴 R1 nit:真 FormData 的欄位值可能是 File(不是 string)。拿掉那道 typeof 守門,
  //    `raw.indexOf` 會直接 TypeError 炸掉整個 action(不是回 invalid)。
  it('🔴 品項欄位帶非字串值(真 FormData 可能是 File)→ 擋下、不炸', () => {
    const fields: Record<string, string | undefined> = baseFields({
      [CANCEL_MODE_FIELD]: 'partial',
    });
    const withFile: CancelFormLike = {
      get: (name) => fields[name] ?? null,
      getAll: () => [{ name: 'x' } as unknown as FormDataEntryValue],
    };
    expect(() => parseOrderCancelForm(withFile)).not.toThrow();
    expect(parseOrderCancelForm(withFile).ok).toBe(false);
  });
});
