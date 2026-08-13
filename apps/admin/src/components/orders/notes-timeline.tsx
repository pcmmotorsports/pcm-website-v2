import Link from 'next/link';
import type { AdminOrderDetail, AdminOrderNoteType } from '@pcm/domain';
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
//
// OD 詳情頁片 1(2026-08-13,主視窗 MAIN-902-A 裁 Q1=A / Q3=C):本區塊改為可收合,
// 且位置由頁尾搬到發票卡下方(搬家在 `order-detail.tsx`,本檔不管位置)。

const NOTIFIED_BADGE: Record<'notified' | 'not_notified' | 'unknown', string> = {
  notified: 'bg-emerald-100 text-emerald-700',
  not_notified: 'bg-muted text-muted-foreground',
  unknown: 'bg-amber-100 text-amber-700',
};

/**
 * note_type 三類分色(OD 定案 `overview-desktop.html:306-312` 逐字:
 * 「note_type 三類要一眼分得出,不是靠讀內容猜。**customer_notified 給最強的視覺份量:
 *   它是告知義務的稽核證據,不是一般聯絡紀錄。**」)。
 *
 * 🔴 上色吃 `entry.noteType`(原始 enum)**不是** `typeLabel` 中文字面 ——
 *    lib 的 `NoteTimelineEntry.noteType` docstring(`note-timeline.ts:54`)逐字寫過
 *    「原始 enum(篩選/badge 上色用;顯示字面用 typeLabel —— 別反推中文字串)」。
 *    反推中文的話,Sean 哪天改文案(該檔頭明寫文案是暫定稿)顏色就會靜默失效。
 * 🔴 `Record<union, string>` 給型別窮盡:CHECK 日後加第四值 → domain union 一改,這裡立刻紅。
 * 份量階梯(刻意不等距):customer_notified 綠底最重 > contact_log 藍底中 > internal 灰底最輕。
 * 與整單那顆 `NOTIFIED_BADGE.notified`(emerald-100/700)刻意不同色階 —— 那顆是「這一單有沒有告知過」
 * 的彙總旗標,這裡是「這一筆是哪一類」,兩者同時出現時不該看起來像同一個東西。
 */
const NOTE_TYPE_BADGE: Record<AdminOrderNoteType, string> = {
  internal: 'bg-muted text-muted-foreground',
  contact_log: 'bg-sky-100 text-sky-800',
  customer_notified: 'bg-emerald-200 text-emerald-900',
};

function EntryRow({ entry, orderId }: { entry: NoteTimelineEntry; orderId: string }) {
  return (
    <li className={`border-t py-3 text-sm first:border-t-0 ${entry.corrected ? 'opacity-60' : ''}`}>
      <div className='text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs'>
        <span className='tabular-nums'>#{entry.seq}</span>
        <span
          className={`inline-flex rounded-full px-2 py-0.5 font-medium ${NOTE_TYPE_BADGE[entry.noteType]}`}
        >
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

  /**
   * Q3=C 的展開條件(主視窗 MAIN-902-A 推翻「一律收合」)。
   *
   * 🔴 定義用「**未被更正的** customer_notified」,不是「有 customer_notified」——
   *    `types.ts:899-900` 逐字:「不得寫成『有 customer_notified』:被更正掉的誤選要排除」。
   *    這與整單 `detail.customerNotified` 是同一條判準,但那個值在截斷/讀取失敗時是 null
   *    ⇒ 這裡自己數已載入的列,兩者不互相取代。
   */
  const uncorrectedNotifiedCount = view.entries.filter(
    (entry) => entry.noteType === 'customer_notified' && !entry.corrected,
  ).length;
  /**
   * 🔴 收合預設值的三個展開理由,少一個都會把「該被看見的東西」藏起來:
   *   ①有未更正的告知紀錄(Q3=C 本體:稽核證據不該預設藏起來)
   *   ②`unreadable` —— 收起來的話 body 裡那段「讀取失敗、不是沒有備註」的紅字就看不到,
   *     等於用收合把 #328 修好的 bug 重新製造一次(換個位置犯)
   *   ③`truncated` —— 同理,「筆數超過載入上限、告知狀態無法判定」的警語必須露出
   */
  const defaultOpen = uncorrectedNotifiedCount > 0 || unreadable || view.truncated;

  return (
    <details
      open={defaultOpen}
      className='bg-card text-card-foreground group rounded-lg border p-4'
    >
      <summary className='flex cursor-pointer flex-wrap items-center gap-2'>
        {/* display:flex 會蓋掉 <summary> 原生的 list-item marker ⇒ 自己補一顆指示三角 */}
        <span className='text-muted-foreground text-[10px] transition-transform group-open:rotate-90'>
          ▶
        </span>
        <h2 className='text-muted-foreground text-xs font-medium'>備註與聯絡紀錄</h2>
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${NOTIFIED_BADGE[notified.state]}`}
        >
          {notified.label}
        </span>
        {/* 收合摘要(OD `:1176` 的「N 筆 · 已告知客人 M 筆 · 最後 …」)。
            🔴 #328 的紀律在收合狀態同樣成立、而且更重要 —— 收起來時這行是唯一可見的資訊:
               讀取失敗**不可**顯示「0 筆」,那是這條 bug 最短的一句謊話
               (entries 是空的,但那不代表真的零筆)。
            🔴 截斷時**不報**「已告知客人 M 筆」:告知列可能被擠出載入窗 ⇒ 那個數字會少報,
               而少報告知義務證據的方向正好是最危險的那一邊。改報「僅最新 N 筆」。 */}
        <span className='text-muted-foreground ml-auto text-xs tabular-nums'>
          {unreadable
            ? '筆數未知'
            : view.truncated
              ? `僅最新 ${view.entries.length} 筆`
              : `${view.entries.length} 筆 · 已告知客人 ${uncorrectedNotifiedCount} 筆`}
          {!unreadable && newestFirst[0] && ` · 最後 ${newestFirst[0].createdAtDisplay}`}
        </span>
      </summary>
      <div className='mt-3'>

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
      </div>
    </details>
  );
}
