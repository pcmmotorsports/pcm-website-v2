import { NextRequest, NextResponse } from 'next/server';
import { createLineSupabase } from '@/lib/line';

// 手動標記：已成交 / 停止追蹤 / 重新開啟
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const { action } = (await req.json()) as { action?: string };
  const now = new Date().toISOString();

  let patch: Record<string, string | null>;
  if (action === 'convert') {
    patch = { converted_at: now, updated_at: now };
  } else if (action === 'cancel') {
    patch = { cancelled_at: now, updated_at: now };
  } else if (action === 'reopen') {
    patch = { converted_at: null, cancelled_at: null, updated_at: now };
  } else {
    return NextResponse.json({ error: 'invalid action' }, { status: 400 });
  }

  const supabase = createLineSupabase();
  const { error } = await supabase
    .from('line_conversations')
    .update(patch)
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
