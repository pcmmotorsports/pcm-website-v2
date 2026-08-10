import { describe, expect, it } from 'vitest';
import { REFUND_SINGLE_FIELDS, parseRefundForm } from './refund-form';
import {
  REFUND_AMOUNT_FIELD,
  REFUND_CONFIRM_FIELD,
  REFUND_KIND_FIELD,
  REFUND_ORDER_ID_FIELD,
  REFUND_REASON_FIELD,
  REFUND_REQUEST_TOKEN_FIELD,
  generateRefundRequestToken,
  isRefundRequestToken,
  refundFailure,
  EMPTY_REFUND_INPUT,
} from './refund-action-state';

// refund-form.test.ts — RW2c 解析器。每條規則至少一紅一綠;
// 互斥矩陣(kind × amount)逐格,不取代表值。

const ORDER_ID = '11111111-2222-3333-4444-555555555555';
// 🔴 v4 小寫(鏡像 RPC regex;版本位=4、variant 位=a)
const TOKEN = '9f8e7d6c-5b4a-4321-a987-654321fedcba';

function form(over: Record<string, string> = {}, omit: string[] = []): FormData {
  const data = new FormData();
  const fields: Record<string, string> = {
    [REFUND_ORDER_ID_FIELD]: ORDER_ID,
    [REFUND_REQUEST_TOKEN_FIELD]: TOKEN,
    [REFUND_KIND_FIELD]: 'partial',
    [REFUND_AMOUNT_FIELD]: '500',
    [REFUND_CONFIRM_FIELD]: '1234',
    [REFUND_REASON_FIELD]: '客人取消訂單,依約定退款',
    ...over,
  };
  for (const [name, value] of Object.entries(fields)) {
    if (!omit.includes(name)) data.set(name, value);
  }
  return data;
}

describe('parseRefundForm — 通過形', () => {
  it('partial:amount 為員工輸入的正整數', () => {
    const parsed = parseRefundForm(form());
    expect(parsed).toEqual({
      ok: true,
      orderId: ORDER_ID,
      kind: 'partial',
      amount: 500,
      confirmCode: '1234',
      reason: '客人取消訂單,依約定退款',
      requestToken: TOKEN,
    });
  });

  it('full:amount 欄可缺、可空字串;解析結果 amount 一律 null(凍結額在 RPC 取 Record)', () => {
    const missing = parseRefundForm(form({ [REFUND_KIND_FIELD]: 'full' }, [REFUND_AMOUNT_FIELD]));
    expect(missing).toMatchObject({ ok: true, kind: 'full', amount: null });
    const empty = parseRefundForm(form({ [REFUND_KIND_FIELD]: 'full', [REFUND_AMOUNT_FIELD]: '' }));
    expect(empty).toMatchObject({ ok: true, kind: 'full', amount: null });
  });

  it('reason 送 trim 後值(RPC btrim 語意,兩層看到同一個字串)', () => {
    const parsed = parseRefundForm(form({ [REFUND_REASON_FIELD]: '  重複下單  ' }));
    expect(parsed).toMatchObject({ ok: true, reason: '重複下單' });
  });
});

describe('parseRefundForm — kind × amount 互斥矩陣(逐格)', () => {
  it('🔴 full 帶了非空金額 = 擋(殘值放行會在 RPC 端 RAISE 成 bug 畫面)', () => {
    expect(parseRefundForm(form({ [REFUND_KIND_FIELD]: 'full', [REFUND_AMOUNT_FIELD]: '500' }))).toEqual({ ok: false });
  });
  it('partial 缺金額 / 空金額 = 擋', () => {
    expect(parseRefundForm(form({}, [REFUND_AMOUNT_FIELD]))).toEqual({ ok: false });
    expect(parseRefundForm(form({ [REFUND_AMOUNT_FIELD]: '' }))).toEqual({ ok: false });
  });
  it('kind 缺 / 非法值 = 擋(不預設任何一種 —— 預設成 full 就是意外全額退)', () => {
    expect(parseRefundForm(form({}, [REFUND_KIND_FIELD]))).toEqual({ ok: false });
    expect(parseRefundForm(form({ [REFUND_KIND_FIELD]: 'FULL' }))).toEqual({ ok: false });
    expect(parseRefundForm(form({ [REFUND_KIND_FIELD]: 'all' }))).toEqual({ ok: false });
  });
});

describe('parseRefundForm — 金額形狀', () => {
  const bad = ['0', '-1', '1.5', '01', '1e3', ' 500', '500 ', 'NaN', '五百', '2147483648'];
  for (const value of bad) {
    it(`拒收:「${value}」`, () => {
      expect(parseRefundForm(form({ [REFUND_AMOUNT_FIELD]: value }))).toEqual({ ok: false });
    });
  }
  it('上限恰 2147483647(PG integer;RPC 端鏡像)', () => {
    expect(parseRefundForm(form({ [REFUND_AMOUNT_FIELD]: '2147483647' }))).toMatchObject({
      ok: true,
      amount: 2_147_483_647,
    });
  });
});

describe('parseRefundForm — token(嚴格 v4 小寫,鏡像 RPC regex)', () => {
  it('🔴 大寫 / 非 v4 / req_ 前綴 / 缺 = 全擋(寬收只會把形狀錯往後推成 P0001 bug 畫面)', () => {
    for (const token of [
      TOKEN.toUpperCase(),
      '9f8e7d6c-5b4a-1321-a987-654321fedcba', // 版本位=1
      '9f8e7d6c-5b4a-4321-c987-654321fedcba', // variant 位=c
      `req_${TOKEN}`,
      '',
    ]) {
      expect(parseRefundForm(form({ [REFUND_REQUEST_TOKEN_FIELD]: token }))).toEqual({ ok: false });
    }
    expect(parseRefundForm(form({}, [REFUND_REQUEST_TOKEN_FIELD]))).toEqual({ ok: false });
  });

  it('產生器產物必過驗證器(同源;`crypto.randomUUID` = v4 小寫)', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(isRefundRequestToken(generateRefundRequestToken())).toBe(true);
    }
  });
});

describe('parseRefundForm — 確認碼 / 訂單 id / reason', () => {
  it('確認碼必須恰 4 個英數', () => {
    for (const code of ['123', '12345', '12 4', '12#4', '']) {
      expect(parseRefundForm(form({ [REFUND_CONFIRM_FIELD]: code }))).toEqual({ ok: false });
    }
    expect(parseRefundForm(form({ [REFUND_CONFIRM_FIELD]: 'A9b3' }))).toMatchObject({ ok: true });
  });

  it('orderId 非 uuid = 擋', () => {
    expect(parseRefundForm(form({ [REFUND_ORDER_ID_FIELD]: '123456' }))).toEqual({ ok: false });
  });

  it('reason:空 / 全空白 / 含控制字元 = 擋', () => {
    for (const reason of ['', '   ', '換貨\u0000退款', 'a\tb', 'x\u007fy', '換貨\n退款']) {
      expect(parseRefundForm(form({ [REFUND_REASON_FIELD]: reason }))).toEqual({ ok: false });
    }
  });

  it('🔴 reason 長度用碼位不用 UTF-16 units(emoji 讓兩者分岔;RPC char_length 是碼位)', () => {
    // 150 個 🏍(每個 2 UTF-16 units):碼位 150 ≤ 200 必須過;
    // 若實作誤用 `.length`(=300 > 200)這格轉紅 —— 有判別力的那格。
    const bikes = '🏍'.repeat(150);
    expect(parseRefundForm(form({ [REFUND_REASON_FIELD]: bikes }))).toMatchObject({ ok: true });
    // 201 / 200 碼位坐邊界
    expect(parseRefundForm(form({ [REFUND_REASON_FIELD]: '字'.repeat(201) }))).toEqual({ ok: false });
    expect(parseRefundForm(form({ [REFUND_REASON_FIELD]: '字'.repeat(200) }))).toMatchObject({ ok: true });
  });
});

describe('#365 同名欄位送兩份 → 被拒(不採第一筆)', () => {
  function realForm(pairs: [string, string][]): FormData {
    const f = new FormData();
    for (const [k, v] of pairs) f.append(k, v);
    return f;
  }
  const base: [string, string][] = [
    [REFUND_ORDER_ID_FIELD, ORDER_ID],
    [REFUND_REQUEST_TOKEN_FIELD, TOKEN],
    [REFUND_KIND_FIELD, 'partial'],
    [REFUND_CONFIRM_FIELD, '1234'],
    [REFUND_REASON_FIELD, '客人取消訂單,依約定退款'],
  ];

  it('🔴 金額送兩份 → ok:false(這條直接決定退多少錢)', () => {
    const f = realForm([...base, [REFUND_AMOUNT_FIELD, '1'], [REFUND_AMOUNT_FIELD, '500']]);
    expect(parseRefundForm(f).ok).toBe(false);
    expect(f.get(REFUND_AMOUNT_FIELD)).toBe('1');
  });

  it('🔴 順序互換仍 ok:false', () => {
    const f = realForm([...base, [REFUND_AMOUNT_FIELD, '500'], [REFUND_AMOUNT_FIELD, '1']]);
    expect(parseRefundForm(f).ok).toBe(false);
  });

  it('單筆金額仍照常通過(擋的是「兩份」不是整條路)', () => {
    expect(parseRefundForm(realForm([...base, [REFUND_AMOUNT_FIELD, '500']])).ok).toBe(true);
  });

  // 🔴 主視窗交辦④:被拒之後**員工看得懂**,不是裸 500。
  //    這條釘的是「解析失敗會落到 invalid 這個碼,而該碼有給人看的中文」。
  it('🔴 被拒的出口是 invalid,而 invalid 有員工看得懂的中文訊息', () => {
    const f = realForm([...base, [REFUND_AMOUNT_FIELD, '1'], [REFUND_AMOUNT_FIELD, '500']]);
    expect(parseRefundForm(f).ok).toBe(false); // 呼叫端據此回 invalid(不是 throw)
    // 走真的出口函式(訊息表是 module-private,不從外面猜它的形狀)。
    const state = refundFailure('invalid', EMPTY_REFUND_INPUT, TOKEN);
    expect(state.status).toBe('failed');
    if (state.status !== 'failed') throw new Error('unreachable');
    expect(state.message).toContain('表單內容不正確');
    expect(state.message).toContain('退款沒有發起');
  });
});

describe('#365 逐欄「送兩份 → 被拒」(這條同時是欄位清單完整性的守門)', () => {
  function dup(field: string): FormData {
    const f = new FormData();
    f.append(REFUND_ORDER_ID_FIELD, ORDER_ID);
    f.append(REFUND_REQUEST_TOKEN_FIELD, TOKEN);
    f.append(REFUND_KIND_FIELD, 'partial');
    f.append(REFUND_AMOUNT_FIELD, '500');
    f.append(REFUND_CONFIRM_FIELD, '1234');
    f.append(REFUND_REASON_FIELD, '客人取消訂單,依約定退款');
    f.append(field, f.get(field) as string); // 同值再送一次 = 最保守的重複
    return f;
  }

  it.each([...REFUND_SINGLE_FIELDS])('%s 送兩份 → ok:false', (field) => {
    expect(parseRefundForm(dup(field)).ok).toBe(false);
  });

  // 🔴 codex 關卡2 MF:上面那條**不是**清單完整性的守門 —— 它走訪的就是那顆常數本身,
  //    清單少一欄時測項也跟著少一條、照樣全綠(循環論證)。真正的守門是拿**測試檔自己手寫的**
  //    清單去比對;來源檔漏欄或多欄,這一條就紅。
  it('🔴 REFUND_SINGLE_FIELDS 逐字等於解析器實際讀的六欄(手寫對照,不走訪同一常數)', () => {
    expect([...REFUND_SINGLE_FIELDS].sort()).toEqual(
      ['order_id', 'request_token', 'kind', 'amount', 'confirm_code', 'reason'].sort(),
    );
  });

  // 🔴🔴 codex 關卡2 抓到的**第二形狀**:數量是 1、但型別不是字串(單一 File)⇒ 第一版擋門放行、
  //    `readSingleString` 照樣回 null ⇒ 同一個 fail-open 換個輸入就復活(實測 ok:true 全額退款)。
  it('🔴 kind=full + amount 是單一 File → ok:false(擋門看的是「恰一筆字串」不是「數量」)', () => {
    const f = new FormData();
    f.append(REFUND_ORDER_ID_FIELD, ORDER_ID);
    f.append(REFUND_REQUEST_TOKEN_FIELD, TOKEN);
    f.append(REFUND_KIND_FIELD, 'full');
    f.append(REFUND_CONFIRM_FIELD, '1234');
    f.append(REFUND_REASON_FIELD, '客人取消訂單,依約定退款');
    f.append(REFUND_AMOUNT_FIELD, new File(['500'], 'a.txt'));
    expect(parseRefundForm(f).ok).toBe(false);
  });

  // 🔴🔴 關卡2 審查實跑抓到的 fail-open 回歸,釘死在這裡:
  //    kind=full + amount 送兩份 ⇒ amount 讀成 null ⇒ 曾經跳過「full 不得帶金額」那道矛盾擋
  //    ⇒ ok:true 且 amount:null = **全額退款**。同樣輸入只送一份 amount 是 ok:false。
  //    ⇒「同一欄送兩份反而比送一份更容易通過」。
  it('🔴 kind=full + amount 送兩份 → ok:false(不得比送一份更寬鬆)', () => {
    const f = new FormData();
    f.append(REFUND_ORDER_ID_FIELD, ORDER_ID);
    f.append(REFUND_REQUEST_TOKEN_FIELD, TOKEN);
    f.append(REFUND_KIND_FIELD, 'full');
    f.append(REFUND_CONFIRM_FIELD, '1234');
    f.append(REFUND_REASON_FIELD, '客人取消訂單,依約定退款');
    f.append(REFUND_AMOUNT_FIELD, '1');
    f.append(REFUND_AMOUNT_FIELD, '500');
    expect(parseRefundForm(f).ok).toBe(false);

    // 對照:送一份 amount 的 full 本來就被擋 ⇒ 兩者一致,寬鬆縫隙消失。
    const single = new FormData();
    for (const [k, v] of f.entries()) {
      if (k !== REFUND_AMOUNT_FIELD) single.append(k, v as string);
    }
    single.append(REFUND_AMOUNT_FIELD, '500');
    expect(parseRefundForm(single).ok).toBe(false);
  });
});
