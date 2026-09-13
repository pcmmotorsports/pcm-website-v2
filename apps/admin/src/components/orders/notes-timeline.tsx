import type { ReactNode } from 'react';
import Link from 'next/link';
import type { AdminOrderDetail, AdminOrderNoteType } from '@pcm/domain';
import {
  buildNoteTimeline,
  describeCustomerNotified,
  isNotesUnreadable,
  type NoteTimelineEntry,
} from '../../lib/orders/note-timeline';
import { NoteDeleteForm } from './note-delete-form';
// 🔵 從**純模組**拿,不從 `components/settings/staff-edit-row`(那支會拉進 `server-only`)。
import {
  type ManagePermission,
  permissionNotice,
} from '../../lib/session/manage-permission';

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

function EntryRow({
  entry,
  orderId,
  returnTo,
  canDeleteNotes,
  deleteToken,
}: {
  entry: NoteTimelineEntry;
  orderId: string;
  returnTo: string;
  canDeleteNotes: ManagePermission;
  /** 這一則專用的冪等 token(由 `order-detail.tsx` 渲染期一則一把)。拿不到就不渲染入口。 */
  deleteToken: string | undefined;
}) {
  return (
    // 🔵 已收起的列也淡化 —— 與「已更正」同一個視覺語言(都是「還在,但不是現行的那一則」)。
    //    🔴 而它**不會消失**:整列拿掉的話對帳與客訴就查不到了,那正是做成軟刪除的理由。
    <li
      className={`border-t py-3 text-sm first:border-t-0 ${
        entry.corrected || entry.deleted ? 'opacity-60' : ''
      }`}
    >
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
        {/* 🔴 貼板 138:已收起的列印一顆 badge —— 字面說「已收起」而不是「已刪除」
            (Sean 2026-09-13 拍板的用語:「僅收起,不刪除」)。
            🔵 誰收的、什麼時候、為什麼,印在下方 body 上面那一行,不擠進這一排 badge。 */}
        {entry.deleted && (
          <span className='bg-muted text-muted-foreground inline-flex rounded-full px-2 py-0.5 font-medium'>
            已收起
          </span>
        )}
        {/* A10a-3 更正入口(債⑥):**同一版**最多被更正一次 ⇒ canCorrect=false 列 disable
            🔴 **不是「一則備註只能改一次」** —— `A ← B ← C` 的鏈本來就合法、也是預期用法
            (A3 `20260729030000:158-159` 逐字),2026-09-13 實測過。要再改 = 按最新那一版。
            (同列的「已更正」badge 說明原因);canCorrect 規則單一真相在 lib(C5)。
            🔵 貼板 138 起,已收起的列**照舊**可以更正 —— `canCorrect` 只看 `corrected`。
               刻意沒有為「已收起」另加一道:那會變成第二條規則,而 Sean 沒說過收起來就不能更正。 */}
        {entry.canCorrect ? (
          <Link
            href={`/orders/${orderId}?correct=${entry.id}#note-compose`}
            className='text-foreground ml-auto font-medium underline'
          >
            更正
          </Link>
        ) : (
          // 🔴🔴 **指引印成【看得見、選得起來】的字,不是只放 `title`**(2026-09-13)。
          //    `docs/phase-1-backlog.md:22301` 逐字:「唯一不能變的是【**不能還是 title**】…
          //    最小可行:**停用控件旁邊印一行短字**」(主視窗 2026-08-18 對 `#639` 釘的約束,同族適用)。
          //    理由不是美感:**鍵盤使用者對不到停用鈕的焦點、觸控裝置叫不出原生提示**
          //    ⇒ 把唯一的操作指引放在 `title` 裡 = 對那些員工**等於沒寫**。
          //    ⇒ `title` 留著當**補充**,不是唯一載體。
          // 🔵 而字面換掉了:⛔ ~~「一筆只能更正一次」~~ —— 那句字面為真、而讀者推出假的結論
          //    (「這則不能再改了」)⇒ 他不會去按最新那一版,而那正是唯一該按的地方。
          //    `A ← B ← C` 的鏈本來就合法(A3 `20260729030000:158-159` 逐字),2026-09-13 實測過。
          <span className='ml-auto flex items-center gap-2'>
            <span className='text-muted-foreground'>要再改請按最新那版</span>
            <button
              type='button'
              disabled
              title='這一版已經被更正過了。要再修改,請按最新那一版的「更正」。'
              className='cursor-not-allowed opacity-50'
            >
              更正
            </button>
          </span>
        )}
      </div>
      {/* 🔴 貼板 138:誰收的 / 何時 / 為什麼。**那三件正是軟刪除存在的理由** ——
          少了它們,畫面就只說得出「這則不見了」而說不出「誰做的、為什麼」。
          🔵 理由是**選填**(Sean 2026-09-13 答乙)⇒ 沒寫就**整句不印**,
             不要印成「理由:(無)」那種看起來像壞掉的字。 */}
      {entry.deleted && (
        <p className='text-muted-foreground mt-1 text-xs'>
          {entry.deleted.by} 於 {entry.deleted.atDisplay} 收起
          {entry.deleted.reason !== null && `:${entry.deleted.reason}`}
        </p>
      )}
      {/* body 逐字渲染(React 天然 escape);pre-wrap 保留員工打的換行 */}
      {/* 🛑 **已收起的列,內容照樣印出來** —— 藏起來的話對帳與客訴就查不到,
          而那正是這一片選軟刪除而不是 DELETE 的理由。淡化(opacity)已經足以區分。 */}
      <p className='mt-1 whitespace-pre-wrap break-words'>{entry.body}</p>
      {/* 🔴 收起入口:**只有管理者看得到**,而且已經收起的列不再出現(冪等由 RPC 保證,
          但讓他按一顆什麼都不會發生的鈕是另一回事)。
          🛑 **這不是安全邊界** —— 擋得住的是 server action 那道 `authorizeManagerMutation()`。
             「看不到」與「擋得住」是兩件事,兩格驗法都要有。
          🔵 `deleteToken` 拿不到(理論上不會)⇒ **不渲染入口**,而不是讓他送一張沒有 token 的表單
             (那會回 `invalid`,而員工看到的是一句他無從處理的錯誤)。 */}
      {entry.deleted === null && canDeleteNotes === 'yes' && deleteToken !== undefined && (
        <NoteDeleteForm
          orderId={orderId}
          noteId={entry.id}
          seq={entry.seq}
          returnTo={returnTo}
          serverToken={deleteToken}
        />
      )}
    </li>
  );
}

export function NotesTimeline({
  detail,
  orderId,
  returnTo = '',
  canDeleteNotes = 'no',
  noteDeleteTokens = {},
  correcting = false,
  children,
}: {
  detail: Pick<AdminOrderDetail, 'notes' | 'notesTruncated' | 'customerNotified'>;
  /** 更正入口 Link 用(`?correct=<id>`;A10a-3) */
  orderId: string;
  /** 收起備註送出後回哪個視圖(#350d-3;與新增備註那支同一顆) */
  returnTo?: string;
  /**
   * 貼板 138:能不能收起備註 —— 三態。
   * 🔵 **預設 `'no'`(最保守的那一態)** —— 忘了接就是看不到入口,不是看得到。
   *    ⚠️ 預設**不用 `'unknown'`**:那一態會印「暫時無法確認權限」,而「忘了接」不是那個世界。
   */
  canDeleteNotes?: ManagePermission;
  /** noteId → 該則專用的冪等 token(呼叫端渲染期一則一把)。 */
  noteDeleteTokens?: Record<string, string>;
  /** 同卡下方的發文表單(A10a-3)。合的是外殼、不是元件 —— 見下方 children 處的註解。 */
  /**
   * 🔴🔴 **網址帶著 `?correct=<id>` ⇒ 這一塊要跟著展開(Sean 2026-09-13 答甲)。**
   *
   * 🔬 **不修會怎樣(2026-09-13 真瀏覽器實測)**:更正表單自己**已經**照規矩展開了
   *    (`note-compose-form.tsx` 的 `details#note-compose` 在更正模式 `open=true`),
   *    **而它是【本卡】的子節點** ⇒ 本卡收著的時候, 員工看到的仍然是一片空白。
   *    ```
   *    由內而外:  details#note-compose  open=true   ← 內層照規矩打開了
   *               details(本卡)        open=false  ← 而外層把它整個收起來
   *    ```
   *    ⇒ 📌 **內層那條「更正模式必須展開」的規矩, 被外層默默作廢了** ——
   *      而**兩邊的碼各自都是對的**, 錯的是沒有人把它們放在一起看過。
   *
   * 🔵 **正常操作踩不到**:要按得到「更正」連結, 他一定已經點開本卡了, 而連過去之後它保持開著。
   *    🔴 **踩得到的是**:書籤、重新整理、把網址貼給同事 ⇒ 他看到的是「連結壞了」。
   *
   * 🛑 **這【不是】推翻 Sean 2026-08-19「編輯要點擊才展開」** ——
   *    `?correct=` 的意思正是「**他已經點了**」(那顆連結就在本卡的時間軸裡)。
   *    ⇒ 判準與內層**是同一個**, 只是往外推一層;**不發明第二個判準**。
   *    ⚠️ 而它也不會讓本卡退化成「永遠展開」(上面 `defaultOpen` 那段警告過的那件事):
   *       沒有 `?correct=` 的一般瀏覽, 展開條件一個字都沒變。
   */
  correcting?: boolean;
  children?: ReactNode;
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
  /**
   * 🔴 2026-08-19 W2:我一度在這裡加了第四個理由「有備註就展開」(讀 Sean 的
   *    「如果有備註,會直接顯示在欄位下方」),而**那會讓 Q3=C 退化成「永遠展開」** ——
   *    `notes-timeline.test.tsx:238` 那條**正向對照**寫得很清楚,它就是為了擋這件事而存在的。
   *    ⇒ **不動。** 「有備註直接顯示 / 編輯要點擊」的對比,落在【列表 vs 表單】那一層,
   *      由表單自己收合來滿足(見 `note-compose-form.tsx` 的 `<details>`),
   *      不需要動這張卡的展開條件。此格若要改,是推翻 Q3=C,要 Sean 拍板。
   * 🔴 主視窗 2026-08-19 裁 Q1=甲 的配套判準:
   *    **任何「這裡的資料可能不完整」的警語,不得住在預設收合的容器裡**
   *    ⇒ `unreadable` / `truncated` 兩條永不可拿掉。
   */
  /**
   * 🔴 **第四個展開理由(2026-09-13, Sean 答甲):網址帶了 `?correct=`。**
   *    理由與射程寫在 `correcting` 那個 prop 的 docstring —— **一句話版本**:
   *    更正表單是本卡的子節點, 本卡收著的時候它自己 `open=true` 也沒有用。
   *    🛑 它與上面那三個理由**性質不同**:那三個是「這裡有東西你該看見」,
   *       這一個是「**你已經按了, 帶你到你要去的地方**」。合起來讀不要當成第四條警語。
   */
  const defaultOpen =
    uncorrectedNotifiedCount > 0 || unreadable || view.truncated || correcting;

  return (
    <details
      open={defaultOpen}
      className='bg-card text-card-foreground group rounded-lg border p-4'
    >
      <summary className='flex cursor-pointer flex-wrap items-center gap-2'>
        {/* display:flex 會蓋掉 <summary> 原生的 list-item marker ⇒ 自己補一顆指示三角 */}
        {/* 🔴 A2(2026-08-21 Sean 拍板乙=最小13px):10px → 13px。 */}
        <span className='text-muted-foreground text-[13px] transition-transform group-open:rotate-90'>
          ▶
        </span>
        {/* 🔴 「聯絡紀錄」→「客人聯繫」:Sean 要那個舊詞消失,而它原本還留在標題裡。
            ⇒ 標題**不叫**「客人聯繫」(Q2=甲:這張卡還裝著內部備註,那不是客人聯繫),
              但標題裡的那個詞要跟著全站統一,否則畫面上仍有兩種說法。 */}
        <h2 className='text-muted-foreground text-xs font-medium'>備註與客人聯繫</h2>
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
              : `${view.entries.length} 筆 · 已告知 ${uncorrectedNotifiedCount} 筆`}
          {!unreadable && newestFirst[0] && ` · 最後 ${newestFirst[0].createdAtDisplay}`}
        </span>
        {/* 🔴🔴 權限查不到的那一句 **住在 `<summary>` 裡,不在收合區內**(codex 2026-09-13 must-fix)。
            ⛔ ~~第一版放在 `<ul>` 最上面~~ ⇒ 這張卡預設收合時它**進了 DOM 而看不到**,
               而我那格測試只比對 `textContent`(它讀得到收合區的字)⇒ **全綠**。
            📌 而本檔自己早就記過這條規矩(上面 `defaultOpen` 那段,主視窗 2026-08-19 裁 Q1=甲):
               **「這裡的資料可能不完整」的警語,不得住在預設收合的容器裡。**
               我寫了一個新的警語,而**沒有回去讀那一段**。
            🔵 為什麼不改成「`unknown` 也強制展開」:那會為了一次權限查詢失敗把整張卡撐開,
               而這句話要傳達的只是「那顆鈕現在為什麼不在」—— 放在收合時就看得到的地方剛剛好。
            🔵 只在 `unknown` 印:`no` 的那個世界不需要一句話 —— 一個非管理者在訂單明細頁
               本來就不預期看到收起入口,對他印「你沒有權限」是憑空製造一個他沒問過的問題。
               (與設定頁不同:那一頁的整組欄位本來就是給管理者用的,不說話才奇怪。)
            🔴 **印一次,不由每一列各印一次** —— `manage-permission.ts` 的 `permissionNotice`
               docstring 逐字記過同一課(codex R3 must-fix):放進單列元件 ⇒ N 則備註 N 段字。 */}
        {canDeleteNotes === 'unknown' && (
          <span role='status' className='text-muted-foreground basis-full text-xs'>
            {permissionNotice('unknown')}
          </span>
        )}
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
            <EntryRow
              key={entry.id}
              entry={entry}
              orderId={orderId}
              returnTo={returnTo}
              canDeleteNotes={canDeleteNotes}
              deleteToken={noteDeleteTokens[entry.id]}
            />
          ))}
        </ul>
      )}

      {/* 🔴 Sean 2026-08-19 逐字:「備註與聯絡紀錄 跟 新增備註 應該和再一起變一個功能卡片,
          不應該拆成兩段」⇒ 表單以 children 進到**同一張卡**裡,而**元件不合併**
          (兩支各 191 / 281 行,合起來 >400 = 鐵則 6 的拆檔線)。
          ⇒ 這裡只合外殼,兩支各自的職責與測試都不動。 */}
      {children}
      </div>
    </details>
  );
}
