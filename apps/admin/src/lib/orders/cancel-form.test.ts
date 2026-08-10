import { describe, expect, it } from 'vitest';
import {
  CANCEL_ITEM_FIELD,
  CANCEL_MODE_FIELD,
  CANCEL_ORDER_ID_FIELD,
  CANCEL_REASON_CODE_FIELD,
  CANCEL_REASON_DETAIL_FIELD,
  CANCEL_REQUEST_TOKEN_FIELD,
  cancelItemQtyField,
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
/**
 * 最小 form。
 * 🔴 **值可以是陣列**(關卡2 codex 第三輪 #2 補):第一版的 `getAll` 只對 `cancel_item` 回東西、
 *    其餘一律回 `[]` ⇒ 「同名欄位送兩份」那條軸**構造不出來 = 零測**,而那正是 `get()` 取第一筆
 *    會出事的地方。現在 `getAll` 對任何欄位都誠實,`get` 照真 FormData 的語意回第一筆。
 */
function form(
  fields: Record<string, string | string[] | undefined>,
  itemEntries: string[] = [],
): CancelFormLike {
  const all = (name: string): FormDataEntryValue[] => {
    if (name === CANCEL_ITEM_FIELD) return itemEntries;
    const v = fields[name];
    if (v === undefined) return [];
    return Array.isArray(v) ? v : [v];
  };
  return { get: (name) => all(name)[0] ?? null, getAll: all };
}

function baseFields(
  over: Record<string, string | string[] | undefined> = {},
): Record<string, string | string[] | undefined> {
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
    // ⚠️ **A13b E1 改過這條的輸入,不是改期望值**:E1 之後「checkbox 說可取消 >1」的品項
    //    **必須**帶同名的數量欄(關卡2 codex 第三輪 #1 的 fail-closed),否則視為兩邊分岔而整份退回。
    //    ITEM_A 帶 2 ⇒ 補 qty 欄;ITEM_B 帶 1 ⇒ 表單本來就不渲染那個欄位,維持不帶。
    //    期望值(逐筆解析的結果)一個字都沒動。
    const res = parseOrderCancelForm(
      form(baseFields({ [CANCEL_MODE_FIELD]: 'partial', [cancelItemQtyField(ITEM_A)]: '2' }), [
        `${ITEM_A}:2`,
        `${ITEM_B}:1`,
      ]),
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
    // ⚠️ **兩筆都用數量 1**(A13b E1 收尾自掃補):原本是 `:1` 配 `:2`,而 `:2` 在新契約下
    //    需要同名數量欄 ⇒ 這條會因為「缺數量欄」而紅、**去重守門拿掉照樣紅 = 恆真格**。
    //    改成兩筆都 `:1`(不需要數量欄)之後,唯一能讓它紅的就只剩去重那道。
    expect(
      parseOrderCancelForm(
        form(baseFields({ [CANCEL_MODE_FIELD]: 'partial' }), [`${ITEM_A}:1`, `${ITEM_A}:1`]),
      ).ok,
    ).toBe(false);
  });

  // 🔴 R1 must-fix:isUuid 是 /i、RPC 去重用 ::uuid(大小寫不敏感)⇒ 同一顆 uuid
  //    一大寫一小寫原本過得了這層,到 RPC 才 RAISE、而那條路的終點是導頁、輸入不保留(D5 前畫面上還沒有訊息)。
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

  // 🔴 關卡2 must-fix(實測):`2147483648` 原本回 ok:true,到 RPC 才 RAISE ⇒ 導頁、輸入不保留。
  //    上界是 int4 欄位型別邊界(`20260730130000:223`),不是業務值域。
  it('🔴 數量超過 int4 上界 → 擋下;恰等於上界 → 收', () => {
    // ⚠️ 同上:E1 之後 >1 的品項必須帶數量欄,故兩格都補;**期望值沒動**。
    //    上界那格的覆寫值刻意等於 checkbox 的數量 ⇒ 覆寫的上界比較放行,
    //    真正決定結果的仍是 `parseItemEntry` 的 int4 判定(把 INT4_MAX 改小,本條仍紅)。
    const partial = { [CANCEL_MODE_FIELD]: 'partial' };
    expect(
      parseOrderCancelForm(
        form(baseFields({ ...partial, [cancelItemQtyField(ITEM_A)]: '2147483648' }), [
          `${ITEM_A}:2147483648`,
        ]),
      ).ok,
    ).toBe(false);
    expect(
      parseOrderCancelForm(
        form(baseFields({ ...partial, [cancelItemQtyField(ITEM_A)]: '2147483647' }), [
          `${ITEM_A}:2147483647`,
        ]),
      ).ok,
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
    const fields = baseFields({ [CANCEL_MODE_FIELD]: 'partial' });
    const first = (name: string): FormDataEntryValue | null => {
      const v = fields[name];
      if (v === undefined) return null;
      return Array.isArray(v) ? (v[0] ?? null) : v;
    };
    const withFile: CancelFormLike = {
      get: first,
      getAll: () => [{ name: 'x' } as unknown as FormDataEntryValue],
    };
    expect(() => parseOrderCancelForm(withFile)).not.toThrow();
    expect(parseOrderCancelForm(withFile).ok).toBe(false);
  });
});

describe('數量覆寫欄 cancel_item_qty__<id>(A13b E1「挑數量」)', () => {
  /** `partial()` 的預設品項是 `ITEM_A:5` ⇒ 新契約下**必須**帶這個欄位,否則整份先被判 invalid。 */
  const QTY_A = cancelItemQtyField(ITEM_A);
  const partial = (
    over: Record<string, string | string[] | undefined> = {},
    entries = [`${ITEM_A}:5`],
  ) =>
    parseOrderCancelForm(form(baseFields({ [CANCEL_MODE_FIELD]: 'partial', ...over }), entries));

  it('🔴 欄位不存在 **且 checkbox 說可取消 1** ⇒ 沿用 checkbox 帶的數量', () => {
    const res = parseOrderCancelForm(
      form(baseFields({ [CANCEL_MODE_FIELD]: 'partial' }), [`${ITEM_A}:1`]),
    );
    expect(res.ok && res.items).toEqual([{ order_item_id: ITEM_A, quantity: 1 }]);
  });

  it('🔴🔴 欄位不存在**但 checkbox 說可取消 5** ⇒ 整份 {ok:false}(表單兩邊分岔,不猜)', () => {
    // 🔴 關卡2 codex 第三輪 #1:第一版無條件沿用 checkbox 的數量 ⇒ 日後有人改欄位名只改一邊,
    //    員工畫面上填 2、系統取消 5。**送出比看到的多**,方向與 E-011 相同。
    //    ⚠️ 與上一條**只差 checkbox 的數字**(1 vs 5),兩條一起才證明「分岔就退回」不是恆真。
    expect(partial().ok).toBe(false);
  });

  it('🔴 欄位有值 ⇒ 以它為準(這格就是「同品項買 5 退 2」)', () => {
    const res = partial({ [cancelItemQtyField(ITEM_A)]: '2' });
    expect(res.ok && res.items).toEqual([{ order_item_id: ITEM_A, quantity: 2 }]);
  });

  it('🔴🔴 欄位存在但**空字串** ⇒ 整份 {ok:false},**不准**沿用 checkbox 的 max', () => {
    // 🔴 這條是本片的心臟(關卡1 R2 #1)。若寫成「空的就沿用 max」,員工把數量清空之後
    //    送出去的會是 5 而畫面上是空的 ⇒ **送出比看到的多**,那正是 E-011 的傷害方向。
    //    ⚠️ 與上一條「欄位不存在 ⇒ 沿用 5」是**不同輸入、不同結果**,兩條一起才有判別力:
    //    只留其中一條的話,把 `raw === null` 誤寫成 `!raw` 的實作照樣全綠。
    expect(partial({ [cancelItemQtyField(ITEM_A)]: '' }).ok).toBe(false);
  });

  it.each([
    ['0(下界)', '0'],
    ['6(超過 checkbox 帶的 5)', '6'],
    ['1.0(不是十進位整數字面)', '1.0'],
    ['+2(正號)', '+2'],
    [' 2(前導空白)', ' 2'],
    ['二(非 ASCII 數字)', '二'],
  ])('🔴 非法覆寫值 %s ⇒ 整份 {ok:false}', (_label, raw) => {
    expect(partial({ [cancelItemQtyField(ITEM_A)]: raw }).ok).toBe(false);
  });

  it('🔴 上界比的是 checkbox 帶的數量、不是某個固定值(改 checkbox 就跟著動)', () => {
    // 正向對照:同一個覆寫值 3,在 checkbox 帶 5 時合法、帶 2 時非法 ⇒ 證明比的是那一顆。
    expect(partial({ [cancelItemQtyField(ITEM_A)]: '3' }, [`${ITEM_A}:5`]).ok).toBe(true);
    expect(partial({ [cancelItemQtyField(ITEM_A)]: '3' }, [`${ITEM_A}:2`]).ok).toBe(false);
  });

  it('🔴 覆寫只作用在自己那一筆,不會外溢到別的品項', () => {
    const res = parseOrderCancelForm(
      form(
        baseFields({
          [CANCEL_MODE_FIELD]: 'partial',
          [cancelItemQtyField(ITEM_A)]: '2',
          [cancelItemQtyField(ITEM_B)]: '4',
        }),
        [`${ITEM_A}:5`, `${ITEM_B}:4`],
      ),
    );
    expect(res.ok && res.items).toEqual([
      { order_item_id: ITEM_A, quantity: 2 },
      { order_item_id: ITEM_B, quantity: 4 },
    ]);
  });

  it('🔴 覆寫**只讀被勾選的那幾筆**:沒勾的品項留著壞值也不影響送出', () => {
    // 🔴 code-reviewer F10 補的靶:少了這條,「掃全部 cancel_item_qty__* 欄位」的突變會存活。
    //    這條同時是元件那邊「數量欄刻意不掛原生 constraint」的理由 —— 沒勾的品項不該擋住整張表單。
    const res = parseOrderCancelForm(
      form(
        baseFields({
          [CANCEL_MODE_FIELD]: 'partial',
          [cancelItemQtyField(ITEM_A)]: '5',
          [cancelItemQtyField(ITEM_B)]: '不是數字',
        }),
        [`${ITEM_A}:5`],
      ),
    );
    expect(res.ok && res.items).toEqual([{ order_item_id: ITEM_A, quantity: 5 }]);
  });

  it('🔴🔴 數量欄送兩份 ⇒ 整份 {ok:false} —— 不准靜默採第一筆', () => {
    // 🔴 關卡2 codex 第三輪 #2:`get()` 取第一筆,而「第一筆」是送出者決定的。
    //    藏一個 5 排在可見的 2 前面 ⇒ 員工看到 2、系統取消 5。**方向就是 E-011 的方向。**
    expect(partial({ [cancelItemQtyField(ITEM_A)]: ['5', '2'] }).ok).toBe(false);
  });

  it('🔴 順序互換也一樣擋 —— 證明擋的是「重複」而不是「某個值」', () => {
    // 正向對照:若實作退回成「取第一筆」,`['2','5']` 會過而 `['5','2']` 會取消 5 ⇒ 兩條分得出來。
    expect(partial({ [cancelItemQtyField(ITEM_A)]: ['2', '5'] }).ok).toBe(false);
    expect(partial({ [cancelItemQtyField(ITEM_A)]: ['2'] }).ok).toBe(true);
  });

  it('🔴 單值欄位送兩份也擋(不只數量欄):reason_code 兩份 ⇒ {ok:false}', () => {
    // ⚠️ 這一格在本片之前就有洞(所有單值欄位共用 `readString`),一起收緊 ——
    //    不留「只修自己那一條路」的半套。
    expect(
      parseOrderCancelForm(
        form(
          baseFields({
            [CANCEL_MODE_FIELD]: 'partial',
            [CANCEL_REASON_CODE_FIELD]: ['out_of_stock', 'other'],
            [cancelItemQtyField(ITEM_A)]: '2',
          }),
          [`${ITEM_A}:5`],
        ),
      ).ok,
    ).toBe(false);
  });

  it.each([
    ['重複兩份', ['一些說明', '另一些說明'] as string[]],
  ])('🔴 非 other 的 reason_detail %s ⇒ 整份 {ok:false}(不准當成「沒填」放行)', (_l, v) => {
    // 🔴 關卡2 codex 複審 #2:`readString` 把「沒送」與「送壞了」都壓成 null,
    //    而非 other 的分支把 null 當合法 ⇒ 重複 / File 直接穿過去,
    //    上一版宣稱的「重複 / File 全拒」對這個欄位並不成立。
    // 🔴 **必須帶數量欄**,否則本條會因為「缺數量欄」而紅 —— 紅的原因不是 reason_detail
    //    ⇒ 就變成另一個恆真格。這一格是我自己的正向對照當場抓到的(第一版真的漏了)。
    expect(partial({ [QTY_A]: '5', [CANCEL_REASON_DETAIL_FIELD]: v }).ok).toBe(false);
  });

  it('🔴 正向對照:非 other 完全不送 reason_detail ⇒ 合法(證明上一條擋的是「送壞了」)', () => {
    expect(partial({ [QTY_A]: '5', [CANCEL_REASON_DETAIL_FIELD]: undefined }).ok).toBe(true);
  });

  it('🔴 數量欄是 File(非字串)⇒ 整份 {ok:false}', () => {
    const withFile: CancelFormLike = {
      get: () => null,
      getAll: (name) => {
        if (name === CANCEL_ITEM_FIELD) return [`${ITEM_A}:5`];
        if (name === cancelItemQtyField(ITEM_A)) return [new File([], 'x') as FormDataEntryValue];
        const v = baseFields({ [CANCEL_MODE_FIELD]: 'partial' })[name];
        if (v === undefined) return [];
        return Array.isArray(v) ? v : [v];
      },
    };
    expect(parseOrderCancelForm(withFile).ok).toBe(false);
  });

  it('🔴 整單取消不吃覆寫欄:full + 任何 cancel_item 仍 {ok:false}(既有守門沒被碰)', () => {
    // 🔴 關卡1 R1 #3:第一版設計把空值過濾排在 mode 分流之前,會讓 `full` + 空品項**從拒絕變合法**。
    //    現行設計 `cancel_item` 一個字都沒改 ⇒ 這道守門原封;這條測試把「原封」釘住。
    const res = parseOrderCancelForm(
      form(baseFields({ [CANCEL_MODE_FIELD]: 'full', [cancelItemQtyField(ITEM_A)]: '2' }), [
        `${ITEM_A}:5`,
      ]),
    );
    expect(res.ok).toBe(false);
  });
});
