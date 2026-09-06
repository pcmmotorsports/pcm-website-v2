// ⟦b4-TAPPAYDIRECT⟧ 片 B · B3a:補登表單解析器。
//
// 🔵 **測試的形狀抄 `manual-refund-form.test.ts`** —— 每一格都送一份完整表單, 只動一個欄位,
//    ⇒ 紅的時候答得出「是哪一欄」, 而不是「這張表單壞了」。
import { describe, expect, it } from 'vitest';

import {
  BACKFILL_AMOUNT_FIELD,
  BACKFILL_ATTESTED_FIELD,
  BACKFILL_DR_CODE_FIELD,
  BACKFILL_OCCURRED_AT_FIELD,
  BACKFILL_ORDER_ID_FIELD,
  BACKFILL_REASON_FIELD,
  parseRefundBackfillForm,
} from './refund-backfill-form';

const ORDER = '11111111-2222-3333-4444-555555555555';
/** 判「不得未來」的基準;注入而不是讀真實時鐘(見解析器那個參數的註解)。 */
const NOW = new Date('2026-09-07T04:00:00.000Z');
const PAST = '2026-09-07T03:00'; // datetime-local 的形狀(無時區)
const FUTURE = '2999-01-01T00:00';

function form(over: Record<string, string | undefined> = {}): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    [BACKFILL_ORDER_ID_FIELD]: ORDER,
    [BACKFILL_ATTESTED_FIELD]: '1',
    [BACKFILL_DR_CODE_FIELD]: 'DR_7788990011',
    [BACKFILL_AMOUNT_FIELD]: '4200',
    [BACKFILL_REASON_FIELD]: '客人退貨, 已在 TapPay 後台退款',
    [BACKFILL_OCCURRED_AT_FIELD]: PAST,
  };
  for (const [k, v] of Object.entries(base)) {
    if (k in over) continue;
    fd.set(k, v);
  }
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue; // undefined = 這一欄整個不送
    fd.set(k, v);
  }
  return fd;
}

describe('⟦b4-TAPPAYDIRECT⟧ 補登表單解析器', () => {
  it('🟢 正向對照:一份完整的表單過得了', () => {
    const r = parseRefundBackfillForm(form(), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.orderId).toBe(ORDER);
    expect(r.amount).toBe(4200);
    expect(r.drCode).toBe('DR_7788990011');
    // ⚠️ 這一格釘的是「有轉成 ISO」, **不是**某個特定時刻 ——
    //    `datetime-local` 沒有時區, 由跑測試的機器所在時區解讀(與解析器註解同一個決定)。
    expect(r.occurredAt.endsWith('Z')).toBe(true);
  });

  // ══ 必勾(plan v3 §片 C G0 的鏡子)══════════════════════════════════
  it('🔴 沒勾 ⇒ 拒。**checkbox 沒勾時瀏覽器根本不送那個欄位**, 不是送 false', () => {
    expect(parseRefundBackfillForm(form({ [BACKFILL_ATTESTED_FIELD]: undefined }), NOW).ok).toBe(
      false,
    );
  });
  it.each(['0', 'true', 'TRUE', 'on', 'yes', ''])(
    "🛑 %o 一律當【沒勾】—— 只認 '1', 不得順手放寬字面",
    (v) => {
      expect(parseRefundBackfillForm(form({ [BACKFILL_ATTESTED_FIELD]: v }), NOW).ok).toBe(false);
    },
  );

  // ══ DR 碼(抄 refund-recovery-form.ts:26 的 ^\S{1,64}$)════════════════
  it('🟢 貼上來帶尾隨空白 ⇒ trim 後過(從後台複製貼上是常態)', () => {
    const r = parseRefundBackfillForm(form({ [BACKFILL_DR_CODE_FIELD]: '  DR_123  ' }), NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.drCode).toBe('DR_123');
  });
  it.each([
    ['空的', ''],
    ['只有空白', '   '],
    ['中間有空白', 'DR 123'],
    ['超過 64', 'D'.repeat(65)],
  ])('🔴 DR 碼 %s ⇒ 拒', (_label, v) => {
    expect(parseRefundBackfillForm(form({ [BACKFILL_DR_CODE_FIELD]: v }), NOW).ok).toBe(false);
  });
  it('🟢 恰好 64 個字 ⇒ 過(邊界的另一邊)', () => {
    expect(parseRefundBackfillForm(form({ [BACKFILL_DR_CODE_FIELD]: 'D'.repeat(64) }), NOW).ok).toBe(
      true,
    );
  });

  // ══ 發生時刻(plan v3 §片 C G2「不得未來」的鏡子)════════════════════
  it('🔴 未來的時刻 ⇒ 拒', () => {
    expect(parseRefundBackfillForm(form({ [BACKFILL_OCCURRED_AT_FIELD]: FUTURE }), NOW).ok).toBe(
      false,
    );
  });
  it('🟢 過去的時刻 ⇒ 過', () => {
    expect(parseRefundBackfillForm(form({ [BACKFILL_OCCURRED_AT_FIELD]: PAST }), NOW).ok).toBe(true);
  });
  it('🔴 不是時刻的字 ⇒ 拒', () => {
    expect(parseRefundBackfillForm(form({ [BACKFILL_OCCURRED_AT_FIELD]: '昨天' }), NOW).ok).toBe(
      false,
    );
  });

  // ══ 其餘欄位:抄既有規則, 各釘一格「它真的有接上」════════════════════
  it('🔴 訂單 id 不是 uuid ⇒ 拒', () => {
    expect(parseRefundBackfillForm(form({ [BACKFILL_ORDER_ID_FIELD]: 'not-a-uuid' }), NOW).ok).toBe(
      false,
    );
  });
  it.each([
    ['0 元', '0'],
    ['負數', '-1'],
    ['小數', '4200.5'],
    ['帶逗號', '4,200'],
    ['超過 PG int', '2147483648'],
  ])('🔴 金額 %s ⇒ 拒', (_label, v) => {
    expect(parseRefundBackfillForm(form({ [BACKFILL_AMOUNT_FIELD]: v }), NOW).ok).toBe(false);
  });
  it.each([
    ['空的', ''],
    ['只有空白', '  '],
    ['超過 200 字', '啊'.repeat(201)],
  ])('🔴 原因 %s ⇒ 拒', (_label, v) => {
    expect(parseRefundBackfillForm(form({ [BACKFILL_REASON_FIELD]: v }), NOW).ok).toBe(false);
  });

  // 🔴 控制字元那一格:**用組的, 不把不可見位元組寫進原始碼** ——
  //    解析器自己的註解就是這個理由(「避免在原始碼裡放進不可見控制位元組本身」),
  //    而我第一版真的貼了一個進去, 被工具當場擋下。
  it.each([
    ['BEL(7)', 7],
    ['換行(10)', 10],
    ['DEL(127)', 127],
  ])('🔴 原因含控制字元 %s ⇒ 拒', (_label, code) => {
    const reason = `退款${String.fromCharCode(code)}原因`;
    expect(parseRefundBackfillForm(form({ [BACKFILL_REASON_FIELD]: reason }), NOW).ok).toBe(false);
  });

  // 🔴 同名欄位送兩份 ⇒ 整張拒。
  // 🛑🛑 **這三格【證不到入口擋門】, 照實寫**:2026-09-07 突變把 `anyMalformed` 整行拿掉
  //    ⇒ 本檔 **32 格全綠**。成因是本檔每一欄都無條件必填, 而 `readSingleString` 對重複本來就回 `null`
  //    ⇒ 這三格真正釘住的是「**重複送不會被靜默採第一筆**」這個**行為**, 不是那一行程式碼。
  //    ⇒ 📌 那一行的存在理由是**縱深**(見解析器該行上方的註解), 不是這幾格在守它。
  it.each([BACKFILL_ATTESTED_FIELD, BACKFILL_DR_CODE_FIELD, BACKFILL_AMOUNT_FIELD])(
    '🔴 %s 送兩份 ⇒ 整張拒(不是靜默採第一筆)',
    (field) => {
      const fd = form();
      fd.append(field, fd.get(field) as string);
      expect(parseRefundBackfillForm(fd, NOW).ok).toBe(false);
    },
  );
});
