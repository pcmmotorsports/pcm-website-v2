import Link from 'next/link';
import {
  formatOrderAmount,
  DATE_FROM_PARAM,
  DATE_TO_PARAM,
  SHOW_UNPAID_CARD_PARAM,
  SHOW_UNPAID_CARD_ON,
} from '../../lib/orders/order-list-view';
import type { TodaySummary } from '../../lib/dashboard/today-read';

// today-summary.tsx — `#16` 今日對帳:首頁**三格**的純顯示元件。
//    🪦 原為四格;「今日退款」於 2026-08-15 拆掉(見 `lib/dashboard/today-view.ts` 墓碑段)。
//
// 🔴 **server component、零 `'use client'`**:全部唯讀顯示,沒有任何互動 ⇒ 不需要 client JS。
//    ⚠️ 它收的是**金額**;若哪天被 `'use client'` 檔 import,這些數字會進 RSC payload。
//    本檔刻意只收**已經加總完的幾個數**、不收任何逐筆列,所以就算外洩也只是總額 ——
//    但那不是放行理由,是**把爆炸半徑先縮到最小**。
//
// 🔴 **判定不在本檔**:今日區間與加總的唯一真相在 `lib/dashboard/today-read.ts`,
//    本檔只把數字翻成中文。**不得**在這裡重算任何一格(重算一份就有兩份會漂移的規格)。
//
// 🔴 中文字面暫定、待 Sean 肉眼定稿(結構鎖、字不鎖)。

const CARD = 'rounded-lg border bg-card p-4 text-card-foreground';

/**
 * 一格數字。
 *
 * 🔴 `value` 一律由呼叫端格式化好再傳進來 —— 本元件不碰數字轉換,
 *    免得「千分位在哪一層做」變成兩個地方都做一半。
 */
/**
 * 一格數字。`value` 為 `null` ⇒ **這格沒讀到**,顯示「讀取失敗」而不是 0(R2 nit7)。
 *
 * 🔴 **絕不把讀取失敗渲染成數字** —— 一個安靜的 `NT$ 0` 看起來就像「今天還沒收到錢」,
 *    而員工正拿它對帳。寧可讓他看到「這格壞了」。
 */
/**
 * 🔴 **`#831` ①(2026-08-21):只有這一格可以點,而「只有這一格」是量出來的、不是保守。**
 *
 * 三格裡**只有「目前待處理退款異常」**兩側是**同一支函式**:
 * ```
 * 卡片  lib/dashboard/today-read.ts:3            import { listRefundExceptions } from '../payment/refund-read'
 * 頁面  app/orders/refund-exceptions/page.tsx:8  import { listRefundExceptions } from '…/lib/payment/refund-read'
 * ⇒ 述詞只有一份 ⇒ **結構上不可能漂移**。不是「今天剛好一致」，是「沒有第二份可以不一致」。
 * ```
 * 另外兩格**各自有兩份述詞**,而實測都對不上 ⇒ **不給 `href`**:
 * ```
 * ② 今日新單    卡片 today-read.ts:239-241 零付款面 filter
 *              清單 SupabaseOrderAdapter.ts:834-836 預設多一條
 *                   `or('payment_channel.neq.tappay,payment_status.neq.unpaid')`
 *              ⇒ 2026-08-21 實測 **7 vs 6**（拋棄式鑽機）⇒ 點過去數字對不上 ⇒ 等 Sean 拍板
 * ③ 今日實收    卡片走 order_payments.received_at（DB 實查 `admin_today_payment_total`）
 *              清單走 orders.created_at ⇒ **兩條不相干的時間軸** ⇒ 沒有誠實的目的地
 * ```
 * 🔴 **判準句(給下一個想把另外兩格也變成連結的人)**:
 * **問「兩側是同一支函式,還是兩份各自寫的述詞?」** 同一支 ⇒ 可以連;
 * 兩份 ⇒ **一定要實跑比對筆數,不論它們讀起來多像**。
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 🔴🔴 **2026-08-22 更新:② 今日新單【現在是連結了】。上面那段原句一個字都沒改。**
 *    Sean 逐字答「當然要」。而**「要」不等於「加個 href」** —— 上面寫的 `7 vs 6` 是真的,
 *    所以這一片做的是**把那個差消掉**,不是無視它。
 *
 *    消法:**兩邊的述詞都不動**,由連結帶 `show_unpaid_card=1` 過去
 *    ⇒ 目的地把那批 tappay×unpaid 放回來 ⇒ **與卡片同一個母體**。詳見 `newOrdersHref()`。
 *    ⇒ **上面那條判準句仍然成立,而它的答案在這一格變了**:
 *      兩份述詞的差**被指名、被量出來、而且有一個第一級的開關可以抵銷** ⇒ 才可以連。
 *      **沒有那個開關的話,答案仍然是不連。**
 *
 * 🔴 **③ 今日實收【仍然】不給連結,而理由沒有變** —— 它是**兩條不相干的時間軸**
 *    (`order_payments.received_at` vs `orders.created_at`),**沒有任何參數抵銷得了**
 *    ⇒ 那不是「差一個 filter」,是「沒有誠實的目的地」。**不要順手也給它一個。**
 * ══════════════════════════════════════════════════════════════════════════
 * ⚠️ 而本卡自己的註解已經寫著判準:**「一個可能不準的對帳數字比沒有更糟」**
 *    —— **一個連到「差不多相關」清單的連結,是同一個病換一個載體。**
 */
function Stat({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: string | null;
  hint?: string;
  /** 有值才可點。**沒有 `href` 的格子維持原樣**(不是 disabled 的連結,是根本不是連結)。 */
  href?: string;
}) {
  const card = (
    <div className={CARD}>
      <p className='text-muted-foreground text-xs'>{label}</p>
      {value === null ? (
        <p className='text-destructive mt-1 text-base font-semibold'>讀取失敗</p>
      ) : (
        <p className='mt-1 text-2xl font-semibold tabular-nums'>{value}</p>
      )}
      {hint !== undefined && <p className='text-muted-foreground mt-1 text-xs'>{hint}</p>}
    </div>
  );
  if (href === undefined) return card;
  return (
    <Link
      href={href}
      // 🔴 整張卡可點（不是只有數字）：點擊目標大、而員工的手勢是「戳那一格」不是「戳那個數字」。
      // 🔴 `aria-label` 明講會去哪裡 —— 螢幕閱讀器唸出來的連結名若只有數字，聽起來像一串數目。
      aria-label={`${label} ${value ?? '讀取失敗'},點這裡看清單`}
      className='hover:border-foreground/30 focus-visible:ring-ring block rounded-lg focus-visible:ring-2 focus-visible:outline-none'
    >
      {card}
    </Link>
  );
}

/**
 * 「今日新單」的目的地(2026-08-22,Sean 答「當然要」)。
 *
 * 🔴🔴 **這不是「加個 href」—— 那格本來被擋的理由是【兩個數字對不起來】,
 *    而這支的存在意義就是把那個差消掉。** 消法**不動任何一邊的述詞**:
 * ```
 * 卡片   today-read.ts:221,236-241  orders where created_at ∈ [台北今日 00:00, 明日 00:00)
 *                                   零付款面 filter、零 cancelled 過濾
 * 清單   SupabaseOrderAdapter.ts:833  預設多一條
 *        if (!filter.includeUnpaidCardOrders)
 *          query.or('payment_channel.neq.tappay,payment_status.neq.unpaid')
 * ⇒ 唯一的差就是那一條, 而它【是 Sean 逐字要求藏起來的那批】(同檔 :832 註解)
 *   ⇒ **不能改清單預設**(推翻他的拍板)、**不能改卡片**(它才是誠實的總數)
 *   ⇒ **改連結**:帶 show_unpaid_card=1 過去, 讓目的地把那批放回來。
 * ```
 * ✅ **另外三個會造成差的東西, 逐一查過都不成立**:
 *   · `cancelled_at` 過濾 **只掛在 `pendingOnly` 那個 `if` 裡**(同檔 :780-784)
 *     ⇒ 本連結不帶 `pending` ⇒ 已取消的單照樣出現 ⇒ 與卡片「含當天取消的」一致
 *   · 日期預設(近半年)被本連結明帶的 `date_from`/`date_to` 蓋掉
 *   · 清單顯示的「共 N 筆」走 `count: 'exact'` 總數, **不受分頁影響**
 *
 * 🔴 **`ymd` 一定要由呼叫端從 `summary` 帶進來, 不在這裡算** ——
 *    `today-view.ts:41` 逐字:「`ymd` 一定要從這裡出去(R2 nit2):呼叫端若自己再
 *    `isoBackToTaipeiYmd(now)` 算一次…」⇒ 卡片與連結必須是**同一個 ymd**,
 *    否則跨日那一刻兩者會指到不同的一天, 而**畫面上看不出來**。
 *
 * 🔴 **綁匯出的參數常數、不綁字面** —— 有人改 `date_from` 的字面時, 這裡要跟著紅,
 *    不是安靜地產出一個沒有人認得的網址(同 `app-sidebar.tsx` 的 `COUNT_QUALIFIER` 那條理由)。
 */
function newOrdersHref(ymd: string): string {
  const qs = new URLSearchParams({
    [DATE_FROM_PARAM]: ymd,
    [DATE_TO_PARAM]: ymd,
    [SHOW_UNPAID_CARD_PARAM]: SHOW_UNPAID_CARD_ON,
  });
  return `/orders?${qs.toString()}`;
}

export function TodaySummaryCards({ summary }: { summary: TodaySummary }) {
  return (
    <section aria-label='今日對帳'>
      <h2 className='text-muted-foreground mb-3 text-xs font-medium'>
        今日對帳({summary.ymd},台北時間)
      </h2>
      {/* 🪦 這裡原本有一條「退款筆數超過查詢上限 ⇒ 金額不完整」的警語(MF4 的顯示半),
          隨「今日退款」那一格於 2026-08-15 一起拆掉 —— 它守的那個查詢已經不存在。
          🔴 **`summary.amountsTruncated` 這個欄位也一併移除**:留著會是一個沒有任何路徑
             能讓它變 true 的旗標 = 恆綠格,而 UI 上長得像「有在防」。
          ⚠️ R2 MF-D 那條教訓**與這格無關、仍然有效**,不要跟著一起忘掉:
             JSX 文字節點裡 React **不解析 markdown** ⇒ 寫 `**…**` 員工會原樣看到星號。
             要強調用 `<strong>`;`today-summary.test.tsx` 的 `not.toContain('**')` 那格**留著**。 */}
      {/* 🔴 R2 nit7:講得出**是哪幾格**沒讀到 —— 只說「對帳壞了」等於要員工自己猜哪個數字能信。 */}
      {summary.failedSections.length > 0 && (
        <p className='border-destructive/30 bg-destructive/5 text-destructive mb-3 rounded-md border p-3 text-xs'>
          這幾格沒讀到:<strong>{summary.failedSections.join('、')}</strong>
          。其餘數字仍可使用。請稍後重新整理,若持續發生請通知系統維護。
        </p>
      )}
      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
        {/* 🔴 「實收」不是「營業額」:它是今天實際收到的錢,含沖銷。
            🪦 原本這句後半寫「退錢給客人不走這格、**走下一格**」—— **那一格 2026-08-15 拆掉了**,
               留著會指向一個不存在的地方。退款金額目前**全站沒有任何一格在顯示**。 */}
        <Stat
          label='今日實收(淨)'
          value={
            summary.receivedAmount === null
              ? null
              : `NT$ ${formatOrderAmount(summary.receivedAmount)}`
          }
          hint='含沖銷;以實際收到錢的日期計'
        />
        {/* 🪦 這裡原本是「今日退款(已完成)」那一格,2026-08-15 拆掉。
            🔴 **不是漏做,是刻意拿掉的** —— 它疊了兩層沒查證過的假設,而 Sean 拍板這格
               「要拿來對帳、要分毫不差」⇒ **一個可能不準的對帳數字比沒有更糟**
               (員工會拿它去對,對不起來,而他不知道是數字錯還是帳錯)。
            完整理由與重做方向見 `lib/dashboard/today-view.ts` 的墓碑段。
            ⚠️ 因此下面的 grid 現在是**三格**;`lg:grid-cols-4` 已跟著改成 `lg:grid-cols-3`。 */}
        {/* 🔴 R2 nit5:這格數的是**今天建立的所有單**,含還沒付錢的(`payment_status` enum 有
            `unpaid`,`packages/adapters/src/supabase/database.types.ts:3748-3754`)、也含當天就取消的
            ⇒ **口徑與另外兩格不同**(那兩格都是「錢真的動了」)。並排時不講,員工會拿它跟實收對。 */}
        <Stat
          label='今日新單'
          value={summary.newOrderCount === null ? null : `${summary.newOrderCount} 筆`}
          hint='含未付款與當天取消的'
          href={newOrdersHref(summary.ymd)}
        />
        {/* 🔴 這一格**不是今日**,是當下累積的待辦量(型別註解有記)——文案刻意寫「目前」不寫「今日」。
            truncated 時數字是**下限**,要講出來,不然員工會以為就這麼多。 */}
        <Stat
          label='目前待處理退款異常'
          value={
            summary.refundExceptionCount === null
              ? null
              : `${summary.refundExceptionCount}${summary.refundExceptionTruncated ? '+' : ''} 筆`
          }
          hint={summary.refundExceptionTruncated ? '已達顯示上限,實際可能更多' : '累計未結案,非今日新增'}
          href='/orders/refund-exceptions'
        />
      </div>
    </section>
  );
}
