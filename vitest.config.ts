/**
 * vitest root config(M-1-02 落地、第一個 test slice)
 *
 * 對齊 docs/architecture/testing-strategy.md:
 * - §1 同層 *.test.ts(不放 __tests__/ folder)
 * - §2 monorepo 統一、root config + workspace inheritance
 * - §3.1 純 stub function 用 vi.fn().mockResolvedValue
 * - §3.3 InMemory adapter 是真實作、非 mock
 * - §4 describe('X') / it('should ...')慣例
 *
 * 設計選擇(本 config 不啟 globals、test 檔顯式 import describe/it/expect/vi):
 * - 對齊 testing-strategy §3.1 範例字面 `import { vi } from 'vitest';`
 * - 顯式 import 邊界清晰、IDE 跳轉 / typecheck 不依賴 ambient types
 *
 * environment: 'node'(domain 邏輯不需 jsdom)
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/.next/**',
      'design-reference/**',
    ],
    environment: 'node',
  },
});
