'use client';

import { useActionState, useEffect, useState } from 'react';
import Link from 'next/link';
import { appendOrderNoteAction } from '../../lib/orders/note-actions';
import {
  NOTE_BODY_FIELD,
  NOTE_CHANNEL_FIELD,
  NOTE_CORRECTS_FIELD,
  NOTE_OCCURRED_AT_FIELD,
  NOTE_ORDER_ID_FIELD,
  NOTE_REQUEST_TOKEN_FIELD,
  NOTE_TYPE_FIELD,
  type NoteActionState,
} from '../../lib/orders/note-action-state';
import { NOTE_CHANNELS, NOTE_TYPES, type NoteType } from '../../lib/orders/note-form';
import {
  CORRECTION_IRREVOCABLE_NOTICE,
  NOTE_CHANNEL_LABEL,
  NOTE_TYPE_LABEL,
} from '../../lib/orders/note-timeline';
import { ADMIN_INPUT_CLASS, AdminFormField } from '../shared/admin-form';

// M-4b E10 A10a-3:訂單備註表單 + 更正模式(A9d2-1 plan §8 七條契約債的 UI 側;
// 逐債落點 = docs/specs/2026-08-03-e10-a10a-3-note-compose-form-plan.md §2)。
// 🔴 中文字面全部暫定、待 Sean 肉眼定稿(結構鎖、字不鎖)。
//
// ⚠️ 本檔的 bfcache「client 換鍵」是**備註專屬**設計,退款側(refund-section.tsx)刻意相反
//    (絕不 client 換鍵):備註多一筆可用更正修、換鍵防的是 C9 死巷;退款多一筆是錢,
//    舊鍵撞 G4 才是重送保護(RW2d codex MF1)。要「統一兩支」前先讀兩邊檔頭論證。
//
// 🔴 token 三態(債①/④,順序即優先序):
//   失敗 state 帶回的那把(R2-2:error 分支 = RPC 可能已 commit,換新把 = 第二筆永久備註)
//   > bfcache 還原後 client 重產的那把(債④:沿用已成功的舊把會撞 C9「內容不符」RAISE)
//   > server 渲染期發的那把(Q2=C 正常路徑權威)。
//   bfcache 路徑的 token 是 client 產 —— Q2=C 的誠實代價之內(繞過畫面者本就能自選 token,
//   server 權威只保 honest path),不是對拍板的偏離。
//
// 🔴 occurredAt(債②):datetime-local 的 value 不帶偏移,直送會被解析器拒收(fail-closed)。
//   可見欄受控(state)、hidden 由同一 state 換算 —— 兩者結構上不可能分岔(R1 N8)。
//
// 🔴 更正模式(R1 MF1):noteType 初值 = 被更正列的型別 —— 預設 internal 會讓「更正告知紀錄的
//   錯字」靜默寫成 internal 更正列,把 customerNotified 翻成 false 且不可撤回。員工仍可改選
//   (「那次告知根本沒發生」= 刻意用 internal 更正,合法意圖)。呼叫端以 key 綁定更正目標,
//   進出更正模式必 remount ⇒ 初值恆新鮮。
//
// ⚠️ 無 JS(hydration 前)送出路徑未驗證:confirm 閘與 datetime 換算都不執行;安全底 =
//   解析器 fail-closed(occurred_at 空 → invalid)與 RPC 第二道,但體驗未測(R1 N3 誠實標注)。

export type CorrectTarget = {
  id: string;
  /** 時間軸相對序號(顯示用;truncated 時會漂,永久識別只有 id) */
  seq: number;
  /** 被更正列的型別(MF1:radio 初值;更正預設同型別) */
  noteType: NoteType;
  typeLabel: string;
  /** 節錄(顯示用 + confirm 內辨識 —— seq 會漂,節錄才認得出對象;R1 N5) */
  excerpt: string;
};

function toOffsetIso(local: string): string {
  if (local === '') return '';
  const parsed = new Date(local);
  // NaN → 送空字串讓解析器擋(invalid),不送半殘字面
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

/** 非 secure context(真機 LAN http 測試)沒有 crypto.randomUUID(R1 N4);token 是冪等鍵非安全值,Math.random 版可接受。 */
function regenerateToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const RADIO_LABEL = 'flex items-center gap-1.5 text-sm';

export function NoteComposeForm({
  orderId,
  serverToken,
  correctTarget,
  correctionMissing = false,
}: {
  orderId: string;
  /** 🔴 由 server component 渲染期產(Q2=C;不得落任何快取層 —— 見 note-action-state.ts:47-50) */
  serverToken: string;
  correctTarget: CorrectTarget | null;
  /** MF2:URL 有 ?correct 但目標不在已載入集合或已被更正 → 明示警告,不靜默當一般新增 */
  correctionMissing?: boolean;
}) {
  const [state, formAction, isPending] = useActionState<NoteActionState, FormData>(
    appendOrderNoteAction,
    { status: 'idle', requestToken: serverToken },
  );
  const [noteType, setNoteType] = useState<NoteType>(correctTarget?.noteType ?? 'internal');
  const [occurredLocal, setOccurredLocal] = useState('');
  const [bfcacheToken, setBfcacheToken] = useState<string | null>(null);

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      // 債④:bfcache 還原(返回鍵)時舊 token 可能已用掉且 committed;重產一把,
      // 否則「改幾個字再送」= 同 token 不同內容 → C9 RAISE(正常操作看到「系統狀態異常」)。
      if (event.persisted) setBfcacheToken(regenerateToken());
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  const failed = state.status === 'failed';
  const requestToken = failed ? state.requestToken : (bfcacheToken ?? serverToken);
  const isContact = noteType !== 'internal';

  return (
    <section id='note-compose' className='bg-card text-card-foreground rounded-lg border p-4'>
      <h2 className='text-muted-foreground mb-3 text-xs font-medium'>
        {correctTarget ? '更正備註' : '新增備註'}
      </h2>

      {correctionMissing && (
        <div
          role='alert'
          className='border-destructive/30 bg-destructive/5 text-destructive mb-3 rounded-md border px-3 py-2 text-sm'
        >
          找不到指定要更正的備註,或它已經被更正過(一筆只能更正一次)。
          下方表單送出的會是<strong>新備註</strong>,不是更正。
          <Link href={`/orders/${orderId}`} className='ml-2 font-medium underline'>
            清除
          </Link>
        </div>
      )}

      {correctTarget && (
        <div className='mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900'>
          <p className='font-medium'>
            正在更正 #{correctTarget.seq}({correctTarget.typeLabel}):
            <span className='font-normal'>{correctTarget.excerpt}</span>
          </p>
          <p className='mt-1 text-xs'>{CORRECTION_IRREVOCABLE_NOTICE}</p>
          <Link
            href={`/orders/${orderId}`}
            className='mt-1 inline-block text-xs font-medium underline'
          >
            取消更正
          </Link>
        </div>
      )}

      {failed && (
        <p
          role='alert'
          className='border-destructive/30 bg-destructive/5 text-destructive mb-3 rounded-md border px-3 py-2 text-sm'
        >
          {state.message}
        </p>
      )}

      <form
        action={formAction}
        onSubmit={(event) => {
          // 債⑥:更正不可撤回 → 送出前 confirm(取消 = 不送);帶節錄不只 seq(N5:seq 會漂)
          if (
            correctTarget &&
            !window.confirm(
              `即將更正 #${correctTarget.seq}(${correctTarget.typeLabel}):${correctTarget.excerpt}\n\n${CORRECTION_IRREVOCABLE_NOTICE}`,
            )
          ) {
            event.preventDefault();
          }
        }}
        className='space-y-3'
      >
        <input type='hidden' name={NOTE_ORDER_ID_FIELD} value={orderId} />
        <input type='hidden' name={NOTE_REQUEST_TOKEN_FIELD} value={requestToken} />
        {correctTarget && (
          <input type='hidden' name={NOTE_CORRECTS_FIELD} value={correctTarget.id} />
        )}

        <div className='flex flex-wrap gap-4'>
          {NOTE_TYPES.map((type) => (
            <label key={type} className={RADIO_LABEL}>
              <input
                type='radio'
                name={NOTE_TYPE_FIELD}
                value={type}
                checked={noteType === type}
                onChange={() => setNoteType(type)}
              />
              {NOTE_TYPE_LABEL[type]}
            </label>
          ))}
        </div>

        {isContact && (
          <div className='grid gap-3 sm:grid-cols-2'>
            <AdminFormField label='聯絡管道'>
              <select name={NOTE_CHANNEL_FIELD} required className={ADMIN_INPUT_CLASS} defaultValue=''>
                <option value='' disabled>
                  請選擇
                </option>
                {NOTE_CHANNELS.map((channel) => (
                  <option key={channel} value={channel}>
                    {NOTE_CHANNEL_LABEL[channel]}
                  </option>
                ))}
              </select>
            </AdminFormField>
            <AdminFormField label='聯絡時間(台北時間)'>
              {/* datetime-local 本身不進 FormData(無 name);帶偏移字面走 hidden(債②) */}
              <input
                type='datetime-local'
                required
                value={occurredLocal}
                onChange={(event) => setOccurredLocal(event.target.value)}
                className={ADMIN_INPUT_CLASS}
              />
            </AdminFormField>
            <input type='hidden' name={NOTE_OCCURRED_AT_FIELD} value={toOffsetIso(occurredLocal)} />
          </div>
        )}

        <AdminFormField label={correctTarget ? '更正後的內容' : '內容'}>
          {/* maxLength 數 UTF-16 code unit、RPC 數碼位(char_length)——
              含 emoji 時這裡先擋(方向安全、不會寫入超長);權威在 RPC BODY_TOO_LONG(N6) */}
          <textarea
            name={NOTE_BODY_FIELD}
            required
            rows={3}
            maxLength={4000}
            defaultValue={failed ? state.body : ''}
            placeholder='備註送出後無法刪除,只能事後更正。'
            className='border-input bg-background rounded-md border px-3 py-2 text-sm'
          />
        </AdminFormField>

        <div className='flex items-center justify-end gap-3'>
          <span className='text-muted-foreground mr-auto text-xs'>
            備註為永久紀錄、送出後不可刪除。
          </span>
          <button
            type='submit'
            disabled={isPending}
            className='bg-primary text-primary-foreground h-9 rounded-md px-5 text-sm font-medium disabled:opacity-50'
          >
            {isPending ? '送出中…' : correctTarget ? '送出更正' : '新增備註'}
          </button>
        </div>
      </form>
    </section>
  );
}
