import { describe, expect, it } from 'vitest';
import {
  EMAIL_COPY,
  EMAIL_COPY_LOCKED,
  LINE_INVITE_MARKER,
  emailCopy,
  fillEmailCopy,
  resolveEmailCopyOverrides,
  validateEmailCopyText,
  withEmailCopyOverrides,
  type EmailCopyKey,
} from './email-copy-catalog';

// 信件文字第 1 片(2026-10-02):清單本身的規則。寄出的信與今天逐字相同, 由 sweep-email-outbox.test.ts 檔尾的快照證。

describe('fillEmailCopy', () => {
  it('換掉給了值的代號, 沒給值的原樣留著', () => {
    expect(fillEmailCopy('訂單 {訂單編號} 共 {件數} 件', { 訂單編號: 'PCM-1' })).toBe('訂單 PCM-1 共 {件數} 件');
  });
  it('值裡的 $& $1 不會被當成取代語法', () => {
    expect(fillEmailCopy('品名 {品名}', { 品名: 'A$&B$1' })).toBe('品名 A$&B$1');
  });
  it('同一個代號出現兩次都換', () => {
    expect(fillEmailCopy('{a}-{a}', { a: 'x' })).toBe('x-x');
  });
});

describe('EMAIL_COPY 清單', () => {
  it('每一句列的必填代號, 預設文字裡真的都有;文字裡的代號也都列在必填裡', () => {
    for (const [key, entry] of Object.entries(EMAIL_COPY)) {
      const inText = [...entry.text.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]).sort();
      expect([...new Set(inText)], key).toEqual([...entry.placeholders].sort());
    }
  });
  it('全部填好之後不留任何大括號', () => {
    for (const [key, entry] of Object.entries(EMAIL_COPY)) {
      const vars = Object.fromEntries(entry.placeholders.map((p) => [p, '值']));
      expect(emailCopy(key as keyof typeof EMAIL_COPY, vars), key).not.toMatch(/[{}]/);
    }
  });
  it('每一句都有位置說明, 文字不是空的', () => {
    for (const [key, entry] of Object.entries(EMAIL_COPY)) {
      expect(entry.label.trim(), key).not.toBe('');
      expect(entry.text.trim(), key).not.toBe('');
    }
  });
});

describe('快照涵蓋不到的兩句(寄信測試走不到那個分支)', () => {
  // 檔尾快照只收得到「有測項寄出」的信;這兩句所在的分支沒有任何寄信測試走得到
  // (品項過多那句, sweep-email-outbox.ts 自己註明今天走不到)⇒ 直接釘住字面, 證明搬家時一字未改。
  it('付款信「品項過多」那句', () => {
    expect(EMAIL_COPY.paidLinesTruncated.text).toBe('(品項過多，此處僅列出部分)');
  });
  it('單號更正信讀不到訂單編號時的開頭', () => {
    expect(EMAIL_COPY.trackingCorrectedHeadlineNoId.text).toBe('您先前那封出貨通知上的貨運單號有誤。');
  });
});

// ─────────────── 第 2 片:員工改的字 ───────────────
describe('validateEmailCopyText(存檔與寄信共用的檢查)', () => {
  it('合格的字 ⇒ 沒有問題', () => {
    expect(validateEmailCopyText('cancelledHeadlineWithId', '訂單 {訂單編號} 已為您取消。')).toEqual([]);
  });
  it('不認得的代號 / 鎖住的句子', () => {
    expect(validateEmailCopyText('noSuchKey', 'x')).toEqual(['不認得這一句']);
    expect(validateEmailCopyText('contactLead', 'x')).toEqual(['這一句不開放修改']);
    expect(validateEmailCopyText('greetingHalfwidth', 'x')).toEqual(['這一句不開放修改']);
  });
  it('少了必填代號、單邊大括號、不認得的代號', () => {
    expect(validateEmailCopyText('cancelledHeadlineWithId', '已取消。')).toContain('缺少 {訂單編號}，請加回去');
    expect(validateEmailCopyText('greeting', '您好 {')).toContain('有不認得的 {代號} 或多出來的大括號');
    expect(validateEmailCopyText('greeting', '您好 {客人}')).toContain('有不認得的 {代號} 或多出來的大括號');
  });
  it('空白、太長、換行、< >、LINE 那段字', () => {
    expect(validateEmailCopyText('greeting', '   ')).toContain('不能是空白');
    expect(validateEmailCopyText('greeting', '字'.repeat(301))).toContain('不能超過 300 個字');
    expect(validateEmailCopyText('greeting', '字'.repeat(300))).toEqual([]);
    expect(validateEmailCopyText('greeting', 'a\nb')).toContain('不能換行');
    expect(validateEmailCopyText('greeting', 'a<b')).toContain('不能有 < 或 >');
    expect(validateEmailCopyText('greeting', `請${LINE_INVITE_MARKER}`)).toContain(`不能含「${LINE_INVITE_MARKER}」這段字`);
  });
  it('LINE 那段字(與 order-email-copy.ts 拿掉整行的依據逐字相同, 那一側由 use-cases 的測試釘)', () => {
    expect(LINE_INVITE_MARKER).toBe('加入官方 LINE @pcmmoto');
  });
  it('鎖住的句子都還在清單裡', () => {
    for (const k of EMAIL_COPY_LOCKED) expect(Object.keys(EMAIL_COPY)).toContain(k);
  });
});

describe('resolveEmailCopyOverrides(挑排隊那一刻生效的版本)', () => {
  const r = (id: string, savedAt: string, text: string | null, copyKey = 'greeting') => ({ id, copyKey, text, savedAt });
  it('只看 asOf 之前存的;同時間看 id;最新是 null 就不蓋', () => {
    const rows = [
      r('a', '2026-10-01T00:00:00Z', '早安，'),
      r('b', '2026-10-02T00:00:00Z', '午安，'),
      r('c', '2026-10-03T00:00:00Z', '晚安，'),
    ];
    expect(resolveEmailCopyOverrides(rows, '2026-10-02T12:00:00Z').overrides.get('greeting')).toBe('午安，');
    expect(resolveEmailCopyOverrides(rows, '2026-09-30T00:00:00Z').overrides.size).toBe(0);
    expect(
      resolveEmailCopyOverrides([...rows, r('d', '2026-10-02T06:00:00Z', null)], '2026-10-02T12:00:00Z').overrides.size,
    ).toBe(0);
    expect(
      resolveEmailCopyOverrides([r('x', '2026-10-01T00:00:00Z', '甲，'), r('y', '2026-10-01T00:00:00Z', '乙，')], '2026-10-02T00:00:00Z')
        .overrides.get('greeting'),
    ).toBe('乙，');
  });
  it('檢查不過的字 ⇒ 不蓋, 列在 invalidKeys;鎖住的句子 ⇒ 不蓋', () => {
    const out = resolveEmailCopyOverrides(
      [r('a', '2026-10-01T00:00:00Z', '已取消。', 'cancelledHeadlineWithId'), r('b', '2026-10-01T00:00:00Z', '嗨,', 'greetingHalfwidth')],
      '2026-10-02T00:00:00Z',
    );
    expect(out.overrides.size).toBe(0);
    expect(out.invalidKeys.sort()).toEqual(['cancelledHeadlineWithId', 'greetingHalfwidth']);
  });
  it('asOf 不是合法時間 ⇒ 一律不蓋(用預設)', () => {
    expect(resolveEmailCopyOverrides([r('a', '2026-10-01T00:00:00Z', '早安，')], 'not-a-date').overrides.size).toBe(0);
  });
});

describe('withEmailCopyOverrides(只在這一封信的組信期間有效)', () => {
  const ov = new Map<EmailCopyKey, string>([['greeting', '嗨，']]);
  it('區段裡讀到員工的字, 區段外回到預設', () => {
    expect(withEmailCopyOverrides(ov, () => emailCopy('greeting'))).toBe('嗨，');
    expect(emailCopy('greeting')).toBe('您好，');
  });
  it('組信丟例外之後也會清掉, 不會串到下一封', () => {
    expect(() => withEmailCopyOverrides(ov, () => { throw new Error('boom'); })).toThrow('boom');
    expect(emailCopy('greeting')).toBe('您好，');
  });
  it('不能巢狀、不能放非同步的東西', () => {
    expect(() => withEmailCopyOverrides(ov, () => withEmailCopyOverrides(ov, () => 1))).toThrow('不能巢狀');
    expect(() => withEmailCopyOverrides(ov, () => Promise.resolve(1))).toThrow('必須是同步函式');
    expect(emailCopy('greeting')).toBe('您好，');
  });
});

