'use client';
import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { FaqRow, type Faq } from './FaqRow';

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

export function FaqPanel() {
  const [faqs, setFaqs] = useState<Faq[]>([]);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [keywords, setKeywords] = useState('');
  const [answer, setAnswer] = useState('');

  const load = useCallback(() => {
    fetch('/api/admin/faq')
      .then((r) => r.json())
      .then((d: { faqs?: Faq[] }) => setFaqs(d.faqs ?? []));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (): Promise<void> => {
    const res = await fetch('/api/admin/faq', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        keywords: keywords.split(/[、,，\s]+/).filter(Boolean),
        answer,
      }),
    });
    if (!res.ok) {
      const d = (await res.json()) as { error?: string };
      window.alert(d.error ?? '新增失敗');
      return;
    }
    setTitle('');
    setKeywords('');
    setAnswer('');
    setAdding(false);
    load();
  };

  return (
    <section>
      <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 10 }}>
        常見問題自動回覆
      </h2>
      {faqs.map((f) => (
        <FaqRow key={f.id} faq={f} onChanged={load} />
      ))}

      {adding ? (
        <div
          style={{
            border: '1px dashed #999',
            borderRadius: 8,
            padding: 12,
            marginTop: 6,
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
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button style={btn} onClick={() => setAdding(false)}>
              取消
            </button>
            <button
              style={{
                ...btn,
                color: '#fff',
                background: '#2563eb',
                borderColor: '#2563eb',
              }}
              onClick={create}
            >
              新增
            </button>
          </div>
        </div>
      ) : (
        <button
          style={{
            ...btn,
            width: '100%',
            padding: 10,
            marginTop: 6,
            borderStyle: 'dashed',
            background: '#fafafa',
          }}
          onClick={() => setAdding(true)}
        >
          ＋ 新增常見問題
        </button>
      )}
    </section>
  );
}
