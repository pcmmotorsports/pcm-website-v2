// probe-cwd 的守門 —— 🔴 **它釘的不是「這條 route 會動」, 是【那兩種會安靜給錯答案的形狀】。**
//
// 本檔與 `route.ts` **一起生、一起死**:那支是一次性量具(見它第一行), 刪它時把本檔一起刪。
import { describe, expect, it, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { basename, dirname, join as pjoin } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GET, dynamic, runtime } from './route';

const SRC = readFileSync(join(process.cwd(), 'apps/admin/src/app/api/probe-cwd/route.ts'), 'utf8');

afterEach(() => vi.restoreAllMocks());

describe('probe-cwd · 一次性量具的守門', () => {
  it('🔴 它【必須是 dynamic】—— 靜態的話印出來的是【建置容器】的 cwd, 而那是錯的世界', () => {
    // 🎯 這一格是本檔存在的主要理由:兩個值長得一樣可信, 而其中一個答的是另一個問題。
    // 🔴 **讀【匯出的值】而不是原始碼字面**(code-reviewer must-fix):
    //    `toContain("export const dynamic …")` 連**被註解掉的那一行**都會綠, 而 Next 讀不到它。
    expect(dynamic).toBe('force-dynamic');
  });

  it('🔴 它【必須是 nodejs runtime】—— Edge 底下 `process.cwd` 不存在 ⇒ 500 而零讀數', () => {
    // 🎯 admin 既有三條 route 每一條都釘了, 而我原本漏了(code-reviewer must-fix)。
    expect(runtime).toBe('nodejs');
  });

  it('🔴 目錄名【不得以 `_` 開頭】—— Next 把 `_foo` 當私有資料夾、不路由, 而它不會報錯', () => {
    // 🎯 plan 原本寫的是 `api/_probe/cwd` ⇒ 那條路徑打不開, 而失敗形狀是 404 而非錯誤訊息。
    // 🔴 **從【這支測試自己的真實位置】取, 不要寫死字面**(code-reviewer must-fix):
    //    原版 `const seg = 'probe-cwd'` 是測試自己上一行定義的 ⇒ **route 怎麼改名它都殺不掉**,
    //    而我三發突變也沒有一發打到它 ⇒ 那是一格恆真。
    const seg = basename(dirname(fileURLToPath(import.meta.url)));
    expect(seg, '量具自檢:沒取到目錄名').not.toBe('');
    expect(seg.startsWith('_'), `目錄名 ${seg} 以底線開頭 ⇒ 這條 route 打不開`).toBe(false);
  });

  it('🔴 它印得出 cwd, 而且回 500(保證失敗 ⇒ 保證會印)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = GET();
    expect(res.status).toBe(500);
    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0]?.[0] ?? '');
    expect(line).toContain('[admin/probe-cwd]');
    // 🔵 **不只比 `process.cwd()`**(code-reviewer nit:期望值與被測對象同一個 API
    //    ⇒ 換成 `process.env.PWD` 也會綠, 而它在 Lambda 上不等值)
    //    ⇒ 加一格【形狀】斷言:它必須是一條絕對路徑。
    expect(line).toContain(`cwd=${process.cwd()}`);
    expect(line).toMatch(/ cwd=\/[^ ]+ /);
    expect(line).toContain('dirname|url=');
  });

  it('🔵 負對照:它【只送一個參數】—— 第二個參數一樣會進 Vercel log', () => {
    // 🔴 同 `api/sso/callback/route.ts:272-274` 那條既有紀律(codex must-fix 5):
    //    「只送一個參數 —— 第二個參數一樣會進 Vercel log, 而 PII 那道守門只看回傳字串」。
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    GET();
    expect(spy.mock.calls[0]?.length, '多送了參數 ⇒ 未來有人塞可識別資料進去時, 字串守門看不到').toBe(1);
  });

  it('🔵 量具自檢:上面那幾格讀的原始碼真的讀到了(讀到空字串會讓字面斷言恆綠)', () => {
    expect(SRC.length).toBeGreaterThan(500);
    expect(SRC).toContain('probe-cwd');
  });
});
