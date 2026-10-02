import { describe, expect, it } from 'vitest';
import { EMAIL_PREVIEW_SAMPLES, emailCopyKeysInSample, renderEmailCopyPreview } from './email-copy-preview';
import { EMAIL_COPY, type EmailCopyKey } from './email-copy-catalog';

// 信件文字第 3 片:後台預覽(與寄信同一支組信程式)。

describe('renderEmailCopyPreview', () => {
  it('每一封範例都組得出來, 三份都有內容', () => {
    for (const s of EMAIL_PREVIEW_SAMPLES) {
      const p = renderEmailCopyPreview(s.id, new Map());
      expect(p, s.id).not.toBeNull();
      expect(p!.text.length, s.id).toBeGreaterThan(50);
      expect(p!.html, s.id).toMatch(/<html/);
      expect(p!.subject, s.id).not.toBe('');
    }
  });

  it('草稿字套進預覽(純文字、HTML、LINE 三份)', () => {
    const p = renderEmailCopyPreview('unpaid_cancelled', new Map<EmailCopyKey, string>([['unpaidCancelledNoCharge', '還沒付款，不收費。']]))!;
    expect(p.text).toContain('還沒付款，不收費。');
    expect(p.html).toContain('還沒付款，不收費。');
    expect(p.lineText).toContain('還沒付款，不收費。');
  });

  it('LINE 版拿掉加 LINE 的邀請那一行', () => {
    const p = renderEmailCopyPreview('unpaid_cancelled', new Map())!;
    expect(p.text).toContain('加入官方 LINE @pcmmoto');
    expect(p.lineText).not.toContain('加入官方 LINE @pcmmoto');
  });

  it('預覽結束後不會把草稿字留給下一封(寄信端)', () => {
    renderEmailCopyPreview('unpaid_cancelled', new Map<EmailCopyKey, string>([['greeting', '嗨，']]));
    expect(renderEmailCopyPreview('unpaid_cancelled', new Map())!.text).toContain('您好，');
  });

  it('不認得的範例 ⇒ null', () => {
    expect(renderEmailCopyPreview('nope', new Map())).toBeNull();
  });
});

describe('emailCopyKeysInSample', () => {
  it('全部範例合起來涵蓋清單裡大部分句子;沒涵蓋的只有少見情況的那幾句', () => {
    const covered = new Set(EMAIL_PREVIEW_SAMPLES.flatMap((s) => emailCopyKeysInSample(s.id)));
    const missing = (Object.keys(EMAIL_COPY) as EmailCopyKey[]).filter((k) => !covered.has(k)).sort();
    expect(missing).toEqual(
      ['cancelledHeadlineNoId', 'lineTitleMissing', 'paidHeadlineNoId', 'paidLinesTruncated', 'shippedTitleMissing', 'trackingCorrectedHeadlineNoId'].sort(),
    );
  });
  it('付款成功信用到付款信的開頭, 沒用到出貨信的句子', () => {
    const keys = emailCopyKeysInSample('paid');
    expect(keys).toContain('paidHeadlineWithId');
    expect(keys).not.toContain('shippedHeadline');
  });
});
