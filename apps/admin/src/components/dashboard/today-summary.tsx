import { formatOrderAmount } from '../../lib/orders/order-list-view';
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
function Stat({ label, value, hint }: { label: string; value: string | null; hint?: string }) {
  return (
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
        />
      </div>
    </section>
  );
}
