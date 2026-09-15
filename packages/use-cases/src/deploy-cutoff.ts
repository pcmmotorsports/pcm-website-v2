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
 * ⟦mail-CUTOFFYEARTYPO⟧ 合理範圍:**`2026-08-01T00:00:00Z`(寫死的地板)~ `now + 35 天`**。
 * 🔴🔴 **兩端的參照點刻意不同, 而那是這一格的全部重點**(2026-09-15 codex 翻出, 主視窗裁甲):
 *   · **上界相對 `now`** —— 防「往後打錯」(2026 貼成 2027)。cutoff 常態設在過去幾天,
 *     打錯往後跳 ≈365 天 ⇒ **設定當下**遠超 `now + 35` ⇒ 擋得到;而合法值永遠在界內。
 *     ⚠️ (codex nit)那個擋是【設定當下】的:一顆打錯而沒人修的未來值, 放到 `now + 35` 追上它的那天
 *        會從 `invalid` 翻成 `ok` —— 那段期間那條線每輪 503、吵得出來, 所以要在那之前被修掉。
 *   · **下界是【絕對地板】** —— 防「往前打錯」(2026 貼成 2025)。地板取寄信線最早上膛之前
 *     (`B4_DEPLOY_CUTOFF` 記錄 `2026-08-19`)⇒ 2025 一律低於地板 ⇒ 擋得到。
 *   ⛔ ~~下界 `now - 30 天`~~ —— **那讓【合法值】自己過期**:值一個字沒動, 每一輪用新的 `now` 重算
 *     ⇒ 滿 30 天那一刻判 `invalid` ⇒ 那條寄信線整條停(新的不排、送出側開關也關)、每輪 503。
 *     🔬 codex 用這支 parser 實跑:`2026-09-01T00:00:00Z` ⇒ 09-30 `ok`、10-01 00:00:01 `invalid`。
 *     🔴 正式站 `B4_DEPLOY_CUTOFF` 記錄 `2026-08-19T03:14Z` ⇒ **原本會在 2026-09-18 11:14(台北)撞線,
 *        付款信停寄**;其餘四顆在 09-30 ~ 10-12 之間陸續撞。
 *   📌 **原本那句「相對 now, 不寫死年份 —— 一個修法若自己會過期…」推理剛好反了**:
 *     它對上界成立(相對 now 才不會過期), 對下界不成立(相對 now 正是會過期的那一個)。
 *     ⇒ 不寫死的那一端會老化;寫死的那一端只會【越來越寬】, 不會把合法值判壞。
 *   🛑 **地板會越來越寬, 那是已知代價**:一年後「往前打錯一年」若剛好落在地板之後就擋不到了
 *     (例:2027 年把 2027-03 貼成 2026-09)。要收緊 ⇒ 往後搬地板, 不要改回相對 now。
 * · **上界 35 天**(⛔ ~~400~~ —— 2026-09-07 tidy 證偽、主視窗改判):
 *   🔴 **400 擋不到它要擋的那個 typo**:截止日常態設在**過去**幾天, 年份 +1 之後只往前 ≈365 天
 *   ⇒ **恆在 400 內**(實算:`2027-09-01` 距 `2026-09-07` 僅 **359** 天 ⇒ 界內 ⇒ 放行)。
 *   🎯 **成因:用一個【絕對距離】去擋一個【相對錯誤】—— 那兩件事的單位不同。**
 *   ⇒ 35 天:年份 +1 的 ≈365 天遠大於它 ⇒ **必被擋**。
 *   ⚠️ **代價明寫**:刻意要設 35 天以後的截止日**會被擋** —— 那是**設計不是壞掉**, 改這一行即可。
 */
/** 下界 = 寫死的絕對地板(理由見上段)。🛑 不要改回相對 now —— 那會讓合法值自己過期。 */
const CUTOFF_FLOOR_MS = Date.parse('2026-08-01T00:00:00.000Z');
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
  const from = new Date(CUTOFF_FLOOR_MS);
  const to = new Date(now.getTime() + CUTOFF_UPPER_DAYS * DAY_MS);
  if (parsed.getTime() < from.getTime() || parsed.getTime() > to.getTime()) {
    return {
      kind: 'invalid',
      acceptedRange: { from: from.toISOString(), to: to.toISOString() },
      // 🔵 **被擋的人要知道這是設計不是壞掉** —— 而這一句**不含收到的值**
      //    (呼叫端 `email-sweep/route.ts:459` 逐字「不印那個值」)。
      hint: '超出範圍是刻意的擋(防年份打錯);真要設更遠 ⇒ 改 deploy-cutoff.ts 的 CUTOFF_UPPER_DAYS / CUTOFF_FLOOR_MS',
    };
  }
  return { kind: 'ok', cutoff: raw };
}
