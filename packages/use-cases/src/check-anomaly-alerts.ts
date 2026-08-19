import type { IAnomalyAlertReader, IAlertNotifier } from '@pcm/ports';
import type { AnomalyAlertSummary, AnomalyAlertMessage } from '@pcm/domain';

/**
 * checkAnomalyAlerts:雙扣 anomaly 主動告警 use-case(M-3 #250;pull→push)。
 *
 * 週期 cron(app/api/cron/anomaly-alert)觸發 → 讀 anomaly + 死卡列計數 **與對應的訂單單號** → 任一門檻踩
 * → 對「所有已設定管道」(LINE/Email、Q1=A+C)推播固定格式告警。杜絕「沉默故障 + 錯過客訴黃金期」。
 *   🔴 ~~原句兩處「零 PII」~~ 2026-08-19 作廢 —— **訊息現在帶訂單單號**,見下方那段授權來歷。
 *
 * ```
 * summary = reader.getAlertSummary(refundingStuckSeconds)   // throw → 上拋(route 503,不吞)
 * shouldAlert = open>0 || refundingStuck>0 || attemptManualReview>0 || releasedStuck>0
 * if shouldAlert: 對每個 notifier.notify(固定訊息)、Promise.allSettled 收集失敗數
 * return { alerted, ...counts, notifiersTotal, notifiersFailed, errors=notifiersFailed }
 * ```
 *
 * 安全 / 信任邊界(鐵則 12):
 * - reader 走 payment_confirmer SECDEF 受控窗、對 anomaly 兩表零表權;回傳計數 **+ 訂單單號**、零 PII/零金額。
 *   🔴🔴 **原句逐字是「回傳只計數、零 PII/零金額/零 id」,而【零 id】那一半是被刻意拿掉的、不是有人漏改。**
 *   打開它的是 **Sean 本人,2026-08-19**,在知道代價(LINE 訊息會留在手機、可能被轉發截圖)的情況下拍板;
 *   他的理由是他自己的:**「沒單號我查不到,那則告警等於只說『有事』」**。
 *   ⇒ 要關回去是可以的,而那要**再問他一次** —— 不要當成修 bug 順手關掉。
 *   ⚠️ 它**每天早上 9 點寄一封**(`20260723120000_m3_s2_settle_sweep_pgcron.sql:12` 逐字
 *   `pcm-anomaly-alert(0 1 * * *)`)⇒ 單號會每天出現在他手機上。
 * - 告警訊息固定格式;🔴 文案不宣稱「已確認雙扣」(open=候選、待查證;runbook line51)。
 * - fail-closed:reader throw → 上拋 → route 503;notifier throw → 計入 errors → route 503(壞掉的管道必須可見、
 *   不得靜默吞成成功)。一管道掛掉不影響另一管道(Promise.allSettled 各自送)。
 * - **無 per-anomaly 去重**(本片刻意):未解決前每輪重推 = 持續提醒(雙扣不可被遺忘);去重狀態表列 follow-up。
 *
 * @see docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md §7
 * @see docs/phase-1-backlog.md #250
 */
export type CheckAnomalyAlertsDeps = {
  reader: IAnomalyAlertReader;
  /** 已設定的推播管道(LINE/Email;composition 依 env 存在性組;至少 1 個〔否則 composition fail-closed〕)。 */
  notifiers: IAlertNotifier[];
};

export type CheckAnomalyAlertsOptions = {
  /** refunding 卡住門檻秒數(route 常數注入、營運參數非 SLA)。 */
  refundingStuckSeconds: number;
  /** #256 pending 雙扣候選:兩 paid 單 paid_at 差窗秒數(route 常數、預設 12h)。 */
  pendingDoubleChargeWindowSeconds: number;
  /** #256 卡住指紋門檻秒數(charged attempt updated_at-created_at 逾此才算卡住;route 常數、預設 10min)。 */
  pendingDoubleChargeStuckSeconds: number;
};

/** CheckAnomalyAlertsResult:結構化摘要(零 PII counts only;route log/回應用)。 */
export type CheckAnomalyAlertsResult = {
  /** 是否踩門檻並嘗試推播。 */
  alerted: boolean;
  openCount: number;
  refundingCount: number;
  refundingStuckCount: number;
  attemptManualReviewCount: number;
  releasedStuckCount: number;
  /** #256 pending-based 雙扣候選「組」數(卡住指紋 + 同額 + 窗;候選待查證)。 */
  pendingDoubleChargeCandidateCount: number;
  /** 最舊 open anomaly 年齡秒數(排序訊號、非 PII;無 open → null)。 */
  oldestOpenAgeSeconds: number | null;
  /** 本輪嘗試推播的管道數(shouldAlert=false 時為 0)。 */
  notifiersTotal: number;
  /** 推播失敗的管道數(>0 → route 503)。 */
  notifiersFailed: number;
  /** errors = notifiersFailed(route 據此回 503;reader throw 已上拋不進此)。 */
  errors: number;
};

/** 每小時秒數(refundingStuckSeconds → 顯示小時)。 */
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;

/** 年齡秒數 → 白話(≥1 天顯天、否則顯小時;純聚合年齡、非 PII)。 */
function formatAge(seconds: number): string {
  if (seconds >= SECONDS_PER_DAY) {
    return `${Math.floor(seconds / SECONDS_PER_DAY)} 天`;
  }
  return `${Math.max(1, Math.floor(seconds / SECONDS_PER_HOUR))} 小時`;
}

/**
 * 🔴 每一類最多列幾張單號。
 *
 * **這個數字的來源是【手機上讀得完】,不是 LINE 的長度上限。**
 * Sean 2026-08-19 的原話是「看不懂」與「精簡」,不是「太長送不出去」⇒ 它是可讀性常數。
 *
 * 🔴🔴 **它【不推翻】他「乙:全部印出來,長就長」那一裁** ——
 *   乙 = 他要的**正常行為**;本常數 = 那一裁的**失效保護**,不是它的相反。
 *   他現在是 1 筆;**在 30 筆以下,兩者的輸出逐字相同。**
 *   ⇒ 讀到這裡的人:**不要因為看到一個上限就以為有人把乙偷偷改回甲了。**
 *
 * ✅ **LINE 上限那格【已經查到了】**(2026-08-19)⇒ 見下面的 `LINE_TEXT_MAX_CHARS`。
 *   ~~原本這裡寫「未確認,缺哪一道檢查」~~ —— 那句已完成它的任務,撤掉。
 *   🔴 而查到之後**這顆常數一個字都沒改**:它管的一直是可讀性,長度那格由另一道閘管。
 *     **兩件事各自有各自的守門,不要把它們併成一個數字。**
 *
 * 🔴 **與 SQL 端 `LIMIT 100` 的關係(兩個不同用途的數字,不是同一個常數的兩個落點)**:
 *   100 = payload 護欄(防陣列無上界);30 = 讀得完。
 *   **唯一不變式:30 必須 ≤ 100** —— 要把這顆調到 100 以上,先回去改 migration 那一行。
 */
const MAX_ORDERS_PER_CATEGORY = 30;

/**
 * 🔴 LINE 單則文字訊息的長度上限。
 *
 * ✅ **這個值有來源了**(2026-08-19 由 codex 關卡2 提供並附連結;我自己抓過四發拿不到那一頁):
 *    LINE Messaging API — Text character count
 *    https://developers.line.biz/en/docs/messaging-api/text-character-count/
 *    ⚠️ **單位是 UTF-16 code unit,不是「看起來幾個字」** —— 中文字多半各佔 1 個 code unit,
 *       而 emoji(本訊息開頭那顆 ⚠️)可能佔 2 個。JS 的 `String.length` **正好就是 UTF-16 長度**
 *       ⇒ 這裡用 `.length` 是對的,不要「改成正確的字元數」。
 *
 * 🔴 **為什麼需要這道閘,而不是靠「30 筆應該不會超過」**:
 *    `display_id` 的格式是 `^PCM-[0-9]{4}-[0-9]{4,}$`(`20260604120000:114`)——
 *    **末段是 `{4,}`,沒有上界** ⇒ 「30 筆算起來只有 2,800 字元」是**現在**的算術,不是保證。
 *    而超過上限時 LINE **整封拒收** ⇒ route 回 503 ⇒ **那天的告警等於沒寄**,
 *    🔴 **而那一天正是筆數最多、最需要它的那天。**
 */
const LINE_TEXT_MAX_CHARS = 5000;

/** 留給 subject、分隔換行與截斷說明的餘裕(寧可早一點截,不要卡在邊界)。 */
const LINE_BUDGET_HEADROOM = 400;

/**
 * 最後一道:整封超過 LINE 的上限時,**只截【單號清單】那一段,結尾三行永遠留著**。
 *
 * 🔴 `footer` 不進被截的範圍(理由寫在呼叫端:那裡有網址與唯一那句擋誤退款的警語)。
 *
 * 🔴🔴 **會走到截斷的路有【兩條】,而本函式對兩條都成立 —— 不要把它寫成一條**:
 * ```
 * ① 有人把 MAX_ORDERS_PER_CATEGORY 調高 —— 而那是【明文允許】的(那顆常數自己寫著「30 必須 ≤ 100」)
 *    實測:上限=50、單號正常長度 ⇒ 4,594 字 ⇒ 真的截（而警語與網址都還在）
 * ② `display_id` 末段是 `{4,}`、沒有上界 ⇒ 單號變長
 *    實測:上限=30、單號 60 字元 ⇒ 4,585 字 ⇒ 真的截（同樣兩者都在）
 * ```
 * 📌 **我一度把它寫成「只有②一條」** —— 因為我用「加筆數」去反證①,而筆數被上面那顆常數夾住了
 *    ⇒ **我變的不是我以為在變的那個變數。** 是 R3 的同儕審查把它分開重跑才看出來。
 * 🔴 **這一段之所以要留:下一個把上限從 30 調到 100 的人,會以為自己不在那個世界裡。**
 *    一句只寫對一半的說明,比沒有說明危險 —— 看到它的人會停止思考。
 * 🔴 不做中途切字 —— 半行單號比沒有那行更糟(讀的人會以為那是完整單號)。
 * ⚠️ 極端情況下 `footer` 自己就超過預算(不可能發生於現行三行,但別假設)⇒
 *    那時 body 會被清空,而 **footer 仍然全數保留** —— 這是刻意的:寧可只剩警語,不要只剩清單。
 * 📌 nit(已知,不修):下面 while 每輪重 `join` 是 O(n²)。上限 5,000 字元、每天一封 ⇒ 不值得換寫法。
 */
function fitToLineBudget(subject: string, body: readonly string[], footer: readonly string[]): string {
  const note = '（單號太多,上面只列出一部分 —— 完整清單請到後台看。）';
  const tail = footer.join('\n');
  const full = [...body, ...footer].join('\n');
  const budget = LINE_TEXT_MAX_CHARS - LINE_BUDGET_HEADROOM - subject.length;
  if (full.length <= budget) return full;
  const kept = [...body];
  const fits = () => [...kept, note, ...footer].join('\n').length <= budget;
  while (kept.length > 0 && !fits()) kept.pop();
  return [...kept, note, tail].join('\n');
}

/**
 * 這一類**真的會印出來**的單號。
 *
 * 🔴🔴 **兩個上限,擋兩個不同的病**(第二個是 R3 抓的,我原本只寫了一邊):
 *   · `MAX_ORDERS_PER_CATEGORY` —— 讀不讀得完。
 *   · 🔴 `count` —— **這封信不能自己跟自己打架**。計數與單號來自**兩次查詢**,
 *     而 skew 有**兩個方向**:
 *       `count > ids.length` ⇒ 單號比較少 ⇒ 用「另外還有 N 筆」講清楚(本來就處理了)
 *       🔴 `ids.length > count` ⇒ **單號比較多** —— 兩次查詢之間**新出現**的異常列:
 *          計數那一發沒看到它、單號那一發看到了。沒有夾的話,信上會是
 *          **「【可能被扣了兩次錢】1 筆」底下列 3 個單號**,而收信人不知道該信哪一個。
 *     ⚠️ **我檔頭原本逐字只寫了「`count > ids.length` 是正常狀態」—— 另一邊我沒有分析過。**
 *   ⇒ 夾在 `count` 是**保守的那一邊**:少列的那幾筆,明天早上 9 點那封會出現(它每天寄)。
 */
function shownIds<T>(ids: readonly T[], count: number): T[] {
  return ids.slice(0, Math.max(0, Math.min(count, MAX_ORDERS_PER_CATEGORY)));
}

/**
 * 一段的單號行。
 * 🔴 `hidden` 用 **`count − 實際列出的數量`** 算,不是 `count − 30` ——
 *    SQL 端 `LIMIT 100` 或缺鍵降級都會讓陣列比 `count` 短,寫死 30 會報出一個**假的差額**。
 * 🔴 陣列空而 `count > 0`(舊版 RPC / 部署錯序)⇒ 回空陣列 ⇒ 呼叫端只講筆數,
 *    **不得憑空編一個單號**。
 */
function orderLines(ids: readonly string[], count: number): string[] {
  const shown = shownIds(ids, count);
  if (shown.length === 0) return [];
  const lines = shown.map((id) => `  ${id}`);
  const hidden = count - shown.length;
  if (hidden > 0) lines.push(`  …另外還有 ${hidden} 筆,請到後台看`);
  return lines;
}

/** 一整段(標題 + 筆數 + 單號行);`count <= 0` ⇒ 這一段整個不出現。 */
function section(title: string, count: number, ids: readonly string[], unit = '筆'): string[] {
  if (count <= 0) return [];
  return [`【${title}】${count} ${unit}`, ...orderLines(ids, count)];
}

/**
 * 由摘要組白話告警訊息(只列踩門檻的類別)。
 *
 * 🔴 **文案紀律(三條,改字的人要一起守)**:
 *   ① **零技術詞** —— 收訊者不是工程師。原版有 8 個他看不懂的詞
 *      (sweeper / pending / 孤兒 / 被讓路 / W1 / Report C / plan §4 / dismissed),全部拿掉。
 *   ② **不宣稱「已確認雙扣」** —— open = 候選、待查證(runbook line51)。
 *      末行那句「先查清楚再退款」是**唯一一句在防動錯錢的**,不要因為它不白話就刪掉。
 *   ③ 🔴 **「本訊息零個資、僅計數」那句已經拿掉,而那是必須的** ——
 *      帶了單號之後它就是**假的**,而一句假的隱私聲明比沒有更糟。
 */
export function buildAnomalyAlertMessage(
  summary: AnomalyAlertSummary,
  refundingStuckSeconds: number,
): AnomalyAlertMessage {
  // 🔴 `Math.round(秒/3600)` 會把 5400 秒(90 分)講成「2 小時」= **報一個錯的門檻給收信人**
  //    (codex R2 nit)。正式路徑目前固定 86400,所以今天走不到 —— 而那不是不修的理由:
  //    這個值是 route 端常數、揭示可調,調成非整點的那天沒有東西會紅。
  const stuckLabel =
    refundingStuckSeconds % SECONDS_PER_HOUR === 0
      ? `${refundingStuckSeconds / SECONDS_PER_HOUR} 小時`
      : `${Math.round(refundingStuckSeconds / 60)} 分鐘`;

  // ① 雙扣候選:附最舊年齡(排序訊號、對齊 W1「越久越優先」)。
  const agePart =
    summary.oldestOpenAgeSeconds !== null ? `(最久的已經 ${formatAge(summary.oldestOpenAgeSeconds)})` : '';

  /**
   * 🔴 某一類的單號**沒有列全**(RPC 端 `LIMIT 100`,或部署窗口整個拿不到)。
   * 這個旗標同時餵兩件事:標題的張數(D)與重疊提示(E)。**兩者壞在同一個前提上** ——
   * 「我手上的單號 = 那一類的全部」,而超過 100 筆時那句話就不成立了。
   */
  const truncated =
    summary.openCount > summary.openDisplayIds.length ||
    summary.refundingStuckCount > summary.refundingStuckDisplayIds.length ||
    summary.attemptManualReviewCount > summary.attemptManualReviewDisplayIds.length ||
    summary.releasedStuckCount > summary.releasedStuckDisplayIds.length ||
    summary.pendingDoubleChargeCandidateCount > summary.pendingDoubleChargeDisplayIdPairs.length;

  // 🔴 ④ 與 ③ 可以是**同一顆 attempt**(被讓路的 released 同時達 12h 與達 ceiling)。
  //    原版只能寫「可能與上一項重疊」;**帶了單號之後這件事變成查得出來的** ——
  //    有交集就直接指名是哪一張,沒有交集就不要提(提一個不存在的重疊反而更難讀)。
  // 🔴🔴 **而「沒有交集」只有在兩邊都列全時才等於「沒有重疊」**(codex R2 must-fix,兩輪都抓到):
  //    ③④ 各 101 筆、同一張單落在任一邊的第 101 名 ⇒ 兩個前 100 陣列**都非空且無交集**
  //    ⇒ 舊寫法會把重疊提示**整句刪掉**,而那正是最需要它的時候(101 筆的那一天)。
  //    ⇒ 被截斷時退回保守的「可能」,不要用一個算不準的集合去下斷言。
  // 🔴🔴 **交集要算在【真的印出去的那些】上,不是原始陣列**(關卡2 must-fix):
  //    `attempt = 1 筆 / ids [A,B]`、`released = 1 筆 / ids [D,B]` ⇒ 兩段各只列 A 與 D,
  //    而拿原始陣列算交集會得到 `B` ⇒ 註記會**指名一個信上根本沒出現的單號**,
  //    還說它是「上面那一項」—— 那是**多洩一個單號 + 講一句假話**,兩個問題一起。
  const shownAttempt = shownIds(summary.attemptManualReviewDisplayIds, summary.attemptManualReviewCount);
  const shownReleased = shownIds(summary.releasedStuckDisplayIds, summary.releasedStuckCount);
  const overlap = shownReleased.filter((id) => shownAttempt.includes(id));
  const bothMayOverlap = summary.attemptManualReviewCount > 0 && summary.releasedStuckCount > 0;
  // 🔴 **只看這兩類自己截斷了沒,不看全域 `truncated`**(關卡2 must-fix):
  //    `open` 被截斷、而 ③④ 兩邊都完整且真的無交集時,全域旗標會讓這裡誤報
  //    「可能和上面那一項是同一張單」—— **拿一個無關類別的殘缺,去替這兩類的完整下修**。
  const pairTruncated =
    summary.attemptManualReviewCount > shownAttempt.length ||
    summary.releasedStuckCount > shownReleased.length;
  const overlapNote =
    overlap.length > 0
      ? [`  (${overlap.join('、')} 和上面那一項是同一張單,不是兩件事)`]
      : bothMayOverlap && (pairTruncated || shownReleased.length === 0)
        ? ['  (可能和上面那一項是同一張單)']
        : [];

  const shownPairs = shownIds(
    summary.pendingDoubleChargeDisplayIdPairs,
    summary.pendingDoubleChargeCandidateCount,
  );

  const blocks: string[][] = [
    section(`可能被扣了兩次錢${agePart}`, summary.openCount, summary.openDisplayIds),
    section(
      `退款卡住,超過 ${stuckLabel}還沒退成`,
      summary.refundingStuckCount,
      summary.refundingStuckDisplayIds,
    ),
    section(
      '刷卡卡在中間,系統自己處理不了',
      summary.attemptManualReviewCount,
      summary.attemptManualReviewDisplayIds,
    ),
    [
      ...section('付款沒完成,但錢可能還被鎖著', summary.releasedStuckCount, summary.releasedStuckDisplayIds),
      ...(summary.releasedStuckCount > 0 ? overlapNote : []),
    ],
    [
      ...(summary.pendingDoubleChargeCandidateCount > 0
        ? [`【同一位客人、同樣金額買了兩次,其中一次卡很久】${summary.pendingDoubleChargeCandidateCount} 組`]
        : []),
      // 🔴 走同一支 `shownIds` ⇒ 第五類也受「不得多於計數」那道夾(R3 的 M1 對五類都成立)。
      ...shownPairs.map(([a, b]) => `  ${a} ＋ ${b}`),
      ...(summary.pendingDoubleChargeCandidateCount > shownPairs.length
        ? [`  …另外還有 ${summary.pendingDoubleChargeCandidateCount - shownPairs.length} 組,請到後台看`]
        : []),
    ],
  ];

  /**
   * 標題的數字 = **不重複的單號張數**,不是各類筆數相加 ——
   * ③④ 可以是同一張單(見 `overlap`),相加會報出一個比實際多的數字。
   *
   * 🔴🔴 **而它只有在【單號列全了】的時候才等於「有幾張單」**(codex R2 must-fix):
   *   open 200 筆、RPC 只回得出前 100 ⇒ 標題會寫「100 張單」而內文寫「200 筆」
   *   ⇒ **同一封信自己跟自己打架**,而收信人沒有辦法知道該信哪一個。
   *   ⇒ 被截斷(或整個拿不到)時 **不寫數字** —— 一個沒有數字的標題只是少講一件事,
   *     一個錯的數字會讓他以為事情比較小。**那兩種代價不對稱。**
   */
  // 🔴 用**實際印出去的那些**,不是原始陣列(R3 的 M1):`ids.length > count` 那個方向下,
  //    原始陣列會讓標題報出一個**比各類計數之和還大**的張數。
  const distinctOrders = new Set<string>([
    ...shownIds(summary.openDisplayIds, summary.openCount),
    ...shownIds(summary.refundingStuckDisplayIds, summary.refundingStuckCount),
    ...shownIds(summary.attemptManualReviewDisplayIds, summary.attemptManualReviewCount),
    ...shownIds(summary.releasedStuckDisplayIds, summary.releasedStuckCount),
    ...shownPairs.flat(),
  ]);
  const subject =
    !truncated && distinctOrders.size > 0
      ? `⚠️ PCM 付款有 ${distinctOrders.size} 張單要你看`
      : '⚠️ PCM 付款有事要你看';

  const body = blocks.filter((b) => b.length > 0).flatMap((b) => [...b, '']);

  /**
   * 🔴🔴 **結尾三行是【不可截的】,而這不是排版偏好。**
   *
   * 我第一版的截斷是「從尾端整行 pop」—— 而**尾端就是這三行**
   * ⇒ 訊息一長,先被丟掉的正好是**網址**與**唯一那句擋著誤退款的警語**
   * ⇒ 🔴 **而它消失的那一天,正是筆數最多、最容易退錯錢的那一天。**
   * ⇒ 這封信唯一的危險動作是**退款**(鐵則 12①),而「先查清楚再退款」是全信唯一擋它的東西。
   * ⇒ ⇒ 所以要截的是**上面那些單號**,不是這三行。**清單少幾行仍然可用;少了警語就不是同一封信。**
   *
   * 📌 抓到它的是 R3 的同儕審查,而**我自己那格測試就在造這封信** ——
   *    它只斷言「截斷發生了」,沒有斷言「截完還是一封完整的信」
   *    ⇒ **每一格都在守實作細節,而沒有一格在守【這封信作為一封信】。**
   */
  const footer = [
    // 🔴 「這幾**筆**」不是「這幾**張單**」:`ids` 全空而 `count > 0` 是本片**刻意設計**
    //    的世界(舊版 RPC / 部署窗口)⇒ 那時信上一個單號都沒有,而「這幾張單」**沒有所指**。
    // 🔴 網址只寫【已驗過的根位址】,**不寫深連結**(例如 `/orders?q=<單號>`)——
    //    那條路徑沒有人驗過,而這是一封每天寄出去的信。沒查證過的東西不寫進去。
    //    值的來源(三層,由弱到強;2026-08-19):①Vercel API 該專案 domains 含此網域
    //    ②該網域的 production 部署 state=READY ③🔴 **Sean 本人在瀏覽器打開並截圖,主視窗親眼看畫面**。
    //    ⚠️ 射程:這證的是**那個網域今天開得起來**,不證它永遠不變。
    // 🔴 「(需登入後台)」五個字不可省 —— 它有登入閘,沒帳號的人點下去會看到登入頁。
    'https://admin.pcmmotorsports.com (需登入後台)',
    '請到後台查這幾筆,看過之後再決定要退款還是標記免處理。',
    '⚠️ 先查清楚再退款 —— 上面每一筆都只是「可能」,不是已經確定。',
  ];
  return { subject, text: fitToLineBudget(subject, body, footer) };
}

export async function checkAnomalyAlerts(
  deps: CheckAnomalyAlertsDeps,
  opts: CheckAnomalyAlertsOptions,
): Promise<CheckAnomalyAlertsResult> {
  // reader throw → 上拋(route catch → 503);無法讀狀態時不推播(不知狀態、fail-closed)。
  const summary = await deps.reader.getAlertSummary(
    opts.refundingStuckSeconds,
    opts.pendingDoubleChargeWindowSeconds,
    opts.pendingDoubleChargeStuckSeconds,
  );

  const shouldAlert =
    summary.openCount > 0 ||
    summary.refundingStuckCount > 0 ||
    summary.attemptManualReviewCount > 0 ||
    summary.releasedStuckCount > 0 ||
    summary.pendingDoubleChargeCandidateCount > 0;

  let notifiersTotal = 0;
  let notifiersFailed = 0;

  if (shouldAlert) {
    // 🔴 fail-closed 縱深(關卡2 codex MED):踩門檻卻零 notifier = 告警無處可送 = 沉默故障 → 上拋(route 503、可見)。
    //    live path 由 composition getAnomalyAlertDeps「enabled 但零管道 throw」先擋;此為 use-case 端第二道防線
    //    (防未來其他 composition / 測試替身直接注入空陣列時偽 200)。
    if (deps.notifiers.length === 0) {
      throw new Error('checkAnomalyAlerts:踩告警門檻但未注入任何 notifier(告警無法送達、fail-closed)');
    }
    const message = buildAnomalyAlertMessage(summary, opts.refundingStuckSeconds);
    notifiersTotal = deps.notifiers.length;
    // 各管道各自送(一管道掛掉不影響另一管道);失敗計數 → route 503(壞掉的管道必須可見)。
    const results = await Promise.allSettled(deps.notifiers.map((n) => n.notify(message)));
    notifiersFailed = results.filter((r) => r.status === 'rejected').length;
  }

  return {
    alerted: shouldAlert,
    openCount: summary.openCount,
    refundingCount: summary.refundingCount,
    refundingStuckCount: summary.refundingStuckCount,
    attemptManualReviewCount: summary.attemptManualReviewCount,
    releasedStuckCount: summary.releasedStuckCount,
    pendingDoubleChargeCandidateCount: summary.pendingDoubleChargeCandidateCount,
    oldestOpenAgeSeconds: summary.oldestOpenAgeSeconds,
    notifiersTotal,
    notifiersFailed,
    errors: notifiersFailed,
  };
}
