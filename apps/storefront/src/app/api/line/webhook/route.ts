import { NextRequest, NextResponse } from 'next/server';
import {
  createLineSupabase,
  verifyLineSignature,
  isInquiryMessage,
  getUserProfile,
} from '@/lib/line';

interface LineMessageEvent {
  type: string;
  source: { userId: string };
  message?: { type: string; text?: string };
}

interface LineWebhookBody {
  events: LineMessageEvent[];
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.text();
  const signature = req.headers.get('x-line-signature') ?? '';

  if (!verifyLineSignature(body, signature)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  const { events } = JSON.parse(body) as LineWebhookBody;
  const supabase = createLineSupabase();

  await Promise.all(
    events
      .filter((e) => e.type === 'message' && e.source.userId)
      .map((e) => handleMessageEvent(e, supabase)),
  );

  return NextResponse.json({ ok: true });
}

async function handleMessageEvent(
  event: LineMessageEvent,
  supabase: ReturnType<typeof createLineSupabase>,
): Promise<void> {
  const userId = event.source.userId;
  const text = event.message?.type === 'text' ? (event.message.text ?? '') : '';
  const hasInquiry = isInquiryMessage(text);
  const now = new Date();

  // 取得現有紀錄（或準備新增）
  const { data: existing } = await supabase
    .from('line_conversations')
    .select('id, display_name')
    .eq('line_user_id', userId)
    .maybeSingle();

  if (hasInquiry) {
    // 詢價訊息：設定追單時間點
    const followUp1At = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const followUp2At = new Date(now.getTime() + 72 * 60 * 60 * 1000);

    // 第一次詢價才撈 profile（減少 API 呼叫）
    let displayName = existing?.display_name ?? null;
    let pictureUrl: string | undefined;
    if (!displayName) {
      const profile = await getUserProfile(userId);
      displayName = profile?.displayName ?? null;
      pictureUrl = profile?.pictureUrl;
    }

    await supabase.from('line_conversations').upsert(
      {
        line_user_id: userId,
        display_name: displayName,
        ...(pictureUrl ? { picture_url: pictureUrl } : {}),
        last_inquiry_at: now.toISOString(),
        follow_up_1_at: followUp1At.toISOString(),
        follow_up_2_at: followUp2At.toISOString(),
        // 重置追單紀錄（客戶重新詢價，重新計時）
        follow_up_1_sent_at: null,
        follow_up_2_sent_at: null,
        cancelled_at: null,
        updated_at: now.toISOString(),
      },
      { onConflict: 'line_user_id' },
    );
  } else if (existing) {
    // 非詢價訊息（客戶回覆了）→ 取消待發的追單
    await supabase
      .from('line_conversations')
      .update({ cancelled_at: now.toISOString(), updated_at: now.toISOString() })
      .eq('line_user_id', userId)
      .is('cancelled_at', null);
  }
}
