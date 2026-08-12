import { describe, expect, it, vi } from 'vitest';
import {
  actorLabel,
  formatAmount,
  formatTaipei,
  labelOrRaw,
  railLabel,
  sumReceived,
  toPaymentListEntry,
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
