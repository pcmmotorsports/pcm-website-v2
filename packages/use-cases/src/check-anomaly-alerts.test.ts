import { describe, expect, it, vi } from 'vitest';
import type { AnomalyAlertSummary, AnomalyAlertMessage } from '@pcm/domain';
import type { IAnomalyAlertReader, IAlertNotifier } from '@pcm/ports';
import {
  checkAnomalyAlerts,
  buildAnomalyAlertMessage,
  type CheckAnomalyAlertsDeps,
} from './check-anomaly-alerts';

const ZERO: AnomalyAlertSummary = {
  // 🔵 排程心跳(片3):基準是【六支都健康】—— 0 支不正常, 名單空, 讀得到。
  //    🛑 `cronHeartbeatUnknown: false` 是刻意的:寫 `true` 會讓這個 ZERO
  //       同時代表「都健康」與「讀不到」兩個世界, 而那正是這一片要分開的東西。
  cronHeartbeatAbnormalCount: 0,
  cronHeartbeatAbnormalJobs: [],
  cronHeartbeatUnknown: false,
  // ⟦b9-RLSHARDEN⟧ 甲:基準是【屬性還在, 而且我量到了】——
  //   🛑 兩個都寫 false 是刻意的, 與上面 `cronHeartbeatUnknown` 同一個理由:
  //      任一寫 true 都會讓這個 ZERO 同時代表兩個世界。
  bypassRlsRevoked: false,
  bypassRlsUnknown: false,
  // 🔵 基線用正式庫 2026-09-02 真呼叫回來的值,不是我編的。
  bypassRlsPrivilegedCount: 6,
  bypassRlsTotalRoleCount: 35,
  openCount: 0,
  refundingCount: 0,
  refundingStuckCount: 0,
  oldestOpenAgeSeconds: null,
  attemptManualReviewCount: 0,
  releasedStuckCount: 0,
  pendingDoubleChargeCandidateCount: 0,
  // F-004:`0` 代表「查得到而且是 0 筆」;`null` + unknown=true 是**另一個世界**(RPC 尚未 apply)。
  // 🔴 ZERO 這個 fixture 刻意用 0/false —— 它是「一切正常且沒事」的基準,不是「查不到」。
  orderRefundsStuckCount: 0,
  orderRefundsStuckOvernightCount: 0,
  orderRefundsManualFailedCount: 0,
  orderRefundsStuckUnknown: false,
  // 🔴 M-4a 寄信五格：同一個道理 —— `0` = 查得到而且是 0 封；`null` + unknown=true 是【另一個世界】
  //    （那支 RPC 尚未 apply）。ZERO 是「一切正常且沒事」的基準。
  emailOverdueCount: 0,
  emailDeadLetterCount: 0,
  emailStuckSendingCount: 0,
  emailQuotaConfirmedCount: 0,
  emailQuotaSuspectedCount: 0,
  // 🔴 預設 fixture 給【非 0】—— 若給 0, 每一格既有測試都會意外落進「五格全 0 且分母 0」
  //   那條新路 ⇒ 一片本來與本片無關的測試會開始紅, 而紅的理由與它們要測的事無關。
  //   📌 而更糟的是反過來:給 0 而那條路【沒接上】時, 沒有任何一格會發現。
  emailOutboxTotalCount: 12,
  // 🔵 出貨那三格:預設 fixture 給【0 + 已知】—— 不叫, 而不是 unknown。
  //   🔴 給 unknown(null)會讓「它有沒有被接上」在既有每一格底下【都看不出來】。
  shippedNeverEnqueuedCount: 0,
  shippedUnsendableCount: 0,
  shipmentsTotalCount: 5,
  shippedGapUnknown: false,
  orderCreatedPaidNoEmailCount: 0,
  orderCreatedNoRecipientCount: 0,
  orderCreatedGapUnknown: false,
  // 🔵 未付款取消信線那三格。基準 = 【查得到而沒有卡住的單】——
  //   🛑 與上面 cronHeartbeat 同一個理由:寫 `Unknown: true` 會讓 ZERO 同時代表
  //      「一切正常」與「讀不到」兩個世界, 而那正是這一片要分開的東西。
  unpaidCancelledPendingCount: 0,
  unpaidCancelledNoRecipientCount: 0,
  unpaidCancelledGapUnknown: false,
  // 🔵 第四條線(⟦b4-NORECIPIENTWINDOW⟧, 2026-09-04)。預設乾淨:不叫。
  trackingCorrectedPendingCount: 0,
  trackingCorrectedNoRecipientCount: 0,
  trackingCorrectedGapUnknown: false,
  orderCreatedStuckCount: 0,
  orderCreatedStuckOldestMinutes: null,
  orderCreatedStuckUnknown: false,
  emailOutboxUnknown: false,
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
  return {
    getAlertSummary: vi.fn().mockResolvedValue(summary),
    // 🔵 ⟦b9-ENUMWATCH⟧ 片 2:多數既有案例不關心這一格 ⇒ 預設回 null(= 那支 RPC 還沒 apply)。
    // 🛑 **而它【擋不住】把新欄位接進 `shouldAlert`**(R2 must-fix F5 抓到我原本的註解在宣稱它擋得住):
    //    預設 null ⇒ count 是 null ⇒ `(count ?? 0) > 0` 為假 ⇒ 那個突變在這 16 格底下**全綠**。
    //    ⇒ 真正殺得掉它的是下面那一格【count > 0 而 summary 是 ZERO】。
    getSearchLogHealth: async () => null,
    getManualCustomerSearchSummary: vi.fn().mockResolvedValue(null),
  };
}

function okNotifier(): IAlertNotifier & { notify: ReturnType<typeof vi.fn> } {
  return { notify: vi.fn().mockResolvedValue(undefined) };
}

function failNotifier(): IAlertNotifier & { notify: ReturnType<typeof vi.fn> } {
  return { notify: vi.fn().mockRejectedValue(new Error('channel down')) };
}

const OPTS = {
  /** ⟦b9-ENUMWATCH⟧ 片 2:回看窗口(秒)。**不是門檻** —— 本片刻意不設門檻。 */
  manualCustomerSearchWindowSeconds: 86400,
  refundingStuckSeconds: 86400,
  pendingDoubleChargeWindowSeconds: 43200,
  pendingDoubleChargeStuckSeconds: 600,
  shippedCutoffIso: null,
  shippedGraceSeconds: 900,
  // 🔵 訊號 4 的起始線;多數案例不需要它 ⇒ null(= 那一段不查)。
  //   需要它的案例自己覆寫,見「[訊號4]」那幾格。
  orderCreatedCutoffIso: null,
  orderCreatedStuckMinutes: null,
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

  it('[訊號4] 🔴🔴 負對照:paidNoEmail>0 而 noRecipient=0 ⇒ 【不叫】', async () => {
    /**
     * 🛑 **這一格是整個訊號 4 最重要的一條**(codex 2026-08-31 R1 must-fix 指出原本一格都沒有)。
     * scanner 每 5 分鐘掃「已付款而沒有信」的單, **然後當輪就把它們排進去**
     * ⇒ `paidNoEmail > 0` 是【正常】的 ⇒ 📌 **把它接進 shouldAlert = 有生意就叫。**
     * ⇒ 少了這一格, 一個「順手把兩個都接進去」的實作會讓上面那張矩陣全綠,
     *   而線上會變成**每天都在叫一個正常狀態** —— 板上 `⟦b4-EMAIL2ND⟧` 有前科。
     */
    const n = okNotifier();
    const res = await checkAnomalyAlerts(
      { reader: reader({ ...ZERO, orderCreatedPaidNoEmailCount: 99 }), notifiers: [n] },
      OPTS,
    );
    expect(res.alerted).toBe(false);
    expect(n.notify).not.toHaveBeenCalled();
    // 🔵 而它仍然要【透傳出來】—— 不叫不等於不報數
    expect(res.orderCreatedPaidNoEmailCount).toBe(99);
  });

  it('[訊號4] 🔵 負對照:unknown=true 而兩個 count 是 null ⇒ 【不叫】(?? 0 不得變成叫)', async () => {
    // 🛑 讀不到走部署管道(route 依旗標回 503), **不變成一封每天寄的信**。
    const n = okNotifier();
    const res = await checkAnomalyAlerts(
      {
        reader: reader({
          ...ZERO,
          orderCreatedPaidNoEmailCount: null,
          orderCreatedNoRecipientCount: null,
          orderCreatedGapUnknown: true,
        }),
        notifiers: [n],
      },
      OPTS,
    );
    expect(res.alerted).toBe(false);
    expect(n.notify).not.toHaveBeenCalled();
    // 🔴 旗標要出得來 —— 否則 route 讀不到它, 那道 fail-closed 在下游就被拆掉
    expect(res.orderCreatedGapUnknown).toBe(true);
    expect(res.orderCreatedNoRecipientCount).toBeNull();
  });

  it.each([
    ['openCount', { ...ZERO, openCount: 1 }],
    ['refundingStuckCount', { ...ZERO, refundingStuckCount: 1 }],
    ['attemptManualReviewCount', { ...ZERO, attemptManualReviewCount: 1 }],
    ['releasedStuckCount', { ...ZERO, releasedStuckCount: 1 }],
    ['pendingDoubleChargeCandidateCount', { ...ZERO, pendingDoubleChargeCandidateCount: 1 }],
    // 🔴 訊號 4 的【主詞】(codex 2026-08-31 R1 must-fix:原本這張矩陣一格都沒有)。
    //   Sean 拍 5️⃣ 甲「有一封就叫」⇒ 這一格證明「一封」真的會叫。
    ['orderCreatedNoRecipientCount', { ...ZERO, orderCreatedNoRecipientCount: 1 }],
    // 🔴 訊號4 的【持續失敗】那一格(板 ⟦b4-SIG4ERRORS⟧, 2026-09-01)。
    //   它守的是一個今天零告警的缺口:enqueue 每一輪都失敗 ⇒ errors 只落在 cron 回應 body。
    ['orderCreatedStuckCount', { ...ZERO, orderCreatedStuckCount: 1 }],
    // 🔴 **未付款取消信線的主詞**(⟦b4-NORECIPIENTWINDOW⟧, 2026-09-03)。
    //   它守的是:把 `shouldAlert` 那一項拿掉 ⇒ **這一格必須紅**。
    //   ⇒ 📌 沒有它, 「讓狀態看得見」是一句話不是一個保護。
    ['unpaidCancelledNoRecipientCount', { ...ZERO, unpaidCancelledNoRecipientCount: 1 }],
    // 🔴 **更正單號信線的主詞**(⟦b4-NORECIPIENTWINDOW⟧ **第四條線**, 2026-09-04)。
    //   守的是同一件事:把 `shouldAlert` 那一項拿掉 ⇒ **這一格必須紅**。
    //   ⇒ 📌 而這一條的後果與姊妹線不同:不是「客人沒收到一封信」,
    //     是**客人手上有一個我們給他的、而現在是錯的貨運單號**, 而我們寄不出更正。
    ['trackingCorrectedNoRecipientCount', { ...ZERO, trackingCorrectedNoRecipientCount: 1 }],
  ] as const)('%s>0 → 告警 + 呼 notifier', async (_label, summary) => {
    const n = okNotifier();
    const res = await checkAnomalyAlerts({ reader: reader(summary), notifiers: [n] }, OPTS);
    expect(res.alerted).toBe(true);
    expect(n.notify).toHaveBeenCalledTimes(1);
    expect(res.errors).toBe(0);
  });

  /**
   * 🔴🔴 **訊號4 持續失敗那一格的【第二個世界】—— 而它比會叫那一格重要。**
   * `orderCreatedPaidNoEmailCount > 0` 是【正常】的:新單進來就被數到一次,
   * 下一輪 scanner 就把它排進去了。
   * ⇒ 📌 **拿它當判準 = 有生意就叫 —— 而一個對常態發的警報會訓練所有人跳過它。**
   */
  /**
   * 🟢🟢 **第四條線的兩個負對照 —— 而沒有它們, 上面那格在「這支 use-case 什麼都叫」的世界裡也會綠。**
   */
  it('🔴 那封信裡要說得出【是哪一件事】—— 而刪掉那行文字, 上面那格照樣綠', async () => {
    // 🔴🔴 codex 2026-09-04 must-fix #7:上面那格只驗 `alerted` 與 `notify` 被呼叫,
    //    ⇒ 把 `emailPush(...)` 那一行整段刪掉, 它**照樣綠** —— 而收信的人會看到一封
    //    說「有異常」而沒說是什麼的信。
    const n = okNotifier();
    await checkAnomalyAlerts(
      { reader: reader({ ...ZERO, trackingCorrectedNoRecipientCount: 3 }), notifiers: [n] },
      OPTS,
    );
    const body = JSON.stringify(n.notify.mock.calls);
    expect(body).toContain('貨運單號更正');
    // 🔵 而它要說出**後果**, 不只說出現象 —— 這一條與姊妹線的差別就在這裡。
    expect(body).toContain('沒有路可以更正');
  });

  it('🔵 trackingCorrectedPending>0 而 noRecipient=0 → 不告警(有更正不是異常)', async () => {
    const n = okNotifier();
    const res = await checkAnomalyAlerts(
      { reader: reader({ ...ZERO, trackingCorrectedPendingCount: 5 }), notifiers: [n] },
      OPTS,
    );
    // 🔴 承重:把 `pending` 也寫進 shouldAlert ⇒ 這一格紅。
    //   而那個錯法的症狀是**每天都叫** —— 對常態發的警報會訓練所有人跳過它。
    expect(res.alerted).toBe(false);
    expect(n.notify).not.toHaveBeenCalled();
  });

  it('🔵 trackingCorrected 三格都是 null(RPC 尚未 apply)→ 不告警, 而那【不是】健康', async () => {
    const n = okNotifier();
    const res = await checkAnomalyAlerts(
      {
        reader: reader({
          ...ZERO,
          trackingCorrectedPendingCount: null,
          trackingCorrectedNoRecipientCount: null,
          trackingCorrectedGapUnknown: true,
        }),
        notifiers: [n],
      },
      OPTS,
    );
    // 🔴 `?? 0` ⇒ 讀不到時不叫 —— 而**「不叫」與「健康」是兩件事**:
    //   那個差別由 `trackingCorrectedGapUnknown` 帶到 route 的回應上, 不由這裡叫。
    expect(res.alerted).toBe(false);
    expect(res.trackingCorrectedGapUnknown).toBe(true);
  });

  it('🔴 paidNoEmail>0 而 stuck=0 → 不告警(有生意不是異常)', async () => {
    const n = okNotifier();
    const res = await checkAnomalyAlerts(
      {
        reader: reader({ ...ZERO, orderCreatedPaidNoEmailCount: 5, orderCreatedStuckCount: 0 }),
        notifiers: [n],
      },
      OPTS,
    );
    expect(res.alerted).toBe(false);
    expect(n.notify).not.toHaveBeenCalled();
  });

  /**
   * 🔵 **`unset` 那一態:env 沒設 ⇒ adapter 回 `null` ⇒ 不叫。**
   * 🛑 驗收是【行為與加這一片之前逐字相同】—— 那讓「落地」與「Sean 去填那顆 env」脫鉤。
   * 🔴 少了這一格, 一個忘記處理 null 的實作會在【還沒上膛】時就開始叫。
   */
  it('🔵 stuckCount=null(還沒上膛 / RPC 未 apply)→ 不告警', async () => {
    const n = okNotifier();
    const res = await checkAnomalyAlerts(
      { reader: reader({ ...ZERO, orderCreatedStuckCount: null }), notifiers: [n] },
      OPTS,
    );
    expect(res.alerted).toBe(false);
    expect(n.notify).not.toHaveBeenCalled();
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
      reader: {
        getAlertSummary: vi.fn().mockRejectedValue(new Error('db down')),
        getSearchLogHealth: async () => null,
        getManualCustomerSearchSummary: vi.fn().mockResolvedValue(null),
      },
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
      null,
    false,
    { stale: false, anonRevoked: false },
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
    const msg = buildAnomalyAlertMessage({ ...ZERO, openCount: 2, openDisplayIds: displayIds(2) }, 86400, null, false, { stale: false, anonRevoked: false });
    expect(msg.text).toContain('可能被扣了兩次錢');
    // 🔴 2026-08-21 codex R3 MF-5:字面由「先查清楚再【退款】」改成「再【動錢】」,
    //    而**承重的那一句換人了** —— 現在擋著誤動錢的是下面那句「請不要自己去 TapPay 後台退款」。
    //    ⇒ 所以兩句都釘,而不是只把舊字面換成新字面。
    expect(msg.text).toContain('先查清楚再動錢');
    expect(msg.text).toContain('請【不要】自己去 TapPay 後台退款');
    // 🔴🔴 **順序也要釘**(2026-08-21 主視窗裁):「只是可能」那句必須出現在
    //    「不要自己去 TapPay 退款」【之前】—— 放結尾等於沒有,收信人讀到那行時還沒讀到它。
    //    而當天查出那封信舉的兩筆(2SQH2P/GVRDMH)payment_status=unpaid、從來沒刷成功
    //    ⇒ **那封信是在叫人去退一筆從來沒收到過的錢**,而唯一擋住它的就是這一句。
    //    ⚠️ 只用 toContain 釘不住位置 —— 有人把它移回結尾,那格照樣綠。
    expect(msg.text.indexOf('只是「可能」')).toBeGreaterThanOrEqual(0);
    expect(msg.text.indexOf('只是「可能」')).toBeLessThan(
      msg.text.indexOf('請【不要】自己去 TapPay 後台退款'),
    );
    expect(msg.text).not.toContain('已確認雙扣');
  });

  it('🔴🔴「本訊息零個資、僅計數」那句不得復活 —— 帶了單號之後它是假的', () => {
    const msg = buildAnomalyAlertMessage({ ...ZERO, openCount: 1, openDisplayIds: displayIds(1) }, 86400, null, false, { stale: false, anonRevoked: false });
    expect(msg.text).not.toContain('零個資');
    expect(msg.text).not.toContain('僅計數');
  });

  it('只列踩門檻的類別(0 的類別不入訊息)', () => {
    const msg = buildAnomalyAlertMessage({ ...ZERO, openCount: 1, openDisplayIds: displayIds(1) }, 86400, null, false, { stale: false, anonRevoked: false });
    expect(msg.text).toContain('可能被扣了兩次錢');
    expect(msg.text).not.toContain('退款卡住');
    // ⚠️ 這一行**對「那句文案對不對」沒有判別力** —— 別把它讀成「字面的守門」。
    //   fixture 是 {...ZERO, openCount: 1} ⇒ releasedStuckCount = 0 ⇒ 那一段不會被渲染。
    // ✅ **而它對【它自己宣稱守的那件事】是有判別力的**,這一格我一度寫反、被更正過兩次:
    //   突變:`section()` 的 `if (count <= 0)`(check-anomaly-alerts.ts:194)改成 `< 0`
    //   ⇒ 0 的類別會渲染出【訂單付款未成功】0 筆 ⇒ **本格紅**(2026-08-21 窗 `-91` 實跑,6 紅之一)。
    //   ⇒ 🔴 我原本在這裡寫「沒有判別力」,那是**假話** —— 我把「對某一個 mutation 沒判別力」
    //     寫成了「沒判別力」。少了那五個字,句子就變成假的,而它附著行號讀起來很像查證過。
    // 🔴 **而這一行是【冗餘】的,這句不可省**:同一發突變,上面的 `not.toContain('退款卡住')`
    //   自己就會紅(refundingStuckCount 也是 0)⇒ **刪掉本行,「0 的類別不入訊息」仍然有人守。**
    //   🔴 這一句我**量過才寫**,不是推的(2026-08-21,改完 shasum 比對還原):
    //     Q  早退改 `< 0`                  ⇒ 6 failed(與窗 `-91` 獨立跑出的 6 相同)
    //     R  Q 之上【再刪掉本行】           ⇒ **仍然 6 failed,本格仍在紅名單裡**
    //     ⇒ 兩發同數 ⇒ 本行對這一發突變**沒有增加任何判別力** = 冗餘,實測不是推測。
    //   我一度寫成「換探針是【唯一】讓它活下來的動作」—— 也是假的,而我在同一封信裡引用過反例。
    //   ⇒ 本行的真實價值收窄成兩點:①跟著分類名字走 ⇒ 改名時會被一起維護(命名的錨)
    //     ②縱深:萬一哪天只有 released 那一類被特例掉,上面兩行接不到。
    // ⇒ 探針必須用【現行】名字:舊字面在 repo 裡已不存在 ⇒ 斷言它不存在是永遠綠的。
    //   🔴 換句話說,**改分類名字這個動作會殺掉本行**,而它死的時候不會紅。
    // 🔴 真正守「舊字面不得復活」的在下面那個 describe(fixture 的 count ≥ 1)。
    expect(msg.text).not.toContain('訂單付款未成功');
  });

  it('🔴 單號真的印出來(1 筆 / 多筆)', () => {
    const one = buildAnomalyAlertMessage({ ...ZERO, openCount: 1, openDisplayIds: ['PCM-2026-0104'] }, 86400, null, false, { stale: false, anonRevoked: false });
    expect(one.text).toContain('PCM-2026-0104');
    const many = buildAnomalyAlertMessage(
      { ...ZERO, openCount: 3, openDisplayIds: ['PCM-2026-0104', 'PCM-2026-0098', 'PCM-2026-0091'] },
      86400,
      null,
    false,
    { stale: false, anonRevoked: false },
  );
    for (const id of ['PCM-2026-0104', 'PCM-2026-0098', 'PCM-2026-0091']) expect(many.text).toContain(id);
  });

  it('🔴🔴 RPC 沒回單號(舊版 / 部署錯序)⇒ 只講筆數,**不得憑空編一個單號**', () => {
    const msg = buildAnomalyAlertMessage({ ...ZERO, openCount: 4, openDisplayIds: [] }, 86400, null, false, { stale: false, anonRevoked: false });
    expect(msg.text).toContain('4 筆');
    expect(msg.text).not.toMatch(/PCM-\d{4}-\d{4}/);
    // 拿不到單號 ⇒ 標題不寫張數(不要退回去用各類計數相加,那個數字會因重疊而偏大)
    expect(msg.subject).toBe('⚠️ PCM 付款有事要你看');
  });

  it('🔴 超過 30 筆 ⇒ 列前 30 + 「另外還有 N 筆」(甲=乙的失效保護,30 筆以下兩者逐字相同)', () => {
    const msg = buildAnomalyAlertMessage({ ...ZERO, openCount: 45, openDisplayIds: displayIds(45) }, 86400, null, false, { stale: false, anonRevoked: false });
    expect(msg.text).toContain('PCM-2026-0030');
    expect(msg.text).not.toContain('PCM-2026-0031');
    expect(msg.text).toContain('另外還有 15 筆');
    // 30 筆整 ⇒ 不得出現「另外還有」
    const exact = buildAnomalyAlertMessage({ ...ZERO, openCount: 30, openDisplayIds: displayIds(30) }, 86400, null, false, { stale: false, anonRevoked: false });
    expect(exact.text).not.toContain('另外還有');
  });

  it('🔴 差額用【實際列出的數量】算,不是寫死 30 —— SQL 端 LIMIT 100 會讓陣列比計數短', () => {
    // 🔴 **陣列必須比 30【短】,這一格才有判別力**(關卡2 nit 抓的):
    //    我原本用 `count=200 / ids=100` ⇒ 列 30、差額 170 —— 而寫死成 `count - 30` **也是 170**
    //    ⇒ 兩種實作在那個輸入下**印一樣的東西**,那格證明不了它宣稱的事。
    //    改成 `ids=10` ⇒ 正確實作 190、寫死 30 的實作 170 ⇒ **兩個世界印不同的東西。**
    const msg = buildAnomalyAlertMessage({ ...ZERO, openCount: 200, openDisplayIds: displayIds(10) }, 86400, null, false, { stale: false, anonRevoked: false });
    expect(msg.text).toContain('另外還有 190 筆');
    expect(msg.text).not.toContain('另外還有 170 筆');
  });

  // 🔴🔴 R3(W6)抓的:skew 的**另一個方向** —— 我原本只分析了「單號比計數少」那一半。
  it('🔴 `ids` 比 `count` **多**(兩次查詢之間新出現的列)⇒ 只列到 count 為止,信不得自相矛盾', () => {
    const msg = buildAnomalyAlertMessage(
      { ...ZERO, openCount: 1, openDisplayIds: ['PCM-2026-0001', 'PCM-2026-0002', 'PCM-2026-0003'] },
      86400,
      null,
    false,
    { stale: false, anonRevoked: false },
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
      null,
    false,
    { stale: false, anonRevoked: false },
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
      null,
    false,
    { stale: false, anonRevoked: false },
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
      null,
    false,
    { stale: false, anonRevoked: false },
  );
    expect(msg.subject.length + msg.text.length).toBeLessThan(5000);
    // 🔴 2026-08-21 codex R2 nit4:上面那格算的是 `subject + text`,而 **LINE 實際收到的不是這個**。
    //    `LineAlertNotifierAdapter` 送的是 `${subject}\n\n${text}\n\n${CHANNEL_MARK}`
    //    ⇒ 少算了兩組分隔符與那行管道標記。
    //    ⚠️ 而那個缺口是【本片自己造出來的】—— 標記是 2026-08-21 才加的,
    //       而長度守門停在標記出現之前的形狀。**加東西進 payload 的人要順手看一眼量它的那把尺。**
    //    ⚠️ 這裡複製了 adapter 的組裝形狀(耦合):adapter 若改組裝方式,這一格要跟著改。
    //       沒有更好的位置 —— 真正的組裝在 adapter,而【產生最大訊息的是這裡】。
    const LINE_MARK = '(這封是從 LINE 送出的)';
    const linePayload = `${msg.subject}\n\n${msg.text}\n\n${LINE_MARK}`;
    expect(linePayload.length).toBeLessThanOrEqual(5000);
    expect(msg.text).toContain('上面只列出一部分');
    // 🔴🔴 **這三格是 R3 抓出來補的,而它們才是這一格真正要守的東西。**
    //    原本只斷言「截斷發生了」⇒ 那格會通過,而它產出的是一封
    //    **沒有警語、沒有網址、只剩一長串單號**的信 —— 因為舊寫法從尾端 pop,而尾端就是它們。
    //    ⇒ 🔴 那正是「每一格都在守實作細節,而沒有一格在守【這封信作為一封信還完不完整】」。
    // 🔴 2026-08-21 codex R3 MF-5:字面由「先查清楚再【退款】」改成「再【動錢】」,
    //    而**承重的那一句換人了** —— 現在擋著誤動錢的是下面那句「請不要自己去 TapPay 後台退款」。
    //    ⇒ 所以兩句都釘,而不是只把舊字面換成新字面。
    expect(msg.text).toContain('先查清楚再動錢');
    expect(msg.text).toContain('請【不要】自己去 TapPay 後台退款');
    // 🔴🔴 **順序也要釘**(2026-08-21 主視窗裁):「只是可能」那句必須出現在
    //    「不要自己去 TapPay 退款」【之前】—— 放結尾等於沒有,收信人讀到那行時還沒讀到它。
    //    而當天查出那封信舉的兩筆(2SQH2P/GVRDMH)payment_status=unpaid、從來沒刷成功
    //    ⇒ **那封信是在叫人去退一筆從來沒收到過的錢**,而唯一擋住它的就是這一句。
    //    ⚠️ 只用 toContain 釘不住位置 —— 有人把它移回結尾,那格照樣綠。
    expect(msg.text.indexOf('只是「可能」')).toBeGreaterThanOrEqual(0);
    expect(msg.text.indexOf('只是「可能」')).toBeLessThan(
      msg.text.indexOf('請【不要】自己去 TapPay 後台退款'),
    );
    // 🔴 2026-08-21 新增:上一版文案叫人「決定要退款還是標記免處理」,而**後台那兩個動作都做不到**
    //    ⇒ 改成明說沒有按鈕。而那句與警語同屬 footer,**同樣不可被截掉** ——
    //    少了它,收信人會回去後台找一顆不存在的按鈕,而那正是這次要修掉的事。
    // ⚠️ 2026-08-21 codex R2 MF-2:字面由「沒有…按鈕(不能退款)」改成「還沒有…功能(還沒做)」——
    //    理由是「做不到」會被讀成【系統故障】,而事實是【功能還沒做】。**那是兩件事。**
    // 🔴 這次改斷言字面是【跟著一個 must-fix 走】,不是為了讓紅的變綠 ——
    //    對照:同日稍早我把警語從『再退款』改成『再動錢』導致兩格紅,那次的正確處置是
    //    **把文案改回去**,不是改斷言。**判準是:字面為什麼變 —— 有人要求 vs 我想改。**
    // ⚠️ 2026-08-21 codex R3 MF-4:「還沒做」會被讀成【整套功能不存在】,
    //    而真相是混合的(有的功能在而這類單不符、有的被旗標擋、「標記免處理」真的不存在)
    //    ⇒ 文案改成只講他需要知道的:**這幾筆在後台動不了,而後台沒有壞**。
    // 🔴🔴 2026-08-21 角度①(告警信線)+ **Sean 拍板「甲」**:上一行的字面被換掉了,而理由要寫滿 ——
    //    上一版斷言的是「這幾筆單目前在後台【不能操作】」,而那句話**對五分之三的分類是假的**:
    //      「同一位客人、同樣金額買了兩次」那一組 `o1/o2 payment_status` 皆 `'paid'`
    //      (`20260819130000_m3_s2…display_ids.sql:189`/`:190`),而
    //      `REFUND_ENTRY_STATUSES = ['paid','partiallyRefunded']`(`refund-entry-gate.ts`)
    //      ⇒ 那一類的退款入口【會渲染】,而信叫他不要去找按鈕。
    //    ⇒ 🔴 **這一次改斷言字面,判準與上面那幾條同一把尺:字面為什麼變 —— 有人要求 vs 我想改。**
    //      這次是【有人要求】:Sean 2026-08-21 對這條 must-fix 逐字答「甲」。
    //      (負對照仍然成立:同日我把警語改成「再動錢」導致兩格紅,那次的正確處置是改回文案。)
    // 🔴 而新的兩格**不是換一句話釘住**,是釘住那個【性質】:
    //    ① 新句在場 ② 那句被證偽的全稱句**不得再出現** —— 沒有②,下一個人把它加回來不會紅。
    // 🔴 「後台沒有壞」**不再在這一格斷言** —— 它已經搬進 ③④ 那兩類自己的註腳裡,
    //    而這個 fixture 是【只有 ①】的截斷案例 ⇒ 那句話在這裡本來就不該出現。
    //    ⇒ 它的守門在下面那個逐類 describe;硬留在這裡只會逼人把它寫回成全稱句。
    // 🔴 這兩格擋的是【那兩版被證偽的全稱句】復活。射程:只擋逐字復活,擋不住換句同義的全稱句
    //    (codex R2 nit,我不加聰明 —— 真正有判別力的是下面那個 describe 的逐類斷言)。
    expect(msg.text).not.toContain('這幾筆單目前在後台【不能操作】');
    expect(msg.text).not.toContain('不要在後台找按鈕');
    // 🔴 2026-08-21 窗 C 複驗:上一版信裡「不能退款」與「先查清楚再退款」隔兩行互相矛盾,
    //    而「在 TapPay 後台可以退」那個解答只寫在 code 註解裡 —— 而 Sean 讀的是信。
    //    ⇒ 這一格釘住那個解答【在信裡】,而且與警語同屬 footer ⇒ 同樣不可被截掉。
    // 🔴 codex R3 MF-5 之後,這裡釘的不再是「去哪裡退」,而是**先回報再處理的順序**——
    //    前一版那句是一條【他可以自己走完的捷徑】,而走完會讓錢出去而系統不知道。
    // 🔴 codex R4 MF-3:「先回報」那句被拿掉了 —— **它承諾了一個不存在的接收端**
    //    (告警收件人、唯一操作者、客服三管道 = 同一個人;站上零工單 API)。
    //    ⇒ 承重的那一句換成【他一個人做得完、不需要任何人回應】的動作。
    expect(msg.text).toContain('把單號記下來,等這筆的處理方式確認過再動');
    expect(msg.text).toContain('https://admin.pcmmotorsports.com');
    expect(msg.text).toContain('需登入後台');
    // 🔴 正向對照:同樣五類全開但單號是正常長度 ⇒ **不得**被截(否則這格對什麼都回 true)
    const normal = buildAnomalyAlertMessage(
      { ...ZERO, openCount: 30, openDisplayIds: displayIds(30) },
      86400,
      null,
    false,
    { stale: false, anonRevoked: false },
  );
    expect(normal.text).not.toContain('上面只列出一部分');
  });

  it('🔴 信裡帶後台網址,而且要講「需登入」(沒帳號的人點下去會看到登入頁)', () => {
    const msg = buildAnomalyAlertMessage({ ...ZERO, openCount: 1, openDisplayIds: displayIds(1) }, 86400, null, false, { stale: false, anonRevoked: false });
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
      null,
    false,
    { stale: false, anonRevoked: false },
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
      null,
    false,
    { stale: false, anonRevoked: false },
  );
    expect(same.text).toContain('PCM-2026-0104 和上面那一項是同一張單');
    const diff = buildAnomalyAlertMessage(
      {
        ...ZERO,
        attemptManualReviewCount: 1, attemptManualReviewDisplayIds: ['PCM-2026-0104'],
        releasedStuckCount: 1, releasedStuckDisplayIds: ['PCM-2026-0999'],
      },
      86400,
      null,
    false,
    { stale: false, anonRevoked: false },
  );
    expect(diff.text).not.toContain('是同一張單');
    // 只有 ④ 時不得指向一個沒列出來的「上面那一項」
    const only = buildAnomalyAlertMessage(
      { ...ZERO, releasedStuckCount: 1, releasedStuckDisplayIds: ['PCM-2026-0999'] },
      86400,
      null,
    false,
    { stale: false, anonRevoked: false },
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
      null,
    false,
    { stale: false, anonRevoked: false },
  );
    expect(msg.subject).toBe('⚠️ PCM 付款有 1 張單要你看'); // 相加會是 2
  });

  // ── codex R2 折回來的三格 ────────────────────────────────────────────────
  it('🔴🔴 單號被截斷時,標題**不寫張數** —— 否則「100 張單」會和內文的「200 筆」自相矛盾', () => {
    const msg = buildAnomalyAlertMessage({ ...ZERO, openCount: 200, openDisplayIds: displayIds(100) }, 86400, null, false, { stale: false, anonRevoked: false });
    expect(msg.subject).toBe('⚠️ PCM 付款有事要你看');
    expect(msg.text).toContain('200 筆'); // 內文的筆數仍然是真的
    // 正向對照:同一組數字但沒有截斷 ⇒ 標題就要寫得出張數(否則這一格是恆真的)
    const full = buildAnomalyAlertMessage({ ...ZERO, openCount: 3, openDisplayIds: displayIds(3) }, 86400, null, false, { stale: false, anonRevoked: false });
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
      null,
    false,
    { stale: false, anonRevoked: false },
  );
    // 兩個前 100 陣列無交集 ⇒ 舊寫法會把這句整個刪掉
    expect(msg.text).toContain('可能和上面那一項是同一張單');
  });

  it('🔴 門檻不是整點小時時不得四捨五入成小時(5400s = 90 分,不是「2 小時」)', () => {
    const msg = buildAnomalyAlertMessage({ ...ZERO, refundingStuckCount: 1 }, 5400, null, false, { stale: false, anonRevoked: false });
    expect(msg.text).toContain('超過 90 分鐘');
    expect(msg.text).not.toContain('2 小時');
  });

  it('退款卡逾時說「超過 24 小時」而不是「24h」(86400s)', () => {
    const msg = buildAnomalyAlertMessage({ ...ZERO, refundingStuckCount: 1 }, 86400, null, false, { stale: false, anonRevoked: false });
    expect(msg.text).toContain('超過 24 小時');
  });

  it('open 附最舊年齡(排序訊號;259200s → 3 天);null → 不附且不崩', () => {
    const withAge = buildAnomalyAlertMessage({ ...ZERO, openCount: 2, oldestOpenAgeSeconds: 259200 }, 86400, null, false, { stale: false, anonRevoked: false });
    expect(withAge.text).toContain('最久的已經 3 天');
    const noAge = buildAnomalyAlertMessage({ ...ZERO, openCount: 1, oldestOpenAgeSeconds: null }, 86400, null, false, { stale: false, anonRevoked: false });
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
      null,
    false,
    { stale: false, anonRevoked: false },
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
      {
        manualCustomerSearchWindowSeconds: 86400,
        refundingStuckSeconds: 43200,
        pendingDoubleChargeWindowSeconds: 3600,
        pendingDoubleChargeStuckSeconds: 900,
        shippedCutoffIso: '2026-08-31T00:00:00.000Z',
        shippedGraceSeconds: 900,
        // 🔴 刻意【不是 null】—— 見下面那條斷言的成因註解。
        orderCreatedCutoffIso: '2026-08-22T00:00:00.000Z',
          // 🔵 訊號4 持續失敗那一格的門檻也【真的傳下去】(2026-09-01)——
          //   🔴 少了這一格, 一個「在 use-case 裡寫死 null」的實作會全綠,
          //     而那等於【那一格永遠不查】。
          orderCreatedStuckMinutes: 60,
      },
    );
    // 🔵 出貨那兩個參數也要【真的傳下去】(2026-08-31)——
    //   🔴 少了這一格, 一個「在 use-case 裡寫死 null」的實作會讓上面所有格全綠,
    //     而那正好等於「那一段永遠不查」。
    /**
     * 🔴🔴 **這一條原本是【恆真】的, codex 2026-08-31 R1 must-fix 抓到**:
     * ⛔ ~~輸入 `orderCreatedCutoffIso: null`、期望也寫 `null`~~
     *   ⇒ 一個「在 use-case 裡把它寫死成 null、完全忽略呼叫端傳的值」的實作
     *   **照樣會通過**, 因為兩邊都是 null。
     * 📌 **⇒ 一條自稱防寫死的斷言, 它自己的輸入與期望相同時, 什麼都沒防到。**
     *   (今天我才寫了一則 traps 講這個形狀, 而我在同一天的新碼裡犯了它。)
     * ✅ 改成餵一個**不是 null 的具體值**, 期望它逐字出現在第 6 個參數。
     */
    expect(r.getAlertSummary).toHaveBeenCalledWith(
      43200, 3600, 900, '2026-08-31T00:00:00.000Z', 900, '2026-08-22T00:00:00.000Z',
      // 🔵 訊號4 持續失敗那一格的門檻也要【真的透傳】(2026-09-01)
      60,
    );
  });
});

// 型別完整性:AnomalyAlertMessage 供 notifier 用(編譯期即驗)。
const _typecheck: AnomalyAlertMessage = { subject: 's', text: 't' };
void _typecheck;

describe('「後台沒有手可以處理」只掛在它為真的那幾類上(2026-08-21 角度① / Sean「甲」/ codex R2)', () => {
  // 🔴🔴 這個 describe 是 codex R2 逼出來的,而它抓到的是**我第二版仍然在說謊**:
  //    v1 全稱句 → v2 換一句全稱句。**兩版的測試都只驗 footer 那句字面在不在**,
  //    而那種測試對「它對哪幾類為真」**一個字都沒問** ⇒ 兩版都全綠。
  //    ⇒ 現在釘的是【逐類】:該有的類要有、不該有的類**必須沒有**。
  const NOTE = '這一類後台沒有手可以處理';

  const only = (over: Partial<Parameters<typeof buildAnomalyAlertMessage>[0]>) =>
    buildAnomalyAlertMessage({ ...ZERO, ...over }, 86400, null, false, { stale: false, anonRevoked: false }).text;

  it('③ 刷卡卡在中間(SQL 寫死 unpaid、窗 C 實測 0 顆可動按鈕)⇒ 要有', () => {
    const text = only({ attemptManualReviewCount: 1, attemptManualReviewDisplayIds: ['PCM-2026-0003'] });
    expect(text).toContain(NOTE);
    // 🔴 「後台沒有壞」那句保證**必須跟它保證的那件事在同一句裡** ——
    //    它曾經是 footer 上一句獨立的話,而那時它是對五類講的(= 其中三類是假的)。
    expect(text).toContain('後台沒有壞');
  });

  it('④ 訂單付款未成功(同樣 SQL 寫死 unpaid)⇒ 要有', () => {
    expect(
      only({ releasedStuckCount: 1, releasedStuckDisplayIds: ['PCM-2026-0004'] }),
    ).toContain(NOTE);
  });

  it('🔴🔴 ⑤ 同一位客人被扣兩次(SQL 寫死 paid ⇒ 退款入口【會渲染】)⇒ **絕對不可以有**', () => {
    // 🔴 這一格就是 v1 那個最貴的錯誤的回歸守門:客人真的被扣了兩次錢,而信叫他不要去找按鈕。
    expect(
      only({
        pendingDoubleChargeCandidateCount: 1,
        pendingDoubleChargeDisplayIdPairs: [['PCM-2026-0005', 'PCM-2026-0006']],
      }),
    ).not.toContain(NOTE);
  });

  it.each([
    ['① 可能被扣了兩次錢', { openCount: 1, openDisplayIds: ['PCM-2026-0001'] }],
    ['② 退款卡住', { refundingStuckCount: 1, refundingStuckDisplayIds: ['PCM-2026-0002'] }],
  ])('%s —— SQL 對它的 payment_status 沒有述詞 ⇒ 不知道 ⇒ 不宣稱', (_l, over) => {
    expect(only(over)).not.toContain(NOTE);
  });

  it('🔴 混合(③ + ⑤)⇒ 那句話只跟著 ③ 走,而且【就在它那一段底下】', () => {
    // 🔴 這格擋的是「反正整封信有講到就好」——
    //    那句話貼在錯的分類底下,跟貼在 footer 上一樣會讓他對 ⑤ 不去找按鈕。
    const text = only({
      attemptManualReviewCount: 1,
      attemptManualReviewDisplayIds: ['PCM-2026-0003'],
      pendingDoubleChargeCandidateCount: 1,
      pendingDoubleChargeDisplayIdPairs: [['PCM-2026-0005', 'PCM-2026-0006']],
    });
    const lines = text.split('\n');
    const noteAt = lines.findIndex((l) => l.includes(NOTE));
    const attemptAt = lines.findIndex((l) => l.includes('刷卡卡在中間'));
    const pairAt = lines.findIndex((l) => l.includes('同一位客人'));
    // 🔴 **收緊成「就在標題的下一行」**(2026-08-21 `-91` 複核 MF-2)——
    //   前一版寫 `toBeGreaterThan(attemptAt)`,而那在「貼在 30 個單號之後」的世界**照樣綠**
    //   ⇒ 它擋不住這一片真正的失敗情境(他讀到第一個單號就去開後台,而那句還在 31 行之下)。
    // 🔴 `+2` 而不是 `+1` —— 2026-08-21 Sean 那句進來之後,③ 的標題下方變成【兩行】:
    //   +1 = Sean 逐字那句(去查什麼) / +2 = NO_HAND_NOTE(系統沒壞)。順序見 SEAN_3DS_NOTE 檔頭。
    //   ⚠️ 這一格改期望值是**跟著一個新需求走**(他給了新文案),不是為了讓紅的變綠 ——
    //     判準同本檔其他幾處:**字面為什麼變,有人要求 vs 我想改。**
    expect(noteAt).toBe(attemptAt + 2);
    expect(noteAt).toBeLessThan(pairAt); // 仍在 ⑤ 的標題【之前】⇒ 不會被讀成在講 ⑤
    expect(lines.filter((l) => l.includes(NOTE))).toHaveLength(1); // 只出現一次
  });

  it('零異常時整封信不得出現那句話(不然它會在沒有分類的世界裡自己成立)', () => {
    expect(buildAnomalyAlertMessage(ZERO, 86400, null, false, { stale: false, anonRevoked: false }).text).not.toContain(NOTE);
  });
});

describe('④ 的分類名 —— 舊字面不得復活(2026-08-21 Sean 逐字定稿 `訂單付款未成功`)', () => {
  // 🔴 這個 describe 存在的理由是 `-91` 複核抓到的那一格:
  //   舊的 `not.toContain('錢可能還被鎖著')` 住在 releasedStuckCount = 0 的 fixture 裡
  //   ⇒ `section()` 的 `if (count <= 0) return []` 讓那一段根本不會渲染 ⇒ **它永遠綠**。
  //   而 releasedStuckCount ≥ 1 的測試有 11 格,**當時沒有任何一格斷言那句字面不在。**
  //   ⇒ 這裡的 fixture **count = 1**,所以兩個世界真的印不同的東西。
  const withReleased = () =>
    buildAnomalyAlertMessage(
      { ...ZERO, releasedStuckCount: 1, releasedStuckDisplayIds: ['PCM-2026-0004'] },
      86400,
      null,
    false,
    { stale: false, anonRevoked: false },
  ).text;

  it('新字面在(Sean 逐字,不得潤飾)', () => {
    expect(withReleased()).toContain('【訂單付款未成功】1 筆');
  });

  it('🔴 舊字面不得出現 —— 而這一格的 fixture count=1,它是真的會紅的', () => {
    // 這句話是事實錯誤:那一類的 attempt 從來沒有被授權過 ⇒ 卡上沒有額度被鎖。
    // 依據(逐類)寫在 check-anomaly-alerts.ts 的 `訂單付款未成功` 那一行上方。
    expect(withReleased()).not.toContain('錢可能還被鎖著');
    // ⚠️ **這一發刻意比 Sean 推翻的整句【寬】** —— 他推翻的是「付款沒完成,但錢可能還被鎖著」,
    //   而這裡只攔前四個字。⇒ **紅了先看是不是誤傷**:哪天有人合法寫出「付款沒完成」四個字
    //   (別的分類、別的說明),這一格會為了錯的理由紅,而修的人看不出它在守什麼。
    //   留著是因為方向安全(寧可誤傷也不要讓舊名字整句回來),**不是因為它精準**。
    expect(withReleased()).not.toContain('付款沒完成');
  });
});

describe('Sean 逐字那句 —— 只掛 ③,而 ④【不得】沾上它(2026-08-21 主視窗裁定,可逆)', () => {
  // 🔴 這個 describe 守的不是排版,是一個【裁定】:
  //   Sean 那句寫的是「3D 驗證問題」,而 ④ 進得了 `released` 的兩條路**都要求未授權**
  //   ⇒ 根本沒走到 3D ⇒ 套上去 = 替他造一句他沒說過、而且是假的話。
  // 🔴 而裁定最容易被下一個人「**順手統一**」掉 —— 統一看起來像整理,不像改變決定。
  //   ⇒ 所以要有一發能表演「誤套到 ④」那個世界。
  const SEAN = '訂單刷卡失敗未收款，請檢查是否是網站3D驗證問題。'; // 全形逗號,逐字

  const only3 = () =>
    buildAnomalyAlertMessage(
      { ...ZERO, attemptManualReviewCount: 1, attemptManualReviewDisplayIds: ['PCM-2026-0003'] },
      86400,
      null,
    false,
    { stale: false, anonRevoked: false },
  ).text;
  // 🔴 fixture 要讓 ④ **真的渲染**(count ≥ 1)—— 不能用 count=0 那種世界,
  //   否則 not.toContain 又變成「斷言一個不會被渲染的東西不在」= 沒有判別力(本檔上面那一課)。
  const only4 = () =>
    buildAnomalyAlertMessage(
      { ...ZERO, releasedStuckCount: 1, releasedStuckDisplayIds: ['PCM-2026-0004'] },
      86400,
      null,
    false,
    { stale: false, anonRevoked: false },
  ).text;

  it('③ 必須含 Sean 那句【逐字】—— 改掉任何一個字都要紅', () => {
    expect(only3()).toContain(SEAN);
  });

  it('③ Sean 那句在【標題正下方第一行】,「沒有按鈕」緊接在後', () => {
    const lines = only3().split('\n');
    const head = lines.findIndex((l) => l.includes('刷卡卡在中間'));
    expect(lines[head + 1]).toContain(SEAN); // 他讀第一行就知道要去查什麼
    expect(lines[head + 2]).toContain('這一類後台沒有手可以處理');
  });

  it('🔴🔴 ④ 的訊息【不得】含「3D驗證」—— 這一格守的是那個裁定,不是文案', () => {
    const text = only4();
    expect(text).toContain('【訂單付款未成功】1 筆'); // 先證明 ④ 真的被渲染了(不然下一行沒有判別力)
    expect(text).not.toContain('3D驗證');
    expect(text).not.toContain(SEAN);
    expect(text).toContain('這一類後台沒有手可以處理'); // 而 NO_HAND_NOTE 仍在
  });
});

/**
 * F-004 · 客人的退款卡住 —— 這一類**以前從來沒有進過這封信**(分母讀的是雙扣表)。
 *
 * 🔴 這一組每一格都成對:一發該綠、一發該紅,而且**兩發都要走得到**。
 *    codex 關卡1 R2 抓到我第一版把「該紅那發」寫成了**不可達分支**
 *    (key=0 且其餘全 0 ⇒ `shouldAlert=false` ⇒ 根本沒有訊息可以驗,而那一格會是綠的)。
 *    ⇒ 所有「訊息內容」的格子一律讓**另一個計數非零**,確保信真的寄得出來。
 */
describe('F-004 退款卡住:計數、過夜拆分、與部署窗口', () => {
  const OTHER_NONZERO = { ...ZERO, openCount: 1, openDisplayIds: ['PCM-2026-0001'] };

  it('計數 > 0 → 會寄信(它自己就踩得到門檻,不用靠別類)', async () => {
    const n = okNotifier();
    const res = await checkAnomalyAlerts(
      { reader: reader({ ...ZERO, orderRefundsStuckCount: 2 }), notifiers: [n] },
      OPTS,
    );
    expect(res.alerted).toBe(true);
    expect(n.notify).toHaveBeenCalledTimes(1);
  });

  it('🔴🔴 三個退款計數【出得來】—— 突變殺出來的三格,不是想出來的', async () => {
    /**
     * 🔴 **成因(線出貨 `-1e` 2026-08-31,與出貨那四格同一個形狀)**:
     * 把 `check-anomaly-alerts.ts` 這三行 pass-through 各自寫死成 `0`,**逐格重跑**:
     * ```
     * pendingDoubleChargeCandidateCount ⇒ rc=1  ✅ 本來就殺得掉
     * orderRefundsStuckCount            ⇒ rc=0  🔴 突變活著
     * orderRefundsStuckOvernightCount   ⇒ rc=0  🔴 突變活著
     * orderRefundsManualFailedCount     ⇒ rc=0  🔴 突變活著
     * ```
     * ⚠️ **而【四格一起突變】那一發是 rc=1** ⇒ 只跑那一發會判成「有守住」。
     *   📌 **一發混合突變只證明【至少一格】被守住,不證明每一格。**
     * 🛑 而更刺的一格:我先用 `grep 'res\.<欄位>'` 數斷言,`pendingDoubleChargeCandidateCount`
     *   數出來 **0 命中** —— 而它的突變**殺得掉**。
     *   ⇒ 📌 **數字面會少報覆蓋率;突變才是實物。兩把尺方向相反,不要互相追認。**
     * ⚠️ 上面那兩格既有測試看的是 `res.alerted`(門檻行為),**而不是那三個數字有沒有出得來** ——
     *   一個把它們寫死成 0 的實作,會讓 route 的 counts log 與告警內文**全部印 0**,而 `alerted` 照樣對。
     */
    const n = okNotifier();
    const res = await checkAnomalyAlerts(
      {
        reader: reader({
          ...ZERO,
          orderRefundsStuckCount: 2,
          orderRefundsStuckOvernightCount: 3,
          orderRefundsManualFailedCount: 4,
        }),
        notifiers: [n],
      },
      OPTS,
    );
    expect(res.orderRefundsStuckCount).toBe(2);
    expect(res.orderRefundsStuckOvernightCount).toBe(3);
    expect(res.orderRefundsManualFailedCount).toBe(4);
  });

  it('🔴 對照:計數 = 0 且其餘全零 → 不寄信(證明上一格是這個欄位造成的)', async () => {
    const n = okNotifier();
    const res = await checkAnomalyAlerts(
      { reader: reader({ ...ZERO, orderRefundsStuckCount: 0 }), notifiers: [n] },
      OPTS,
    );
    expect(res.alerted).toBe(false);
    expect(n.notify).not.toHaveBeenCalled();
  });

  it('訊息含這一類的白話標題與筆數(不含資料表技術名)', () => {
    const msg = buildAnomalyAlertMessage(
      { ...OTHER_NONZERO, orderRefundsStuckCount: 3 },
      OPTS.refundingStuckSeconds,
      null,
    false,
    { stale: false, anonRevoked: false },
  );
    // 🔴 斷言【整行】,不是裸數字 —— 同一封信裡「24 小時」等處也有數字,
    //    `toContain('3')` 在功能壞掉時照樣可能綠。
    expect(msg.text).toContain('【客人的退款卡住,還沒退成功】3 筆');
    // 🔴 這封信是給 Sean 看的,不得出現資料表名(codex R1 N8)。
    expect(msg.text).not.toContain('order_refunds');
  });

  it('🔴 過夜是【分開列】不是把剛卡住的藏起來:總數與過夜數同時出現', () => {
    const msg = buildAnomalyAlertMessage(
      { ...OTHER_NONZERO, orderRefundsStuckCount: 5, orderRefundsStuckOvernightCount: 2 },
      OPTS.refundingStuckSeconds,
      null,
    false,
    { stale: false, anonRevoked: false },
  );
    expect(msg.text).toContain('5');
    expect(msg.text).toContain('其中 2 筆已經卡超過一天');
  });

  it('🔴 對照:過夜數 = 0 → 不出現「其中 N 筆」那一行(而總數照出)', () => {
    const msg = buildAnomalyAlertMessage(
      { ...OTHER_NONZERO, orderRefundsStuckCount: 5, orderRefundsStuckOvernightCount: 0 },
      OPTS.refundingStuckSeconds,
      null,
    false,
    { stale: false, anonRevoked: false },
  );
    expect(msg.text).toContain('客人的退款卡住');
    expect(msg.text).not.toContain('已經卡超過一天');
  });

  it('文案不逐筆承諾可以處理、也不承諾筆數會變少', () => {
    const msg = buildAnomalyAlertMessage(
      { ...OTHER_NONZERO, orderRefundsStuckCount: 1 },
      OPTS.refundingStuckSeconds,
      null,
    false,
    { stale: false, anonRevoked: false },
  );
    // ① 有些筆點進去沒有按鈕(判定落在 record_shape_bad / evidence_contradiction)
    expect(msg.text).toContain('有幾筆可能還按不了');
    // ② 不承諾筆數會變少 —— 否則下一封信數字沒降,他會以為系統壞了
    expect(msg.text).toContain('每天都會再出現一次');
  });

  it('🔴 部署窗口:查不到 ≠ 0 筆 —— 兩個世界的文案必須不同', () => {
    const unknown = buildAnomalyAlertMessage(
      { ...OTHER_NONZERO, orderRefundsStuckCount: null, orderRefundsStuckOvernightCount: null, orderRefundsStuckUnknown: true },
      OPTS.refundingStuckSeconds,
      null,
    false,
    { stale: false, anonRevoked: false },
  );
    const zero = buildAnomalyAlertMessage(
      { ...OTHER_NONZERO, orderRefundsStuckCount: 0 },
      OPTS.refundingStuckSeconds,
      null,
    false,
    { stale: false, anonRevoked: false },
  );
    expect(unknown.text).toContain('今天查不到');
    expect(zero.text).not.toContain('今天查不到');
    // 🔴 兩發都寄得出信(OTHER_NONZERO 讓 shouldAlert 成立)⇒ 差別只在那一行在不在。
    expect(unknown.text).not.toBe(zero.text);
  });

  it('🔴 unknown 自己【不】觸發寄信 —— 部署問題走 route 503,不是每天寄信給老闆', async () => {
    const n = okNotifier();
    const res = await checkAnomalyAlerts(
      {
        reader: reader({
          ...ZERO,
          orderRefundsStuckCount: null,
          orderRefundsStuckOvernightCount: null,
          orderRefundsStuckUnknown: true,
        }),
        notifiers: [n],
      },
      OPTS,
    );
    expect(res.alerted).toBe(false);
    expect(n.notify).not.toHaveBeenCalled();
    // 而它必須在結果裡看得見,否則 route 沒有東西可以據以回 503。
    expect(res.orderRefundsStuckUnknown).toBe(true);
  });
});

/**
 * F-004 折 code-reviewer 的兩條 must-fix。**兩條都會改到寄到 Sean 手機上的那封信的字面。**
 */
describe('F-004 · 主旨張數 與 「只是可能」的射程', () => {
  const ONE_OPEN = { ...ZERO, openCount: 1, openDisplayIds: ['PCM-2026-0001'] };

  it('🔴 有退款卡住那一類時,主旨【不寫張數】(那一類永遠沒有單號 = 整個拿不到)', () => {
    const msg = buildAnomalyAlertMessage(
      { ...ONE_OPEN, orderRefundsStuckCount: 4 },
      OPTS.refundingStuckSeconds,
      null,
    false,
    { stale: false, anonRevoked: false },
  );
    // 實測過的壞法:主旨會印「有 1 張單要你看」,而內文是 1 筆 + 4 筆
    // ⇒ 本檔自己寫著「一個錯的數字會讓他以為事情比較小」。
    expect(msg.subject).not.toContain('1 張單');
    expect(msg.subject).toBe('⚠️ PCM 付款有事要你看');
  });

  it('🔴 對照:退款卡住 0 筆時,主旨【照常寫張數】(證明上一格是這個欄位造成的)', () => {
    const msg = buildAnomalyAlertMessage(
      { ...ONE_OPEN, orderRefundsStuckCount: 0 },
      OPTS.refundingStuckSeconds,
      null,
    false,
    { stale: false, anonRevoked: false },
  );
    expect(msg.subject).toContain('1 張單');
  });

  it('🔴 unknown 時主旨也不寫張數(那一類是「查不到」,更不該替它報數字)', () => {
    const msg = buildAnomalyAlertMessage(
      {
        ...ONE_OPEN,
        orderRefundsStuckCount: null,
        orderRefundsStuckOvernightCount: null,
        orderRefundsStuckUnknown: true,
      },
      OPTS.refundingStuckSeconds,
      null,
    false,
    { stale: false, anonRevoked: false },
  );
    expect(msg.subject).not.toContain('1 張單');
  });

  it('🔴 有退款卡住那一類時,補上「那一類是已經確定的」—— 因為「每一筆都只是可能」對它是假的', () => {
    const msg = buildAnomalyAlertMessage(
      { ...ONE_OPEN, orderRefundsStuckCount: 2 },
      OPTS.refundingStuckSeconds,
      null,
    false,
    { stale: false, anonRevoked: false },
  );
    // Sean 拍板的那句字面不動(它有兩格測試釘著,含順序那格)
    expect(msg.text).toContain('上面每一筆都只是「可能」,不是已經確定');
    // 而範圍那句要跟在它後面
    expect(msg.text).toContain('是已經確定卡住的,不是「可能」');
    expect(msg.text.indexOf('只是「可能」')).toBeLessThan(msg.text.indexOf('是已經確定卡住的'));
  });

  it('🔴 對照:退款卡住 0 筆時,不加那句範圍話(不替一封沒有那類的信加無所指的話)', () => {
    const msg = buildAnomalyAlertMessage(
      { ...ONE_OPEN, orderRefundsStuckCount: 0 },
      OPTS.refundingStuckSeconds,
      null,
    false,
    { stale: false, anonRevoked: false },
  );
    expect(msg.text).toContain('上面每一筆都只是「可能」,不是已經確定');
    expect(msg.text).not.toContain('是已經確定卡住的');
  });

  it('過夜數大於總數(理論上走不到)也不會印出矛盾的兩個數字', () => {
    const msg = buildAnomalyAlertMessage(
      { ...ONE_OPEN, orderRefundsStuckCount: 1, orderRefundsStuckOvernightCount: 5 },
      OPTS.refundingStuckSeconds,
      null,
    false,
    { stale: false, anonRevoked: false },
  );
    expect(msg.text).toContain('其中 1 筆已經卡超過一天');
    expect(msg.text).not.toContain('其中 5 筆');
  });
});

/**
 * F-004 · Sean 2026-08-24 拍甲:②終態半**不列進清單**,只在信尾寫一行。
 * 主視窗轉貼他的原句:「① 退款告警信要不要列『已判定失敗、按不了任何按鈕』的那幾筆 / 甲(推薦)」
 */
describe('F-004 · ②終態半只出現在信尾那一行', () => {
  const ONE_OPEN = { ...ZERO, openCount: 1, openDisplayIds: ['PCM-2026-0001'] };

  it('🔴 有終態半 ⇒ 信尾出現「另有 N 筆已判定失敗,不需要你動作」', () => {
    const msg = buildAnomalyAlertMessage(
      { ...ONE_OPEN, orderRefundsManualFailedCount: 4 },
      OPTS.refundingStuckSeconds,
      null,
    false,
    { stale: false, anonRevoked: false },
  );
    expect(msg.text).toContain('另有 4 筆已判定失敗,不需要你動作');
  });

  it('🔴 對照:終態半 = 0 ⇒ 那一行不出現', () => {
    const msg = buildAnomalyAlertMessage(
      { ...ONE_OPEN, orderRefundsManualFailedCount: 0 },
      OPTS.refundingStuckSeconds,
      null,
    false,
    { stale: false, anonRevoked: false },
  );
    expect(msg.text).not.toContain('已判定失敗,不需要你動作');
  });

  it('🔴 N 是動態值,不是寫死的 4', () => {
    const msg = buildAnomalyAlertMessage(
      { ...ONE_OPEN, orderRefundsManualFailedCount: 7 },
      OPTS.refundingStuckSeconds,
      null,
    false,
    { stale: false, anonRevoked: false },
  );
    expect(msg.text).toContain('另有 7 筆');
    expect(msg.text).not.toContain('另有 4 筆');
  });

  it('🔴🔴 終態半【不觸發寄信】—— 它是終態、永遠不會消失,進了閘就是每天叫一次做不到的事', async () => {
    const n = okNotifier();
    const res = await checkAnomalyAlerts(
      { reader: reader({ ...ZERO, orderRefundsManualFailedCount: 4 }), notifiers: [n] },
      OPTS,
    );
    expect(res.alerted).toBe(false);
    expect(n.notify).not.toHaveBeenCalled();
  });

  it('它不進主旨的張數計算,也不讓主旨變成「不寫數字」那條路', () => {
    const msg = buildAnomalyAlertMessage(
      { ...ONE_OPEN, orderRefundsManualFailedCount: 4 },
      OPTS.refundingStuckSeconds,
      null,
    false,
    { stale: false, anonRevoked: false },
  );
    // 只有①可處理半(永遠沒單號)才讓主旨不寫數字;②終態半只是信尾一行。
    expect(msg.subject).toContain('1 張單');
  });
});

// ─────────────────────────────────────────────────────────────
// 🔴 M-4a:寄信這條線壞掉,要有人被通知(Sean 2026-08-29 拍 `Q-EMAIL-ALERT` = 甲)
//
// **在這幾格之前發生的事**:額度爆掉 ⇒ 每封信失敗,而 sweeper 回報「這一輪成功」
// ⇒ 心跳前進 ⇒ **一封信都沒寄出去,而所有監控都說正常。**
// 那一半已修(`97864730`)—— **而【會主動叫的那一格】直到本片才有。**
describe('🔴 寄信五格:叫得出來,而且說對是哪一件事', () => {
  const withEmail = (over: Partial<AnomalyAlertSummary>): AnomalyAlertSummary => ({
    ...ZERO,
    ...over,
  });

  it('[E1] 只有寄信異常 ⇒ 會叫,而且主旨【不能】說是付款的事', async () => {
    const notifier = { notify: vi.fn().mockResolvedValue(undefined) };
    const res = await checkAnomalyAlerts({
      reader: {
        getAlertSummary: async () => withEmail({ emailDeadLetterCount: 3 }),
        getSearchLogHealth: async () => null,
        getManualCustomerSearchSummary: async () => null,
      },
      notifiers: [notifier],
    }, OPTS);
    // 🔴 怎麼會紅:把那五格從 shouldAlert 拿掉 ⇒ alerted 變 false。
    expect(res.alerted, '只有寄信異常時它不叫 ⇒ 那正是本片要修的那個沉默').toBe(true);
    const msg = notifier.notify.mock.calls[0]![0] as { subject: string; text: string };
    // 🔴 怎麼會紅:主旨不分三個世界 ⇒ 這裡會拿到「PCM 付款有事要你看」。
    //    📌 一個內容正確而標題錯誤的告警，比不叫更糟 —— 它把人送去錯的地方。
    expect(msg.subject, '一封只有寄信異常的信，卻用付款的主旨').toContain('寄信');
    expect(msg.subject).not.toContain('付款有');
    expect(msg.text).toContain('永遠不會再寄');
    // 🔴 而信裡要明講「不用去動訂單」—— footer 原本就是叫人去看訂單的。
    expect(msg.text).toContain('不用去後台退款或改單');
  });

  it('[E2] 🔴 確診與疑似用【不同的字】—— 把未知報成確診會把人送去買方案', async () => {
    const notifier = { notify: vi.fn().mockResolvedValue(undefined) };
    await checkAnomalyAlerts({
      reader: {
        getAlertSummary: async () => withEmail({ emailQuotaSuspectedCount: 7 }),
        getSearchLogHealth: async () => null,
        getManualCustomerSearchSummary: async () => null,
      },
      notifiers: [notifier],
    }, OPTS);
    const body = (notifier.notify.mock.calls[0]![0] as { text: string }).text;
    // 🔴 怎麼會紅:把 5-b 併進 5-a 的文案 ⇒ 這裡會出現「確定」。
    //    `http_429` 可能只是瞬時限流 —— 而「額度用盡、請升級」是一個【確診】。
    expect(body).toContain('可能是額度');
    expect(body).not.toContain('撞到寄信額度上限(確定)');
  });

  it('[E3] 🔴 負對照:五格都是 0 ⇒ 不叫(它不是恆叫)', async () => {
    const notifier = { notify: vi.fn().mockResolvedValue(undefined) };
    const res = await checkAnomalyAlerts({
      reader: {
        getAlertSummary: async () => ZERO,
        getSearchLogHealth: async () => null,
        getManualCustomerSearchSummary: async () => null,
      },
      notifiers: [notifier],
    }, OPTS);
    // 🔴 沒有這一格,一個「永遠 alerted」的實作也會讓上面兩格全綠。
    expect(res.alerted).toBe(false);
    expect(notifier.notify).not.toHaveBeenCalled();
  });

  // ══ 🔵🔵 分母那一格(2026-08-31;Sean 逐字答 `3 甲`;板上錨 ⟦b4-EMAILTOTAL⟧)══
  //   五個 count 全部 `FROM public.email_outbox` ⇒ 只數【已經存在的列】
  //   ⇒ 「一切正常」與「這張表是空的 / 讀不到資料」印同一組 0。
  //   🔴 而【只把分母接進來、不改告警閘】是不夠的:閘是「任一 > 0 才叫」
  //     ⇒ 五格全 0 ⇒ 一封信都不會發 ⇒ **那個分母在它要防的世界裡沒有人看得到。**
  it('[E3a] 🔴🔴 五格全 0 【而且】分母也 0 ⇒ 要叫,而訊息不得猜是哪一種', async () => {
    const notifier = { notify: vi.fn().mockResolvedValue(undefined) };
    const res = await checkAnomalyAlerts({
      reader: {
        getAlertSummary: async () => withEmail({ emailOutboxTotalCount: 0 }),
        getSearchLogHealth: async () => null,
        getManualCustomerSearchSummary: async () => null,
      },
      notifiers: [notifier],
    }, OPTS);
    expect(res.alerted).toBe(true);
    const body = (notifier.notify.mock.calls[0]![0] as { text: string }).text;
    expect(body).toContain('一列都沒有');
    // 🔴 文案刻意寫兩種可能 —— 這一格底下【分不出來】是空表還是讀不到,
    //   而寫死其中一個會把人送去修錯的東西。
    expect(body).toContain('可能是這張表是空的');
    expect(body).toContain('也可能是讀不到資料');
  });

  it('[E3b] 🔴 負對照一:五格全 0 而【分母 > 0】⇒ 不叫(那是真的一切正常)', async () => {
    const notifier = { notify: vi.fn().mockResolvedValue(undefined) };
    const res = await checkAnomalyAlerts({
      reader: {
        getAlertSummary: async () => withEmail({ emailOutboxTotalCount: 12 }),
        getSearchLogHealth: async () => null,
        getManualCustomerSearchSummary: async () => null,
      },
      notifiers: [notifier],
    }, OPTS);
    // 🔴 沒有這一格,一個【把分母恆判成 0】的實作會天天叫,而上面那一格照樣綠。
    expect(res.alerted).toBe(false);
    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it('[E3c] 🔴 負對照二:有一格 > 0 而分母 > 0 ⇒ 照舊叫,而訊息【不得】出現那一句', async () => {
    const notifier = { notify: vi.fn().mockResolvedValue(undefined) };
    await checkAnomalyAlerts({
      reader: {
        getAlertSummary: async () =>
          withEmail({ emailDeadLetterCount: 3, emailOutboxTotalCount: 12 }),
        getSearchLogHealth: async () => null,
        getManualCustomerSearchSummary: async () => null,
      },
      notifiers: [notifier],
    }, OPTS);
    const body = (notifier.notify.mock.calls[0]![0] as { text: string }).text;
    expect(body).toContain('永遠不會再寄');
    // 🔴 那一句只屬於【什麼都沒有】那個世界;混進來會讓人以為表也空了。
    expect(body).not.toContain('一列都沒有');
  });

  it('[E3d] 🔴🔴 負對照三:讀不到(unknown)而五格與分母都是 null ⇒ 【仍然不叫】', async () => {
    // 🛑 這一格是本片最容易寫壞的地方:`null ?? 0 === 0` ⇒ 讀不到的世界
    //   與「真的全 0」在 `?? 0` 之後【長得一模一樣】。
    //   ⇒ 📌 而那正是本片要防的那個形狀本身 —— 我差一點用它去防它自己。
    const notifier = { notify: vi.fn().mockResolvedValue(undefined) };
    const res = await checkAnomalyAlerts({
      reader: {
        getAlertSummary: async () =>
          withEmail({
            emailOverdueCount: null,
            emailDeadLetterCount: null,
            emailStuckSendingCount: null,
            emailQuotaConfirmedCount: null,
            emailQuotaSuspectedCount: null,
            emailOutboxTotalCount: null,
            emailOutboxUnknown: true,
          }),
        getSearchLogHealth: async () => null,
        getManualCustomerSearchSummary: async () => null,
      },
      notifiers: [notifier],
    }, OPTS);
    expect(res.alerted).toBe(false);
    expect(notifier.notify).not.toHaveBeenCalled();
  });

  // ══ 🔵🔵 出貨信缺口(2026-08-31;Sean 逐字答 `2 甲`:「大於 0 就叫」)══
  it('[E5a] 🔴 貨出了而通知信沒被排進佇列 ⇒ 要叫,而用【與寄不出去不同的字】', async () => {
    const notifier = { notify: vi.fn().mockResolvedValue(undefined) };
    const res = await checkAnomalyAlerts({
      reader: {
        getAlertSummary: async () => withEmail({ shippedNeverEnqueuedCount: 3 }),
        getSearchLogHealth: async () => null,
        getManualCustomerSearchSummary: async () => null,
      },
      notifiers: [notifier],
    }, OPTS);
    expect(res.alerted).toBe(true);
    const body = (notifier.notify.mock.calls[0]![0] as { text: string }).text;
    expect(body).toContain('根本沒被排進佇列');
    // 🔴 它與「兩個信箱都是空的」是【兩種病】—— 併起來 = 用一種原因的文案報另一種原因。
    expect(body).not.toContain('兩個信箱都是空的');
  });

  it('[E5b] 🔴 兩個信箱都空 ⇒ 也要叫,而【那不是系統壞掉】,字要不一樣', async () => {
    const notifier = { notify: vi.fn().mockResolvedValue(undefined) };
    const res = await checkAnomalyAlerts({
      reader: {
        getAlertSummary: async () => withEmail({ shippedUnsendableCount: 2 }),
        getSearchLogHealth: async () => null,
        getManualCustomerSearchSummary: async () => null,
      },
      notifiers: [notifier],
    }, OPTS);
    expect(res.alerted).toBe(true);
    const body = (notifier.notify.mock.calls[0]![0] as { text: string }).text;
    expect(body).toContain('兩個信箱都是空的');
    expect(body).not.toContain('根本沒被排進佇列');
  });

  it('[E5c] 🔴 負對照:兩格都是 0 ⇒ 不叫(它不是恆叫)', async () => {
    const notifier = { notify: vi.fn().mockResolvedValue(undefined) };
    const res = await checkAnomalyAlerts({
      reader: {
        getAlertSummary: async () =>
          withEmail({ shippedNeverEnqueuedCount: 0, shippedUnsendableCount: 0 }),
        getSearchLogHealth: async () => null,
        getManualCustomerSearchSummary: async () => null,
      },
      notifiers: [notifier],
    }, OPTS);
    expect(res.alerted).toBe(false);
    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it('[E5d] 🔴🔴 還沒上膛 / 讀不到(unknown ⇒ 三個都是 null)⇒ 【不叫】', async () => {
    // 🛑 這一格與 E4 同一個理由, 而它多防一種成因:
    //   `SHIPPED_EMAIL_CUTOFF` 沒設 ⇒ adapter 根本不呼叫那支 RPC ⇒ 也落 unknown。
    //   ⇒ 而那個狀態【由 route 印在 log 上】, 不變成一封每天寄的信。
    const notifier = { notify: vi.fn().mockResolvedValue(undefined) };
    const res = await checkAnomalyAlerts({
      reader: {
        getAlertSummary: async () =>
          withEmail({
            shippedNeverEnqueuedCount: null,
            shippedUnsendableCount: null,
            shipmentsTotalCount: null,
            shippedGapUnknown: true,
          }),
        getSearchLogHealth: async () => null,
        getManualCustomerSearchSummary: async () => null,
      },
      notifiers: [notifier],
    }, OPTS);
    expect(res.alerted).toBe(false);
    expect(notifier.notify).not.toHaveBeenCalled();
    /**
     * 🔴🔴 **這四條是【突變殺出來的】,不是想出來的**(線出貨 `-1e` 2026-08-31)。
     * 實測:把 `check-anomaly-alerts.ts` 那行 `shippedGapUnknown: summary.shippedGapUnknown`
     * 改成寫死 `false` ⇒ **3 支測試檔 186 格全過、rc=0**(型別過、語法過、零紅)。
     * ⇒ 📌 而那一行正上方有一段註解逐字寫著「**這一行是本片最重要的一行**」,
     *    並記載作者第一版漏寫它 ⇒ route 讀不到旗標 ⇒ RPC 沒 apply 時整片沉默。
     * 🔴 **⇒ 一段說明它有多重要的註解,不是一個會在它壞掉時變紅的東西。**
     * ⚠️ 為什麼原本抓不到:adapter 的測試測的是 adapter 怎麼【算】這個旗標;
     *    而 route 的測試把 `checkAnomalyAlerts` 整支 mock 掉 ⇒ **真正的 use-case 沒有跑**
     *    ⇒ 中間這一段 pass-through 兩邊都以為對方測了。
     */
    expect(res.shippedGapUnknown).toBe(true);
    expect(res.shippedNeverEnqueuedCount).toBeNull();
    expect(res.shippedUnsendableCount).toBeNull();
    expect(res.shipmentsTotalCount).toBeNull();
  });

  it('[E4] 🔴 讀不到(RPC 尚未 apply)⇒ 【不叫】—— 部署問題走部署管道', async () => {
    const notifier = { notify: vi.fn().mockResolvedValue(undefined) };
    const res = await checkAnomalyAlerts({
      reader: {
        getAlertSummary: async () =>
          withEmail({
            emailOverdueCount: null,
            emailDeadLetterCount: null,
            emailStuckSendingCount: null,
            emailQuotaConfirmedCount: null,
            emailQuotaSuspectedCount: null,
            emailOutboxTotalCount: null,
            emailOutboxUnknown: true,
          }),
        getSearchLogHealth: async () => null,
        getManualCustomerSearchSummary: async () => null,
      },
      notifiers: [notifier],
    }, OPTS);
    // 🔴 怎麼會紅:把 `?? 0` 改成把 unknown 當成有事 ⇒ 這裡 false 變 true。
    //    📌 DB 一直沒 apply ⇒ 每天寄一封「尚未啟用」⇒ 久了變例行雜訊
    //       = 把沉默換成無限重寄，同一個病的另一面（照 orderRefundsStuckUnknown 的成例）。
    expect(res.alerted, 'unknown 進了 shouldAlert ⇒ 部署問題會變成一封每天寄的信').toBe(false);
  });

  it('[E6] 🔴 訊息超長時,寄信那段【不能】是先被截掉的那一段', async () => {
    const notifier = { notify: vi.fn().mockResolvedValue(undefined) };
    // 造一封【真的會超過預算】的信:大量付款單號 + 一段寄信異常。
    // 🔴 **單號【數量】撐不破預算** —— `shownIds` 每類上限 30 ⇒ 200 個只印得出 30 個。
    //    第一版用 200 個短單號 ⇒ 實測整封信 **986 字元**,而預算約 4570 ⇒ **它根本沒截**
    //    ⇒ 那一格是恆真的,而突變(把 emailBlock 移到尾端)**殺不掉它**。
    //    📌 又是「量具沒有對準被測的東西」—— 今晚第二次,而第一次是那個 console 攔截器。
    // ⇒ 改用【很長的單號】把長度撐上去,並且下面加一道**對準檢查**。
    const many = Array.from(
      { length: 200 },
      (_, i) => `PCM-VERY-LONG-DISPLAY-ID-FOR-BUDGET-TEST-${String(i).padStart(6, '0')}-${'X'.repeat(120)}`,
    );
    await checkAnomalyAlerts(
      {
        reader: {
          getAlertSummary: async () =>
            withEmail({
              openCount: many.length,
              openDisplayIds: many,
              emailDeadLetterCount: 5,
            }),
          getSearchLogHealth: async () => null,
          getManualCustomerSearchSummary: async () => null,
        },
        notifiers: [notifier],
      },
      OPTS,
    );
    const text = (notifier.notify.mock.calls[0]![0] as { text: string }).text;
    // 🔴🔴 **對準檢查,排在斷言【之前】** —— 沒有它,這一格會在「訊息其實沒超長」時
    //    安靜地退化成恆真,而**顏色不會變**。(第一版就是那樣,實測 986 字元、根本沒截。)
    expect(text.length, '訊息沒有超過預算 ⇒ 這一格沒有在測截斷,不是「沒被截掉」').toBeGreaterThan(
      3000,
    );
    expect(text, '沒有出現截斷註記 ⇒ 這一發根本沒觸發截斷').toContain('單號太多');
    // 🔴 怎麼會紅:把 emailBlock 從 body 最前面移到最後面 ⇒ 截斷從尾端 pop ⇒ 這裡就沒了。
    //    📌 而【上面那五格全部是短訊息】—— 移到尾端它們照樣全綠,
    //       所以沒有這一格的話,「放最前面」那個決定沒有任何東西守著。
    expect(text, '寄信那段在長訊息裡被截掉了 ⇒ 而那是這封信裡唯一不可逆的事實').toContain(
      '永遠不會再寄',
    );
  });

  it('[E5] 付款與寄信【同時】有事 ⇒ 主旨要說兩件,不能只說一件', async () => {
    const notifier = { notify: vi.fn().mockResolvedValue(undefined) };
    await checkAnomalyAlerts({
      reader: {
        getAlertSummary: async () => withEmail({ openCount: 1, emailDeadLetterCount: 2 }),
        getSearchLogHealth: async () => null,
        getManualCustomerSearchSummary: async () => null,
      },
      notifiers: [notifier],
    }, OPTS);
    const subject = (notifier.notify.mock.calls[0]![0] as { subject: string }).subject;
    // 🔴 怎麼會紅:主旨只判其中一邊 ⇒ 會漏講另一件,而收信人只會去查它講的那件。
    expect(subject).toContain('付款');
    expect(subject).toContain('寄信');
  });
});

/**
 * 🔵 **排程心跳(板 `⟦b4-SWEEPDEAD1⟧` 片3;Sean 2026-08-30 拍 `q4: 甲`)。**
 *
 * 那一列的問題逐字是「**結算程式死了沒人知道**」—— 而在片3 之前,
 * 心跳**只被後台儀表板顯示、從來沒有被告警**:
 *   儀表板 = 有人去看的時候它告訴他;告警 = 沒有人去看的時候它來告訴你。
 * ⇒ 下面這幾格驗的就是「它會來告訴你」這件事。
 */
describe('心跳 → 告警(片3)', () => {
  it('🔴 有 1 支不正常 ⇒ 告警(而其餘全零)', async () => {
    const n = okNotifier();
    const res = await checkAnomalyAlerts(
      { reader: reader({ ...ZERO, cronHeartbeatAbnormalCount: 1, cronHeartbeatAbnormalJobs: ['pcm-settle-sweep'] }), notifiers: [n] },
      OPTS,
    );
    expect(res.alerted).toBe(true);
    expect(n.notify).toHaveBeenCalled();
  });

  it('🟢 0 支不正常 ⇒ 不告警(證明上一格不是恆真)', async () => {
    const n = okNotifier();
    const res = await checkAnomalyAlerts(
      { reader: reader({ ...ZERO, cronHeartbeatAbnormalCount: 0, cronHeartbeatAbnormalJobs: [] }), notifiers: [n] },
      OPTS,
    );
    expect(res.alerted).toBe(false);
  });

  /**
   * 🛑 **`Unknown` 刻意【不】進 `shouldAlert`** —— 照本檔其餘每一條的成例:
   *   部署問題走部署管道, 不變成一封每天寄的信。
   * 🔴 而 `Count: null` 與 `Count: 0` **在這一格底下必須都不叫, 理由卻不同**:
   *   前者是「讀不到」, 後者是「六支都健康」。它們的【下一步】不一樣, 所以型別上分得開。
   */
  it('🛑 讀不到(unknown)⇒ 不告警 —— 部署問題不變成每天一封信', async () => {
    const n = okNotifier();
    const res = await checkAnomalyAlerts(
      { reader: reader({ ...ZERO, cronHeartbeatAbnormalCount: null, cronHeartbeatAbnormalJobs: null, cronHeartbeatUnknown: true }), notifiers: [n] },
      OPTS,
    );
    expect(res.alerted).toBe(false);
  });

  it('🔴 信裡要印出【哪幾支】—— 一個裸數字會逼收信的人自己去後台找', () => {
    const msg = buildAnomalyAlertMessage(
      { ...ZERO, cronHeartbeatAbnormalCount: 2, cronHeartbeatAbnormalJobs: ['pcm-email-sweep', 'pcm-settle-sweep'] },
      86400,
      null,
    false,
    { stale: false, anonRevoked: false },
  );
    expect(msg.text).toContain('pcm-email-sweep');
    expect(msg.text).toContain('pcm-settle-sweep');
    expect(msg.text).toContain('2 支');
  });

  it('🟢 沒有不正常時, 信裡【不得】出現那一塊(否則它每天都在)', () => {
    const msg = buildAnomalyAlertMessage({ ...ZERO, openCount: 1, openDisplayIds: displayIds(1) }, 86400, null, false, { stale: false, anonRevoked: false });
    expect(msg.text).not.toContain('【背景排程】');
  });
});

// ⟦b9-ENUMWATCH⟧ 片 2:R2(換模型 adversarial-reviewer)的 must-fix 證人們。
describe('⟦b9-ENUMWATCH⟧ 片 2:客戶搜尋計數', () => {
  function readerWithSearch(
    search: { count: number; actors: number } | null,
    throws = false,
  ): IAnomalyAlertReader {
    return {
      getAlertSummary: vi.fn().mockResolvedValue({ ...ZERO, openCount: 1 }),
      getSearchLogHealth: async () => null,
      getManualCustomerSearchSummary: throws
        ? vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: '42501' }))
        : vi.fn().mockResolvedValue(search),
    };
  }

  it('🟢 有數字 ⇒ 三個 Result 欄位都對, 而 Unknown 是 false', async () => {
    const res = await checkAnomalyAlerts(
      { reader: readerWithSearch({ count: 7, actors: 3 }), notifiers: [okNotifier()] },
      OPTS,
    );
    expect(res.manualCustomerSearchCount).toBe(7);
    expect(res.manualCustomerSearchActors).toBe(3);
    expect(res.manualCustomerSearchUnknown).toBe(false);
  });

  it('🔵 RPC 還沒 apply(回 null)⇒ Unknown=true, 而兩個數字是 null(**不是 0**)', async () => {
    const res = await checkAnomalyAlerts(
      { reader: readerWithSearch(null), notifiers: [okNotifier()] },
      OPTS,
    );
    // 🔴 「查不到」與「零筆」在畫面上會印同一個數字, 而它們是相反的意思。
    expect(res.manualCustomerSearchCount).toBeNull();
    expect(res.manualCustomerSearchUnknown).toBe(true);
  });

  it('🔴🔴 讀取 throw ⇒ **整封告警照常送**(次要觀測不得帶走主要功能)', async () => {
    // 🎯 突變:把 use-case 那個 try/catch 拿掉 ⇒ 這一格會整個 rejects。
    const notifier = okNotifier();
    const res = await checkAnomalyAlerts(
      { reader: readerWithSearch(null, true), notifiers: [notifier] },
      OPTS,
    );
    expect(res.manualCustomerSearchUnknown).toBe(true);
    expect(res.alerted).toBe(true); // openCount=1 ⇒ 本來就要叫
    expect(notifier.notify).toHaveBeenCalledTimes(1);
  });

  it('🔴🔴 **count > 0 而其餘全零 ⇒ alerted 必須 false**(R2 must-fix F5:這才殺得掉那個突變)', async () => {
    // ⛔ 我原本以為 fixture 預設 null 就擋得住「把新欄位接進 shouldAlert」——
    //    **而 null ⇒ (count ?? 0) > 0 為假 ⇒ 那個突變在既有 16 格底下全綠。**
    //    ✅ 真正殺得掉它的是這一格:**有數字、而其餘全零**。
    const res = await checkAnomalyAlerts(
      {
        reader: {
          getAlertSummary: vi.fn().mockResolvedValue(ZERO),
          getSearchLogHealth: async () => null,
          getManualCustomerSearchSummary: vi.fn().mockResolvedValue({ count: 99, actors: 9 }),
        },
        notifiers: [okNotifier()],
      },
      OPTS,
    );
    expect(res.manualCustomerSearchCount).toBe(99);
    expect(res.alerted, '客戶搜尋計數【不進 shouldAlert】—— 它只搭已經要寄的那封信的便車').toBe(false);
  });

  it('信尾:有數字 ⇒ 那一行帶【算出來的】窗口;查不到 ⇒ 印一句不是 0 的話', () => {
    const withNum = buildAnomalyAlertMessage({ ...ZERO, openCount: 1 }, 86400, {
      count: 5,
      actors: 2,
      windowSeconds: 86400,
    }, false, { stale: false, anonRevoked: false });
    expect(withNum.text).toContain('過去 24 小時客戶搜尋 5 次,2 個操作者。');
    // 🔴 R2 consider F7 的證人:窗口換成 1 小時 ⇒ 那句話必須跟著換(舊版寫死「24 小時」)
    const oneHour = buildAnomalyAlertMessage({ ...ZERO, openCount: 1 }, 86400, {
      count: 5,
      actors: 2,
      windowSeconds: 3600,
    }, false, { stale: false, anonRevoked: false });
    expect(oneHour.text).toContain('過去 1 小時客戶搜尋 5 次');
    expect(oneHour.text).not.toContain('過去 24 小時');

    const unknown = buildAnomalyAlertMessage({ ...ZERO, openCount: 1 }, 86400, null, false, { stale: false, anonRevoked: false });
    expect(unknown.text).toContain('客戶搜尋計數:查不到');
    expect(unknown.text).not.toContain('過去 24 小時客戶搜尋');
  });
});

// ⟦b9-ENUMWATCH⟧ 片 2:R3 must-fix 1 的證人 —— 「讀取失敗」與「還沒 apply」要分得開。
describe('⟦b9-ENUMWATCH⟧ R3:兩種 Unknown', () => {
  function readerFor(mode: 'ok' | 'not-applied' | 'failed'): IAnomalyAlertReader {
    return {
      getAlertSummary: vi.fn().mockResolvedValue({ ...ZERO, openCount: 1 }),
      getSearchLogHealth: async () => null,
      getManualCustomerSearchSummary:
        mode === 'failed'
          ? vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: '42501' }))
          : vi.fn().mockResolvedValue(
              mode === 'ok' ? { count: 5, actors: 2, windowSeconds: 86400 } : null,
            ),
    };
  }

  it('🔴 讀取失敗 ⇒ Failed=true(而還沒 apply ⇒ Failed=false)', async () => {
    // 🎯 突變:把 use-case 那個 `searchReadFailed = true` 拿掉 ⇒ 這一格必須紅。
    //    ⇒ 而它守的是 R3 指的那件事:兩者原本【只有一行 console.error 分得開】,
    //      而把那行刪掉測試照樣全綠 ⇒ 那個「分得開」沒有量具。
    const failed = await checkAnomalyAlerts(
      { reader: readerFor('failed'), notifiers: [okNotifier()] },
      OPTS,
    );
    expect(failed.manualCustomerSearchUnknown).toBe(true);
    expect(failed.manualCustomerSearchFailed).toBe(true);

    const notApplied = await checkAnomalyAlerts(
      { reader: readerFor('not-applied'), notifiers: [okNotifier()] },
      OPTS,
    );
    expect(notApplied.manualCustomerSearchUnknown).toBe(true);
    expect(notApplied.manualCustomerSearchFailed, '還沒 apply 不是失敗').toBe(false);
  });

  it('🔴 而信上那句話也要不一樣(否則讀信的人以為只是還沒部署)', () => {
    const notApplied = buildAnomalyAlertMessage({ ...ZERO, openCount: 1 }, 86400, null, false, { stale: false, anonRevoked: false });
    const failed = buildAnomalyAlertMessage({ ...ZERO, openCount: 1 }, 86400, null, true, { stale: false, anonRevoked: false });
    expect(notApplied.text).toContain('那支查詢還沒上線');
    expect(failed.text).toContain('讀取失敗');
    // 🔵 負對照:失敗那一版【不得】說「還沒上線」—— 那正是 R3 指的那個誤導
    expect(failed.text).not.toContain('那支查詢還沒上線');
  });
});

// ⟦b9-RLSHARDEN⟧ 甲(片B):權限被收緊那天,這道量具會不會叫。
//
// 🔴 **這一組的形狀是主視窗釘的:「必須叫,而且【只有那一格】叫」** ——
//    「有訊息就算過」是一個**恆綠格**:任何一格出問題都會讓訊息非空。
//    ⇒ 所以下面那發把**其他計數全部留在 ZERO**,再斷言訊息裡**沒有別的區塊**。
describe('⟦b9-RLSHARDEN⟧ 甲:BYPASSRLS 被收掉那天', () => {
  it('🔴 屬性被收掉 ⇒ 要叫,而且信裡有那一塊', async () => {
    const res = await checkAnomalyAlerts(
      { reader: reader({ ...ZERO, bypassRlsRevoked: true }), notifiers: [okNotifier()] },
      OPTS,
    );
    expect(res.alerted, '屬性被收掉而沒有叫 ⇒ 這一片等於沒做').toBe(true);
  });

  it('🔴 而【只有那一格】叫 —— 其他區塊一個都不准出現', () => {
    const msg = buildAnomalyAlertMessage({ ...ZERO, bypassRlsRevoked: true }, 86400, null, false, { stale: false, anonRevoked: false });
    expect(msg.text).toContain('【資料庫權限】');
    // 🛑 這四行才是這一格的判別力所在:少了它們,「有訊息」與「只有這一塊」印同一個綠。
    expect(msg.text).not.toContain('【背景排程】');
    expect(msg.text).not.toContain('【待處理】');
    expect(msg.text).not.toContain('【退款】');
    expect(msg.text).not.toContain('【寄信】');
    /**
     * 🔴🔴 **codex 2026-09-02 must-fix ①:上面四行【不夠】** ——
     *   我只檢查了 body 的四個標題, **完全沒看 `subject`**。
     *   ⇒ 而只有這一格叫時 `hasPayment` / `hasEmail` 都是 false
     *     ⇒ 主旨會掉到 `'⚠️ PCM 付款有事要你看'`
     *   ⇒ ⇒ 📌 **主旨說「付款有事」而付款一格都沒事** —— 收信的人會去查訂單、查錢,
     *      而真正的問題是**他看到的那些數字本身可能是空的**。
     * 🎯 **⇒ 一個錯誤的實作在我原本那四行底下【照樣全綠】。**
     */
    /**
     * 🔴🔴 **codex R2 must-fix:`toContain` 對這個突變是【恆綠】的。**
     *   刪掉「純權限」那一支 ⇒ 掉進下一支 `'⚠️ PCM 資料庫權限有事,而付款/寄信也有事要你看'`
     *   ⇒ 它**仍然含「資料庫權限」**、也仍然不含「付款有事要你看」⇒ 我原本兩行照樣過。
     * 📌 **⇒ 一個【包含】斷言分不出「對的那一支」與「隔壁那一支」。改用 `toBe` 精確比對。**
     */
    expect(msg.subject).toBe('⚠️ PCM 資料庫權限有事要你看(與付款無關)');
  });

  /**
   * 🔴 **codex R2:「combined worlds 被合併, 確實有世界被吃掉」** ——
   *   權限+付款 / 權限+寄信 / 三者都有, 目前全走同一支三元。
   * ⇒ 逐一釘住**可達的四種主旨**, 讓任何一支被改動時有東西會紅。
   */
  it.each([
    [
      '純權限',
      { bypassRlsRevoked: true },
      '⚠️ PCM 資料庫權限有事要你看(與付款無關)',
    ],
    [
      '權限 + 付款',
      { bypassRlsRevoked: true, openCount: 1, openDisplayIds: displayIds(1) },
      '⚠️ PCM 資料庫權限有事,而其他也有事要你看',
    ],
    [
      '純付款(對照:沒有權限那一格時不得出現「資料庫權限」)',
      { openCount: 1, openDisplayIds: displayIds(1) },
      '⚠️ PCM 付款有 1 張單要你看',
    ],
    /**
     * 🔴🔴 **R3 must-fix 1 的證人:「純心跳」這個世界一直都在, 而它掉到「付款有事」。**
     *   `cronHeartbeatAbnormalCount` 進 `shouldAlert`, 而它不在 `hasPayment` 也不在 `hasEmail`
     *   ⇒ 只有它為真時, 主旨會說「付款有事」而付款一格都沒事。
     * 🎯 **而本片自己會點著它**:`bypassRlsUnknown ⇒ 503` 前先記一次心跳失敗
     *   ⇒ 連續失敗之後這一格就亮了 ⇒ **我原本「Unknown 不吵 Sean」那句在真系統為假。**
     */
    [
      '純心跳(本片自己會點著它 —— 503 會記心跳失敗)',
      { cronHeartbeatAbnormalCount: 1, cronHeartbeatAbnormalJobs: ['pcm-anomaly-alert'] },
      '⚠️ PCM 背景排程有事要你看(與付款無關)',
    ],
    [
      '權限 + 心跳(兩者都亮時以權限為主詞)',
      {
        bypassRlsRevoked: true,
        cronHeartbeatAbnormalCount: 1,
        cronHeartbeatAbnormalJobs: ['pcm-anomaly-alert'],
      },
      '⚠️ PCM 資料庫權限有事,而其他也有事要你看',
    ],
  ])('🔴 主旨精確比對 —— %s', (_name, patch, expected) => {
    const msg = buildAnomalyAlertMessage({ ...ZERO, ...patch }, 86400, null, false, { stale: false, anonRevoked: false });
    expect(msg.subject).toBe(expected);
  });

  it('🛑 信裡要逐字帶【它證不到什麼】—— 沒有它,收到的人會以為「沒叫 = 沒事」', () => {
    const msg = buildAnomalyAlertMessage({ ...ZERO, bypassRlsRevoked: true }, 86400, null, false, { stale: false, anonRevoked: false });
    expect(msg.text).toContain('不答哪些表會安靜回 0');
    // 🔵 數字帶時點與分母跟著走(2026-09-01 唯讀實測 45 / 54)。
    expect(msg.text).toContain('45 張');
    expect(msg.text).toContain('54 張');
  });

  it('🟢 正對照:屬性還在(今天的正常態)⇒ 靜,而且信裡沒有那一塊', async () => {
    // 🔵 基線不是我算的:正式庫 2026-09-02 真的呼叫過那支函式 ⇒
    //    {"total_role_count":35,"privileged_role_count":6,"service_role_bypassrls":true}
    //    ⇒ 對應到本層就是 ZERO 那兩個 false ⇒ **今天它會叫 0 次。**
    const res = await checkAnomalyAlerts(
      { reader: reader({ ...ZERO }), notifiers: [okNotifier()] },
      OPTS,
    );
    expect(res.alerted).toBe(false);
    const msg = buildAnomalyAlertMessage({ ...ZERO, openCount: 1, openDisplayIds: displayIds(1) }, 86400, null, false, { stale: false, anonRevoked: false });
    expect(msg.text).not.toContain('【資料庫權限】');
  });

  it('🔴 量不到 ⇒ 這道閘【不直接】叫(而它會經由心跳那條路叫 —— 見下方註解)', async () => {
    const res = await checkAnomalyAlerts(
      { reader: reader({ ...ZERO, bypassRlsUnknown: true }), notifiers: [okNotifier()] },
      OPTS,
    );
    // 🎯 這一格若翻成 true, 部署窗口**每天**寄一封給 Sean。
    // 🛑 **而「所以它不吵 Sean」是錯的(R3 must-fix 1)** —— Unknown ⇒ route 回 503
    //    前先記一次心跳失敗 ⇒ 連續失敗到門檻 ⇒ `cronHeartbeatAbnormalCount` 亮
    //    ⇒ **那一格就在 `shouldAlert` 裡** ⇒ 照樣寄。
    // ✅ 本格證的是**這一個旗標不直接觸發**, 不是「Sean 不會收到信」。
    //    📌 **兩者差一層, 而我原本把它們寫成同一句。**
    expect(res.alerted, '量不到就【直接】寄信 ⇒ 部署窗口每天一封').toBe(false);
  });

  it('🛑 而「被收掉」與「量不到」同時為真時,**以被收掉為準**(要叫)', async () => {
    // 🔴 這個組合理論上不該出現(adapter 保證互斥), 而測試在這裡釘住【萬一出現時的方向】——
    //    寧可多叫一次, 不可因為「我也不確定」就靜下來。
    const res = await checkAnomalyAlerts(
      { reader: reader({ ...ZERO, bypassRlsRevoked: true, bypassRlsUnknown: true }), notifiers: [okNotifier()] },
      OPTS,
    );
    expect(res.alerted).toBe(true);
  });
});

/**
 * ⟦b4-NORECIPIENTWINDOW⟧ 未付款取消信線的收件人訊號(2026-09-03)。
 *
 * 🔴 **這一組守的東西, 和上面那格矩陣不一樣**:矩陣證「一封就叫」,
 *    這一組證的是**兩條線分得開**、以及**安靜與壞掉分得開**。
 */
describe('未付款取消信 · 找不到收件人', () => {
  it('pending>0 而 noRecipient=0 → 不叫(那是正常的:下一輪 scanner 就排掉)', async () => {
    const n = okNotifier();
    const res = await checkAnomalyAlerts(
      { reader: reader({ ...ZERO, unpaidCancelledPendingCount: 5 }), notifiers: [n] },
      OPTS,
    );
    // 🛑 這一格是【負對照】:拿 pending 當判準 = 有生意就叫, 那不是告警。
    expect(res.alerted).toBe(false);
    expect(n.notify).not.toHaveBeenCalled();
  });

  it('unknown → 不叫, 而旗標必須出得來(否則「安靜」與「沒裝上」印同一個畫面)', async () => {
    const n = okNotifier();
    const res = await checkAnomalyAlerts(
      {
        reader: reader({
          ...ZERO,
          unpaidCancelledPendingCount: null,
          unpaidCancelledNoRecipientCount: null,
          unpaidCancelledGapUnknown: true,
        }),
        notifiers: [n],
      },
      OPTS,
    );
    expect(res.alerted).toBe(false);
    // 🔴 旗標要出得來 —— 否則 route 讀不到它, 那道 fail-closed 在下游就被 `?? 0` 拆掉。
    expect(res.unpaidCancelledGapUnknown).toBe(true);
    expect(res.unpaidCancelledNoRecipientCount).toBeNull();
  });

  it('兩條線各自的訊息獨立成行 —— 併成一行看信的人不知道去哪一條線', async () => {
    const n = okNotifier();
    await checkAnomalyAlerts(
      {
        reader: reader({
          ...ZERO,
          orderCreatedNoRecipientCount: 2,
          unpaidCancelledNoRecipientCount: 3,
        }),
        notifiers: [n],
      },
      OPTS,
    );
    const msg = (n.notify.mock.calls[0]![0] as { text: string }).text;
    // 🔴 兩句都要在, 而且是【兩句】—— 這一格會抓到「順手合併成一行」那種改法。
    expect(msg).toContain('訂單成立了而【那張單兩個信箱都是空的】');
    expect(msg).toContain('訂單被取消了而【那張單兩個信箱都是空的】');
  });
});


describe('⟦search-LOGSILENTZERO⟧ 搜尋日誌靜靜歸零', () => {
  type Health = Awaited<ReturnType<IAnomalyAlertReader['getSearchLogHealth']>>;
  const readerWithHealth = (h: Health): IAnomalyAlertReader => ({
    ...reader(ZERO),
    getSearchLogHealth: async () => h,
  });
  const run = async (h: Health) =>
    checkAnomalyAlerts(
      { reader: readerWithHealth(h), notifiers: [okNotifier()] },
      OPTS,
    );

  it('🔵 世界①該綠 · 表【還沒貼】⇒ 不是異常, stale 必須 false', async () => {
    const res = await run({ tableExists: false, lastRowAt: null, anonCanExecute: null });
    expect(res.searchLogTableExists).toBe(false);
    expect(res.searchLogStale, '還沒貼卻算成 stale ⇒ 值班的人會去查一個不存在的事故').toBe(false);
    expect(res.searchLogUnknown).toBe(false);
  });

  it('🔵 世界②該綠 · 表在而【從來沒有列】= 還沒開始收 ⇒ stale 必須 false', async () => {
    const res = await run({ tableExists: true, lastRowAt: null, anonCanExecute: true });
    expect(res.searchLogStale, '「還沒開始收」被算成 stale = 主視窗推翻的甲案(每天半夜假紅)').toBe(false);
  });

  it('🔴 世界③該紅 · 有過列而【最後一列 30 小時前】⇒ stale = true', async () => {
    const res = await run({
      tableExists: true,
      lastRowAt: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(),
      anonCanExecute: true,
    });
    expect(res.searchLogStale).toBe(true);
  });

  it('🔵 世界④該綠 · 最後一列在【23 小時前】⇒ 還沒過門檻(24h 那條線的下界證人)', async () => {
    const res = await run({
      tableExists: true,
      lastRowAt: new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString(),
      anonCanExecute: true,
    });
    expect(res.searchLogStale, '少了這一格, 把 24h 改成 1h 也全綠').toBe(false);
  });

  it('🔴🔴 anon 的 null 與「被收掉」【不得】合併 —— 它們的下一步相反', async () => {
    const notApplied = await run({ tableExists: false, lastRowAt: null, anonCanExecute: null });
    const doorShut = await run({
      tableExists: true,
      lastRowAt: new Date().toISOString(),
      anonCanExecute: false,
    });
    expect(notApplied.searchLogAnonExecuteRevoked, 'null = 還沒貼(不告警)').toBeNull();
    expect(doorShut.searchLogAnonExecuteRevoked, 'true = 那道門被關掉了(告警)').toBe(true);
    // 🔴 這一行才是承重的:壓成 boolean 的實作會讓上面兩格【印同一個值】
    expect(notApplied.searchLogAnonExecuteRevoked).not.toBe(doorShut.searchLogAnonExecuteRevoked);
  });

  it('🔵 而【門是開著的】那個世界也要有證人 —— 否則把它改成回 null 也全綠', async () => {
    const open = await run({
      tableExists: true,
      lastRowAt: new Date().toISOString(),
      anonCanExecute: true,
    });
    expect(open.searchLogAnonExecuteRevoked, '門開著 = false(不是 null, 也不是 true)').toBe(false);
  });

  it('🔴 「還沒 apply」與「讀取失敗」不得只靠一行 log 分開 —— result 要有量具', async () => {
    const notApplied = await run(null);
    const boom: IAnomalyAlertReader = {
      ...reader(ZERO),
      getSearchLogHealth: async () => {
        throw new Error('boom');
      },
    };
    const failed = await checkAnomalyAlerts(
      { reader: boom, notifiers: [okNotifier()] },
      OPTS,
    );
    expect(notApplied.searchLogUnknown).toBe(true);
    expect(failed.searchLogUnknown).toBe(true);
    // 🔴 兩者在 Unknown 上相同 ⇒ 只有這一格分得開它們
    expect(notApplied.searchLogFailed, '還沒 apply 不是失敗').toBe(false);
    expect(failed.searchLogFailed, '真的壞了要有人看').toBe(true);
  });

  it('🔴 命中 ⇒ 信裡有那一行;🔵 不命中 ⇒ 【零字】(主視窗 2026-09-04 裁①)', () => {
    const hit = buildAnomalyAlertMessage(ZERO, 86400, null, false, {
      stale: true,
      anonRevoked: false,
    });
    expect(hit.text).toContain('【搜尋日誌】');
    expect(hit.text).toContain('超過 24 小時沒有新列');
    expect(hit.text, '不告訴他要做什麼 = 那一行對他沒用').toContain('轉給施工窗');

    const miss = buildAnomalyAlertMessage(ZERO, 86400, null, false, {
      stale: false,
      anonRevoked: false,
    });
    // 🔴 這一行才是承重的:無條件 push 的實作會讓上面那格【照樣綠】
    expect(miss.text, '不命中卻出現在信裡 ⇒ 每天一封').not.toContain('【搜尋日誌】');
  });

  it('🔴 兩格【各自】進信, 而它們的文字不同 —— 門被關了 ≠ 沒有東西進來', () => {
    const revoked = buildAnomalyAlertMessage(ZERO, 86400, null, false, {
      stale: false,
      anonRevoked: true,
    });
    expect(revoked.text).toContain('那道權限被收掉了');
    // 🔴 少了這一行, 兩格共用一句話也全綠 ⇒ 值班的人分不出該去看哪一邊
    expect(revoked.text).not.toContain('超過 24 小時沒有新列');
  });

  it('🔴🔴 只有搜尋日誌異常時, 那封信【要真的寄】—— codex must-fix ①', async () => {
    const staleRes = await run({
      tableExists: true,
      lastRowAt: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(),
      anonCanExecute: true,
    });
    // 🔴 這一格是這一片存在的理由:寫進信的【內容】而沒寫進【要不要寄】,
    //    buildAnomalyAlertMessage 的測試會全綠, 而信一封都不會送。
    expect(staleRes.alerted, '只有搜尋日誌異常 ⇒ 不寄 = 這一片等於沒做').toBe(true);

    const revokedRes = await run({
      tableExists: true,
      lastRowAt: new Date().toISOString(),
      anonCanExecute: false,
    });
    expect(revokedRes.alerted, '門被收掉也要寄').toBe(true);

    // 🔵 負對照:兩格都正常 ⇒ 【不寄】(否則上面兩格對「無條件寄」也全綠)
    const okRes = await run({
      tableExists: true,
      lastRowAt: new Date().toISOString(),
      anonCanExecute: true,
    });
    expect(okRes.alerted, '一切正常卻寄 ⇒ 每天一封').toBe(false);
  });

  it('🔵 lastRowAt 要原封回傳 —— 它是值班的人唯一看得到「上次寫進來是什麼時候」的那格', async () => {
    const at = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const res = await run({ tableExists: true, lastRowAt: at, anonCanExecute: true });
    expect(res.searchLogLastRowAt, '寫死 null 的實作在這一格之前【七格全綠】').toBe(at);
  });

  it('🔵 RPC 還沒 apply(reader 回 null)⇒ Unknown, 而不是把它讀成「一切正常」', async () => {
    const res = await run(null);
    expect(res.searchLogUnknown).toBe(true);
    expect(res.searchLogTableExists).toBeNull();
    expect(res.searchLogStale, '讀不到卻算成 stale ⇒ 把「不知道」讀成「壞了」').toBe(false);
  });

  it('🔵 讀取【拋例外】⇒ 落 Unknown 而不得帶走主要功能(次要觀測的收口)', async () => {
    const boom: IAnomalyAlertReader = {
      ...reader(ZERO),
      getSearchLogHealth: async () => {
        throw new Error('boom');
      },
    };
    const res = await checkAnomalyAlerts(
      { reader: boom, notifiers: [okNotifier()] },
      OPTS,
    );
    expect(res.searchLogUnknown).toBe(true);
  });
});
