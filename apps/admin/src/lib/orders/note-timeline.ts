// note-timeline.ts — 訂單備註時間軸「顯示層」純函式(M-4b E10 A10a-1;夜跑純邏輯半片)。
// 只做資料形狀 → 顯示形狀:標籤 / 序號 / 更正標記 / 三態描述 / 更正鏈 walker。
// 無 server-only、無 @/ → 可單測。契約對照表(附 檔案:行號)=
// docs/specs/2026-08-03-e10-a10a-1-note-timeline-plan.md §2。
//
// 🔴 本檔所有中文字面 = 暫定文案、待 Sean 定稿(A10a 白天半片)。本片鎖死的是**結構**:
//    三態(notified/not_notified/unknown)、「已更正」標記、walker 的四種停止原因 —— 改字可以,
//    砍態不行(unknown 砍掉就是把「無法判定」當 false 用,A9d2-1 plan §8 債5 的明文禁項)。

import type {
  AdminOrderDetail,
  AdminOrderNote,
  AdminOrderNoteChannel,
  AdminOrderNoteType,
} from '@pcm/domain';
import { formatOrderDateTime } from './order-detail-view';

/**
 * note_type 標籤(值域 = 建表檔 CHECK 三值,domain union `types.ts:394` 鏡像)。
 * `Record<union, string>` 給型別窮盡:CHECK 日後加第四值 → domain union 一改,這裡立刻紅。
 */
export const NOTE_TYPE_LABEL: Record<AdminOrderNoteType, string> = {
  internal: '內部備註',
  contact_log: '聯絡紀錄',
  customer_notified: '已告知客人',
};

/** channel 標籤(值域 = CHECK 五值;internal 恆 null、由配對規則 CHECK 保證,顯示層不重驗)。 */
export const NOTE_CHANNEL_LABEL: Record<AdminOrderNoteChannel, string> = {
  line: 'LINE',
  phone: '電話',
  email: 'Email',
  in_person: '當面',
  other: '其他',
};

/**
 * 更正不可撤回的告知文案(契約 C2:建表檔 `:179-184`;線 plan `:153-154` 明文「這句要進 A10a 的
 * UI 文案」)。字面已定稿(Sean 2026-08-03 拍 A 照現字面);改字面前先問 Sean,語意三件事不可刪:①不可撤回 ②更正的更正不會讓最早那筆復活
 * ③誤更正有效告知的唯一還原路徑 = 重登一筆新的「已告知客人」紀錄。
 */
export const CORRECTION_IRREVOCABLE_NOTICE =
  '更正送出後不可撤回;對更正再做更正,也不會讓最早那筆恢復有效。若誤更正了有效的告知紀錄,唯一的還原方式是重新登記一筆新的「已告知客人」紀錄。';

/** 時間軸單列 view model(UI 只讀這個,不自己摸 AdminOrderNote 的原始欄)。 */
export type NoteTimelineEntry = {
  id: string;
  /**
   * 1 起編、依輸入序(= mapper 的三層全序;本模組不重排,排序權威見 `types.ts:477-481`)。
   * 🔴 `truncated=true` 時 seq 是**相對編號、會隨新備註往下漂**(舊列被擠出載入窗)——
   * UI 不得把它當永久單號對外引用;永久識別只有 `id`。
   */
  seq: number;
  /** 原始 enum(篩選/badge 上色用;顯示字面用 typeLabel —— 別反推中文字串) */
  noteType: AdminOrderNoteType;
  /** 原始 channel(internal 恆 null;同上,篩選用) */
  channel: AdminOrderNoteChannel | null;
  typeLabel: string;
  /** internal 恆 null(配對規則 CHECK) */
  channelLabel: string | null;
  /** 聯絡實際發生時間(Asia/Taipei);internal 恆 null;解析不出的字面原樣返回 */
  occurredAtDisplay: string | null;
  createdAtDisplay: string;
  author: string;
  /** 逐字轉交(渲染交給 JSX,React 天然 escape;顯示層不 trim 不改寫) */
  body: string;
  /** 已被別列直接指向(契約 C1:標「已更正」、不是不顯示) */
  corrected: boolean;
  /** 更正我的那列的 seq;未被更正 = null(corrected=true 時理論上必可解析,防禦上仍容 null) */
  correctedBySeq: number | null;
  /** 更正入口啟用規則(契約 C5:一筆最多被更正一次 ⇒ 已被更正列 disable) */
  canCorrect: boolean;
  /** 本列更正了誰;targetSeq=null = 目標不在已載入集合(截斷),UI 顯示「不在已載入範圍」 */
  corrects: { targetId: string; targetSeq: number | null } | null;
};

export type NoteTimelineView = {
  entries: NoteTimelineEntry[];
  /** true = 僅載入最新一批(上限見 adapter);UI 必須帶警示,筆數用 entries.length 實數 */
  truncated: boolean;
};

/** 日期顯示:沿用明細頁慣例(`order-detail-view.ts:38-47`);解析不出(DB 腐壞)原字面返回,不顯示 Invalid Date。 */
function formatNoteInstant(iso: string): string {
  return Number.isNaN(Date.parse(iso)) ? iso : formatOrderDateTime(iso);
}

/**
 * 更正入口啟用規則(契約 C5:partial unique ⇒ 一筆最多被更正一次)的**唯一定義點**。
 * 時間軸 `canCorrect` 與表單側 `resolveCorrectTarget` 都走這裡(A10a-3 R2-N1:
 * 兩處各寫 `!corrected` 會在規則擴充時分岔成「入口 disable、表單卻進得了更正模式」)。
 */
export function canCorrectNote(note: Pick<AdminOrderNote, 'corrected'>): boolean {
  return !note.corrected;
}

/**
 * 時間軸投影。`corrected` 以 domain 值為權威、不在此重推導(mapper 已算過;重推導 = 第二真相源,
 * 且會把「本列是更正者」與「本列被更正」兩個方向搞混 —— 那是兩件事)。
 */
export function buildNoteTimeline(
  detail: Pick<AdminOrderDetail, 'notes' | 'notesTruncated'>,
): NoteTimelineView {
  const seqById = new Map<string, number>();
  detail.notes.forEach((note, i) => seqById.set(note.id, i + 1));
  // 反向索引:被更正列 id → 更正它那列的 seq(partial unique ⇒ 一筆最多被指一次,單值即可)
  const correctorSeqByTargetId = new Map<string, number>();
  detail.notes.forEach((note, i) => {
    if (note.correctsNoteId !== null) correctorSeqByTargetId.set(note.correctsNoteId, i + 1);
  });
  const entries = detail.notes.map((note, i): NoteTimelineEntry => {
    return {
      id: note.id,
      seq: i + 1,
      noteType: note.noteType,
      channel: note.channel,
      typeLabel: NOTE_TYPE_LABEL[note.noteType],
      channelLabel: note.channel === null ? null : NOTE_CHANNEL_LABEL[note.channel],
      occurredAtDisplay: note.occurredAt === null ? null : formatNoteInstant(note.occurredAt),
      createdAtDisplay: formatNoteInstant(note.createdAt),
      author: note.author,
      body: note.body,
      corrected: note.corrected,
      correctedBySeq: note.corrected ? (correctorSeqByTargetId.get(note.id) ?? null) : null,
      canCorrect: canCorrectNote(note),
      corrects:
        note.correctsNoteId === null
          ? null
          : { targetId: note.correctsNoteId, targetSeq: seqById.get(note.correctsNoteId) ?? null },
    };
  });
  return { entries, truncated: detail.notesTruncated };
}

export type CustomerNotifiedState = 'notified' | 'not_notified' | 'unknown';
export type CustomerNotifiedDescriptor = { state: CustomerNotifiedState; label: string };

/**
 * U6 告知義務三態(契約 C4:`types.ts:483-489`)。
 * 🔴 `null` 必須先以 `=== null` 分流 —— 寫成 `value ?? false` / truthy 判斷就是把「無法判定」
 * 顯示成「尚未告知」,兩個方向都可能錯(被截掉的更正列/告知列),明文禁項。
 */
export function describeCustomerNotified(value: boolean | null): CustomerNotifiedDescriptor {
  if (value === null) {
    return {
      state: 'unknown',
      label: '無法判定(備註筆數超過載入上限,告知紀錄可能不在已載入範圍)',
    };
  }
  return value
    ? { state: 'notified', label: '已告知客人' }
    : { state: 'not_notified', label: '尚未告知客人' };
}

export type CorrectionChainStop = 'end' | 'missing' | 'cycle' | 'depth';
export type CorrectionChainResult = {
  /** 起點之後、沿 correctsNoteId 走訪的 id 序(含觸發 missing/cycle 的那個 id) */
  chainIds: string[];
  /** end=走到鏈尾 / missing=指向不在已載入集合(截斷或起點查無)/ cycle=撞環 / depth=超過上限 */
  stop: CorrectionChainStop;
};

/**
 * 更正鏈 walker(契約 C3)。🔴 環在**應用路徑構造不出來**(A6 RPC 單列 INSERT),但在 DB 層
 * 實測可達(owner 單一多列 INSERT 互指,建表檔 `:186-195`)⇒ 顯示層不得假設鏈會終止:
 * visited 集合保證終止並把環**顯性回報**(cycle = 資料腐壞訊號,UI 要顯示異常、不是靜默截短)。
 * ⚠️ 深度上限誠實邊界:visited 已保證 chainIds < notes 數,而生產路徑 notes ≤ 200(內嵌載入上限)
 * ⇒ **預設值下 depth 分支在生產不可達**,它是「別的呼叫端傳大集合/未來改載入策略」的縱深護欄,
 * 參數化讓負測構造得出來(否則就是宣稱不了的死守門)。
 */
export function walkCorrectionChain(
  startId: string,
  notes: readonly AdminOrderNote[],
  maxDepth = 200,
): CorrectionChainResult {
  const byId = new Map(notes.map((note) => [note.id, note]));
  const start = byId.get(startId);
  if (start === undefined) return { chainIds: [], stop: 'missing' };
  const visited = new Set<string>([startId]);
  const chainIds: string[] = [];
  let current = start;
  for (;;) {
    const targetId = current.correctsNoteId;
    if (targetId === null) return { chainIds, stop: 'end' };
    if (visited.has(targetId)) {
      chainIds.push(targetId);
      return { chainIds, stop: 'cycle' };
    }
    if (chainIds.length >= maxDepth) return { chainIds, stop: 'depth' };
    const target = byId.get(targetId);
    if (target === undefined) {
      chainIds.push(targetId);
      return { chainIds, stop: 'missing' };
    }
    chainIds.push(targetId);
    visited.add(targetId);
    current = target;
  }
}
