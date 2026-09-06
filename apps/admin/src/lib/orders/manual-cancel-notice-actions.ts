'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import { NotificationEmailInput } from '@pcm/schemas';
import { getRequestId } from '../audit/context';
import { authorizeManagerMutation } from '../session/authorize';
import { getAdminAuditLogRepository } from './order-repository';
import { readManualCancelNoticeEligibility } from './manual-cancel-notice-read';
import {
  manualCancelNoticeResultCode,
  type ManualCancelNoticeFailureCode,
} from './manual-cancel-notice-messages';

// manual-cancel-notice-actions.ts — ⟦b4-CANCELMAILMIXEDRAIL⟧ 片 B ①②③
//
// 「卡 + 現金混合退款的取消單」系統**刻意不寄**取消信(`20260905310000` 那道排除閘),
// 要人工寄。片 A 建了計數去數「該人工寄而還沒寄」的單, 而**那個數字沒有人能讓它歸零** ——
// Sean 2026-09-06 拍甲:**後台按一下「已寄」⇒ 補一列 outbox ⇒ 數字自己歸零。**
// 這支就是那顆鈕的後半。
//
// ── 🔴 順序:稽核【先寫】, 照 `dead-letter-actions.ts:68` 那條既有判準 ─────────
//  那支檔逐字寫著判準是「**哪一半救得回來**」:
//    · 員工變更那邊:資料已經改了 ⇒ 回滾比少一筆稽核更糟 ⇒ 稽核失敗不回滾
//    · 死信重排那邊:重排可以晚一點, 而「誰按的」查不回來 ⇒ 稽核失敗就不重排
//  ⇒ **本片與死信同一側**:這一列 outbox **可以晚一點補**(員工再按一次就好),
//    而「誰宣稱他寄了那封信」**查不回來** ⇒ 📌 **稽核先寫, 寫不成就不插。**
//
// ── 🛑 `status: 'sent'` 這個字在本檔之後有【兩個意思】 ────────────────────────
//  主視窗 2026-09-06 裁甲:借用既有的 `sent`, 不加第八態。
//  ⇒ 從此 `sent` = 「**我們的系統寄的**」**或**「**某個人自己寄的, 而他來登記了**」,
//    而**差別只住在 `payload` 裡**(`manual: true` + 誰 + 何時)。
//  🔴 **代價寫出來, 不要讓下一個人自己撞到**:查「為什麼這封 `sent` 卻沒有 Resend 編號」
//    的人, 會先繞一圈才找到 payload。✅ 而畫面那一格已經接得住 ——
//    寄信紀錄對沒有編號的列顯示「沒有編號」, 不是空白。
//
// ── 🔵 為什麼不寫 `sent_at = now()` 以外的東西 ───────────────────────────────
//  `attempts` / `max_attempts` / `next_retry_at` **有 DEFAULT ⇒ 不給**。
//  🔴 而 `attempts` 留在 0 是**對的**:我們一次都沒試過寄 —— 寄的是人。
//    填一個假的 1 進去 = 把「系統試過一次」寫成觀察值, 而那沒有發生。

// 🔴 `?r=` 是這一批頁面**唯一共用**的結果參數(`apps/admin/src/app/orders/[id]/page.tsx` 讀它)。
//    ⛔ ~~我第一版自己發明了 `?mcn=`~~ —— 那個參數**沒有任何人在讀**
//    ⇒ 📌 **12 個碼一個都不會顯示**, 而按鈕看起來就像沒反應。code-reviewer 2026-09-06 抓到。
//    ⛔ ~~13 個碼~~ 🔴 R2 nit 訂正 —— 那個 13 是我**加出來的不是數出來的**(把已經拿掉的
//       成功碼 `ok` 一起算了)。🔬 數法:`grep -c "manualCancelNoticeResultCode('" <messages 檔>` ⇒ **12**。
const RESULT_PARAM = 'r';

/** 失敗才回碼。**成功不回** —— 理由在 messages 那支檔(`?r=` 偽造得出來, 假綠字最危險)。 */
function backTo(orderId: string, code: ManualCancelNoticeFailureCode): never {
  redirect(`/orders/${orderId}?${RESULT_PARAM}=${manualCancelNoticeResultCode(code)}`);
}

export async function recordManualCancelNoticeAction(formData: FormData): Promise<void> {
  // ① 授權閘。🔴 走既有入口, 不自己寫一份(`server-action-guard-sweep.test.ts` 逐字要求
  //    「每一支 server action 都要有 authorize*Mutation, 除非白名單裡有它」)。
  // 🔴 **`Manager` 不是 `Admin`**(主視窗 2026-09-06 裁乙, code-reviewer nit ⑨ 問出來的):
  //    這顆鈕宣稱「我寄了一封信給客人」而且**不可逆** ⇒ 與死信重排同級
  //    (`dead-letter-actions.ts:46` 用的也是 `authorizeManagerMutation`)。
  const authorization = await authorizeManagerMutation();

  const rawOrderId = formData.get('order_id');
  const orderId = typeof rawOrderId === 'string' && rawOrderId !== '' ? rawOrderId : null;
  // 🔴 授權失敗時**不能 redirect 到帶 orderId 的網址**(那個值還沒被信任過)⇒ 回列表。
  if (!authorization) redirect(`/orders?${RESULT_PARAM}=${manualCancelNoticeResultCode('denied')}`);
  if (orderId === null) redirect(`/orders?${RESULT_PARAM}=${manualCancelNoticeResultCode('invalid')}`);

  // ② 🔴🔴 **重新讀資格 —— 不信任表單, 也不信任「鈕出現了」這件事。**
  //    codex 關卡1 must-fix ①:送一個還沒取消的訂單 ID 進來, 只靠 UI 藏鈕擋不住,
  //    而先插進去的那一列會讓它**日後真的被取消時反而收不到信**。
  const eligibility = await readManualCancelNoticeEligibility(orderId);
  if (!eligibility.eligible) backTo(orderId, eligibility.blocker);

  // ③ 信箱:走既有 schema(含**假信箱 gate** `isSyntheticEmailDomain`)。
  //    🔴 不是「有填就好」—— 預填有可能帶到合成信箱, 而直接呼叫 action 也送得進任意字串。
  //    ⚠️ **而它仍然只驗格式** —— 證不到那封信真的投遞到了。不要把這一關讀成投遞證明。
  const parsed = NotificationEmailInput.safeParse(formData.get('recipient_email'));
  if (!parsed.success) backTo(orderId, 'email_invalid');
  const recipientEmail = parsed.data;

  const requestId = await getRequestId();
  const recordedAt = new Date().toISOString();

  // ④ 稽核【先寫】。寫不成 ⇒ 不登錄(判準見檔頭)。
  //    🔴 動作名用 `_requested`:寫這一筆的當下**那一列還沒插進去**
  //    (照 `dead-letter-actions.ts` 那條 —— 一筆記載了沒有發生的事的稽核, 是改不掉的)。
  try {
    await getAdminAuditLogRepository().record(
      {
        action: 'email.order_cancelled.manual_send_record_requested',
        target: `order:${orderId}`,
        before: { order_cancelled_outbox_row: 'none' },
        // 🔴 `after` 留白:寫這一筆時還沒寫成。填「預期結果」= 把期望值寫成觀察值。
        reason: `後台登錄人工寄出取消通知:收件人 ${recipientEmail}`,
      },
      { actor: authorization.actorId, requestId, sourceApp: 'admin' },
    );
  } catch (error) {
    console.error('[admin/orders] 稽核寫入失敗(這張單【沒有】被登錄)', {
      request_id: requestId,
      order_id: orderId,
      message: String((error as { message?: unknown }).message ?? '').slice(0, 200),
    });
    backTo(orderId, 'audit_failed');
  }

  // ⑤ 插那一列。
  //    🔴 `dedup_key` **沿用既有算法 = 訂單 ID**
  //    (`SupabaseEmailOutboxAdapter.ts:337` 逐字 `dedupKey: input.orderId,`)——
  //    ⛔ **不可以每次產新 UUID**:唯一鍵是 `(event_type, dedup_key)`,
  //      新 UUID 每次都不撞 ⇒ 按兩下就兩列。
  // 🔴🔴 **這一段【刻意不包 try】** —— 而我第一版包了, code-reviewer 2026-09-06 抓到:
  //    `backTo()` 走的是 `redirect()`, 而它**靠丟 NEXT_REDIRECT 來運作**
  //    ⇒ 包在 try 裡的話, `23505` 那條路的 `backTo(orderId, 'raced')` **會被我自己的 catch 接住**
  //    ⇒ 📌 印一行**假的**「丟例外」, 然後改導 `write_failed`
  //      ⇒ 🛑 **撞鍵(別人同時登錄了)被回報成「登錄失敗請再試」** —— 而他再試還是撞。
  //    ✅ 形狀照 `dead-letter-actions.ts:100-114`:**Supabase 查詢錯誤是回 `{ error }`, 不是丟**
  //      ⇒ 檢查 `res.error` 就夠, 不需要 catch;真的丟出來的東西讓它往上走。
  const res = await createSupabaseServiceClient()
    .from('email_outbox')
    .insert({
      event_type: 'order_cancelled',
      order_id: orderId,
      dedup_key: orderId,
      recipient_email: recipientEmail,
      subject: '訂單取消通知(人工寄出)',
      // 🔴 差別住在這裡 —— `status` 是借來的, payload 才分得出兩種 `sent`。
      payload: {
        manual: true,
        recorded_by: authorization.actorId,
        recorded_at: recordedAt,
        request_id: requestId,
        note: '這一列不是系統寄的:員工自己寄了信之後在後台登錄。沒有 provider_message_id 是正常的。',
      },
      status: 'sent',
      sent_at: recordedAt,
    })
    .select('id')
    .maybeSingle();

  if (res.error) {
    // 🔴 唯一鍵撞了 ⇒ **不是成功**(codex 關卡1 must-fix ③)。
    //    回「已登錄」會讓員工以為處理完了, 而他這一次其實什麼都沒寫。
    if (res.error.code === '23505') backTo(orderId, 'raced');
    console.error('[admin/orders] 登錄人工寄出取消通知失敗(稽核已留下一筆)', {
      request_id: requestId,
      order_id: orderId,
      code: res.error.code,
      message: String(res.error.message ?? '').slice(0, 300),
    });
    backTo(orderId, 'write_failed');
  }

  revalidatePath(`/orders/${orderId}`);
  // 🔴 **成功【不帶結果碼】** —— `?r=` 任何人都打得出來, 一則綠色「已登錄」會讓員工
  //    對一張**沒被登錄過**的單停止動作(理由全文在 messages 那支檔)。
  //    ✅ 成功的證據是**看得到的事實**:鈕消失 + 寄信紀錄多一列, 兩個都是伺服器現讀的。
  redirect(`/orders/${orderId}`);
}
