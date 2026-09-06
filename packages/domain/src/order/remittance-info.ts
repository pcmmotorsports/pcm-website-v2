// remittance-info.ts —— 匯款收款資訊(Sean 2026-09-03 本人給的)與匯款期限。
//
// 🔴 **為什麼在 domain 不在 order-email-copy**:這五樣有**兩個落點** ——
//    ① 下單信(段 4)② 顧客站選了匯款之後的畫面(段 1)。
//    ⇒ 放在 `order-email-copy.ts` 的話, 那個檔名對第二個落點是**假的**。
//
// 🛑 **鐵則 9 分級 = L1**(判準是改動頻率):公司收款帳戶只在換銀行時變 ⇒ 年 0-1 次。
//    ⚠️ **而 L1 的代價不是頻率問題, 要寫在這裡因為它是【下一次的成本】**:
//      hardcode ⇒ **改帳號要重新部署**。而這是印在客人信上的收款帳號,
//      印錯 = 客人把錢匯到別的地方。
//    ⇒ 📌 **所以驗收不是「畫面顯示得出來」, 是「那串數字有沒有第二個人對過」。**

/**
 * 收款資訊 —— **Sean 2026-09-03 23:2x 本人在對話裡貼出**, 23:4x 逐字回「資訊正確」。
 *
 * 🔴🔴 **而他第一發回的是「這是啥?」** —— 那不是他忘了,
 *    是**脫離上下文他認不出這串數字**;主視窗把他自己那則的原話貼回去, 他才判得出來。
 *    ⇒ 📌 **要人確認一個值, 必須同時給他【那個值是從哪來的】**, 否則他在對一個沒有上下文的字串。
 *    🛑 **⇒ 改這裡之前**:把新的那串**連同它從哪來**一起端給他, 不要只問「這樣對嗎」。
 *      (那次來回花了三則訊息, 而前兩則都沒有回到那一句。)
 *
 * 🔵 **他貼的原字面(未 trim)**, 留著讓對照的人看得到差在哪:
 * ```
 * 銀行名稱: 中國信託          ← 尾巴有 1 個空白
 * 分行: 城北分行
 * 戶名:  派達有限公司         ← 值的前面有 1 個空白
 * 帳號: 200540278354
 * ```
 * ⚠️ 主視窗轉述時寫「戶名前面有**兩個**空白」—— 那**包含 `key: value` 的分隔空白**;
 *    值本身是 **1 個**(我自己用 `len(原字面) - len(trim)` 量的)。
 *
 * 🔬 **帳號位數我自己數過**(不是抄轉述):`len('200540278354')` = **12**、`isdigit()` = true。
 */
export const PCM_REMITTANCE_BANK_NAME = '中國信託';
export const PCM_REMITTANCE_BRANCH = '城北分行';
export const PCM_REMITTANCE_ACCOUNT_NAME = '派達有限公司';
/** 🔴 12 碼純數字。改它之前先讀上面那段「他第一發回的是『這是啥?』」。 */
export const PCM_REMITTANCE_ACCOUNT_NO = '200540278354';

/**
 * 🆕 **Sean 自己加的第五樣**(我們只問了四樣)—— 逐字「匯款備註請填寫訂單編號」。
 *
 * 🔴 **它的用途是【對帳】** —— 錢匯進來時認得出是哪一單。
 * 🔵 而他界定它是「**匯款時候**要讓客人知道的資訊」。
 * ⚠️ **而「匯款時候 ⇒ 所以顧客站的畫面上也要有」是【主視窗的推論】, 不是他的話。**
 *    ⇒ 📌 標在這裡, 因為那個推論會跟著這個常數一起被搬到第二個落點。
 */
export const PCM_REMITTANCE_MEMO_INSTRUCTION = '匯款備註請填寫訂單編號';

/**
 * 匯款/現金單多久沒付款就自動取消 —— **Sean 2026-09-03 逐字「乙 5天」**
 * (現金同值, 逐字「甲 跟匯款一樣 5 天」)。
 *
 * 🔴🔴 **這個數字有兩個消費者, 而它們在【兩種語言】裡**:
 * ```
 * SQL  ⛔ ~~20260903080000_m4b_expire_unpaid_by_payment_channel.sql~~ **不是現行那一代**
 *      ✅ 正式庫現在跑的是 20260904230000(2026-09-06 唯讀量到 prosrc md5 b91dc977…);
 *         貼板 53 之後會是 20260906600000_m4b_expire_day_boundary.sql
 *      的 CASE:bank_transfer / cash ⇒ interval '5 days'   ← 真正在【執行】的那一份
 *      🔴 查現行是哪一代:`bash scripts/latest-definition-of.sh expire_unpaid_orders`
 * TS   本常數                                              ← 印在信上與畫面上給客人看的那一份
 * ```
 * 🛑 **⇒ 所以「只寫一次」在這裡物理上做不到** —— TS import 不了 SQL。
 * ⇒ ✅ **而做得到的是:讓它們分岔的那一刻【有東西會紅】。**
 *   `remittance-info.test.ts` 直接讀那支 migration 的字面, 斷言兩邊相等。
 * ⇒ 📌 **一個「單一來源」做不到的地方, 退而求其次的不是「小心一點」, 是一道會叫的閘。**
 */
export const PCM_REMITTANCE_EXPIRE_DAYS = 5;

/**
 * 匯款期限的**那一天**(Sean 2026-09-05 第 3 題拍**甲** —— 逐字「改成直接寫日期」)。
 *
 * 🔴🔴 **起算點是 `orders.created_at`, 而那是【量到的】不是猜的**:
 *   ⛔ ~~cron 的條件逐字是 `o.created_at < now() - interval '5 days'`~~ **2026-09-06 起作廢** ——
 *   ✅ 現行條件是**台北日界**:`now() >= timezone('Asia/Taipei', date_trunc('day',
 *   timezone('Asia/Taipei', created_at)) + interval '5 days' + interval '1 day')`
 *   (`20260906600000_m4b_expire_day_boundary.sql`;Sean 2026-09-06 逐字拍【乙】「第 5 天整天都算, 隔天 00:00 才取消」)。
 *   🔵 **這讓下面那句「(含)」從【近似正確】變成【逐格正確】** —— 舊版第 5 天下午就可能被取消。
 *   🛑 而 `tappay` **沒有**跟著改, 它仍是時戳比較 1 天(主視窗 `-f8` 2026-09-06 裁甲)。
 *   ⇒ 📌 **所以「還剩幾天」的分母是下單那一刻, 不是付款、不是最後一次改單。**
 *
 * 🛑 **邊界要講清楚, 因為它決定客人會不會白跑一趟**:
 *   ⛔ ~~cron 是 `created_at < now() - 5 days` ⇒ 第 5 天當天還沒到期, 第 6 天才會被掃到~~
 *   ✅ **現在是台北日界**:第 5 天**整天**有效, **隔天 00:00(台北)**才會被掃到。
 *   ⇒ ✅ 所以「請於 X 前完成匯款」的 X = `created_at + 5 天`那一天,
 *     而那一天**當天仍然有效**(⇒ 文案用「**X(含)之前**」, 不用「X 之前」)。
 *   ⛔ ~~⚠️ 而 cron 幾點跑不是我們控制的 ⇒ 那一天的深夜仍有風險~~ **2026-09-06 起不再成立** ——
 *     日界之後, 第 5 天的**任何時刻**都還在期限內;cron 幾點跑只影響「隔天多晚被取消」。
 *     🔵 排程是 `'0 * * * *'`(每小時整點, DB 走 UTC)⇒ 台北 00:00 那一發會掃到。
 *
 * 🔴 **時區**:cron 跑在 DB(UTC),而客人看的是台灣時間。
 *   ⇒ 本函式用 `Asia/Taipei` 取**下單那一天的日曆日**, 再在日曆上加 N 天
 *     —— 與 SQL 那一半**同一個算法**(2026-09-06 起;見函式內的 codex R2 #12 那段)。
 *   ⛔ ~~代價明寫:UTC 與台北差 8 小時 ⇒ 極端情況下畫面那一天與 cron 掃到的時刻可能差不到一天~~
 *     **作廢** —— 日界之後兩邊算的是同一個日曆日, 那個偏差不存在了。
 *
 * @param createdAtIso 下單時間(ISO 8601)。**不合法就回 `null`** —— 🔴 **算錯的日期比不算糟**:
 *   客人照著一個錯的日期去匯款, 錢到了而單子已經被取消。呼叫端拿到 `null` 要退回「N 天內」那句。
 */
export function remittanceDeadlineLabel(createdAtIso: string): string | null {
  const t = Date.parse(createdAtIso);
  if (!Number.isFinite(t)) return null;
  // 🔴🔴 **先取【下單那一天在台北的日曆日】, 再在日曆上加 N 天**(codex R2 #12 打回舊版)
  //    ⛔ ~~舊版是 `new Date(t + N * 24 * 60 * 60 * 1000)` 再取台北日期~~ —— 那是**絕對時間 +120 小時**。
  //    🔬 兩者在「那段區間內台北的 UTC 偏移沒變」時相等, 而**台灣 1945-1961 實施過夏令時間**
  //      ⇒ codex 構造出 `1946-05-10T15:30:00Z`:舊版顯示「5 月 16 日(含)」,
  //        而 SQL 的日界在 5/16 00:00 就取消 ⇒ **畫面說當天有效, 系統已經取消了。**
  //    ⇒ ✅ 改成日曆加法之後, 這一支與 SQL 的
  //      `date_trunc('day', created_at AT TIME ZONE 'Asia/Taipei') + N days` **是同一個算法**,
  //      ⇒ 📌 不再依賴「沒有 DST」這個前提。
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(t));
  const get = (k: string): number | null => {
    const v = parts.find((x) => x.type === k)?.value;
    return v === undefined ? null : Number(v);
  };
  const y = get('year');
  const mo = get('month');
  const da = get('day');
  if (y === null || mo === null || da === null) return null;
  // 🔵 用 UTC 當「無時區的日曆」載體:Date.UTC 只做日曆加減, 不碰任何偏移。
  const due = new Date(Date.UTC(y, mo - 1, da + PCM_REMITTANCE_EXPIRE_DAYS));
  const m = due.getUTCMonth() + 1;
  const d = due.getUTCDate();
  return `${m} 月 ${d} 日`;
}

/**
 * 「請於 X 之前完成匯款」那一整句 —— **兩個消費端的唯一一份**。
 *
 * 🔴🔴 **為什麼要有這一支**(R3-MF3 抓到, 而它是對的):
 *   `remittanceDeadlineLabel` 只回**日期本身**(「9 月 11 日」)—— **無年、無主詞**。
 *   ⛔ 匯款信第一版直接插那個裸回傳值 ⇒ 🛑 **信上會出現孤零零一行「9 月 11 日」**,
 *      而且 **「(含)」那個邊界消失** ⇒ 📌 **客人第 5 天不敢匯。**
 *   ⇒ 而畫面那半(`OrderDetailView`)本來就有完整那一句 ⇒ **兩處各寫一份 = 會漂。**
 *
 * 🔵 **「(含)」不是贅字**:⛔ ~~逾期 cron 的述詞是 `created_at < now() - 5 days`~~
 *   ✅ 2026-09-06 起是**台北日界** ⇒ 第 5 天**整天**有效, 隔天 00:00 才取消
 *   (`20260906600000_m4b_expire_day_boundary.sql`)⇒ 「(含)」現在是**逐格正確**, 不再是近似。
 *
 * 🔴 **算不出日期 ⇒ 退回「N 天內」那句, 不是不印** ——
 *   `remittanceDeadlineLabel` 對不合法輸入回 `null`(理由:算錯的日期比不算糟),
 *   而**這一句一定要有**:它是客人唯一知道「什麼時候會被取消」的地方。
 */
export function remittanceDeadlineSentence(createdAtIso: string): string {
  const label = remittanceDeadlineLabel(createdAtIso);
  return label === null
    ? `請於 ${PCM_REMITTANCE_EXPIRE_DAYS} 天內完成匯款,逾期訂單將自動取消。`
    : `請於 ${label}(含)之前完成匯款,逾期訂單將自動取消。`;
}
