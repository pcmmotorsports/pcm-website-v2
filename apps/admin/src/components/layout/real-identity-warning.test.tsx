// @vitest-environment jsdom
//
// ⟦b4-MGRENV1⟧ 2026-09-06 · 那道【會叫的訊號】的世界表 + 兩道「它真的接上了嗎」守門。
//
// 🔬 **本檔的形狀是 codex R1(FAIL 4 條 must-fix)換來的**, 四條各留了證人:
//   ① 環境判準從 `IS_PROD` 換成 `resolveEnvTag()` ⇒ 證人 = 「Preview」與「本機 next start」兩格
//   ② 文案不得含利用步驟          ⇒ 證人 = 「不得出現冒名配方」那格
//   ③ 「缺」要餵**真的 undefined**  ⇒ 見下方 `renderIn` 的註解
//   ④ 只 render 元件證不了它被掛上 ⇒ 證人 = 「掛載」與「可見性」兩格
//
// 🛑 **本檔不 mock `requireRealIdentity`, 也不 mock `resolveEnvTag`** —— 那兩個正是被測對象。
// 🔵 **不需要 `vi.resetModules()`**(前一版有):`resolveEnvTag()` 與 `requireRealIdentity()`
//    都是**呼叫當下**才讀 `process.env` 的函式, 不是模組載入時算好的常數。
//    ⚠️ 前一版用的 `IS_PROD` 才是常數 —— 那也正是 must-fix ① 的一半。
// 🔴 用 `vi.stubEnv` 不用 `process.env.X = …`(後者 typecheck 紅、vitest 綠 —— 綠的那個不是尺)。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RealIdentityWarning } from './real-identity-warning';

/**
 * 🔴 `flag: undefined` 餵的是【真的沒有這個變數】, 不是空字串。
 *   前一版把「缺」寫成 `stubEnv(name, '')` —— codex R1 must-fix ③ 指出那是**假測試**:
 *   存在一種壞法(把 `undefined` 當成已開、而 `''` 仍當成關)會讓所有格全綠,
 *   而正式環境**漏設**那顆 env 時完全不出聲。⇒ 這裡用 `stubEnv(name, undefined)` 真的刪掉它。
 */
function renderIn(env: { vercel?: string; node?: string; flag?: string }) {
  vi.stubEnv('VERCEL_ENV', env.vercel as string | undefined);
  vi.stubEnv('NODE_ENV', (env.node ?? 'production') as string);
  vi.stubEnv('ADMIN_REQUIRE_REAL_IDENTITY', env.flag as string | undefined);
  render(<RealIdentityWarning />);
}
const PROD = { vercel: 'production' };
const bar = () => screen.queryByTestId('real-identity-warning');

afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe('RealIdentityWarning(⟦b4-MGRENV1⟧ 的會叫訊號)', () => {
  it('🟢 production + 旗標 =1 ⇒ 不出聲(零 DOM)', () => {
    renderIn({ ...PROD, flag: '1' });
    expect(bar(), '旗標開著還在叫 ⇒ 它會變成背景雜訊, 而真的關掉那天沒有人會抬頭').toBeNull();
    expect(document.body.textContent, '不只是隱藏, 是整段不渲染').not.toContain('管理者身分驗證');
  });

  it('🔴 production + 旗標【真的沒設】⇒ 要出聲', () => {
    renderIn({ ...PROD, flag: undefined });
    expect(bar(), '這正是那一列說的那個世界:閘會放行, 而今天零訊號').not.toBeNull();
  });

  it('🔴 production + 旗標 =0 ⇒ 要出聲', () => {
    renderIn({ ...PROD, flag: '0' });
    expect(bar()).not.toBeNull();
  });

  it('🔴 production + 旗標 =空字串 ⇒ 要出聲(與「真的沒設」是兩個世界, 各一格)', () => {
    renderIn({ ...PROD, flag: '' });
    expect(bar()).not.toBeNull();
  });

  it('🔴 production + 旗標 =true ⇒ 要出聲(認得出來才算開, 不是「不是空的就算開」)', () => {
    // 🔬 釘 `requireRealIdentity()` 的既有形狀(`session.ts`, 逐字 `=== '1'`)。
    //    ⚠️ 少了它, 有人把 `=== '1'` 放寬成 truthy 檢查時, 上面幾格【全部照樣綠】。
    renderIn({ ...PROD, flag: 'true' });
    expect(bar(), '`true` 不算開 —— 而一個「看起來有設」的值最容易讓人以為守著了').not.toBeNull();
  });

  it('🟢 Vercel Preview + 旗標沒設 ⇒ 不出聲(codex R1 must-fix ① 的證人)', () => {
    // 🔬 Preview 本來就不會設這顆旗標。用 `IS_PROD`(= `NODE_ENV === 'production'`)判時
    //    Preview 也是 true ⇒ 每一個預覽網址天天噴假警報, 而**假警報會讓真警報沒有人看**。
    renderIn({ vercel: 'preview', flag: undefined });
    expect(bar()).toBeNull();
  });

  it('🟢 本機 next start(NODE_ENV=production 而沒有 VERCEL_ENV)⇒ 不出聲', () => {
    // 🔬 must-fix ① 的另一半:`resolveEnvTag()` 走白名單, 認不出來回 null ⇒ 不出聲。
    renderIn({ vercel: undefined, node: 'production', flag: undefined });
    expect(bar(), 'NODE_ENV=production 不等於「這是正式站」').toBeNull();
  });

  it('🟢 dev + 旗標沒設 ⇒ 不出聲(`ADMIN_DEV_BYPASS` 那條路不受影響)', () => {
    // 🔵 板列逐字:「本檔【不該】在這裡強制那個旗標 —— 關掉它會讓 dev 的 `ADMIN_DEV_BYPASS`
    //    進不去 ⇒ 那是 B7 的範圍」。本片只在 production 出聲, 這一格就是那句話的證人。
    renderIn({ vercel: undefined, node: 'development', flag: undefined });
    expect(bar(), 'dev 天天都是關著的 ⇒ 在 dev 叫 = 每個工程師每一頁都看到一條假警報').toBeNull();
  });

  it('🔴 掛載守門:root layout 裡真的有這個元件(codex R1 must-fix ④)', () => {
    // 🛑 **上面每一格都只證明「這個元件自己會不會出聲」** ——
    //   把 `<RealIdentityWarning />` 從 `app/layout.tsx` 刪掉, 它們**一格都不會紅**,
    //   而後台從此再也不會出聲。⇒ 這一格守的是【它有沒有被接上去】。
    // ⚠️ 它讀的是**檔案文字**, 不是渲染結果 —— `vitest related` 走 import 圖, 看不到這種尺;
    //   要跑它必須明確餵這支檔(commit body 的分母那節有寫)。
    // 定位法照搬 `app/sidebar-inset-min-width.test.ts:26`(`resolve(__dirname, …)`)——
    // `import.meta.url` 在本專案的 vitest transform 下不是 file: scheme, 會丟 TypeError。
    const src = readFileSync(resolve(__dirname, '../../app/layout.tsx'), 'utf8');
    expect(src, 'layout 裡沒有掛這個元件 ⇒ 上面 8 格全綠而畫面上什麼都不會出現')
      .toContain('<RealIdentityWarning />');
    expect(src, 'import 也要在').toContain("from '@/components/layout/real-identity-warning'");
  });

  it('🔴 可見性守門:出聲那一格不得被藏起來(codex R1 must-fix ④ 的另一半)', () => {
    // 🛑 `queryByTestId` 找得到 ≠ 人看得見。加一個 `hidden` 或 `display:none` 就能讓
    //   上面那些格全綠而畫面上空無一物。
    renderIn({ ...PROD, flag: undefined });
    const el = bar();
    expect(el).not.toBeNull();
    expect(el?.hasAttribute('hidden'), '帶 hidden ⇒ 看不見, 而斷言照樣過').toBe(false);
    expect(el?.className ?? '', '不得有 hidden 類').not.toMatch(/(^|\s)hidden(\s|$)/);
    expect((el as HTMLElement).style.display, '不得 inline 藏起來').not.toBe('none');
    expect(el?.className ?? '', 'print:hidden 是刻意的 —— 只藏列印, 不藏螢幕').toContain('print:hidden');
  });

  it('🔬 文案:講得出【會發生什麼】與【去哪裡改】, 而【不得】含冒名的做法', () => {
    // 🛑 本格只證明「這幾串字在不在」—— 它**證不出**句子通順或 Sean 讀得懂
    //   (codex R1 nit:前一版的標題宣稱「Sean 一眼看懂」, 那是本格答不出的)。
    // 🔴 而後半段是 must-fix ② 的證人:這條字出現在登入閘內側, 而 `proxy.ts` 只證明「已登入」,
    //   **沒有證明看的人是管理者** ⇒ 文案不得把現成的冒名步驟遞給他。
    renderIn({ ...PROD, flag: undefined });
    const t = bar()?.textContent ?? '';
    expect(t, '要說出後果').toContain('放行');
    expect(t, '要說得出去哪裡改').toContain('Vercel');
    expect(t, '要說得出改成什麼').toContain('正好是 1');
    expect(t, '變數名要在中文句子裡當附註, 不是單獨出場').toContain('ADMIN_REQUIRE_REAL_IDENTITY');
    expect(t.indexOf('ADMIN_REQUIRE_REAL_IDENTITY'), '變數名不可以是開頭第一個字').toBeGreaterThan(10);
    // 🔴🔴 **這裡刻意用【白名單】, 不用黑名單**(codex R2 must-fix:黑名單只擋五個精確字串,
    //   而「到右上角改選某位管理者再重送」「actor」「staff id」「COOKIE」「零寬字元」全都通得過)。
    //   `CLAUDE.md` Git 紀律那格逐字寫過同一件事:**黑名單在跟下一個沒想到的前綴賽跑。**
    //   ⇒ 改成釘【整段文案逐字】:任何一次改字都會讓這一格紅, 改的人必須回來看一眼這裡的理由。
    //   ⚠️ 代價要明講:它會因為**無害的錯字修正**而紅 —— 那是刻意的, 這段字有安全語意。
    const APPROVED =
      '後台的「管理者身分驗證」目前是關的。' +
      '在這個狀態下,某些登入方式無法確認執行管理者動作的人真的是本人,' +
      '而檢查會照常放行、不會有任何錯誤訊息 —— 請暫時不要在後台調整員工權限或重送信件。' +
      '請到 Vercel 專案的環境變數把它開回來(那一格叫 ADMIN_REQUIRE_REAL_IDENTITY,' +
      '值要正好是 1),存檔後要重新部署才會生效。';
    expect(t.replace(/\s+/g, ''), '文案改了 ⇒ 回去讀元件檔「文案刻意不寫怎麼利用」那一段再改這裡')
      .toBe(APPROVED.replace(/\s+/g, ''));
  });
});
