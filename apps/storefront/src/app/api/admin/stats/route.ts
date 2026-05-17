import { NextResponse } from 'next/server';
import { createLineSupabase } from '@/lib/line';

interface StatRow {
  follow_up_1_sent_at: string | null;
  cancelled_at: string | null;
  converted_at: string | null;
}

// 追單成效統計
export async function GET(): Promise<NextResponse> {
  const supabase = createLineSupabase();
  const { data, error } = await supabase
    .from('line_conversations')
    .select('follow_up_1_sent_at, follow_up_2_sent_at, cancelled_at, converted_at');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const rows = (data ?? []) as (StatRow & { follow_up_2_sent_at: string | null })[];

  const pending = rows.filter(
    (r) =>
      !r.cancelled_at &&
      !r.converted_at &&
      (!r.follow_up_1_sent_at || !r.follow_up_2_sent_at),
  ).length;
  const followUpsSent = rows.filter((r) => r.follow_up_1_sent_at).length;
  const responded = rows.filter(
    (r) =>
      r.follow_up_1_sent_at &&
      r.cancelled_at &&
      new Date(r.cancelled_at) > new Date(r.follow_up_1_sent_at),
  ).length;
  const converted = rows.filter((r) => r.converted_at).length;

  return NextResponse.json({ pending, followUpsSent, responded, converted });
}
