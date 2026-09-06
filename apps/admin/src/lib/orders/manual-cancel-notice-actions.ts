'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import { NotificationEmailInput } from '@pcm/schemas';
import { getRequestId } from '../audit/context';
import { authorizeManagerMutation } from '../session/authorize';
import { getAdminAuditLogRepository } from './order-repository';
import {
  readManualCancelNoticeEligibility,
  readManualCancelNoticeRowForAudit,
  readPhoneNotifiedMark,
} from './manual-cancel-notice-read';
import {
  manualCancelNoticeResultCode,
  manualCancelRevokeResultCode,
  manualCancelPhoneResultCode,
  PHONE_NOTIFIED_AUDIT_ACTION,
  type ManualCancelNoticeFailureCode,
  type ManualCancelRevokeFailureCode,
  type ManualCancelPhoneFailureCode,
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

  // 🔴🔴 **從這裡開始一律用 `canonicalOrderId`, 不再碰表單送來的那個字串。**
  //    codex R3 must-fix ②:`orders.id` 是 `uuid` 而 `email_outbox.dedup_key` 是 **`text`**
  //    ⇒ 兩個分頁用**大小寫不同**的 UUID 網址, DB 認為是**同一張單**(uuid 會正規化),
  //      而 `dedup_key` 收到的是**兩個不同的字串**
  //      ⇒ 🛑 **兩筆都插得進去 —— `(event_type, dedup_key)` 那道唯一鍵整個繞過去了。**
  //    ✅ 這個值是 `select('id')` 回來的那一份 ⇒ **形狀由 Postgres 決定, 不由網址決定。**
  const canonicalOrderId = eligibility.orderId;

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
        target: `order:${canonicalOrderId}`,
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
  // 🔴🔴 **改走 RPC —— 而這【不是】重構, 是把一個真的窗口關掉。**
  //    codex R3 must-fix ①:上面那次資格重讀與這裡的寫入之間**沒有共同交易也沒有鎖**。
  //    🔬 反例(它給的, 我在拋棄式 PG 上重現過):總額 5000、卡退 4000、人工退款兩筆各 500,
  //      我讀完資格之後另一人**作廢其中一筆** ⇒ `20260905440000` 把狀態降成 `partiallyRefunded`
  //      ⇒ 🛑 我仍然無條件插入 ⇒ **寫入當下已經不合格**, 而日後卡上補退滿時
  //        那一列會讓這張單被 anti-join 排除 ⇒ 📌 **那位客人的取消信永久關閉。**
  //    ✅ `record_manual_cancel_notice`(`20260906920000`)先 `FOR NO KEY UPDATE` 鎖那張單,
  //      **再算述詞, 再寫** —— 三件事在同一個交易裡。
  //    🔵 **上面那次 TS 的資格檢查【不拿掉】**:它負責給人一句看得懂的話(12 顆碼),
  //      而 RPC 負責正確性。形狀與理由逐字同 `dead-letter-actions.ts:64-67`
  //      (「前置判斷與 RPC 的白名單刻意同義而不是取代」)。
  //    ⚠️ **而 `dedup_key` 現在由 SQL 那側從 `uuid` 轉出來** ⇒ 呼叫端連傳錯形狀的機會都沒有
  //      (R3 must-fix ② 的第二道防線;TS 這側仍用 canonicalOrderId, 兩層同向)。
  const res = await createSupabaseServiceClient().rpc('record_manual_cancel_notice', {
    p_order_id: canonicalOrderId,
    p_recipient_email: recipientEmail,
    p_actor: authorization.actorId,
    p_request_id: requestId,
  });

  if (res.error) {
    console.error('[admin/orders] record_manual_cancel_notice 失敗(稽核已留下一筆)', {
      request_id: requestId,
      order_id: canonicalOrderId,
      code: res.error.code,
      message: String(res.error.message ?? '').slice(0, 300),
    });
    backTo(orderId, 'write_failed');
  }

  // 🔴 **RPC 回的碼要逐個接** —— 少接一個, 那條路會安靜地走到下面的「成功」。
  //    🛑 而 `result` 不是我認得的字串時也**不可以**當成功:那表示 SQL 那側改了而這裡沒跟上。
  const rpcResult = (res.data as { result?: unknown } | null)?.result;
  if (rpcResult === 'raced') backTo(orderId, 'raced');
  if (rpcResult === 'not_found') backTo(orderId, 'not_found');
  if (rpcResult === 'not_eligible') {
    // 🔵 RPC 刻意不細分為什麼不合格(那是本檔上面那次檢查的職責)。
    //    走到這裡 = **兩次檢查之間狀態真的變了** ⇒ 用 `raced` 那句話最貼近事實:
    //    「剛才有別人動了這張單, 你這一次沒有寫入」。
    backTo(orderId, 'raced');
  }
  if (rpcResult !== 'ok') {
    console.error('[admin/orders] record_manual_cancel_notice 回了我不認得的碼', {
      request_id: requestId,
      order_id: canonicalOrderId,
      result: String(rpcResult ?? '(空)').slice(0, 100),
    });
    backTo(orderId, 'write_failed');
  }

  revalidatePath(`/orders/${orderId}`);
  // 🔴 **成功【不帶結果碼】** —— `?r=` 任何人都打得出來, 一則綠色「已登錄」會讓員工
  //    對一張**沒被登錄過**的單停止動作(理由全文在 messages 那支檔)。
  //    ✅ 成功的證據是**看得到的事實**:鈕消失 + 寄信紀錄多一列, 兩個都是伺服器現讀的。
  redirect(`/orders/${orderId}`);
}

/** 撤銷那條路的導頁。**成功不回碼**(理由同登錄那條:`?r=` 偽造得出來)。 */
function revokeBackTo(orderId: string, code: ManualCancelRevokeFailureCode): never {
  redirect(`/orders/${orderId}?${RESULT_PARAM}=${manualCancelRevokeResultCode(code)}`);
}

/**
 * ⟦b4-CANCELMAILMIXEDRAIL⟧ 片 B:**撤銷**人工寄出取消通知的登錄。
 *
 * 🔴 **它存在是因為登錄那顆鈕不可撤銷** —— 那一列會永久吃掉 `(order_cancelled, <orderId>)`
 *    那個唯一鍵, 而掃描 view 的 anti-join 只問 `event_type`
 *    ⇒ 誤按一次 = 那位客人的系統取消信永久關閉。主視窗 2026-09-06 裁乙:做這顆。
 *
 * 🛑 **順序與登錄那支同一條判準**(`dead-letter-actions.ts:68` 逐字「哪一半救得回來」):
 *    撤銷**可以晚一點**(再按一次就好), 而**「誰撤的」查不回來** ⇒ **稽核先寫, 寫不成就不撤。**
 *
 * 🔵 **述詞在 SQL 那側**(`revoke_manual_cancel_notice`, `20260906930000`)——
 *    「只准撤 payload 標 manual 的列」寫在 DELETE 那一句上, 而不是這裡。
 *    🔬 理由量過:這個 repo 對 PostgREST 的 jsonb 路徑過濾**零先例**
 *      (`git grep "payload->>" -- apps packages` ⇒ 命中 1, 而那是一句註解;
 *       🟢 正對照 `.eq(` 在 `apps/admin/src` ⇒ 38 檔)
 *    ⇒ 📌 **一個沒有綁上的過濾, 在【硬刪】這個動作上會刪掉不該刪的列。**
 */
export async function revokeManualCancelNoticeAction(formData: FormData): Promise<void> {
  // ① 授權閘 —— 與登錄同級(manager)。撤銷同樣不可逆(那一列刪了就沒了)。
  const authorization = await authorizeManagerMutation();

  const rawOrderId = formData.get('order_id');
  const orderId = typeof rawOrderId === 'string' && rawOrderId !== '' ? rawOrderId : null;
  if (!authorization) redirect(`/orders?${RESULT_PARAM}=${manualCancelRevokeResultCode('denied')}`);
  if (orderId === null) redirect(`/orders?${RESULT_PARAM}=${manualCancelRevokeResultCode('invalid')}`);

  const requestId = await getRequestId();

  // ② 🔴 **先把那一列【讀下來】** —— 稽核的 `before` 要是觀察值, 不是我填的期望值
  //    (code-reviewer must-fix;現成形狀見 `dead-letter-actions.ts:56`)。
  //    🔵 讀不到就寫 `null` —— **那也是一個誠實的觀察**(「我按的時候沒看到那一列」)。
  const before = await readManualCancelNoticeRowForAudit(orderId);

  // ③ 稽核【先寫】。動作名用 `_requested`:寫這一筆的當下**那一列還在**。
  try {
    await getAdminAuditLogRepository().record(
      {
        action: 'email.order_cancelled.manual_send_revoke_requested',
        target: `order:${orderId}`,
        before:
          before === null
            ? { order_cancelled_outbox_row: null }
            : {
                outbox_id: before.id,
                manual: before.manual,
                recipient_email: before.recipientEmail,
                recorded_by: before.recordedBy,
              },
        // 🔴 **`after` 明寫成「還沒發生」而不是留空**(codex nit)——
        //    `audit-diff.ts:102` 把缺席的 `after` 當**空物件** ⇒ 稽核畫面會顯示
        //    「那些欄位由原值**改成空值**」⇒ 📌 **一筆 `_requested` 看起來像已經刪掉了。**
        //    ⇒ 動作名對而**展開的內容會騙人**;給它一個明確的值就沒有那個歧義。
        after: { outcome: 'pending', note: '寫這一筆的當下還沒有撤;結果看第二筆 _revoked' },
        reason: '後台撤銷「已人工寄出取消通知」的登錄:按下按鈕',
      },
      { actor: authorization.actorId, requestId, sourceApp: 'admin' },
    );
  } catch (error) {
    console.error('[admin/orders] 撤銷登錄的稽核寫入失敗(這張單【沒有】被撤銷)', {
      request_id: requestId,
      order_id: orderId,
      message: String((error as { message?: unknown }).message ?? '').slice(0, 200),
    });
    revokeBackTo(orderId, 'audit_failed');
  }

  // ③ 撤銷 —— 述詞與刪除在同一句 SQL 裡(見那支 migration)。
  // 🔴🔴 **把【我讀到的那一列的 id】傳進去** —— codex must-fix ①(compare-and-swap)。
  //    ⛔ 舊版只傳 order_id ⇒ RPC 撤的是「這張單**現在**的那一列」
  //    ⇒ 🛑 舊分頁的一發撤銷會刪掉**後來那一筆有效的登錄**(而信其實已經寄了)。
  //    🔵 讀不到那一列時**根本不該叫 RPC** —— 直接回 not_found, 而稽核那一筆已經誠實記了 null。
  if (before === null) revokeBackTo(orderId, 'not_found');
  const res = await createSupabaseServiceClient().rpc('revoke_manual_cancel_notice', {
    p_order_id: orderId,
    p_outbox_id: before.id,
    p_actor: authorization.actorId,
    p_request_id: requestId,
  });

  if (res.error) {
    console.error('[admin/orders] revoke_manual_cancel_notice 失敗(稽核已留下一筆)', {
      request_id: requestId,
      order_id: orderId,
      code: res.error.code,
      message: String(res.error.message ?? '').slice(0, 300),
    });
    revokeBackTo(orderId, 'revoke_failed');
  }

  // 🔴 四種回碼逐個接。**不認得的字不可以當成功** —— 那表示 SQL 那側改了而這裡沒跟上。
  const rpcResult = (res.data as { result?: unknown } | null)?.result;
  if (rpcResult === 'not_found') revokeBackTo(orderId, 'not_found');
  if (rpcResult === 'not_manual') revokeBackTo(orderId, 'not_manual');
  if (rpcResult === 'invalid_args') revokeBackTo(orderId, 'invalid');
  if (rpcResult !== 'ok') {
    console.error('[admin/orders] revoke_manual_cancel_notice 回了我不認得的碼', {
      request_id: requestId,
      order_id: orderId,
      result: String(rpcResult ?? '(空)').slice(0, 100),
    });
    revokeBackTo(orderId, 'revoke_failed');
  }

  // ④ 🔴🔴 **成功了才寫第二筆** —— 而這一筆在【硬刪】這件事上特別重要:
  //    成功之後 DB 裡**連那一列都沒了** ⇒ 沒有第二筆的話,
  //    📌 **事後沒有任何東西分得出「撤掉了」與「按了而沒撤成」**,
  //      被刪列的 `recorded_by` / `recipient_email` 也一起消失。
  //    🔵 現成形狀 `dead-letter-actions.ts:117-131` 逐字「成功了才寫第二筆…
  //      按了與真的排回去了因此分得開」。
  //    ⚠️ **這一筆失敗【不擋】**(與 ③ 相反):刪除**已經發生**、回滾不了,
  //      而「誰按的」在 ③ 那一筆裡已經記住了。
  const deletedId = (res.data as { deleted_id?: unknown } | null)?.deleted_id;
  try {
    await getAdminAuditLogRepository().record(
      {
        action: 'email.order_cancelled.manual_send_revoked',
        target: `order:${orderId}`,
        // 🔵 `after` 是空的 —— 那一列**不存在了**, 而那正是這個動作的結果。
        after: { order_cancelled_outbox_row: null, deleted_outbox_id: deletedId ?? null },
        reason: '後台撤銷「已人工寄出取消通知」的登錄:已刪除那一列',
      },
      { actor: authorization.actorId, requestId, sourceApp: 'admin' },
    );
  } catch (error) {
    console.error('[admin/orders] 撤銷【已經完成】而第二筆稽核寫入失敗(不回滾)', {
      request_id: requestId,
      order_id: orderId,
      deleted_outbox_id: String(deletedId ?? ''),
      message: String((error as { message?: unknown }).message ?? '').slice(0, 200),
    });
  }

  revalidatePath(`/orders/${orderId}`);
  // 🔴 成功不帶結果碼(理由同登錄那條)。證據 = 撤銷鈕消失、登錄鈕回來、紀錄少一列。
  redirect(`/orders/${orderId}`);
}

function phoneBackTo(orderId: string, code: ManualCancelPhoneFailureCode): never {
  redirect(`/orders/${orderId}?${RESULT_PARAM}=${manualCancelPhoneResultCode(code)}`);
}

/**
 * ⟦mail-PHONEONLYNOTIFY⟧:標記「已電話通知」(Sean 2026-09-06 拍甲)。
 *
 * 🔴 **為什麼不寫 `email_outbox`**:那張表的 `recipient_email` 是 `NOT NULL` **外加**
 *    `CHECK (recipient_email <> '')` —— 而這顆鈕服務的**正是沒有信箱的單**
 *    ⇒ 📌 **它天生塞不進去**, 而為了塞進去去鬆那道約束, 代價不對稱
 *      (那道約束正在擋一整族的錯:**沒有收件人的信被排進寄信佇列**)。
 *    ✅ 主視窗裁**甲**:只寫稽核, 而 `20260906960000` 讓計數的述詞去讀它。
 *
 * 🛑 **這個動作【沒有撤銷】**(稽核 append-only)—— 主視窗裁「接受」:
 *    按錯的後果只是**那張單不再被提醒**(不是寄錯信給客人), 而誰按的稽核留著。
 *    ⚠️ **與登錄鈕不對稱, 而那是刻意的。**
 *
 * 🔵 **它只寫一筆稽核, 沒有第二筆** —— 與撤銷那支不同, 因為這裡**沒有第二個步驟**:
 *    稽核那一筆本身就是那個動作的全部。⇒ 動作名不用 `_requested`。
 */
export async function markPhoneNotifiedAction(formData: FormData): Promise<void> {
  const authorization = await authorizeManagerMutation();

  const rawOrderId = formData.get('order_id');
  const orderId = typeof rawOrderId === 'string' && rawOrderId !== '' ? rawOrderId : null;
  if (!authorization) redirect(`/orders?${RESULT_PARAM}=${manualCancelPhoneResultCode('denied')}`);
  if (orderId === null) redirect(`/orders?${RESULT_PARAM}=${manualCancelPhoneResultCode('invalid')}`);

  // 🔵 已經標記過就不重複寫 —— 稽核是 append-only, 重複寫會讓「誰通知的」變成一串人。
  //    🛑 而這**不是**那道閘:它是體貼, 不是正確性。真的重複寫也只是多一筆,
  //      計數那一側的述詞用的是 `NOT EXISTS` ⇒ 一筆與十筆同義。
  // 🔴🔴 **伺服器端重讀資格**(code-reviewer 2026-09-06 must-fix ②)——
  //    ⛔ 舊版從授權直接跳到寫稽核 ⇒ **任何 manager POST 任意 order_id 都寫得進去**。
  //    🛑 而後果比登錄鈕那顆**更重**:那邊插的 outbox 列有 `20260906930000` 撤得掉;
  //      這邊稽核 **append-only** ⇒ 📌 **那張單的看門狗永久關閉, 而沒有任何入口撤得回來。**
  //    ✅ 判準與登錄鈕同一支(`readManualCancelNoticeEligibility`)——
  //      不合格就拒, 而它順便給我**正規化過的 id**(見下)。
  const eligibility = await readManualCancelNoticeEligibility(orderId);
  if (!eligibility.eligible) phoneBackTo(orderId, 'invalid');

  // 🔴🔴 **server 也要檢查「真的沒有信箱」**(codex 2026-09-06 must-fix ②;它在隔離探針重現過)。
  //    ⛔ 舊版只檢查 `eligible` ⇒ 管理者**直接 POST**、或開頁之後有人**補上信箱**,
  //      這一發仍會寫入「沒有信箱、已電話通知」並**關掉那張單的提醒**。
  //    🛑 而稽核 **append-only** ⇒ 📌 **關掉了就撤不回來。**
  //    ✅ 判準與 UI 那一側**同一份**:資格現讀之後, 兩個信箱都空(含合成信箱)才准。
  //    🔵 讀 `customers` 失敗時也拒 —— 那是「我不知道有沒有信箱」, 不是「沒有」。
  if (eligibility.suggestedEmail !== null || eligibility.customerEmailReadFailed) {
    phoneBackTo(orderId, 'invalid');
  }

  // 🔴🔴 **`target` 一律用 DB 正規化過的 id**(code-reviewer must-fix ①)——
  //    ⛔ 舊版寫 `order:${orderId}` 拿的是**表單/網址**那個字串。
  //    🔬 而 SQL 述詞是 `'order:' || o.id::pg_catalog.text`, 而 `uuid_out` **恆輸出小寫**
  //    ⇒ 🛑 從**大寫 UUID 網址**按下去 ⇒ 述詞永遠不匹配 ⇒ **計數不會歸零**;
  //      而 `readPhoneNotifiedMark(orderId)` 用同一個大寫字串走 **text 等值** ⇒ 它匹配得到
  //      ⇒ 📌 **畫面說「已電話通知」而計數還在叫 —— 兩邊各自看起來都正常。**
  //      (那正是本片自己在 SQL 檔頭警告過的形狀, 而我在 TS 這側踩了它。)
  const canonicalOrderId = eligibility.orderId;

  const already = await readPhoneNotifiedMark(canonicalOrderId);
  if (already !== null) phoneBackTo(orderId, 'already_marked');

  // 🔴 稽核的 `before` 要是**讀來的**, 不是我編的(code-reviewer must-fix ③;
  //    而那正是**同一支檔今天稍早**折過的同一個形狀 —— `read.ts:76-82` 記著)。
  const before = await readManualCancelNoticeRowForAudit(canonicalOrderId);

  const requestId = await getRequestId();

  try {
    await getAdminAuditLogRepository().record(
      {
        // 🔴 走常數不重打字面 —— 這個字同時住在 `20260906960000` 的述詞裡。
        action: PHONE_NOTIFIED_AUDIT_ACTION,
        target: `order:${canonicalOrderId}`,
        before:
          before === null
            ? { order_cancelled_outbox_row: null }
            : { outbox_id: before.id, manual: before.manual },
        after: { phone_notified: true },
        reason: '後台標記「已電話通知」:這張單沒有信箱, 客服用電話通知客人',
      },
      { actor: authorization.actorId, requestId, sourceApp: 'admin' },
    );
  } catch (error) {
    console.error('[admin/orders] 電話通知標記的稽核寫入失敗(這張單【沒有】被標記)', {
      request_id: requestId,
      order_id: orderId,
      message: String((error as { message?: unknown }).message ?? '').slice(0, 200),
    });
    phoneBackTo(orderId, 'audit_failed');
  }

  revalidatePath(`/orders/${orderId}`);
  // 🔴 成功不帶結果碼。證據 = 那顆鈕換成一行「已電話通知 · 誰 · 何時」。
  redirect(`/orders/${orderId}`);
}
