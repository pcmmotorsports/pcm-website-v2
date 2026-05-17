'use client';
import { type CSSProperties, useState } from 'react';

export interface Faq {
  id: string;
  title: string;
  keywords: string[];
  answer: string;
  enabled: boolean;
}

const input: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid #ccc',
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 14,
  marginTop: 4,
};
const btn: CSSProperties = {
  border: '1px solid #ccc',
  borderRadius: 6,
  padding: '5px 12px',
  fontSize: 13,
  background: '#fff',
  cursor: 'pointer',
};

function splitKeywords(raw: string): string[] {
  return raw.split(/[、,，\s]+/).filter(Boolean);
}

export function FaqRow({
  faq,
  onChanged,
}: {
  faq: Faq;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState(faq.title);
  const [keywords, setKeywords] = useState(faq.keywords.join('、'));
  const [answer, setAnswer] = useState(faq.answer);
  const [enabled, setEnabled] = useState(faq.enabled);
  const [saving, setSaving] = useState(false);

  const save = async (): Promise<void> => {
    setSaving(true);
    await fetch(`/api/admin/faq/${faq.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        keywords: splitKeywords(keywords),
        answer,
        enabled,
      }),
    });
    setSaving(false);
    onChanged();
  };

  const remove = async (): Promise<void> => {
    if (!window.confirm(`確定刪除「${faq.title}」？`)) return;
    await fetch(`/api/admin/faq/${faq.id}`, { method: 'DELETE' });
    onChanged();
  };

  return (
    <div
      style={{
        border: '1px solid #e0e0e0',
        borderRadius: 8,
        padding: 12,
        marginBottom: 10,
        opacity: enabled ? 1 : 0.55,
      }}
    >
      <input
        style={input}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="標題"
      />
      <input
        style={input}
        value={keywords}
        onChange={(e) => setKeywords(e.target.value)}
        placeholder="觸發關鍵字（用、分隔）"
      />
      <textarea
        style={{ ...input, minHeight: 72, resize: 'vertical' }}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder="自動回覆內容"
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginTop: 8,
        }}
      >
        <label style={{ fontSize: 13, color: '#666' }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />{' '}
          啟用
        </label>
        <div style={{ flex: 1 }} />
        <button style={btn} onClick={remove}>
          刪除
        </button>
        <button
          style={{
            ...btn,
            color: '#fff',
            background: '#2563eb',
            borderColor: '#2563eb',
          }}
          onClick={save}
          disabled={saving}
        >
          {saving ? '儲存中…' : '儲存'}
        </button>
      </div>
    </div>
  );
}
