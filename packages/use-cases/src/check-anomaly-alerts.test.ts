import { describe, expect, it, vi } from 'vitest';
import type { AnomalyAlertSummary, AnomalyAlertMessage } from '@pcm/domain';
import type { IAnomalyAlertReader, IAlertNotifier } from '@pcm/ports';
import {
  checkAnomalyAlerts,
  buildAnomalyAlertMessage,
  type CheckAnomalyAlertsDeps,
} from './check-anomaly-alerts';

const ZERO: AnomalyAlertSummary = {
  openCount: 0,
  refundingCount: 0,
  refundingStuckCount: 0,
  oldestOpenAgeSeconds: null,
  attemptManualReviewCount: 0,
  releasedStuckCount: 0,
  pendingDoubleChargeCandidateCount: 0,
};

function reader(summary: AnomalyAlertSummary): IAnomalyAlertReader {
  return { getAlertSummary: vi.fn().mockResolvedValue(summary) };
}

function okNotifier(): IAlertNotifier & { notify: ReturnType<typeof vi.fn> } {
  return { notify: vi.fn().mockResolvedValue(undefined) };
}

function failNotifier(): IAlertNotifier & { notify: ReturnType<typeof vi.fn> } {
  return { notify: vi.fn().mockRejectedValue(new Error('channel down')) };
}

const OPTS = {
  refundingStuckSeconds: 86400,
  pendingDoubleChargeWindowSeconds: 43200,
  pendingDoubleChargeStuckSeconds: 600,
};

describe('checkAnomalyAlerts — 門檻矩陣', () => {
  it('全零 → 不告警、不呼任何 notifier、errors=0', async () => {
    const n = okNotifier();
    const deps: CheckAnomalyAlertsDeps = { reader: reader(ZERO), notifiers: [n] };
    const res = await checkAnomalyAlerts(deps, OPTS);
    expect(res.alerted).toBe(false);
    expect(res.errors).toBe(0);
    expect(res.notifiersTotal).toBe(0);
    expect(n.notify).not.toHaveBeenCalled();
  });

  it.each([
    ['openCount', { ...ZERO, openCount: 1 }],
    ['refundingStuckCount', { ...ZERO, refundingStuckCount: 1 }],
    ['attemptManualReviewCount', { ...ZERO, attemptManualReviewCount: 1 }],
    ['releasedStuckCount', { ...ZERO, releasedStuckCount: 1 }],
    ['pendingDoubleChargeCandidateCount', { ...ZERO, pendingDoubleChargeCandidateCount: 1 }],
  ] as const)('%s>0 → 告警 + 呼 notifier', async (_label, summary) => {
    const n = okNotifier();
    const res = await checkAnomalyAlerts({ reader: reader(summary), notifiers: [n] }, OPTS);
    expect(res.alerted).toBe(true);
    expect(n.notify).toHaveBeenCalledTimes(1);
    expect(res.errors).toBe(0);
  });

  it('🔴 refundingCount>0 但 stuck=0 且其餘 0 → 不告警(進行中的 refunding 非異常、只 stuck 才告警)', async () => {
    const n = okNotifier();
    const res = await checkAnomalyAlerts(
      { reader: reader({ ...ZERO, refundingCount: 3 }), notifiers: [n] },
      OPTS,
    );
    expect(res.alerted).toBe(false);
    expect(n.notify).not.toHaveBeenCalled();
  });
});

describe('checkAnomalyAlerts — fail-closed + 多管道', () => {
  it('🔴 reader throw → 上拋(route 據此 503、不吞)', async () => {
    const deps: CheckAnomalyAlertsDeps = {
      reader: { getAlertSummary: vi.fn().mockRejectedValue(new Error('db down')) },
      notifiers: [okNotifier()],
    };
    await expect(checkAnomalyAlerts(deps, OPTS)).rejects.toThrow();
  });

  it('🔴 一管道掛掉 → errors=1、另一管道仍送(Promise.allSettled)', async () => {
    const bad = failNotifier();
    const good = okNotifier();
    const res = await checkAnomalyAlerts(
      { reader: reader({ ...ZERO, openCount: 1 }), notifiers: [bad, good] },
      OPTS,
    );
    expect(res.alerted).toBe(true);
    expect(res.notifiersTotal).toBe(2);
    expect(res.notifiersFailed).toBe(1);
    expect(res.errors).toBe(1);
    expect(bad.notify).toHaveBeenCalledTimes(1);
    expect(good.notify).toHaveBeenCalledTimes(1); // 一管道失敗不阻另一管道
  });

  it('兩管道皆掛 → errors=2', async () => {
    const res = await checkAnomalyAlerts(
      { reader: reader({ ...ZERO, openCount: 1 }), notifiers: [failNotifier(), failNotifier()] },
      OPTS,
    );
    expect(res.errors).toBe(2);
    expect(res.notifiersFailed).toBe(2);
  });

  it('🔴 踩門檻但零 notifier → throw(告警無處可送 = 沉默故障、route 503;縱深第二道防線)', async () => {
    await expect(
      checkAnomalyAlerts({ reader: reader({ ...ZERO, openCount: 1 }), notifiers: [] }, OPTS),
    ).rejects.toThrow();
  });

  it('未踩門檻 + 零 notifier → 不 throw(全零常態、200 no-op)', async () => {
    const res = await checkAnomalyAlerts({ reader: reader(ZERO), notifiers: [] }, OPTS);
    expect(res.alerted).toBe(false);
    expect(res.errors).toBe(0);
  });
});

describe('buildAnomalyAlertMessage — 固定格式零 PII', () => {
  it('🔴 open 文案為「候選/待查證」、非「已確認雙扣」(runbook line51);提醒查 W1 對帳', () => {
    const msg = buildAnomalyAlertMessage({ ...ZERO, openCount: 2 }, 86400);
    expect(msg.subject).toContain('PCM 付款異常');
    expect(msg.text).toContain('雙扣候選');
    expect(msg.text).toContain('待查證');
    expect(msg.text).toContain('W1');
    expect(msg.text).not.toContain('已確認雙扣');
  });

  it('只列踩門檻的類別(0 的類別不入訊息)', () => {
    const msg = buildAnomalyAlertMessage({ ...ZERO, openCount: 1 }, 86400);
    expect(msg.text).toContain('雙扣候選');
    expect(msg.text).not.toContain('退款卡逾時');
    expect(msg.text).not.toContain('released 死卡');
  });

  it('refunding 卡逾時顯示小時(86400s → 24h)', () => {
    const msg = buildAnomalyAlertMessage({ ...ZERO, refundingStuckCount: 1 }, 86400);
    expect(msg.text).toContain('24h');
  });

  it('open 附最舊年齡(排序訊號;259200s → 3 天)', () => {
    const msg = buildAnomalyAlertMessage({ ...ZERO, openCount: 2, oldestOpenAgeSeconds: 259200 }, 86400);
    expect(msg.text).toContain('最舊 3 天');
  });

  it('open 但 oldestOpenAgeSeconds=null → 不附年齡(不崩)', () => {
    const msg = buildAnomalyAlertMessage({ ...ZERO, openCount: 1, oldestOpenAgeSeconds: null }, 86400);
    expect(msg.text).toContain('雙扣候選');
    expect(msg.text).not.toContain('最舊');
  });

  it('🔴 零 PII:訊息不含金額/單號/user id 樣式(只含計數與固定字串)', () => {
    const msg = buildAnomalyAlertMessage(
      { openCount: 1, refundingCount: 0, refundingStuckCount: 1, oldestOpenAgeSeconds: 999, attemptManualReviewCount: 2, releasedStuckCount: 0, pendingDoubleChargeCandidateCount: 1 },
      86400,
    );
    const blob = `${msg.subject}\n${msg.text}`;
    // 不含 UUID / NT$ 金額樣式
    expect(blob).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
    expect(blob).not.toMatch(/NT\$|\bTWD\b/);
  });
});

describe('checkAnomalyAlerts — 計數透傳(telemetry 零 PII)', () => {
  it('result 帶各計數(供 route log、零 PII)', async () => {
    const summary: AnomalyAlertSummary = {
      openCount: 1,
      refundingCount: 2,
      refundingStuckCount: 1,
      oldestOpenAgeSeconds: 3600,
      attemptManualReviewCount: 4,
      releasedStuckCount: 0,
      pendingDoubleChargeCandidateCount: 3,
    };
    const res = await checkAnomalyAlerts({ reader: reader(summary), notifiers: [okNotifier()] }, OPTS);
    expect(res).toMatchObject({
      alerted: true,
      openCount: 1,
      refundingCount: 2,
      refundingStuckCount: 1,
      attemptManualReviewCount: 4,
      releasedStuckCount: 0,
      pendingDoubleChargeCandidateCount: 3,
      oldestOpenAgeSeconds: 3600,
    });
  });

  it('reader 收到 route 注入的 refundingStuckSeconds + pending 雙扣窗/卡住門檻', async () => {
    const r = reader(ZERO);
    await checkAnomalyAlerts(
      { reader: r, notifiers: [okNotifier()] },
      { refundingStuckSeconds: 43200, pendingDoubleChargeWindowSeconds: 3600, pendingDoubleChargeStuckSeconds: 900 },
    );
    expect(r.getAlertSummary).toHaveBeenCalledWith(43200, 3600, 900);
  });
});

// 型別完整性:AnomalyAlertMessage 供 notifier 用(編譯期即驗)。
const _typecheck: AnomalyAlertMessage = { subject: 's', text: 't' };
void _typecheck;
