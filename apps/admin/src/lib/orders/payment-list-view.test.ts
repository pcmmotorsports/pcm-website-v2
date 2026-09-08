import { describe, expect, it, vi } from 'vitest';
import {
  actorLabel,
  formatAmount,
  formatTaipei,
  labelOrRaw,
  railLabel,
  refundedTotalFromUnregistered,
  sumReceived,
  toPaymentListEntry,
  toPaymentSummary,
  toReceivedNetSummary,
  type OrderPaymentRow,
} from './payment-list-view';

// payment-list-view.test.ts — #15-B2-a 語意層。突變靶釘在本檔。

const ROW: OrderPaymentRow = {
  id: 'p1',
  rail: 'cash',
  amount: 100,
  receivedAt: '2026-08-01T02:00:00+00:00',
  createdAt: '2026-08-11T04:55:37+00:00',
  actor: 'staff:sean',
  bankReference: null,
  recTradeId: null,
  payerNote: null,
  reversesPaymentId: null,
  reversalReason: null,
  isReversal: false,
};

describe('軌別對照', () => {
  // 🔴 正式站現況 6 列**全部**是 card,而手動收款表單明文拒收 card
  //    ⇒ 漏了這一格,列表第一天就會有整欄空白。
  it('必須涵蓋 card(正式站現況全是它,而本表單做不出來)', () => {
    expect(railLabel('card')).toBe('信用卡');
  });

  it('bank_transfer / cash 也有', () => {
    expect(railLabel('bank_transfer')).toBe('銀行匯款');
    expect(railLabel('cash')).toBe('現金');
  });

  it('🔴 未知軌別 ⇒ 誠實回原值,**不得**回空字串', () => {
    expect(railLabel('crypto')).toBe('crypto');
    expect(railLabel('crypto')).not.toBe('');
  });

  // 突變靶:把 RAIL_LABELS 裡的 card 那行拿掉 ⇒ 第一格轉紅(且只有它)。
});

describe('🔴 原型鏈:obj[使用者資料] 會取到 truthy 的非字串', () => {
  // memory `js-index-lookup-hits-prototype-chain`:本 repo 曾有 6 頁中過。
  // 拿掉 `Object.hasOwn` 那道 ⇒ 這幾格會拿到函式,轉紅。
  it.each(['constructor', 'toString', '__proto__', 'valueOf', 'hasOwnProperty'])(
    'rail=%s ⇒ 回原字串,不是原型上的東西',
    (evil) => {
      const out = railLabel(evil);
      expect(typeof out).toBe('string');
      expect(out).toBe(evil);
    },
  );

  it('labelOrRaw 對空對照表也只回原值', () => {
    expect(labelOrRaw({}, 'constructor')).toBe('constructor');
  });
});

describe('登錄者對照', () => {
  it('機器身分翻成白話(員工看不懂內部代號)', () => {
    expect(actorLabel('op4_backfill')).toBe('系統回填(歷史資料)');
    expect(actorLabel('payment_confirmer')).toBe('刷卡自動入帳');
  });

  it('真人 staff id ⇒ 原值', () => {
    expect(actorLabel('staff:sean')).toBe('staff:sean');
  });
});

describe('時間', () => {
  it('固定 Asia/Taipei(UTC 02:00 ⇒ 台北 10:00)', () => {
    expect(formatTaipei('2026-08-01T02:00:00+00:00')).toBe('2026-08-01 10:00');
  });

  it('🔴 解析不了 ⇒ null,**不得** fallback 成今天(會讓壞資料看起來像剛收的款)', () => {
    expect(formatTaipei('not-a-date')).toBeNull();
    expect(formatTaipei('')).toBeNull();
  });

  it('同一時點的不同字面寫法要得到同一個顯示(RPC 的字面受 session TimeZone 影響)', () => {
    expect(formatTaipei('2026-08-01T02:00:00+00:00')).toBe(formatTaipei('2026-08-01T10:00:00+08:00'));
  });

  // 🔴 上面那三格在**本 repo 零判別力**:`vitest.config.ts` 把 TZ 釘死在 Asia/Taipei
  //    ⇒ 拿掉 `formatTaipei` 裡 `timeZone: 'Asia/Taipei'` 那行,它們照樣全綠;
  //    而 Vercel 跑在 **UTC** ⇒ 日期整整差八小時、沒有一個守門會叫(#352 族的形狀)。
  //    這一格把執行期時區改成 UTC,是唯一會因為那行消失而轉紅的斷言。
  it('🔴 執行環境在 UTC 時仍印台北時間(唯一能證明那行 timeZone 有效的一格)', () => {
    vi.stubEnv('TZ', 'UTC');
    try {
      // 前置斷言:先確認 stub 真的改到執行期時區 —— 沒改到的話下面那句在台北下恆綠,
      // 又是一個「偵測器根本沒吐東西」的假綠(本片已經踩過一次)。
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC');
      expect(formatTaipei('2026-08-01T02:00:00+00:00')).toBe('2026-08-01 10:00');
    } finally {
      vi.unstubAllEnvs();
    }
    // 收尾也驗:時區有還原,否則本檔後面的格子會在 UTC 下跑。
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Asia/Taipei');
  });
});

describe('金額', () => {
  it('整數元、千分位', () => {
    expect(formatAmount(1180)).toBe('1,180 元');
  });

  it('🔴 沖銷列保留負號原樣,不取絕對值', () => {
    expect(formatAmount(-500)).toBe('-500 元');
  });
});

/**
 * 「沒有任何列被沖銷」的第二參數。
 *
 * ⚠️ 具名而不是每處寫 `new Set()`:這個值會讓 `isReversed` 恆為 false、`canReverseByRow`
 * 只受 rail 影響 —— 對**不驗沖銷面**的格子是正確的中性值,但它同時讓那一面恆真。
 * 具名之後,哪些格子跑在這個前提下一眼看得出來(要驗沖銷面的格子自己傳真的集合)。
 */
const NONE_REVERSED: ReadonlySet<string> = new Set<string>();

describe('🔴 沖銷只認具名旗標,不看金額正負', () => {
  it('正額的沖銷列仍是沖銷(沖銷之沖銷可為正:500−500+500=500)', () => {
    const e = toPaymentListEntry(
      { ...ROW, amount: 500, isReversal: true, reversalReason: '打錯' },
      NONE_REVERSED,
    );
    expect(e.isReversal).toBe(true);
    expect(e.amountLabel).toBe('500 元');
  });

  it('負額但不是沖銷列時,isReversal 仍為 false(旗標才是真相)', () => {
    const e = toPaymentListEntry({ ...ROW, amount: -1, isReversal: false }, NONE_REVERSED);
    expect(e.isReversal).toBe(false);
  });

  // 突變靶:把 toPaymentListEntry 的 isReversal 改成 `row.amount < 0` ⇒ 上面兩格都轉紅。
});

describe('憑證欄', () => {
  it('匯款看單號', () => {
    expect(toPaymentListEntry({ ...ROW, bankReference: 'B123' }, NONE_REVERSED).referenceLabel).toBe(
      'B123',
    );
  });

  it('卡軌看交易序號', () => {
    expect(toPaymentListEntry({ ...ROW, recTradeId: 'RCPVVJ' }, NONE_REVERSED).referenceLabel).toBe(
      'RCPVVJ',
    );
  });

  it('兩個都沒有 ⇒ null(誠實,不編一個)', () => {
    expect(toPaymentListEntry(ROW, NONE_REVERSED).referenceLabel).toBeNull();
  });
});

describe('received_at 與 created_at 是不同的東西', () => {
  it('兩欄分開輸出,不可混用(對帳看 received_at)', () => {
    const e = toPaymentListEntry(ROW, NONE_REVERSED);
    expect(e.receivedAtDisplay).toBe('2026-08-01 10:00');
    expect(e.createdAtDisplay).toBe('2026-08-11 12:55');
    expect(e.receivedAtDisplay).not.toBe(e.createdAtDisplay);
  });
});

describe('已收合計(本片不顯示,語意先釘住)', () => {
  // 🔴 這格的 fixture 挑過:**一條被沖掉、沒有再被沖回來**的鏈。
  //    我第一版用「收款 + 沖銷 + 沖銷之沖銷」(500 −500 +500),
  //    那組**全加=500、濾掉沖銷也=500** ⇒ 兩種寫法同值、這條斷言零判別力
  //    (memory `fixture-value-makes-guard-vacuous`:值本身讓守門恆真)。
  it('🔴 沖銷列要**一起加**,不可濾掉(SUM(amount) 就是已收)', () => {
    const rows: OrderPaymentRow[] = [
      { ...ROW, id: 'a', amount: 500 },
      { ...ROW, id: 'b', amount: -500, isReversal: true },
    ];
    // 這筆收款已被沖銷 ⇒ 已收 = 0。
    expect(sumReceived(rows)).toBe(0);
    // 濾掉沖銷列會得到 500 —— 那就是「錢還在」的假象。兩者必須不同值,這條才有判別力。
    const filteredWrong = rows.filter((r) => !r.isReversal).reduce((a, r) => a + r.amount, 0);
    expect(filteredWrong).toBe(500);
    expect(sumReceived(rows)).not.toBe(filteredWrong);
  });

  it('沖銷之沖銷:錢又回來了(鏈式也只要直接加總)', () => {
    const rows: OrderPaymentRow[] = [
      { ...ROW, id: 'a', amount: 500 },
      { ...ROW, id: 'b', amount: -500, isReversal: true },
      { ...ROW, id: 'c', amount: 500, isReversal: true },
    ];
    expect(sumReceived(rows)).toBe(500);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// 「已收」扣掉退款只顯示淨額(Sean 2026-09-08 拍【乙】)+ X5F8WG ④「已收足」吃錯口徑。
//
// 🔴 **本組的判別句不是「淨額算對了嗎」,是「`kind` 有沒有跟著換口徑」** ——
//    那才是 X5F8WG ④ 的病:一張「收 10,500、退 10,500」的單,淨額印 0 而膠囊仍印「已收足」。
//    ⇒ 所以每一格都同時斷言 `received` 與 `kind`,只斷言其中一個會漏掉另一半。
// ─────────────────────────────────────────────────────────────────────────────

/** 造一張「收了 `amount` 元」的收款列(沖銷面另有專屬那組測試,這裡不重測)。 */
function paid(amount: number): OrderPaymentRow[] {
  return [{ ...ROW, id: 'x', amount }];
}

describe('已退總額 = 訂單總額 − 帳本未登記額', () => {
  it('正常:10,500 的單,未登記額 0 ⇒ 已退 10,500', () => {
    expect(refundedTotalFromUnregistered(10500, 0, false)).toBe(10500);
  });

  it('🟢 正對照:沒退過款的單 ⇒ 已退 0(不是 null、不是總額)', () => {
    // 沒有這一格,一個「永遠回 null」的實作也會讓下面每一格 fail-closed 而全綠。
    expect(refundedTotalFromUnregistered(14300, 14300, false)).toBe(0);
  });

  it('🛑 讀取失敗 ⇒ null(fail-closed,不得回 0)', () => {
    // 回 0 的話,一張退過款的單在讀不到退款時會印出**未扣的原值** ⇒ 員工分不出真假。
    expect(refundedTotalFromUnregistered(14300, 9000, true)).toBeNull();
  });

  it('🛑 未登記額 null / undefined(查無訂單、呼叫端沒接)⇒ null', () => {
    expect(refundedTotalFromUnregistered(14300, null, false)).toBeNull();
    expect(refundedTotalFromUnregistered(14300, undefined, undefined)).toBeNull();
  });

  it('🛑 算出來是負的(未登記額 > 總額,不該存在)⇒ null,不得回負數', () => {
    // 回負數的話 `received − 負數` 會把已收**加大** ⇒ 往「錢比實際多」那個方向再推一次。
    expect(refundedTotalFromUnregistered(14300, 15000, false)).toBeNull();
  });
});

describe('已收淨額:數字與 kind 同一個口徑', () => {
  it('🔴 X5F8WG ④:收 10,500 全退 ⇒ 已收 0,而 kind 不得還是 settled', () => {
    const gross = toPaymentSummary(10500, paid(10500));
    expect(gross.kind, '前提:未扣退款時它本來就是 settled,否則本格證明不了什麼').toBe('settled');

    const net = toReceivedNetSummary(gross, 10500);
    expect(net.kind).toBe('short');
    expect(net).toEqual({ kind: 'short', due: 10500, received: 0, gap: 10500 });
  });

  it('🟢 正對照:一毛都沒退 ⇒ 淨額摘要與未扣的那份逐欄相同', () => {
    // 沒有這一格,一個「永遠回 { received: 0 }」的實作會讓上面那格全綠。
    const gross = toPaymentSummary(10500, paid(10500));
    expect(toReceivedNetSummary(gross, 0)).toEqual(gross);
  });

  it('部分退款:收 1,000、退 400 ⇒ 已收 600,而「還差」跟著變成 13,700', () => {
    const net = toReceivedNetSummary(toPaymentSummary(14300, paid(1000)), 400);
    expect(net).toEqual({ kind: 'short', due: 14300, received: 600, gap: 13700 });
  });

  it('🔴 淨額是負的就印負的,**不夾成 0**(主視窗 -1a 2026-09-08 裁:夾住會把「我們多退了 500」藏起來,而那是錢)', () => {
    // 🔬 「今天有幾張是負的」量過:**0 張,而分母是 4 張單**
    //    (🟢 正對照:有退款 2 張 / 有收款 2 張 ⇒ 尺碰得到那個欄位)。
    //    🛑 **那個 0 是「還沒有材料」,不是「這個問題不存在」** —— 這句逐字保留,不要簡化。
    const net = toReceivedNetSummary(toPaymentSummary(14300, paid(1000)), 1500);
    expect(net).toEqual({ kind: 'short', due: 14300, received: -500, gap: 14800 });
  });

  it('溢收那態也走同一條算式:收 12,000、退 1,000、應收 10,500 ⇒ 溢收 500', () => {
    const net = toReceivedNetSummary(toPaymentSummary(10500, paid(12000)), 1000);
    expect(net).toEqual({ kind: 'over', due: 10500, received: 11000, excess: 500 });
  });

  it('退款算不出來(null)⇒ 整份摘要收斂成 unknown,不得沿用未扣的原值', () => {
    const gross = toPaymentSummary(14300, paid(1000));
    expect(gross.kind).toBe('short'); // 前提:它本來有一個數字可以印
    expect(toReceivedNetSummary(gross, null)).toEqual({ kind: 'unknown' });
  });

  it('收款讀不到(gross 已是 unknown)⇒ 退款有值也不得變出一個數字', () => {
    expect(toReceivedNetSummary(toPaymentSummary(14300, null), 400)).toEqual({ kind: 'unknown' });
  });
});
