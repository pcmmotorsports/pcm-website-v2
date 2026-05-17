'use client';
import { type CSSProperties, useCallback, useEffect, useState } from 'react';

interface Stats {
  pending: number;
  followUpsSent: number;
  responded: number;
  converted: number;
}

const card: CSSProperties = {
  flex: '1 1 calc(50% - 8px)',
  border: '1px solid #e0e0e0',
  borderRadius: 8,
  padding: '12px 14px',
  background: '#fafafa',
};

export function StatsPanel() {
  const [stats, setStats] = useState<Stats | null>(null);

  const load = useCallback(() => {
    fetch('/api/admin/stats')
      .then((r) => r.json())
      .then((d: Stats) => setStats(d))
      .catch(() => setStats(null));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!stats) return <p style={{ color: '#888' }}>載入統計中…</p>;

  const items = [
    { label: '待追單中', value: stats.pending, color: '#d97706' },
    { label: '追單已發出', value: stats.followUpsSent, color: '#2563eb' },
    { label: '追單後有回應', value: stats.responded, color: '#059669' },
    { label: '已標記成交', value: stats.converted, color: '#7c3aed' },
  ];

  return (
    <section style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {items.map((it) => (
          <div key={it.label} style={card}>
            <div style={{ fontSize: 13, color: '#666' }}>{it.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: it.color }}>
              {it.value}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
