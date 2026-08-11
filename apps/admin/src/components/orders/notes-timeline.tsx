import Link from 'next/link';
import type { AdminOrderDetail } from '@pcm/domain';
import {
  buildNoteTimeline,
  describeCustomerNotified,
  isNotesUnreadable,
  type NoteTimelineEntry,
} from '../../lib/orders/note-timeline';

// M-4b E10 A10a-2:訂單備註/聯絡紀錄時間軸(server-render、唯讀;表單與更正入口 = A10a-3)。
// 純顯示:所有語意計算在 lib/orders/note-timeline.ts(A10a-1,21 格突變釘死),本檔只排版。
// 🔴 顯示方向 = 新在上(營運看最近動態;seq 以時間軸舊→新編號、不隨顯示方向變,
//    「#3」永遠指同一筆 —— 但 truncated 時 seq 會漂移、不得當永久單號,見 lib 註解)。
// 🔴 文案為暫定稿、待 Sean 肉眼驗後定案(A10a-1 plan §5:鎖結構不鎖字)。

const NOTIFIED_BADGE: Record<'notified' | 'not_notified' | 'unknown', string> = {
  notified: 'bg-emerald-100 text-emerald-700',
  not_notified: 'bg-muted text-muted-foreground',
  unknown: 'bg-amber-100 text-amber-700',
};

function EntryRow({ entry, orderId }: { entry: NoteTimelineEntry; orderId: string }) {
  return (
    <li className={`border-t py-3 text-sm first:border-t-0 ${entry.corrected ? 'opacity-60' : ''}`}>
      <div className='text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs'>
        <span className='tabular-nums'>#{entry.seq}</span>
        <span className='bg-muted text-foreground inline-flex rounded-full px-2 py-0.5 font-medium'>
          {entry.typeLabel}
        </span>
        {entry.channelLabel && <span>{entry.channelLabel}</span>}
        {entry.occurredAtDisplay && <span>聯絡於 {entry.occurredAtDisplay}</span>}
        <span>
          {entry.author} 登記於 {entry.createdAtDisplay}
        </span>
        {entry.corrected && (
          <span className='bg-destructive/10 text-destructive inline-flex rounded-full px-2 py-0.5 font-medium'>
            已更正{entry.correctedBySeq !== null ? `(由 #${entry.correctedBySeq})` : ''}
          </span>
        )}
        {entry.corrects && (
          <span>
            更正 →{' '}
            {entry.corrects.targetSeq !== null ? `#${entry.corrects.targetSeq}` : '不在已載入範圍'}
          </span>
        )}
        {/* A10a-3 更正入口(債⑥):一筆最多被更正一次 ⇒ canCorrect=false 列 disable
            (同列的「已更正」badge 說明原因);canCorrect 規則單一真相在 lib(C5)。 */}
        {entry.canCorrect ? (
          <Link
            href={`/orders/${orderId}?correct=${entry.id}#note-compose`}
            className='text-foreground ml-auto font-medium underline'
          >
            更正
          </Link>
        ) : (
          <button
            type='button'
            disabled
            title='已被更正,一筆只能更正一次'
            className='ml-auto cursor-not-allowed opacity-50'
          >
            更正
          </button>
        )}
      </div>
      {/* body 逐字渲染(React 天然 escape);pre-wrap 保留員工打的換行 */}
      <p className='mt-1 whitespace-pre-wrap break-words'>{entry.body}</p>
    </li>
  );
}

export function NotesTimeline({
  detail,
  orderId,
}: {
  detail: Pick<AdminOrderDetail, 'notes' | 'notesTruncated' | 'customerNotified'>;
  /** 更正入口 Link 用(`?correct=<id>`;A10a-3) */
  orderId: string;
}) {
  const view = buildNoteTimeline(detail);
  // #328:整段沒讀到 ⇒ 徽章與下方橫幅都要說「讀取失敗」,不能畫成一條「尚無備註」的空時間軸。
  const unreadable = isNotesUnreadable(detail);
  const notified = describeCustomerNotified(detail.customerNotified, unreadable);
  // 顯示新在上;seq 由 lib 依時間軸(舊→新)編號,反轉只動排版不動語意。
  const newestFirst = [...view.entries].reverse();

  return (
    <section className='bg-card text-card-foreground rounded-lg border p-4'>
      <div className='mb-3 flex flex-wrap items-center gap-2'>
        <h2 className='text-muted-foreground text-xs font-medium'>備註與聯絡紀錄</h2>
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${NOTIFIED_BADGE[notified.state]}`}
        >
          {notified.label}
        </span>
        {/* 🔴 #328:讀取失敗時**不可**顯示「0 筆」—— 那是這條 bug 最短的一句謊話
            (entries 是空的,但那不代表真的零筆)。 */}
        <span className='text-muted-foreground ml-auto text-xs tabular-nums'>
          {unreadable ? '筆數未知' : `${view.entries.length} 筆`}
        </span>
      </div>

      {view.truncated && (
        <p className='mb-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800'>
          備註筆數超過載入上限,僅顯示最新 {view.entries.length} 筆;更早的紀錄未載入,
          上方告知狀態因此無法判定。
        </p>
      )}

      {/* 🔴 #328:這一格排在「尚無備註」之前,因為兩者的輸入長得一模一樣(entries 皆為空)——
          差別只在我們**有沒有讀到**。順序寫反就等於把讀取失敗顯示成「這單沒人寫過備註」。 */}
      {unreadable ? (
        <p className='mb-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800'>
          這一單的備註沒有載入(讀取失敗)—— 這<strong>不是</strong>「沒有備註」,是「不知道有沒有」。
          請重新整理;若仍相同,請通知系統維護。在這之前不要據此判斷有沒有告知過客人。
        </p>
      ) : view.entries.length === 0 ? (
        <p className='text-muted-foreground py-2 text-sm'>尚無備註。</p>
      ) : (
        <ul>
          {newestFirst.map((entry) => (
            <EntryRow key={entry.id} entry={entry} orderId={orderId} />
          ))}
        </ul>
      )}
    </section>
  );
}
