/**
 * ⟦b4-EMAILTRIAGE⟧ 甲-3:排信前的「這一發會寄幾封」批次上限閘。
 *
 * ══ 病灶 ═══════════════════════════════════════════════════════════════════
 * cutoff 貼錯年份(或有人手插一列)⇒ 掃描面一次冒出大量舊單 ⇒ **大量補寄**。
 * 而排信這一層在此之前**沒有任何一道閘會問「這一發要排幾封」** ——
 * 六支 `enqueue-*.ts` 掃到幾列就排幾列, 而寄出去的信收不回來。
 *
 * ══ N = 20 的依據(不是拍腦袋, 而它也【不是】從正式庫的資料推出來的)════════
 * 🛑 **先講證不到的**:2026-09-07 唯讀正式庫 ⇒ 全站訂單 **4** 張 · outbox **5** 列 ·
 *    有資料的天數 **2** · 單日最多【排信】 **3** 封 · 單日最多【下單】 **2** 張
 *    (🔵 負對照現造事件型別 ⇒ 0)。⚠️ **「排幾封」與「幾張單」是兩個數, 不要互相代入。**
 *    ⇒ 📌 **分母 2 天、峰值 3 —— 那組數字撐不起任何門檻**, 所以 N 不從它來。
 * ✅ **N 從碼的量級來**(`apps/storefront/src/app/api/cron/email-sweep/route.ts`):
 *    · `ENQUEUE_LIMIT = 50`(`:168`)—— 六種信各自傳給自己的 scanner
 *    · `CLAIM_LIMIT = 50`(`:108`)· 排程 = **每 5 分鐘一輪**(`20260819160000:213` 那個 cron 字串;
 *      🔴 這裡刻意不寫那五個字元 —— 它含 `*` 加斜線, 會把這個區塊註解【提早關掉】,
 *      而症狀是整支檔語法錯, 不是註解怪怪的。踩過一次, 留著這句。)
 *    ⇒ 12 輪/小時 ⇒ **寄送天花板 600 封/小時**。
 *    一輪覆蓋 5 分鐘的生意 ⇒ 同一種信在 5 分鐘內排到 20 封 = **每分鐘 4 封**。
 *    ⚠️ **換算成「一天 5,760 封」要多一個假設:全天均勻**。真實的一天不是均勻的
 *       (促銷、上架、批次出貨都會擠在一起)⇒ 📌 **5,760 是量級參考, 不是預測值**,
 *       而 20 是「一分鐘 4 封同一種信」這個直覺量級, 不是從那個年化數字倒推的。
 *    對照今天的實測:單日最多排 **3** 封 ⇒ 20 在【每一種說法下】都遠高於現況、又低於既有的 50。
 *
 * ══ ⚠️ 三段式改了什麼(codex `gpt-6-astra` 2026-09-07 12⑤ 問出來的, 不是我主動想到的)══
 * 原本是「邊解析邊排」, 現在是「全部解析完 → 問一次 → 再排」。兩個差異寫出來:
 * ① **組裝失敗的時機**:`countNewEvents` 內部會跑 `composeEvent`(那是刻意的, 鍵才不會分岔)
 *    ⇒ 若某一筆組裝就 throw, **現在整批 0 排**, 而改版前是那一筆 `errors += 1`、其餘照排。
 *    🔵 codex 說它「未證成現行合法資料可觸發」(DB 約束已擋掉多數空值反例)⇒ 不列缺陷, 而**列出來**。
 * ② **撞閘那一輪的計數不回傳**:閘 throw ⇒ 已經累加的 `noRecipient` 隨著 result 一起丟掉,
 *    呼叫端只會看到 catch。⇒ 那一輪的 `noRecipient` 在 log 上是**沒有讀數**, 不是 0。
 *
 * ══ 🛑 這道閘【擋不到】什麼(誠實列, 不是免責)════════════════════════════
 * ① **慢速大量**:每輪 19 封、連續數小時 ⇒ 每一輪都合法, 而總量一樣很大。
 *    ⇒ 那要靠**累計視窗**(不是單輪閘)。主視窗 B 2026-09-07 裁**本片不做**,
 *      已知限制寫進板列 `⟦mail-ENQUEUEBATCHCAP⟧`。
 * ② **20~50 那一段才是它真正在守的範圍** —— 因為 `ENQUEUE_LIMIT = 50` 已經在上游
 *    把單輪列數壓在 50, 所以「一次超過 N」在 N ≥ 50 時**永遠不會成立**。
 *    ⇒ 📌 一道設在 50 的閘會是**恆真**的, 而它看起來跟一道有效的閘一模一樣。
 * ③ 它問的是**排信**不是**寄送**:撞閘那一種信本輪不排, 而**已經在 outbox 裡的照寄**。
 *
 * ══ 撞閘之後怎麼恢復 ═══════════════════════════════════════════════════════
 * 合法的補寄(例如照 `docs/runbooks/email-sweep-kill-switch.md` 停信幾小時後重開)
 * **會撞到這道閘, 而那是對的** —— 處置寫在那支 runbook 的「撞到批次上限閘怎麼辦」一節:
 * 先確認那批**真的該寄**(cutoff / 年份 / 資料), 確認了才改這裡的常數重佈。
 * 🔴 **刻意不給 env 開關** —— 一個 `*_ENABLED` 會讓「解除大量寄信的保護」變成
 *    改一個環境變數就好, 那是鐵則 12④ 那一面(平台設定)自己長出來的第二個入口。
 */

/** 單一事件型別、單一輪次的排信上限。改它 = 改「一次最多寄幾封」的保護, 見檔頭。 */
export const ENQUEUE_BATCH_CAP = 20;

export class EnqueueBatchCapExceededError extends Error {
  constructor(
    readonly eventType: string,
    readonly count: number,
    readonly cap: number,
  ) {
    // 🔴 訊息零 PII:只有型別名與兩個數字, 沒有訂單號 / 信箱 / 金額。
    super(`排信批次上限:${eventType} 這一輪要排 ${count} 封, 上限 ${cap} ⇒ 本輪不排`);
    this.name = 'EnqueueBatchCapExceededError';
  }
}

/**
 * 撞上限 ⇒ throw。呼叫端(`email-sweep/route.ts` 六個 catch)會把它記成
 * **那一種信**的 `failed` + 一行 log, 其他五種照跑, 而整輪最後回 503。
 * 🔵 `count === cap` 是**放行**的 —— 「超過」才擋。驗收那兩格(20 排 / 21 不排)釘的就是這一格。
 */
export function assertEnqueueBatchWithinCap(
  eventType: string,
  count: number,
  cap: number = ENQUEUE_BATCH_CAP,
): void {
  if (count > cap) {
    throw new EnqueueBatchCapExceededError(eventType, count, cap);
  }
}

/**
 * 給呼叫端的 log 用:撞閘時給出**型別與數量**(主視窗 B 2026-09-07 要的那一行),
 * 不是撞閘就回空物件 ⇒ 與既有 `ScanQueryError` 那個 allowlist 手法同形。
 */
export function describeEnqueueBatchCap(
  err: unknown,
): { reason_detail: string; eventType: string; count: number; cap: number } | Record<string, never> {
  if (err instanceof EnqueueBatchCapExceededError) {
    return {
      reason_detail: 'enqueue_batch_cap_exceeded',
      eventType: err.eventType,
      count: err.count,
      cap: err.cap,
    };
  }
  return {};
}
