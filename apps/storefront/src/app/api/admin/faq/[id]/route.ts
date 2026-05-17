import { NextRequest, NextResponse } from 'next/server';
import { createLineSupabase } from '@/lib/line';

// 修改 FAQ
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const body = (await req.json()) as {
    title?: string;
    keywords?: string[];
    answer?: string;
    enabled?: boolean;
  };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.title !== undefined) patch.title = body.title;
  if (body.keywords !== undefined) patch.keywords = body.keywords;
  if (body.answer !== undefined) patch.answer = body.answer;
  if (body.enabled !== undefined) patch.enabled = body.enabled;

  const supabase = createLineSupabase();
  const { error } = await supabase.from('line_faq').update(patch).eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// 刪除 FAQ
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const supabase = createLineSupabase();
  const { error } = await supabase.from('line_faq').delete().eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
