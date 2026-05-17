import { NextRequest, NextResponse } from 'next/server';
import { createLineSupabase } from '@/lib/line';

// FAQ 列表
export async function GET(): Promise<NextResponse> {
  const supabase = createLineSupabase();
  const { data, error } = await supabase
    .from('line_faq')
    .select('*')
    .order('sort_order', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ faqs: data ?? [] });
}

// 新增 FAQ
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as {
    title?: string;
    keywords?: string[];
    answer?: string;
    sort_order?: number;
  };
  if (!body.title || !body.keywords?.length || !body.answer) {
    return NextResponse.json(
      { error: '標題、關鍵字、回覆內容必填' },
      { status: 400 },
    );
  }

  const supabase = createLineSupabase();
  const { error } = await supabase.from('line_faq').insert({
    title: body.title,
    keywords: body.keywords,
    answer: body.answer,
    sort_order: body.sort_order ?? 99,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
