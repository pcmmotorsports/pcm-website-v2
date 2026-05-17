import { NextResponse } from 'next/server';
import { createLineSupabase } from '@/lib/line';

// 追單對話列表（儀表板用）
export async function GET(): Promise<NextResponse> {
  const supabase = createLineSupabase();
  const { data, error } = await supabase
    .from('line_conversations')
    .select('*')
    .order('last_inquiry_at', { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ conversations: data ?? [] });
}
