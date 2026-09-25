// Supabase「Confirm signup」範本(docs/email-templates/supabase-confirm-signup.html)的形狀檢查
// (2026-09-26 資安修正片 2 · Codex R1 必修)。
// 🔴 Supabase 用 Go 範本引擎解析整份內文, 連 HTML 註解裡的雙大括號也會當成指令;
//    多一個它不認得的指令, 整份範本就壞掉, 客人收不到能用的確認信, 而網站這邊什麼都不會叫。
// ⇒ 範本裡只准出現 SiteURL、TokenHash 這兩個變數, 而且連結要指到 /auth/confirm 的 type=email。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const TEMPLATE = resolve(__dirname, '../../../../../../docs/email-templates/supabase-confirm-signup.html');
const html = readFileSync(TEMPLATE, 'utf8');

describe('Supabase 註冊確認信範本', () => {
  it('🔴 只出現 {{ .SiteURL }} 與 {{ .TokenHash }} 兩種指令(註解裡也不行有別的)', () => {
    const directives = html.match(/\{\{[\s\S]*?\}\}/g) ?? [];
    expect(directives.length).toBeGreaterThan(0);
    for (const d of directives) {
      expect(['{{ .SiteURL }}', '{{ .TokenHash }}']).toContain(d);
    }
    // 沒有落單的左大括號(例如只寫了一半)
    expect((html.match(/\{\{/g) ?? []).length).toBe(directives.length);
  });

  it('按鈕連結指到 /auth/confirm 的 token_hash、type=email(換裝置也能用, 不走 /auth/callback)', () => {
    expect(html).toContain('href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=email"');
    expect(html).not.toContain('/auth/callback');
    expect(html).not.toContain('{{ .ConfirmationURL }}');
  });
});
