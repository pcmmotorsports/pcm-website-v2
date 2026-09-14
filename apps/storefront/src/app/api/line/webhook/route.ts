import { LINE_SIGNATURE_HEADER, LINE_WEBHOOK_MAX_BYTES, parseLineWebhookEvents, verifyLineSignature } from '@/lib/line/friend-webhook';
import { setLineFriendAt } from '@/lib/line/friend-repository';

// api/line/webhook — LINE Messaging API webhook(S3,2026-09-14;plan docs/plans/2026-09-14-line-friend-and-order-push-plan.md §1-5)。
//
// Sean 逐字「我們 LINE 登入可以做到順便加官方帳號為好友,然後就可以記錄在我們系統裡面」。
// 這支只做一件事:客人加 / 退官方帳號好友 ⇒ 記在 customers.line_friend_at。之後推播(S4)只推 line_friend_at 非空的人。
//
// 🔴 順序:① 沒設 secret ⇒ 503、零寫入 ② 缺 header / body 太大 ⇒ 先拒, 不讀 body ③ 讀【原始 bytes】驗簽章, 錯 ⇒ 401、零寫入
//    ④ 不是 `{events:[…]}` ⇒ 400 ⑤ follow / unfollow 逐筆條件寫(亂序不回寫), 其餘忽略 ⇒ 200。
// 🔴 DB 寫失敗 ⇒ 500。LINE 的 webhook redelivery **預設關閉**(官方文件), S0 上線檢查要在 console 打開它才會重送;
//    重送安全:事件冪等 + 亂序有 line_friend_event_at 擋。部分成功(第 2 筆炸)⇒ 500 ⇒ 整包重送 ⇒ 第 1 筆再寫一次同值。
// 🔴 回應不帶任何 userId;log 只記筆數與分類、錯誤只記 code 不記 message(message 可能夾識別碼)。
// 🔴 runtime nodejs:node:crypto + service_role(受控小門 friend-repository.ts), 同 auth/line/callback 那條紀律。

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.LINE_WEBHOOK_CHANNEL_SECRET ?? '';
  if (secret === '') {
    console.error('[line/webhook] LINE_WEBHOOK_CHANNEL_SECRET 沒設 ⇒ 不驗簽章就不收(fail-closed)');
    return Response.json({ ok: false, reason: 'not_configured' }, { status: 503 });
  }
  const signature = req.headers.get(LINE_SIGNATURE_HEADER);
  if (signature === null || signature === '') {
    return Response.json({ ok: false, reason: 'bad_signature' }, { status: 401 });
  }
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > LINE_WEBHOOK_MAX_BYTES) {
    return Response.json({ ok: false, reason: 'too_large' }, { status: 413 });
  }
  const rawBytes = new Uint8Array(await req.arrayBuffer());
  if (rawBytes.byteLength > LINE_WEBHOOK_MAX_BYTES) {
    return Response.json({ ok: false, reason: 'too_large' }, { status: 413 });
  }
  if (!verifyLineSignature(rawBytes, signature, secret)) {
    console.warn('[line/webhook] 簽章不對 ⇒ 401, 零寫入', { bytes: rawBytes.byteLength });
    return Response.json({ ok: false, reason: 'bad_signature' }, { status: 401 });
  }
  const events = parseLineWebhookEvents(Buffer.from(rawBytes).toString('utf8'));
  if (events === null) {
    return Response.json({ ok: false, reason: 'bad_body' }, { status: 400 });
  }
  let updated = 0;
  let skipped = 0;
  let ignored = 0;
  try {
    for (const ev of events) {
      if (ev.kind === 'other') {
        ignored += 1;
        continue;
      }
      const r = await setLineFriendAt(ev.userId, ev.kind === 'follow' ? ev.eventAt : null, ev.eventAt);
      if (r === 'updated') updated += 1;
      else skipped += 1;
    }
  } catch (e) {
    const code = (e as { code?: unknown })?.code;
    console.error('[line/webhook] 寫 line_friend_at 失敗 ⇒ 500', { code: typeof code === 'string' ? code : 'unknown', updated, skipped });
    return Response.json({ ok: false, reason: 'db_error' }, { status: 500 });
  }
  console.info('[line/webhook] ok', { events: events.length, updated, skipped, ignored });
  return Response.json({ ok: true, updated, skipped, ignored });
}
