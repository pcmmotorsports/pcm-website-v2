import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CHECKOUT_CSS = readFileSync(new URL('./checkout.css', import.meta.url), 'utf8');

// 🔴 註解會污染 anchor 切片:檔頭註解若提到 `.co-steps {` 或 `@media (max-width: 900px)`,
//   下面的 indexOf/match 會切到註解而誤判(本片實際踩過)。先剝掉所有 /* */ 區塊再比對。
const CSS = CHECKOUT_CSS.replace(/\/\*[\s\S]*?\*\//g, '');

// 🔴 U1(M-3 兩步結帳):.co-steps 的 grid 欄數是硬編碼、不會自動跟隨步數。
//   codex 唯讀審查抓到 `repeat(3, 1fr)` 配兩顆鈕 = 留下空的幽靈第三欄(步驟只佔 2/3 寬)。
//   桌機與 mobile 兩處規則必須同時是 2 欄;本測試把兩處都鎖住,增減步驟時會當場轉紅。
describe('checkout 步驟列欄數 guard(U1 兩步)', () => {
  it('桌機 .co-steps 為 2 欄(不得留幽靈第三欄)', () => {
    const base = CSS.slice(0, CSS.indexOf('@media'));
    const rule = base.match(/\.co-steps\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toMatch(/grid-template-columns:\s*repeat\(2,\s*1fr\)/);
    expect(rule).not.toMatch(/repeat\(3,/);
  });

  it('mobile breakpoint .co-steps 同步為 2 欄', () => {
    const mobileStart = CSS.indexOf('@media (max-width: 900px)');
    const nextBreakpoint = CSS.indexOf('@media (max-width: 720px)', mobileStart);
    const mobileCss = CSS.slice(mobileStart, nextBreakpoint);
    const rule = mobileCss.match(/\.co-steps\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toMatch(/grid-template-columns:\s*1fr\s+1fr\s*;/);
    expect(rule).not.toMatch(/1fr\s+1fr\s+1fr/);
  });
});

// 🔴 U2b:收件摘要地址的單行截短**只能靠 CSS**。若有人改成 JS slice,
//   CheckoutStep2ReviewSections.test.tsx 會抓到「完整字面不見了」,本測試則抓到「三條規則被拿掉」。
//   兩邊各守一半,缺一都補不上(規則還在但沒套用 / 套用了但字面被 JS 砍掉)。
describe('checkout 收件摘要地址截短 guard(U2b)', () => {
  it('.co-shipping-summary-address 三條 CSS 截短宣告齊備', () => {
    const rule = CSS.match(/\.co-shipping-summary-address\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toMatch(/overflow:\s*hidden\s*;/);
    expect(rule).toMatch(/text-overflow:\s*ellipsis\s*;/);
    expect(rule).toMatch(/white-space:\s*nowrap\s*;/);
  });
});

describe('checkout mobile CSS guard', () => {
  it('通知 Email input 在 mobile breakpoint 至少 16px，避免 iOS Safari 聚焦自動放大', () => {
    const mobileStart = CSS.indexOf('@media (max-width: 900px)');
    const nextBreakpoint = CSS.indexOf('@media (max-width: 720px)', mobileStart);
    const mobileCss = CSS.slice(mobileStart, nextBreakpoint);

    expect(mobileStart).toBeGreaterThanOrEqual(0);
    expect(nextBreakpoint).toBeGreaterThan(mobileStart);
    expect(mobileCss).toMatch(/\.co-notification-email input\s*\{[^}]*font-size:\s*16px\s*;/);
  });
});
