// date-range.ts — M-4b #347-3b:後台訂單列表「建立日期範圍」的**曆面 → 絕對時刻**換算。
//
// 🔴🔴 **為什麼這支必須存在(而不是讓呼叫端各自 `new Date(ymd)`)**:
//    列表畫面上的日期欄是**固定 Asia/Taipei 曆面**(`order-list-view.ts` 的 `formatOrderListDate`
//    用 `Intl.DateTimeFormat` 釘死 `timeZone: 'Asia/Taipei'`)—— 不是瀏覽器時區、也不是 UTC。
//    而 `new Date('2026-08-10')` 在 JS 裡是 **UTC 午夜**。兩者差 8 小時 ⇒
//    `2026-08-09T16:30Z` 這張單在畫面上顯示 `08/10`,卻會被 UTC 起點的篩選**排除在外**。
//    員工看到的日期是 08/10、選了 08/10、單卻不見了 —— 而且沒有任何錯誤訊息。
//    「篩選與畫面是同一個量」是 #347-3 plan §1-2 的整個理由,用錯時區就當場失效。
//
// 🔴 **半開區間 `[from, to)`**(`20260810120000` migration 檔頭逐字寫死,3b/3c 照著算):
//    RPC 用 `>= p_from AND < p_to`。用 `<=` 配「當天 23:59:59」會在毫秒級漏單(timestamptz 有微秒精度)。
//    ⇒ **UI 的「結束日」是含當天的**:員工選 8/10 就是要看到 8/10 整天的單
//      ⇒ 送 `p_to = 下一個台北午夜`(8/11 00:00+08:00)。這條寫在這裡,呼叫端不要各自解釋。

/**
 * 台灣的 UTC 偏移。
 *
 * 🔴 **寫死 `+08:00` 是刻意的,不是偷懶**:台灣**沒有日光節約時間**(最後一次實施是 1979 年),
 *    所以「台北曆面某日的午夜」對應到唯一一個絕對時刻,不需要查時區資料庫。
 *    ⚠️ 這是一個**假設**,不是恆真:哪天真的恢復 DST(或本函式被拿去算別的時區),
 *    正確修法是改用 `Intl.DateTimeFormat` 反推 offset,而不是把這個常數改成別的數字。
 *    守門:`date-range.test.ts` 有一格把它與 `Intl` 在 Asia/Taipei 的實際 offset 對帳。
 */
const TAIPEI_OFFSET = '+08:00';

/** `YYYY-MM-DD`(曆面日期,非時刻)。 */
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 台北曆面某一天的**午夜**(= 那一天的起點)的絕對時刻 ISO 字串。
 *
 * `'2026-08-10'` → `'2026-08-10T00:00:00+08:00'`。
 * 形狀不合(非 `YYYY-MM-DD`、或不存在的日期如 `2026-02-30`)⇒ 回 `null`,**呼叫端當作沒篩**。
 *
 * 🔴 fail-**open** 是這裡的正確方向,與 `orderNumber` / `keyword` 那幾欄相反 ——
 *    那幾欄「打錯字回零筆」是因為 fail-open 會列出全部訂單、讓人誤以為查無;
 *    日期範圍打錯字回 `null` 只是「這一軸不篩」,而其他軸照舊生效,不會造出假的查無。
 *    ⚠️ 真正的形狀守門在 3c 的 UI(下拉只給得出合法值);本層是縱深。
 */
export function taipeiDayStartIso(ymd: string): string | null {
  if (!YMD_RE.test(ymd)) return null;
  const iso = `${ymd}T00:00:00${TAIPEI_OFFSET}`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  // 🔴 `new Date('2026-02-30T00:00:00+08:00')` 在 V8 上是 **Invalid Date**,但規範沒有保證
  //    所有引擎都這樣(有些會溢位成 3/2)⇒ 回頭比對曆面,不靠引擎的好心。
  return isoBackToTaipeiYmd(parsed) === ymd ? iso : null;
}

/**
 * 台北曆面某一天的**結束邊界** = **下一個**台北午夜(半開區間的 `to`)。
 *
 * `'2026-08-10'` → `'2026-08-11T00:00:00+08:00'`(員工選 8/10 ⇒ 看得到 8/10 整天)。
 *
 * 🔴 **不要改成「當天 23:59:59」** —— `created_at` 是 timestamptz(微秒精度),
 *    23:59:59.5 那筆會被吞掉,而且它是一年只發生幾次、沒人查得出來的那種漏單。
 */
export function taipeiDayEndExclusiveIso(ymd: string): string | null {
  if (taipeiDayStartIso(ymd) === null) return null;
  const next = new Date(`${ymd}T00:00:00${TAIPEI_OFFSET}`);
  next.setUTCDate(next.getUTCDate() + 1);
  return `${isoBackToTaipeiYmd(next)}T00:00:00${TAIPEI_OFFSET}`;
}

/** 絕對時刻 → 台北曆面的 `YYYY-MM-DD`(與列表日期欄同一個曆面)。 */
export function isoBackToTaipeiYmd(instant: Date): string {
  // `en-CA` 的 short date 就是 `YYYY-MM-DD`;用 `formatToParts` 而不是切字串
  // (格式一改就靜默切錯,`order-list-view.ts:442-444` 記過同一條)。
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * 「近 N 個月」的日期範圍(台北曆面),回**半開區間**的兩個曆面日。
 *
 * `now` 必須由呼叫端傳入(純函式;`Date.now()` 進不了本層,否則測不出邊界)。
 *
 * 🔴🔴 **本函式只負責「算得出來」,不負責「要不要套」** —— #347-3b 刻意**不在 adapter 套預設**:
 *    一旦 adapter 在 UI 沒送日期時自己補上近半年,列表就會**默默藏掉半年前的單**
 *    = 員工看得見的產品行為改變。Sean Q14=A 的「未選預設近半年」是**下拉選單的預設值**
 *    (看得見的選單狀態),不是隱形過濾 ⇒ 屬 3c 的產出面。主視窗 2026-08-10 核。
 *    落檔:plan §1-1/§2 與 memory `project_347-3-date-range-default-belongs-to-3c`。
 *
 * 🔴 **月運算必須跑在台北曆面的 y/m/d 上,不能跑在那個瞬間的 UTC 曆面上**(R1 must-fix,實跑推翻我)：
 *    台北午夜 = 前一天 16:00Z ⇒ 用 `setUTCMonth()` 是在**前一天**上減月份,
 *    月長不同時會漂一天:`2026-01-01` 往回 6 個月會得到 `2025-07-02`(**少一天**、漏掉 07-01 整天),
 *    而我原本的註解寫的是「方向是多給而不是漏掉」—— 那句被實跑證偽。
 * 🔴 **日超出目標月就夾到該月最後一天**(8/31 往回 6 個月 → 2/28,閏年 → 2/29):
 *    這是 `date-fns.subMonths` 的慣例,而且方向是**多給**(2/28 起算比 3/3 起算寬)
 *    —— 對「找得到單」這個目的,寬的那邊才是安全的一邊。
 */
export function recentTaipeiMonthsRange(
  now: Date,
  months: number,
): { fromYmd: string; toYmd: string } {
  const toYmd = isoBackToTaipeiYmd(now);
  const [y, m, d] = toYmd.split('-').map(Number) as [number, number, number];
  // 0-based 月序往回推;負數要用 floor 除法才會跨年跨對(`-1 % 12` 在 JS 是 -1、不是 11)。
  const target = m - 1 - months;
  const year = y + Math.floor(target / 12);
  const month0 = ((target % 12) + 12) % 12;
  // 目標月的最後一天(`Date.UTC(y, m+1, 0)` = 該月第 0 天 = 上個月最後一天);
  // 這裡只用 UTC 當**曆法計算器**、不當時區 —— 進出都是曆面數字,沒有時刻語意。
  const lastDay = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { fromYmd: `${year}-${pad(month0 + 1)}-${pad(day)}`, toYmd };
}
