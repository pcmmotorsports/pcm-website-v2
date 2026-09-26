import { describe, expect, it } from 'vitest';
import { renderAccountDisabledEmail } from './account-disabled-email';

// 停用帳號按忘記密碼時寄的通知(Sean 2026-09-26 Q30 甲)
describe('renderAccountDisabledEmail', () => {
  it('主旨、內文有停用說明與 LINE;沒有重設密碼連結', () => {
    const m = renderAccountDisabledEmail();
    expect(m.subject).toBe('PCM 帳號已停用通知');
    expect(m.text).toContain('此帳號已停用，如有疑問請加 LINE @pcmmoto 聯絡我們。');
    expect(m.html).toContain('@pcmmoto');
    expect(m.html).not.toMatch(/reset|重設密碼連結<\/a>/i);
  });

  it('🔴 HTML 不含 HTML 註解(會原樣寄進客人信箱)', () => {
    expect(renderAccountDisabledEmail().html).not.toContain('<!--');
  });

  it('🔴 每次內容完全相同(防重複鍵要求同一封信內容一樣)', () => {
    expect(renderAccountDisabledEmail()).toEqual(renderAccountDisabledEmail());
  });
});
