import type { ClaimedEmailJob, IEmailOutbox, IEmailSender } from '@pcm/ports';
import {
  computeEmailBackoff,
  LEASE_RECLAIM_RETRY_DELAY_MS,
  type EmailBackoffRandom,
} from './email-backoff';

/**
 * sweepEmailOutbox:交易信 outbox sweeper use-case(M-4a Email 片 E2a-b;plan v3.3 §3.5/§3.6/§5)。
 *
 * 週期觸發(E2a-c route → E2b pg_cron 每 5 分鐘;🔴 不走 Vercel cron)→ 三段固定順序:
 * ```
 * ① lease 回收(claim 前必跑;migration §⑩):stale sending → failed + 'lease_reclaimed'
 * ② claimDue(CAS 認領、attempts < max guard 在 port 內建)
 * ③ 逐封順序寄送 → sent → markSent / failed → markFailed(退避 = email-backoff:§⑨ 三列+plan §5 兜底)
 * ```
 *
 * 安全 / 信任邊界(鐵則 12):
 * - 🔴 **零告警**(Sean Q13=A):五訊號全歸 E2a-2 獨立管道 —— sweeper 死時它發的告警一起死,
 *   自我監看=沒有監看。本 use-case 只回 counts,判讀交給獨立 cron。
 * - 🔴 **at-least-once、不宣稱不重複**(E2a-a codex 擊破「擊不破」後的正確定性):Resend
 *   Idempotency-Key 只保 24h → 「已送出未 markSent → 回收 → 停擺 >24h → 重送」的第二封會真的
 *   寄出 = 極窄非零重複率(Sean S3 認可)。
 * - 🔴 lease 下界 = **物理擋**(E2a-a 義務;codex 關卡2 R1 must-fix 後收緊):單一常數門檻
 *   證明不了 port 要求的「lease > 單輪最長執行時間 + 時鐘偏差」→ caller 必須申告
 *   `maxRunSeconds`(= 執行環境的硬性 kill 上界,E2a-c 即 route `maxDuration`;單輪真正的
 *   物理上界是**平台 kill**,不是本迴圈自己)並通過 `leaseSeconds ≥ max(3600,
 *   maxRunSeconds + 時鐘偏差餘裕)` 驗證,違反直接 throw;迴圈另設時間預算(超過
 *   `maxRunSeconds` 停止寄送、剩餘已認領列計 `deferred`)= 對「平台沒殺」情境的縱深,
 *   ⚠️ 但**擋不住單一 await 懸掛**(懸掛只能靠平台 kill 收拾 → 列卡 sending → 下輪回收)。
 *   太短的 lease 會把在途列判 stale → 原持有者仍寄出 → 重複寄信。
 * - 單封 fail-closed(鏡像 `sweepSettlements`):sender 合約不 throw,若仍 throw(合約違反)或
 *   mark* DB 錯 → 計 error、**不補救不重標**,列留 sending 由下輪 ① 回收 = 安全可恢復。
 * - 順序寄送(concurrency 固定 1):量級 10-30 封/日、Resend 限流保守值 5 req/s → 無並發需求;
 *   維持順序天然不撞限流,也免掉 `sweepSettlements` 的 runBounded 複雜度。
 * - 零 PII:result counts-only;`recipientEmail` 只進 `sender.send` 的 `to`,不進 log/result/錯誤
 *   訊息;內文只用 payload 內非 PII 欄(display_id)。
 *
 * @see supabase/migrations/20260717020000_m4a_email_outbox.sql §⑦/§⑨/§⑩
 * @see docs/specs/2026-07-16-m4a-email-notify-plan.md §3.5/§3.6/§5
 */
export type SweepEmailOutboxDeps = {
  outbox: IEmailOutbox;
  sender: IEmailSender;
};

/**
 * 參數由 route(E2a-c)顯式注入(鏡像 `sweepSettlements` 慣例、不設預設值)。
 * - `claimLimit`:每輪認領上限(port `claimDue` 語意=認領上限、死列不佔窗)。
 * - `maxRunSeconds`:單輪執行時間的**硬性上界申告**(E2a-c = route `maxDuration` 字面;平台在
 *   此時限 kill function = 單輪最長執行時間的物理保證來源)。兼作迴圈時間預算(見檔頭)。
 * - `leaseSeconds`:lease 長度(秒)。🔴 硬下界 = **max(3600, maxRunSeconds + 時鐘偏差餘裕 300)**
 *   (plan §3.5-4「lease ≥1h」+ port「> 單輪最長執行 + 跨 instance 偏差」;違反 = throw)。
 * - `now` / `random`:測試注入縫(production 省略 = 系統鐘 + Math.random)。
 */
export type SweepEmailOutboxOptions = {
  claimLimit: number;
  maxRunSeconds: number;
  leaseSeconds: number;
  now?: () => Date;
  random?: EmailBackoffRandom;
};

/** SweepEmailOutboxResult:結構化摘要(零 PII、counts only;E2a-c route log/回應用)。 */
export type SweepEmailOutboxResult = {
  /** ① 回收的 stale sending 列數(→ failed + 'lease_reclaimed';正常恆 0、>0 = 上輪有非正常死亡)。 */
  reclaimed: number;
  /** ② 本輪認領到的列數。 */
  claimed: number;
  /**
   * ③ provider 裁決 = 接受的封數(sender 回 `sent` 當下遞增、**不含**後續 markSent 是否落表:
   * mark DB 錯 → `errors`、柵欄 no-op → `staleMarks`;codex 關卡2 R1 must-fix 後的精確語意)。
   */
  sent: number;
  /** ③ provider 裁決 = 失敗的封數(sender 回 `failed` 當下遞增;markFailed 落表狀況同上)。 */
  failed: number;
  /**
   * ③ 時間預算耗盡而未嘗試寄送的已認領列數(留在 sending、由下輪 ① 回收;代價 = 各燒 1 次
   * attempts + 延遲一個 lease 週期。>0 = claimLimit 相對 maxRunSeconds 太大,應調參)。
   */
  deferred: number;
  /**
   * mark* 世代柵欄 no-op 筆數(false:lease 已被回收/他人接手 → 不得覆寫)。**非錯誤**,
   * 僅供「DB 實寫 < 裁決計數」可見度(鏡像 `sweepSettlements.staleMarks`)。
   */
  staleMarks: number;
  /** 單封 throw / 段級(回收、claim)throw 計數(fail-closed 不中斷整批;>0 → route 503)。 */
  errors: number;
};

/** lease 硬下界(秒)= plan §3.5-4「lease ≥ 1 小時」字面(物理擋、非約定)。 */
const MIN_LEASE_SECONDS = 3600;

/**
 * 跨 instance app 時鐘偏差餘裕(秒;E2a-a 關卡2 Fable F2:`claimed_at` 由認領方 app 鐘寫、
 * `staleBefore` 由回收方 app 鐘算)。5 分鐘遠大於 NTP 常態偏差量級 = 保守值。
 */
const CLOCK_SKEW_ALLOWANCE_SECONDS = 300;

/**
 * 依 eventType 窮舉分派內文模板(codex 關卡2 R1 must-fix:DB CHECK 與 `ClaimedEmailJob` 型別
 * 都合法允許 `order_shipped` 列存在 —— enqueue 現況雖只開 order_created,手動 DB 寫入即可造出
 * → 不做分派會把出貨列寄成「付款成功」信)。
 * 🔴 `order_shipped` = E4 未落地、無模板 → **寄送前 fail-closed throw**(零 PII;由呼叫端
 * per-job catch 計 error、列留 sending → 回收 → 耗盡 attempts → 訊號 2 可見,不靜默吞)。
 * E4 增員 union 時本 switch 少 case → typecheck 必紅(`satisfies never` 窮舉)。
 */
function buildEmailText(job: ClaimedEmailJob): string {
  switch (job.eventType) {
    case 'order_created':
      return buildOrderCreatedText(job);
    case 'order_shipped':
      throw new Error('sweepEmailOutbox:order_shipped 模板未定義(E4 未落地)、fail-closed 不寄');
    default:
      return job.eventType satisfies never;
  }
}

/**
 * 由 job 組純文字內文(L2 佔位字面;🔴 文案由 E3 定案、寄出前給 Sean 過目 —— 與
 * `orderCreatedSubject` 同一約定)。只取 payload 中非 PII 的 `display_id`(組裝層 allowlist
 * 三欄之一);payload 形狀異常(理論上不可達,組裝層 runtime 驗過)→ 退回不含編號的通用文案,
 * **不因文案缺欄位就不寄**(付款成功通知的存在比編號重要)。
 */
function buildOrderCreatedText(job: ClaimedEmailJob): string {
  const payload = job.payload;
  const displayId =
    typeof payload === 'object' &&
    payload !== null &&
    'display_id' in payload &&
    typeof (payload as { display_id: unknown }).display_id === 'string'
      ? (payload as { display_id: string }).display_id
      : null;
  const orderLine = displayId === null ? '您的訂單已付款成功。' : `您的訂單 ${displayId} 已付款成功。`;
  return [
    '您好,',
    '',
    orderLine,
    '我們將盡快為您安排出貨;訂單明細與最新狀態請至 PCM 會員中心查看。',
    '',
    'PCM Motorsports',
  ].join('\n');
}

export async function sweepEmailOutbox(
  deps: SweepEmailOutboxDeps,
  opts: SweepEmailOutboxOptions,
): Promise<SweepEmailOutboxResult> {
  const { outbox, sender } = deps;
  // 🔴 lease 下界物理擋(fail-closed 大聲炸,不靜默降級:太短的 lease = 系統性重複寄信)。
  if (!Number.isFinite(opts.maxRunSeconds) || opts.maxRunSeconds < 1) {
    throw new Error(`sweepEmailOutbox:maxRunSeconds 必須是 ≥1 的有限數(收到 ${opts.maxRunSeconds})`);
  }
  const minLease = Math.max(MIN_LEASE_SECONDS, opts.maxRunSeconds + CLOCK_SKEW_ALLOWANCE_SECONDS);
  if (!Number.isFinite(opts.leaseSeconds) || opts.leaseSeconds < minLease) {
    throw new Error(
      `sweepEmailOutbox:leaseSeconds 必須 ≥ ${minLease}(= max(${MIN_LEASE_SECONDS}, maxRunSeconds + ${CLOCK_SKEW_ALLOWANCE_SECONDS});plan §3.5-4 + port staleBefore 安全下界;收到 ${opts.leaseSeconds})`,
    );
  }
  const now = opts.now ?? (() => new Date());
  const random = opts.random ?? Math.random;

  const result: SweepEmailOutboxResult = {
    reclaimed: 0,
    claimed: 0,
    sent: 0,
    failed: 0,
    deferred: 0,
    staleMarks: 0,
    errors: 0,
  };

  // 🔴 單一時鐘快照:staleBefore / nextRetryAt / 時間預算基準皆由此導出(兩次 now() 之間的
  //    間隔會憑空吃掉 lease 餘裕)。
  const sweepStartedAt = now();

  // ── ① lease 回收(claim 前必跑;§⑩:落 failed + 'lease_reclaimed'、attempts 不動)────────
  //    fail-closed:throw → 計 error + 續(回收失敗只是 stale 列本輪不回收,下輪重來;
  //    不阻斷 ② 的正常寄送)。
  try {
    result.reclaimed = await outbox.reclaimStaleLeases(
      new Date(sweepStartedAt.getTime() - opts.leaseSeconds * 1000),
      new Date(sweepStartedAt.getTime() + LEASE_RECLAIM_RETRY_DELAY_MS),
    );
  } catch {
    result.errors++;
  }

  // ── ② claim due(CAS 認領;輸家/死列由 port 述詞處理)──────────────────────────────
  let jobs: ClaimedEmailJob[] = [];
  try {
    jobs = await outbox.claimDue(opts.claimLimit);
  } catch {
    result.errors++;
  }
  result.claimed = jobs.length;

  // ── ③ 逐封順序寄送 → mark(世代柵欄 = job.attempts 原樣帶回)─────────────────────
  for (let i = 0; i < jobs.length; i++) {
    // 時間預算(縱深、擋不住單一 await 懸掛=檔頭誠實揭示):超過申告上界即停寄,
    // 剩餘已認領列留 sending 交下輪 ① 回收。
    if (now().getTime() - sweepStartedAt.getTime() >= opts.maxRunSeconds * 1000) {
      result.deferred = jobs.length - i;
      break;
    }
    const job = jobs[i]!;
    try {
      const outcome = await sender.send({
        to: job.recipientEmail,
        subject: job.subject,
        text: buildEmailText(job),
        idempotency: { eventType: job.eventType, outboxId: job.id },
      });
      // 🔴 計數 = provider 裁決當下(mark 落表前;codex 關卡2 R1 must-fix:mark throw 不得
      //    讓「Resend 已接受」從計數上消失)。
      if (outcome.kind === 'sent') {
        result.sent++;
        const owned = await outbox.markSent(job.id, job.attempts);
        if (!owned) result.staleMarks++; // 柵欄 no-op:所有權已失、不得覆寫(非錯誤)
      } else {
        result.failed++;
        const failedAt = now();
        const owned = await outbox.markFailed(
          job.id,
          job.attempts,
          outcome.errorCode,
          computeEmailBackoff(outcome.errorCode, job.attempts, failedAt, random),
        );
        if (!owned) result.staleMarks++;
      }
    } catch {
      // sender 合約不 throw(可預期失敗走 failed 結果)→ 此處 = 合約違反、order_shipped
      // fail-closed(buildEmailText throw)或 mark* DB 錯。不補標不重試:列留 sending、
      // lease 到期由下輪 ① 回收(at-least-once、fail-closed)。
      result.errors++;
    }
  }

  return result;
}
