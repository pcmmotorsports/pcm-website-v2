/**
 * `B4_DEPLOY_CUTOFF` 的**單一裁決點**。
 *
 * 🔴🔴 **為什麼要抽出來**(2026-08-31,線【出貨】`-1e`):
 * 這支解析原本**只住在 `apps/storefront/src/app/api/cron/email-sweep/route.ts` 裡**,
 * 而訊號 4 的告警端要讀**同一顆 env**。
 * ⇒ 各寫一份 ⇒ **兩個消費者、兩套驗證** ⇒ 它們對同一個字串有不同的世界觀。
 *
 * 📌 **而那不是設想** —— 同一天在 `SHIPPED_EMAIL_CUTOFF` 上量到過一次:
 * 寄信端用 `resolveShippedEmailCutoff`(有格式檢查與下界)、告警端只 `trim()`
 * ⇒ 設一個早於下界的值 ⇒ **寄信端擋下一封不寄,而告警端收下照數**
 * ⇒ 告警每天叫一件寄信端【結構上做不到】的事。
 * ⇒ ✅ 所以這一次**先抽再接**,不是接完再說。
 *
 * 🛑 **本檔是【搬移】不是重寫** —— 邏輯與註解逐字沿用 `email-sweep/route.ts` 的原版,
 * 那些理由是 codex 兩輪 must-fix 換來的,不要因為看起來囉嗦就精簡。
 */

/**
 * ISO 8601 UTC 的**形狀**(毫秒可有可無)。
 * 🔴 **形狀對 ≠ 日期存在**(codex 關卡2 R4 must-fix 3):`2026-13-40T25:61:61Z` 過得了這個正則。
 *    那種值會一路送進 PostgREST,失敗在那裡 ⇒ 回 `failed` + `stage=orders` + DB code
 *    ⇒ **接手的人會往權限 / schema / 網路查,而不是去看 env** —— 我們設計的分流當場失效。
 *    ⇒ 所以下面還要做一次 **round-trip**:parse 回 Date、再 `toISOString()` 比對回來。
 */
const ISO_UTC_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

export type DeployCutoffRead =
  | { kind: 'unset' }
  | {
      kind: 'invalid';
      /**
       * ⟦mail-CUTOFFYEARTYPO⟧ 2026-09-07:被**範圍**擋下時說得出「我接受的是 A 到 B」。
       * 🔴 **只帶邊界, 不帶【收到的值】** —— 呼叫端 `email-sweep/route.ts:459` 逐字
       *    「**只印 env 名與固定 reason, 不印那個值**」, 這一欄不得違反那個規矩。
       * 🔵 形狀不合(非範圍)時**不給這一欄** ⇒ 兩種 `invalid` 在下游分得開。
       */
      acceptedRange?: { from: string; to: string };
      /** 被擋的人要知道**這是設計不是壞掉**;同樣**不含收到的值**。 */
      hint?: string;
    }
  | { kind: 'ok'; cutoff: string };

/**
 * 🔴 **不准隨便填一個看起來合理的時戳**:
 * · 填【早】了 ⇒ 掃到 B-4 之前建的舊單 ⇒ 那些單 `notification_email` 是 NULL ⇒ 走 `customers.email`
 *   ⇒ **客人收到一封關於幾個月前那張單的通知信**,而 repo 內不會有任何東西紅。
 * · 填【晚】了 ⇒ 已由 B-4 新程式處理、但 `created_at < cutoff` 的單**被永久排除**
 *   ⇒ 少數客人沒收到信,而 route 一路 200、counts 正常(codex R3 consider:這一種更不明顯)。
 *
 * ⚠️ **參數化,不自己讀 `process.env`** —— 呼叫端各自帶 `no-restricted-syntax` 的受控例外註解,
 * 而那道 lint 規則的存在理由(動態 env 不進 client bundle)只在 route 那一層說得清楚。
 */
/**
 * ⟦mail-CUTOFFYEARTYPO⟧ 合理範圍:`now - 30 天` ~ `now + 400 天`(主視窗 2026-09-07 指定)。
 * 🔴 **相對 `now`, 不寫死年份** —— 📌 **一個修法若自己會過期, 它修的不是那個病, 是把它延後一年。**
 * · **下界 30 天**:容得下「補設一個剛過去的截止日」。
 *   🔬 **驗過**(2026-09-07):repo + docs + 信箱裡設過的 cutoff 值共 **9 個**, 最遠的
 *   `2026-08-11` 距當日 **27 天** ⇒ **沒有人設過超過 30 天的** ⇒ 下界維持 30。
 *   🛑 **而 27 貼得很近** —— 這是「**查無**」不是「不存在」;真的要設更遠 ⇒ 改這一行、不要繞過。
 *   (🟢 正對照:那三個 env 名在 repo **53** 支檔命中 · 🔵 負對照 現造 env 名 ⇒ **0**。)
 * · **上界 35 天**(⛔ ~~400~~ —— 2026-09-07 tidy 證偽、主視窗改判):
 *   🔴 **400 擋不到它要擋的那個 typo**:截止日常態設在**過去**幾天, 年份 +1 之後只往前 ≈365 天
 *   ⇒ **恆在 400 內**(實算:`2027-09-01` 距 `2026-09-07` 僅 **359** 天 ⇒ 界內 ⇒ 放行)。
 *   🎯 **成因:用一個【絕對距離】去擋一個【相對錯誤】—— 那兩件事的單位不同。**
 *   ⇒ 35 天:年份 +1 的 ≈365 天遠大於它 ⇒ **必被擋**。
 *   ⚠️ **代價明寫**:刻意要設 35 天以後的截止日**會被擋** —— 那是**設計不是壞掉**, 改這一行即可。
 */
const CUTOFF_LOWER_DAYS = 30;
const CUTOFF_UPPER_DAYS = 35;
const DAY_MS = 24 * 60 * 60 * 1000;

export function readDeployCutoff(raw: string | undefined, now: Date = new Date()): DeployCutoffRead {
  // 🔴 `raw === undefined` 才是「沒設」(codex 關卡2 R5 must-fix)。
  //    原本寫 `!raw` ⇒ **env 設了、但值是空字串** 會被判成「沒設」⇒ 回 200 `skipped_no_cutoff`
  //    ⇒ 有人設定填錯(貼成空值)而**整件事安靜地沒發生**,正是本片一直在防的那種壞法。
  //    空字串過不了下面的形狀檢查 ⇒ 落 `invalid` ⇒ 吵得出來。
  if (raw === undefined) return { kind: 'unset' };
  if (!ISO_UTC_SHAPE.test(raw)) return { kind: 'invalid' };
  // 🔴 round-trip:`Date` 對 `2026-13-40T25:61:61Z` 會回 Invalid Date;
  //    對「形狀合法但被正規化過」的值(例 `2026-02-30`)則會回到不同的字面 ⇒ 一併擋掉。
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return { kind: 'invalid' };
  const normalized = parsed.toISOString();
  if (normalized !== raw && normalized !== `${raw.slice(0, 19)}.000Z`) return { kind: 'invalid' };
  // 🔴 **上面四道全部擋【格式】, 而「2025 貼成 2026」是一個【格式完全合法】的值** ——
  //    它過得了形狀、過得了 `Date`、過得了 round-trip ⇒ 📌 **缺口不是「沒有守門」,
  //    是【守門擋不到一個看起來完全正常的值】** —— 而那比沒有守門更難發現。
  // 🛑 **邊界用 `<` / `>`(界內含端點)** —— 端點本身合法, 而測試有一格釘住它。
  const from = new Date(now.getTime() - CUTOFF_LOWER_DAYS * DAY_MS);
  const to = new Date(now.getTime() + CUTOFF_UPPER_DAYS * DAY_MS);
  if (parsed.getTime() < from.getTime() || parsed.getTime() > to.getTime()) {
    return {
      kind: 'invalid',
      acceptedRange: { from: from.toISOString(), to: to.toISOString() },
      // 🔵 **被擋的人要知道這是設計不是壞掉** —— 而這一句**不含收到的值**
      //    (呼叫端 `email-sweep/route.ts:459` 逐字「不印那個值」)。
      hint: '超出範圍是刻意的擋(防年份打錯);真要設更遠 ⇒ 改 deploy-cutoff.ts 的 CUTOFF_UPPER_DAYS',
    };
  }
  return { kind: 'ok', cutoff: raw };
}

/**
 * ⟦b4-CUTOFFWRONGCOLUMN⟧ 乙 —— **盯住一個「今天剛好無害」的假設,而它的到期日不會自己出聲。**
 *
 * 🔴 病在哪:`SupabaseUnpaidCancelledOrderScannerAdapter.ts:179-180` 同時用
 *    `.gte('cancelled_at', cutoff)` 與 `.gte('created_at', cutoff)`,而該檔自己逐字寫著
 *    「`created_at >= cutoff` 是一個【已知會漏信】的條件:它漏掉「cutoff 之前建立、之後被員工取消」的單。
 *      今天無害(未付款單 1 天就 expire),而它會在【有人給這條線一顆新 cutoff 的那天】開始靜靜漏。」
 *
 * 🎯 **而那個「新 cutoff 的那天」沒有任何東西在盯** —— cutoff 是 env(`B4_DEPLOY_CUTOFF`),
 *    repo 裡的測試看不到它的值 ⇒ 只有 runtime 問得到。
 *
 * 🔵 **門檻不是我發明的**:未付款單的 TTL 是 `interval '1 day'`
 *    (`supabase/migrations/20260828060000_m4b_b4cron6_expire_unpaid_orders_heartbeat.sql`,該檔 2 處)。
 *    ⇒ cutoff 剛移動的那一天之內,**「cutoff 之前建立、之後被員工取消」的單真的存在得了**;
 *      過了 TTL + 餘裕之後,那種單應該已經被自動過期清掉 ⇒ 漏的窗口關上。
 *    ⇒ 這裡取 **TTL 1 天 + 1 天餘裕 = 48 小時**。餘裕是刻意的:過期排程是 `0 * * * *`(每小時),
 *      而「應該被清掉」與「已經被清掉」之間有一個排程間隔。
 *
 * 🛑 **它只回一個判斷,不做任何事** —— 呼叫端只拿它去 log。零行為改變。
 *
 * 🔴🔴 **射程(2026-09-08 code-reviewer R1 #1 指出,我原本寫得比碼強)**:
 *    **它的觸發條件是「cutoff 這個【值】落在 48h 內」,不是「cutoff 被【換掉】了」。**
 *    ⇒ 那兩者不是同一件事,而有一條可達的路會讓它【永遠不叫】:
 *      cutoff 放超過 30 天 ⇒ `readDeployCutoff` 判 `invalid`(下界 `CUTOFF_LOWER_DAYS`)
 *      ⇒ 整條線 `skipped_bad_cutoff` 靜靜停;幾天後有人補設一顆**回填的** cutoff
 *      (本檔上面逐字寫著「截止日常態設在**過去**幾天」)⇒ 第一發 sweep 時 age 已 > 48h
 *      ⇒ 🛑 **它一次都不會叫,而那段空窗裡 `created < 新cutoff <= cancelled` 的單是永久漏掉的。**
 *    ⇒ 📌 所以「往前搬看不到」只是這個病的一半;**回填式換值它也看不到。**
 *    ⇒ ✅ **要涵蓋那一半,得盯【值有沒有變】而不是【值有多新】** —— 那需要一個
 *      「上一次看到的 cutoff」落點(DB 或 outbox),本片沒有做。
 *
 * 🛑 **它證不到什麼**:①它不知道那種單今天存不存在(那要查 DB)
 *    ②「有人把 cutoff 往【前】搬」(改成更舊)看不到 —— 那個方向不會漏信,會多寄。
 *    ③**回填式換值**看不到(見上面射程那段)。
 *
 * ⚠️ **而那個 48 小時吃了一個沒寫下來的前提**(R1 #3):**過期排程還活著**。
 *    有人 `cron.unschedule` 掉 `pcm-expire-unpaid-orders`(信線就有這種 runbook)
 *    ⇒ 未付款單的 TTL 實際上變成無限 ⇒ **48h 這個門檻當場失效,而這道守門照樣安靜。**
 */
export const UNPAID_CANCEL_CUTOFF_FRESH_WINDOW_MS = 48 * 60 * 60 * 1000;

export function unpaidCancelCutoffIsFresh(
  cutoff: string,
  now: Date = new Date(),
): { fresh: boolean; ageMs: number; unparseable: boolean } {
  // 🔴 **餵不進去的值要自己出聲**(2026-09-08 R1 #6):`new Date('垃圾')` ⇒ NaN
  //    ⇒ `NaN >= 0` 是 false ⇒ **「這個值我讀不懂」與「這顆 cutoff 舊而安全」印同一個答案**。
  //    今天唯一呼叫端有 `kind === 'ok'` 擋著所以撞不到, 而它是 public export ⇒ 分開回。
  const ageMs = now.getTime() - new Date(cutoff).getTime();
  if (Number.isNaN(ageMs)) return { fresh: false, ageMs: Number.NaN, unparseable: true };
  return {
    fresh: ageMs >= 0 && ageMs < UNPAID_CANCEL_CUTOFF_FRESH_WINDOW_MS,
    ageMs,
    unparseable: false,
  };
}
