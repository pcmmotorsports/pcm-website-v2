import {
  EMAIL_LOG_EMPTY_TEXT,
  toEmailLogEntry,
  type EmailLogRow,
} from '../../lib/orders/email-log-view';
import { formatOrderDateTime } from '../../lib/orders/order-detail-view';

// email-log-section.tsx — 片A:訂單詳情頁「通知信」區塊(server-render、唯讀)。
// 語意全在 `lib/orders/email-log-view.ts`,本檔只排版(同 payment-list 的分工)。
//
// 🔴 視覺**零新語言** —— class 逐字照 `payment-list.tsx` 的卡片形狀。
//    (OD 稿 `pcm-524f/HANDOFF-orders-ui.md` 掃 9 個「寄信/信件/通知紀錄」命中,
//     逐條開看**全部在講信件模板本身**, 一條都不是這一塊 ⇒ 本區塊【稿上查無】;
//     🟢 正對照:同一支檔「訂單」⇒ 294 次 ⇒ 那把尺會動。
//     主視窗 2026-09-02 判甲:唯讀清單、沒有新視覺語言 ⇒ 不必先問 Sean。
//     🛑 而如果之後有人要在這裡加**新的 badge 樣式或新的顏色語意** ⇒ 那條線是 Sean 的, 停下來問。)
//
// 🔴 **三態必須分開畫**(照 payment-list 那條, 理由同款):
//    讀不到 ≠ 沒寄過。把讀取失敗畫成「沒有寄過信」是這一族最短的一句謊話 ——
//    而這一整片存在的理由就是【空白被讀成沒發生】, 所以本檔尤其不能自己再犯一次。

export type EmailLogData =
  | { readonly status: 'ok'; readonly rows: readonly EmailLogRow[] }
  | { readonly status: 'unreadable' };

export function EmailLogSection({ data }: { data: EmailLogData }) {
  return (
    <section className='bg-card text-card-foreground rounded-lg border p-4'>
      <div className='mb-3 flex flex-wrap items-center gap-2'>
        <h2 className='text-muted-foreground text-xs font-medium'>通知信</h2>
        {/* 🔴 讀不到時**不可**顯示「0 筆紀錄」—— 同 payment-list `:184` 那條。 */}
        {/* 🔴🔴 **R1 must-fix #5:這裡不可以寫「N 封」。**
            ⛔ ~~`${data.rows.length} 封`~~ —— `skipped_*` 的列**一封都沒寄出去**,
               而它們照樣算進這個數 ⇒ 兩列都沒寄時標題印「2 封」
               ⇒ ⇒ 員工會對著電話那頭說「我們寄了兩封」。
            ✅ 「筆紀錄」不做那個宣稱 —— 有沒有真的寄出去, 由每一列自己的狀態說。 */}
        <span className='text-muted-foreground ml-auto text-xs tabular-nums'>
          {data.status === 'ok' ? `${data.rows.length} 筆紀錄` : '筆數未知'}
        </span>
      </div>

      {data.status === 'unreadable' ? (
        <p className='rounded-md bg-red-50 px-3 py-2 text-xs text-red-800'>
          這一單的寄信紀錄沒有載入(讀取失敗)—— 這<strong>不是</strong>
          「沒有寄過信」,是「不知道有沒有」。請重新整理;若仍相同,請通知系統維護。
        </p>
      ) : data.rows.length === 0 ? (
        // 🔴 空態**不得整區消失** —— 員工分不出「沒寄」與「這頁壞了」。
        <p className='text-muted-foreground text-xs'>{EMAIL_LOG_EMPTY_TEXT}</p>
      ) : (
        <ul className='divide-y text-xs'>
          {data.rows.map((row, i) => {
            const e = toEmailLogEntry(row);
            return (
              <li key={`${e.eventRaw}-${e.createdAt}-${i}`} className='flex flex-wrap gap-x-3 gap-y-1 py-2'>
                <span className='font-medium'>
                  {/* 🔴 fail-open:未知種類印**原始字串**, 不印一句沒有資訊的「未知」。 */}
                  {e.eventLabel ?? e.eventRaw}
                </span>
                <span className={e.isKnownStatus ? '' : 'text-amber-700'}>
                  {/* 🔴🔴 未知態 fail-open —— 這一格是本片的承重點, 不要改成白名單。
                      成因見 `email-log-view.ts` 檔頭:新態上線那天會【安靜地消失一列】,
                      而那與「這張單沒寄信」在畫面上長得一模一樣。 */}
                  {e.statusLabel ?? `${e.statusRaw}(未知狀態)`}
                </span>
                {/* 🔴 **R1 must-fix #1:`failed` 是雙義的, 而那個歧義在畫面上本來沒有形狀。**
                    同一句「寄送失敗」可能是【5 分鐘後 cron 會再試】也可能是【已放棄】,
                    ⇒ 員工看不出差別就會做出相反的動作。判準見 `email-log-view.ts` 的 `isDead`。 */}
                {e.statusRaw === 'failed' ? (
                  <span className={e.isDead ? 'text-red-700' : 'text-muted-foreground'}>
                    {/* 🔴 **R2 must-fix:指路的頁名與權限都要對, 否則員工照它走會撲空。**
                        ⛔ ~~「要到「信件」頁重排」~~ —— **側欄與 h1 的字面都是「寄不出去的信」**
                           (`layout/nav-items.ts:71` / `app/settings/mail/page.tsx:59`, 本窗開檔複驗)
                        ⇒ 而重排鈕只給 `is_manager === true`(那頁搜 `is_manager === true`)
                        ⇒ ⇒ 非主管照舊字面走過去, **找不到那個頁名, 而且按不到那顆鈕**。 */}
                    {e.isDead ? '已放棄 — 請主管到「寄不出去的信」頁重排' : '稍後會自動再試'}
                  </span>
                ) : null}
                <span className='text-muted-foreground ml-auto tabular-nums'>
                  {/* 寄出時刻優先。
                      🔵 **R1 nit #12:`skipped_*` 不可以印「排入」** —— 它們的 `sent_at` 是 null,
                         而「排入 X」讀起來像還在排隊, 與同一列的「沒寄(…)」互相打架。 */}
                  {e.sentAt
                    ? `寄出 ${formatOrderDateTime(e.sentAt)}`
                    : e.statusRaw.startsWith('skipped_')
                      ? `判定 ${formatOrderDateTime(e.createdAt)}`
                      : `排入 ${formatOrderDateTime(e.createdAt)}`}
                </span>
                {e.attempts > 1 ? (
                  <span className='text-muted-foreground tabular-nums'>
                    試 {e.attempts} / {e.maxAttempts} 次
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
