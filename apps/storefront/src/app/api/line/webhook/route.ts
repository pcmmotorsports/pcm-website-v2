import { NextRequest, NextResponse } from 'next/server';
import {
  createLineSupabase,
  verifyLineSignature,
  isInquiryMessage,
  getUserProfile,
  sendReplyMessage,
} from '@/lib/line';

interface LineMessageEvent {
  type: string;
  replyToken?: string;
  source: { userId: string };
  message?: { type: string; text?: string };
}

interface LineWebhookBody {
  events: LineMessageEvent[];
}

interface FaqRow {
  keywords: string[];
  answer: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.text();
  const signature = req.headers.get('x-line-signature') ?? '';

  if (!verifyLineSignature(body, signature)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  const { events } = JSON.parse(body) as LineWebhookBody;
  const supabase = createLineSupabase();

  // 一次撈出啟用中的 FAQ，多個 event 共用
  const { data: faqs } = await supabase
    .from('line_faq')
    .select('keywords, answer')
    .eq('enabled', true)
    .order('sort_order', { ascending: true });

  await Promise.all(
    events
      .filter((e) => e.type === 'message' && e.source.userId)
      .map((e) => handleMessageEvent(e, supabase, (faqs ?? []) as FaqRow[])),
  );

  return NextResponse.json({ ok: true });
}

async function handleMessageEvent(
  event: LineMessageEvent,
  supabase: ReturnType<typeof createLineSupabase>,
  faqs: FaqRow[],
): Promise<void> {
  const userId = event.source.userId;
  const text = event.message?.type === 'text' ? (event.message.text ?? '') : '';
  const now = new Date();

  // 1. FAQ 比對：命中即自動回覆，視為已處理（不進追單邏輯）
  if (text && event.replyToken) {
    const matched = faqs.find((f) => f.keywords.some((kw) => text.includes(kw)));
    if (matched) {
      await sendReplyMessage(event.replyToken, [
        { type: 'text', text: matched.answer },
      ]);
      return;
    }
  }

  // 2. 沒命中 FAQ → 追單邏輯
  const hasInquiry = isInquiryMessage(text);

  const { data: existing } = await supabase
    .from('line_conversations')
    .select('id, display_name')
    .eq('line_user_id', userId)
    .maybeSingle();

  if (hasInquiry) {
    const followUp1At = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const followUp2At = new Date(now.getTime() + 72 * 60 * 60 * 1000);

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
        follow_up_1_sent_at: null,
        follow_up_2_sent_at: null,
        cancelled_at: null,
        updated_at: now.toISOString(),
      },
      { onConflict: 'line_user_id' },
    );
  } else if (existing) {
    await supabase
      .from('line_conversations')
      .update({ cancelled_at: now.toISOString(), updated_at: now.toISOString() })
      .eq('line_user_id', userId)
      .is('cancelled_at', null);
  }
}
