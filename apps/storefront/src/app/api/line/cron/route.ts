import { NextRequest, NextResponse } from 'next/server';
import { createLineSupabase, sendPushMessage, FOLLOW_UP_MESSAGES } from '@/lib/line';

// Vercel cron 每小時呼叫一次，查詢到期追單並發送
export async function GET(req: NextRequest): Promise<NextResponse> {
  // 防止外部任意呼叫
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createLineSupabase();
  const now = new Date().toISOString();
  const results = { sent1: 0, sent2: 0, errors: 0 };

  // --- 追單 1：24hr 後 ---
  const { data: due1 } = await supabase
    .from('line_conversations')
    .select('id, line_user_id')
    .lte('follow_up_1_at', now)
    .is('follow_up_1_sent_at', null)
    .is('cancelled_at', null)
    .is('converted_at', null);

  for (const row of due1 ?? []) {
    try {
      await sendPushMessage(row.line_user_id, FOLLOW_UP_MESSAGES.first);
      await supabase
        .from('line_conversations')
        .update({ follow_up_1_sent_at: now, updated_at: now })
        .eq('id', row.id);
      results.sent1++;
    } catch {
      results.errors++;
    }
  }

  // --- 追單 2：72hr 後 ---
  const { data: due2 } = await supabase
    .from('line_conversations')
    .select('id, line_user_id')
    .lte('follow_up_2_at', now)
    .is('follow_up_2_sent_at', null)
    .not('follow_up_1_sent_at', 'is', null) // 確保追單 1 已發過
    .is('cancelled_at', null)
    .is('converted_at', null);

  for (const row of due2 ?? []) {
    try {
      await sendPushMessage(row.line_user_id, FOLLOW_UP_MESSAGES.second);
      await supabase
        .from('line_conversations')
        .update({ follow_up_2_sent_at: now, updated_at: now })
        .eq('id', row.id);
      results.sent2++;
    } catch {
      results.errors++;
    }
  }

  return NextResponse.json({ ok: true, ...results });
}
