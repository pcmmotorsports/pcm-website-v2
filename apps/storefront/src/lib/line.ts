import 'server-only';
import { createHmac } from 'crypto';
import { createClient } from '@supabase/supabase-js';

// apps/api 尚未實作，暫在此直接建 service client（server-only 保護已在本檔頂部）
export function createLineSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env not set');
  return createClient(url, key);
}

const LINE_API = 'https://api.line.me/v2/bot';

// 從對話紀錄萃取的高頻詢價關鍵字
const INQUIRY_KEYWORDS = [
  '多少', '報價', '有嗎', '有貨', '現貨', '庫存',
  '詢問', '請問', '多錢', '怎麼賣', '價格', '價錢',
  '要多少', '賣多少', '幫我查', '有沒有',
];

export function isInquiryMessage(text: string): boolean {
  return INQUIRY_KEYWORDS.some((kw) => text.includes(kw));
}

export function verifyLineSignature(body: string, signature: string): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) throw new Error('LINE_CHANNEL_SECRET not set');
  const digest = createHmac('sha256', secret)
    .update(body)
    .digest('base64');
  return digest === signature;
}

export async function sendPushMessage(
  userId: string,
  messages: ReadonlyArray<{ type: 'text'; text: string }>,
): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN not set');

  const res = await fetch(`${LINE_API}/message/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ to: userId, messages }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LINE push failed ${res.status}: ${err}`);
  }
}

export async function getUserProfile(
  userId: string,
): Promise<{ displayName: string; pictureUrl?: string } | null> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return null;

  const res = await fetch(`${LINE_API}/profile/${userId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;

  const data = (await res.json()) as { displayName: string; pictureUrl?: string };
  return { displayName: data.displayName, pictureUrl: data.pictureUrl };
}

export const FOLLOW_UP_MESSAGES = {
  first: [
    {
      type: 'text' as const,
      text: '您好！上次詢問的商品，如果還有需要歡迎再告知我 😊\n有任何問題也可以直接問，我們隨時為您服務！',
    },
  ],
  second: [
    {
      type: 'text' as const,
      text: '您好，不知道之前詢問的商品是否還有需要？\n如果找到了或有其他問題也歡迎告知，感謝您！🙏',
    },
  ],
} as const;
