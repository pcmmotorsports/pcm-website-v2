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
  openDisplayIds: [],
  refundingStuckDisplayIds: [],
  attemptManualReviewDisplayIds: [],
  releasedStuckDisplayIds: [],
  pendingDoubleChargeDisplayIdPairs: [],
};

/** 產 n 個合法單號(`PCM-2026-0001` …);用來測上限與差額。 */
const displayIds = (n: number, from = 1): string[] =>
  Array.from({ length: n }, (_, i) => `PCM-2026-${String(from + i).padStart(4, '0')}`);

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

describe('buildAnomalyAlertMessage — 白話 + 帶單號(2026-08-19 Sean 拍板)', () => {
  // 🔴 這一組取代了舊的「固定格式零 PII」那一組。**舊那組不是壞掉,是規格被改了** ——
  //    Sean 本人在知道隱私代價的情況下拍板打開「零單號」那道閘(理由見 check-anomaly-alerts.ts 檔頭)。
  //    ⇒ 動這組之前先讀那段;**不要因為看到「訊息裡有單號」就以為是 bug。**

  /** 🔴 收訊者不是工程師。這 8 個詞是 2026-08-19 那封他看不懂的告警裡出現過的。 */
  const JARGON = ['sweeper', 'pending', '孤兒', '被讓路', 'W1', 'Report C', 'plan §4', 'dismissed'];

  it('🔴 白話尺:五類全開時,那 8 個技術詞一個都不得出現', () => {
    const msg = buildAnomalyAlertMessage(
      {
        ...ZERO,
        openCount: 1, openDisplayIds: displayIds(1, 1),
        refundingStuckCount: 1, refundingStuckDisplayIds: displayIds(1, 2),
        attemptManualReviewCount: 1, attemptManualReviewDisplayIds: displayIds(1, 3),
        releasedStuckCount: 1, releasedStuckDisplayIds: displayIds(1, 4),
        pendingDoubleChargeCandidateCount: 1,
        pendingDoubleChargeDisplayIdPairs: [['PCM-2026-0005', 'PCM-2026-0006']],
        oldestOpenAgeSeconds: 259200,
      },
      86400,
    );
    const blob = `${msg.subject}\n${msg.text}`;
    // 🔴🔴 **正向對照的 needle 要種在【真輸出】裡,不能自己拼一個字串進去**(R3 抓的):
    //    我原本寫 `JARGON.some(w => \`${blob} sweeper\`.includes(w))` —— needle 種在 `blob` **外面**
    //    ⇒ `buildAnomalyAlertMessage` 回空字串時,8 格全 false 全過、對照也過 ⇒ **整格綠**,
    //      而「訊息整個壞掉」正是這一格要排除的世界。
    //    ⇒ 形狀抄本檔下面那格(`expect(blob).toContain('PCM-2026-0104')`):needle 在真輸出裡。
    expect(blob).toContain('可能被扣了兩次錢');
    for (const w of JARGON) expect({ [w]: blob.includes(w) }).toEqual({ [w]: false });
  });

  it('🔴 open 仍是「可能」不是「已確認雙扣」(runbook line51);防動錯錢那句要留著', () => {
    const msg = buildAnomalyAlertMessage({ ...ZERO, openCount: 2, openDisplayIds: displayIds(2) }, 86400);
    expect(msg.text).toContain('可能被扣了兩次錢');
    expect(msg.text).toContain('先查清楚再退款');
    expect(msg.text).not.toContain('已確認雙扣');
  });

  it('🔴🔴「本訊息零個資、僅計數」那句不得復活 —— 帶了單號之後它是假的', () => {
    const msg = buildAnomalyAlertMessage({ ...ZERO, openCount: 1, openDisplayIds: displayIds(1) }, 86400);
    expect(msg.text).not.toContain('零個資');
    expect(msg.text).not.toContain('僅計數');
  });

  it('只列踩門檻的類別(0 的類別不入訊息)', () => {
    const msg = buildAnomalyAlertMessage({ ...ZERO, openCount: 1, openDisplayIds: displayIds(1) }, 86400);
    expect(msg.text).toContain('可能被扣了兩次錢');
    expect(msg.text).not.toContain('退款卡住');
    expect(msg.text).not.toContain('錢可能還被鎖著');
  });

  it('🔴 單號真的印出來(1 筆 / 多筆)', () => {
    const one = buildAnomalyAlertMessage({ ...ZERO, openCount: 1, openDisplayIds: ['PCM-2026-0104'] }, 86400);
    expect(one.text).toContain('PCM-2026-0104');
    const many = buildAnomalyAlertMessage(
      { ...ZERO, openCount: 3, openDisplayIds: ['PCM-2026-0104', 'PCM-2026-0098', 'PCM-2026-0091'] },
      86400,
    );
    for (const id of ['PCM-2026-0104', 'PCM-2026-0098', 'PCM-2026-0091']) expect(many.text).toContain(id);
  });

  it('🔴🔴 RPC 沒回單號(舊版 / 部署錯序)⇒ 只講筆數,**不得憑空編一個單號**', () => {
    const msg = buildAnomalyAlertMessage({ ...ZERO, openCount: 4, openDisplayIds: [] }, 86400);
    expect(msg.text).toContain('4 筆');
    expect(msg.text).not.toMatch(/PCM-\d{4}-\d{4}/);
    // 拿不到單號 ⇒ 標題不寫張數(不要退回去用各類計數相加,那個數字會因重疊而偏大)
    expect(msg.subject).toBe('⚠️ PCM 付款有事要你看');
  });

  it('🔴 超過 30 筆 ⇒ 列前 30 + 「另外還有 N 筆」(甲=乙的失效保護,30 筆以下兩者逐字相同)', () => {
    const msg = buildAnomalyAlertMessage({ ...ZERO, openCount: 45, openDisplayIds: displayIds(45) }, 86400);
    expect(msg.text).toContain('PCM-2026-0030');
    expect(msg.text).not.toContain('PCM-2026-0031');
    expect(msg.text).toContain('另外還有 15 筆');
    // 30 筆整 ⇒ 不得出現「另外還有」
    const exact = buildAnomalyAlertMessage({ ...ZERO, openCount: 30, openDisplayIds: displayIds(30) }, 86400);
    expect(exact.text).not.toContain('另外還有');
  });

  it('🔴 差額用【實際列出的數量】算,不是寫死 30 —— SQL 端 LIMIT 100 會讓陣列比計數短', () => {
    // 🔴 **陣列必須比 30【短】,這一格才有判別力**(關卡2 nit 抓的):
    //    我原本用 `count=200 / ids=100` ⇒ 列 30、差額 170 —— 而寫死成 `count - 30` **也是 170**
    //    ⇒ 兩種實作在那個輸入下**印一樣的東西**,那格證明不了它宣稱的事。
    //    改成 `ids=10` ⇒ 正確實作 190、寫死 30 的實作 170 ⇒ **兩個世界印不同的東西。**
    const msg = buildAnomalyAlertMessage({ ...ZERO, openCount: 200, openDisplayIds: displayIds(10) }, 86400);
    expect(msg.text).toContain('另外還有 190 筆');
    expect(msg.text).not.toContain('另外還有 170 筆');
  });

  // 🔴🔴 R3(W6)抓的:skew 的**另一個方向** —— 我原本只分析了「單號比計數少」那一半。
  it('🔴 `ids` 比 `count` **多**(兩次查詢之間新出現的列)⇒ 只列到 count 為止,信不得自相矛盾', () => {
    const msg = buildAnomalyAlertMessage(
      { ...ZERO, openCount: 1, openDisplayIds: ['PCM-2026-0001', 'PCM-2026-0002', 'PCM-2026-0003'] },
      86400,
    );
    expect(msg.text).toContain('1 筆');
    expect(msg.text).toContain('PCM-2026-0001');
    expect(msg.text).not.toContain('PCM-2026-0002'); // 舊寫法會把三個都列出來,標題卻寫 1 筆
    expect(msg.text).not.toContain('另外還有'); // hidden 為負 ⇒ 不得冒出一行假的差額
    // 🔴 標題也要跟著夾,否則它會報出一個比各類計數之和還大的張數
    expect(msg.subject).toBe('⚠️ PCM 付款有 1 張單要你看');
  });

  // ── 關卡2(codex)折回來的四格 ──────────────────────────────────────────
  it('🔴 重疊註記**不得指名一個信上沒印出來的單號**(交集要算在【真的印出去的】上)', () => {
    // attempt 1 筆 / ids [A,B]、released 1 筆 / ids [D,B] ⇒ 兩段各只列 A 與 D。
    // 拿原始陣列算交集會得到 B ⇒ 註記會洩出一個沒被列出的單號,還說它是「上面那一項」。
    const msg = buildAnomalyAlertMessage(
      {
        ...ZERO,
        attemptManualReviewCount: 1, attemptManualReviewDisplayIds: ['PCM-2026-000A', 'PCM-2026-000B'],
        releasedStuckCount: 1, releasedStuckDisplayIds: ['PCM-2026-000D', 'PCM-2026-000B'],
      },
      86400,
    );
    expect(msg.text).toContain('PCM-2026-000A'); // 正向對照:段落真的印出來了
    expect(msg.text).not.toContain('PCM-2026-000B');
  });

  it('🔴 別的類別被截斷,**不得**讓 ③④ 誤報「可能是同一張單」(截斷要看自己那兩類)', () => {
    const msg = buildAnomalyAlertMessage(
      {
        ...ZERO,
        openCount: 200, openDisplayIds: displayIds(100), // open 被截斷,與 ③④ 無關
        attemptManualReviewCount: 1, attemptManualReviewDisplayIds: ['PCM-2026-0101'],
        releasedStuckCount: 1, releasedStuckDisplayIds: ['PCM-2026-0202'],
      },
      86400,
    );
    expect(msg.text).not.toContain('可能和上面那一項是同一張單');
  });

  it('🔴 訊息超過 LINE 上限 ⇒ 從尾端整行丟掉並明說(不得整封被拒收)', () => {
    // 構造:五類各 30 筆、單號刻意很長(display_id 的 CHECK 末段是 `{4,}`,沒有上界)
    const long = (n: number, p: string) =>
      Array.from({ length: n }, (_, i) => `PCM-2026-${p}${String(i).padStart(60, '0')}`);
    const msg = buildAnomalyAlertMessage(
      {
        ...ZERO,
        openCount: 30, openDisplayIds: long(30, '1'),
        refundingStuckCount: 30, refundingStuckDisplayIds: long(30, '2'),
        attemptManualReviewCount: 30, attemptManualReviewDisplayIds: long(30, '3'),
        releasedStuckCount: 30, releasedStuckDisplayIds: long(30, '4'),
      },
      86400,
    );
    expect(msg.subject.length + msg.text.length).toBeLessThan(5000);
    expect(msg.text).toContain('上面只列出一部分');
    // 🔴🔴 **這三格是 R3 抓出來補的,而它們才是這一格真正要守的東西。**
    //    原本只斷言「截斷發生了」⇒ 那格會通過,而它產出的是一封
    //    **沒有警語、沒有網址、只剩一長串單號**的信 —— 因為舊寫法從尾端 pop,而尾端就是它們。
    //    ⇒ 🔴 那正是「每一格都在守實作細節,而沒有一格在守【這封信作為一封信還完不完整】」。
    expect(msg.text).toContain('先查清楚再退款');
    expect(msg.text).toContain('https://admin.pcmmotorsports.com');
    expect(msg.text).toContain('需登入後台');
    // 🔴 正向對照:同樣五類全開但單號是正常長度 ⇒ **不得**被截(否則這格對什麼都回 true)
    const normal = buildAnomalyAlertMessage(
      { ...ZERO, openCount: 30, openDisplayIds: displayIds(30) },
      86400,
    );
    expect(normal.text).not.toContain('上面只列出一部分');
  });

  it('🔴 信裡帶後台網址,而且要講「需登入」(沒帳號的人點下去會看到登入頁)', () => {
    const msg = buildAnomalyAlertMessage({ ...ZERO, openCount: 1, openDisplayIds: displayIds(1) }, 86400);
    expect(msg.text).toContain('https://admin.pcmmotorsports.com');
    expect(msg.text).toContain('需登入後台');
    // 🔴 不得出現深連結 —— 那條路徑沒有人驗過
    expect(msg.text).not.toMatch(/admin\.pcmmotorsports\.com\/\w/);
  });

  it('🔴 第五類是【一組兩張單】,兩個單號都要出現', () => {
    const msg = buildAnomalyAlertMessage(
      {
        ...ZERO,
        pendingDoubleChargeCandidateCount: 1,
        pendingDoubleChargeDisplayIdPairs: [['PCM-2026-0110', 'PCM-2026-0111']],
      },
      86400,
    );
    expect(msg.text).toContain('PCM-2026-0110 ＋ PCM-2026-0111');
    expect(msg.text).toContain('1 組');
  });

  it('🔴 ③④ 是同一張單時【指名】,不再只說「可能重疊」;沒有交集就不要提', () => {
    const same = buildAnomalyAlertMessage(
      {
        ...ZERO,
        attemptManualReviewCount: 1, attemptManualReviewDisplayIds: ['PCM-2026-0104'],
        releasedStuckCount: 1, releasedStuckDisplayIds: ['PCM-2026-0104'],
      },
      86400,
    );
    expect(same.text).toContain('PCM-2026-0104 和上面那一項是同一張單');
    const diff = buildAnomalyAlertMessage(
      {
        ...ZERO,
        attemptManualReviewCount: 1, attemptManualReviewDisplayIds: ['PCM-2026-0104'],
        releasedStuckCount: 1, releasedStuckDisplayIds: ['PCM-2026-0999'],
      },
      86400,
    );
    expect(diff.text).not.toContain('是同一張單');
    // 只有 ④ 時不得指向一個沒列出來的「上面那一項」
    const only = buildAnomalyAlertMessage(
      { ...ZERO, releasedStuckCount: 1, releasedStuckDisplayIds: ['PCM-2026-0999'] },
      86400,
    );
    expect(only.text).not.toContain('上面那一項');
  });

  it('🔴 標題數字 = 不重複的張數,不是各類計數相加(③④ 同一張單只算一張)', () => {
    const msg = buildAnomalyAlertMessage(
      {
        ...ZERO,
        attemptManualReviewCount: 1, attemptManualReviewDisplayIds: ['PCM-2026-0104'],
        releasedStuckCount: 1, releasedStuckDisplayIds: ['PCM-2026-0104'],
      },
      86400,
    );
    expect(msg.subject).toBe('⚠️ PCM 付款有 1 張單要你看'); // 相加會是 2
  });

  // ── codex R2 折回來的三格 ────────────────────────────────────────────────
  it('🔴🔴 單號被截斷時,標題**不寫張數** —— 否則「100 張單」會和內文的「200 筆」自相矛盾', () => {
    const msg = buildAnomalyAlertMessage({ ...ZERO, openCount: 200, openDisplayIds: displayIds(100) }, 86400);
    expect(msg.subject).toBe('⚠️ PCM 付款有事要你看');
    expect(msg.text).toContain('200 筆'); // 內文的筆數仍然是真的
    // 正向對照:同一組數字但沒有截斷 ⇒ 標題就要寫得出張數(否則這一格是恆真的)
    const full = buildAnomalyAlertMessage({ ...ZERO, openCount: 3, openDisplayIds: displayIds(3) }, 86400);
    expect(full.subject).toBe('⚠️ PCM 付款有 3 張單要你看');
  });

  it('🔴🔴 ③④ 都被截斷時,重疊提示要**退回「可能」而不是整句消失**(101 筆那天正是最需要它的時候)', () => {
    const msg = buildAnomalyAlertMessage(
      {
        ...ZERO,
        attemptManualReviewCount: 101, attemptManualReviewDisplayIds: displayIds(100, 1),
        releasedStuckCount: 101, releasedStuckDisplayIds: displayIds(100, 201),
      },
      86400,
    );
    // 兩個前 100 陣列無交集 ⇒ 舊寫法會把這句整個刪掉
    expect(msg.text).toContain('可能和上面那一項是同一張單');
  });

  it('🔴 門檻不是整點小時時不得四捨五入成小時(5400s = 90 分,不是「2 小時」)', () => {
    const msg = buildAnomalyAlertMessage({ ...ZERO, refundingStuckCount: 1 }, 5400);
    expect(msg.text).toContain('超過 90 分鐘');
    expect(msg.text).not.toContain('2 小時');
  });

  it('退款卡逾時說「超過 24 小時」而不是「24h」(86400s)', () => {
    const msg = buildAnomalyAlertMessage({ ...ZERO, refundingStuckCount: 1 }, 86400);
    expect(msg.text).toContain('超過 24 小時');
  });

  it('open 附最舊年齡(排序訊號;259200s → 3 天);null → 不附且不崩', () => {
    const withAge = buildAnomalyAlertMessage({ ...ZERO, openCount: 2, oldestOpenAgeSeconds: 259200 }, 86400);
    expect(withAge.text).toContain('最久的已經 3 天');
    const noAge = buildAnomalyAlertMessage({ ...ZERO, openCount: 1, oldestOpenAgeSeconds: null }, 86400);
    expect(noAge.text).toContain('可能被扣了兩次錢');
    expect(noAge.text).not.toContain('最久的');
  });

  it('🔴 單號可以出,而 UUID 與金額仍然不可以', () => {
    const msg = buildAnomalyAlertMessage(
      {
        ...ZERO,
        openCount: 1, openDisplayIds: ['PCM-2026-0104'],
        refundingStuckCount: 1, refundingStuckDisplayIds: ['PCM-2026-0091'],
        oldestOpenAgeSeconds: 999,
      },
      86400,
    );
    const blob = `${msg.subject}\n${msg.text}`;
    expect(blob).toContain('PCM-2026-0104'); // 正向對照:這把尺看得到內容
    expect(blob).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
    expect(blob).not.toMatch(/NT\$|\bTWD\b/);
  });
});

describe('checkAnomalyAlerts — 計數透傳(telemetry 零 PII)', () => {
  it('result 帶各計數(供 route log、零 PII)', async () => {
    const summary: AnomalyAlertSummary = {
      ...ZERO,
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
