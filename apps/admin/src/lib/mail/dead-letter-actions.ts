'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import { getRequestId } from '../audit/context';
import { getAdminAuditLogRepository } from '../orders/order-repository';
import { authorizeManagerMutation } from '../session/authorize';
import { findDeadLetterForAudit } from './dead-letter-read';
import type { DeadLetterResultCode } from './dead-letter-messages';

// dead-letter-actions.ts — M-4b ⟦b4-MAILDEAD⟧ + ⟦b4-MAILAUDIT⟧:死信重排 + 稽核。
//
// ── 🔴🔴 **為什麼順序是「先稽核、後重排」,而它不能反** ──────────────────────
//
//  ⛔ **反過來(先 RPC、後稽核)在這個結構下【做不到 fail-closed】**:
//     那支 RPC 是**它自己的交易**,回來就已經 commit ⇒ 稽核失敗時**回滾不了**。
//     ⇒ 那條路只剩下既有慣例(`staff-actions.ts:86` 逐字「稽核寫入失敗(員工變更已生效)」),
//       而主視窗 2026-09-01 要求的是「兩者不可以分開成功」。
//
//  ✅ **先稽核 ⇒ 稽核失敗就不呼叫 RPC ⇒ fail-closed 成立。**
//
//  🔴 **而這【不推翻】那條既有慣例 —— 兩者用的是【同一條判準:哪一半救得回來】**:
//     · 員工變更那邊:資料**已經改了** ⇒ 回滾它比少一筆稽核更糟 ⇒ 稽核失敗不回滾。
//     · 本片這邊    :**重排可以晚一點**(下一輪 cron / 下一次按),
//       而**「誰按的」查不回來** ⇒ 稽核失敗就不要重排。
//     ⇒ 📌 同一條判準,套在兩個方向相反的不對稱上,得到相反的答案。
//     ⇒ ⇒ **看到兩個相反的做法時,不要以為其中一個是錯的。**
//
//  🔵 **副作用:稽核的語意變成【誰按了這顆鈕】,不是【這件事成功了】** ——
//     而那正是 `⟦b4-MAILAUDIT⟧` 判別句要的東西。RPC 事後失敗時,
//     稽核上會留著一筆「有人按過」而重排沒發生 ⇒ **誠實,不是漏洞。**
//
// 🔴 **授權走【既有】`authorizeManagerMutation`**(`../session/authorize`),不自己寫一道。
//    它 → `isActiveManager` → `staff.ts` 的 `row?.is_active === true && row.is_manager === true`。
//    ⚠️ 而那道閘住在**應用層** —— `service_role` 仍改得動那些欄(Sean Q15=甲 讀過代價後不鎖)。

const SETTINGS_PATH = '/settings/mail';

function redirectWith(code: DeadLetterResultCode): never {
  redirect(`${SETTINGS_PATH}?r=${code}`);
}

export async function requeueDeadEmailAction(formData: FormData): Promise<void> {
  // ① 授權閘。
  const authorization = await authorizeManagerMutation();
  if (!authorization) redirectWith('denied');

  // ② 解析。
  const raw = formData.get('outbox_id');
  const outboxId = typeof raw === 'string' && raw !== '' ? raw : null;
  if (outboxId === null) redirectWith('invalid');

  const requestId = await getRequestId();

  // ③ 🔴 **在證據被抹掉之前把它讀下來** —— 那支 RPC 會把 `last_error_code` 清成 NULL。
  const before = await findDeadLetterForAudit(outboxId);
  if (before === null) redirectWith('notfound');

  // ④ 🔴 **前置判斷與 RPC 的白名單刻意【同義而不是取代】**:
  //    這裡先判是為了給員工一句看得懂的話(而不是一個 500);
  //    而真正的防線仍是 RPC 裡的 `FOR UPDATE` + 白名單 —— 兩個人同時按時,
  //    只有那一側擋得住(這裡讀完到那裡鎖住之間,狀態仍可能變)。
  //    🛑 述詞改任一邊 ⇒ 兩邊一起改(`dead-letter-read.ts` 檔頭同一句)。
  if (before.status !== 'pending' && before.status !== 'failed') redirectWith('rejected');
  if (before.attempts < before.maxAttempts) redirectWith('rejected');

  // ⑤ 稽核【先寫】。寫不成 ⇒ 不重排。
  try {
    await getAdminAuditLogRepository().record(
      {
        action: 'email.dead_letter.requeue_requested',
        target: `email_outbox:${outboxId}`,
        before: {
          status: before.status,
          attempts: before.attempts,
          max_attempts: before.maxAttempts,
          last_error_code: before.lastErrorCode,
          event_type: before.eventType,
          order_id: before.orderId,
        },
        // 🔴 `after` 刻意留白:寫這一筆的當下**重排還沒發生**。
        //    填一個「預期的結果」進去 = 把期望值寫成觀察值。
        // 🔴 動作名是 `_requested` 不是 `requeue` —— 寫這一筆的當下**重排還沒發生**
        //    (codex 2026-09-01 R1 must-fix 2:一筆叫 `requeue` 的稽核, 在 RPC 失敗時
        //     會變成一筆【記載了沒有發生的事】的紀錄, 而稽核是 append-only 改不掉)。
        reason: '後台手動重排死信:按下按鈕',
      },
      { actor: authorization.actorId, requestId, sourceApp: 'admin' },
    );
  } catch (error) {
    console.error('[admin/settings/mail] 稽核寫入失敗(這封信【沒有】被重排)', {
      request_id: requestId,
      outbox_id: outboxId,
      message: String((error as { message?: unknown }).message ?? '').slice(0, 200),
    });
    redirectWith('audit_failed');
  }

  // ⑥ 重排。
  const { error } = await createSupabaseServiceClient().rpc('admin_requeue_dead_email', {
    p_outbox_id: outboxId,
  });
  if (error) {
    // 🔴 這裡到不了 `rejected` 的細分 —— RPC 用 RAISE EXCEPTION,而靠字串比對它的訊息很脆。
    //    ⇒ 統一回 `error`,而**完整訊息進 log**(那才是查得回來的地方)。
    console.error('[admin/settings/mail] admin_requeue_dead_email 失敗(稽核已留下一筆)', {
      request_id: requestId,
      outbox_id: outboxId,
      code: error.code,
      message: String(error.message ?? '').slice(0, 300),
    });
    redirectWith('error');
  }

  // ⑦ 🔴 **成功了才寫第二筆** —— 稽核上「按了」與「真的排回去了」因此分得開。
  //    ⚠️ 而這一筆失敗**不擋**(與 ⑤ 相反)——重排**已經發生**、回滾不了,
  //      而「誰按的」在 ⑤ 那一筆裡已經記住了。
  //    ⇒ 📌 同一條判準(哪一半救得回來)在同一支檔裡用了兩次, 得到兩個相反的處置。
  try {
    await getAdminAuditLogRepository().record(
      {
        action: 'email.dead_letter.requeued',
        target: `email_outbox:${outboxId}`,
        before: { status: before.status, attempts: before.attempts },
        after: { status: 'pending', attempts: 0, last_error_code: null },
        reason: '後台手動重排死信:RPC 回報成功',
      },
      { actor: authorization.actorId, requestId, sourceApp: 'admin' },
    );
  } catch (error) {
    console.error('[admin/settings/mail] 完成稽核寫入失敗(而重排【已經發生】, 不回滾)', {
      request_id: requestId,
      outbox_id: outboxId,
      message: String((error as { message?: unknown }).message ?? '').slice(0, 200),
    });
  }

  revalidatePath(SETTINGS_PATH);
  redirectWith('requeued');
}
