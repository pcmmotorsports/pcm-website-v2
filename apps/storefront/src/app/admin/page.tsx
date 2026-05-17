import type { Metadata } from 'next';
import { StatsPanel } from '@/components/admin/StatsPanel';
import { FollowUpPanel } from '@/components/admin/FollowUpPanel';
import { FaqPanel } from '@/components/admin/FaqPanel';

export const metadata: Metadata = { title: 'PCM 追單後台' };

// 內部營運後台 — 由 middleware.ts 做密碼保護
export default function AdminPage() {
  return (
    <main
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '24px 16px 60px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#1a1a1a',
      }}
    >
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>
        PCM 追單後台
      </h1>
      <StatsPanel />
      <FollowUpPanel />
      <FaqPanel />
    </main>
  );
}
