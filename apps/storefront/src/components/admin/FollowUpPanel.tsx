'use client';
import { type CSSProperties, useCallback, useEffect, useState } from 'react';

interface Conversation {
  id: string;
  display_name: string | null;
  last_inquiry_at: string | null;
  follow_up_1_sent_at: string | null;
  follow_up_2_sent_at: string | null;
  cancelled_at: string | null;
  converted_at: string | null;
}

function statusOf(c: Conversation): { label: string; color: string } {
  if (c.converted_at) return { label: '已成交', color: '#7c3aed' };
  if (c.cancelled_at) return { label: '已停止', color: '#999' };
  if (c.follow_up_2_sent_at) return { label: '追單2已發', color: '#2563eb' };
  if (c.follow_up_1_sent_at) return { label: '追單1已發', color: '#2563eb' };
  return { label: '待追單', color: '#d97706' };
}

function fmtDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const btn: CSSProperties = {
  border: '1px solid #ccc',
  borderRadius: 6,
  padding: '4px 10px',
  fontSize: 13,
  background: '#fff',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

export function FollowUpPanel() {
  const [list, setList] = useState<Conversation[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/admin/conversations')
      .then((r) => r.json())
      .then((d: { conversations?: Conversation[] }) =>
        setList(d.conversations ?? []),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (id: string, action: string): Promise<void> => {
    await fetch(`/api/admin/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    load();
  };

  const rows = showAll
    ? list
    : list.filter((c) => !c.converted_at && !c.cancelled_at);

  return (
    <section style={{ marginBottom: 28 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
          gap: 8,
        }}
      >
        <h2 style={{ fontSize: 17, fontWeight: 700 }}>追單名單</h2>
        <label style={{ fontSize: 13, color: '#666' }}>
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
          />{' '}
          顯示全部
        </label>
      </div>
      {loading && <p style={{ color: '#888' }}>載入中…</p>}
      {!loading && rows.length === 0 && (
        <p style={{ color: '#888' }}>目前沒有追單中的客戶</p>
      )}
      {rows.map((c) => {
        const st = statusOf(c);
        const done = Boolean(c.converted_at) || Boolean(c.cancelled_at);
        return (
          <div
            key={c.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 0',
              borderBottom: '1px solid #eee',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {c.display_name ?? '(未知客戶)'}
              </div>
              <div style={{ fontSize: 12, color: '#888' }}>
                詢價 {fmtDate(c.last_inquiry_at)}
                <span style={{ color: st.color, marginLeft: 8 }}>
                  ● {st.label}
                </span>
              </div>
            </div>
            {done ? (
              <button style={btn} onClick={() => act(c.id, 'reopen')}>
                重新開啟
              </button>
            ) : (
              <>
                <button
                  style={{ ...btn, color: '#7c3aed' }}
                  onClick={() => act(c.id, 'convert')}
                >
                  已成交
                </button>
                <button
                  style={{ ...btn, color: '#999' }}
                  onClick={() => act(c.id, 'cancel')}
                >
                  停止
                </button>
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}
