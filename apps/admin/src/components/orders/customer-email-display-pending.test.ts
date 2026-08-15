// customer-email-display-pending.test.ts — 🔴 **一個會在【正確的那一刻】自己紅的守門**
//
// ══ 這格在守什麼 ═══════════════════════════════════════════════════════════
//
// Sean 2026-08-16 拍板乙:**LINE 合成信箱不得顯示原字串**。
// C 窗的線上有一支 `customerEmailDisplay()` 實作它,**而那支還沒 merge 進本樹**
// (2026-08-16 實查:`grep -rn customerEmailDisplay` 全樹 **0 命中**)。
//
// 🔴 **問題不是「現在沒接」,是【收割那一刻沒有人會記得接】** ——
//    我剛把四張摘要卡抽成 `order-detail-summary-cards.tsx`,而 C 窗那側的守門
//    (`refund-wiring.test.tsx`,**本樹沒有那支檔**)釘的是**舊結構那一行**
//    ⇒ 收割時「取重構那邊」看起來是對的,而那一取,拍板就掉了。
//
// ══ 🔴 所以本格【現在是綠的,而它會在 helper 一 merge 進來就紅】 ═════════════
//
// 邏輯:全樹掃「有沒有人 export `customerEmailDisplay`」。
//   · 0 個 ⇒ helper 還沒到 ⇒ 本格綠(但下面那條 `it` 會把待辦印出來)
//   · ≥1 個 ⇒ helper 到了 ⇒ **所有顯示客戶 email 的地方都必須用它**,否則紅
//
// ⚠️ **這不是「寫個註解提醒自己」** —— 註解不會在時機到的時候叫。
//    本格把「記得接上去」變成「時機一到就有東西紅」。
// ⚠️ **它守不住什麼**:①只掃 `apps/admin/src` 的 `.tsx`
//    ②靠 `customerEmailDisplay` 這個名字 —— C 窗若改名,本格會安靜地繼續綠。
//    ③它不驗 helper 的行為對不對,只驗「有沒有被用」。

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ADMIN_SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPO = resolve(ADMIN_SRC, '../../..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === '.git') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** 顯示客戶 email 的地方(本樹實查:2 處)。**新增顯示點要加進來。** */
const DISPLAY_POINTS = [
  join(ADMIN_SRC, 'components/orders/order-detail-summary-cards.tsx'),
  join(ADMIN_SRC, 'components/customers/customer-detail.tsx'),
];

describe('🔴 Sean 08-16 拍板乙:LINE 合成信箱不得顯示原字串', () => {
  const files = walk(join(REPO, 'apps'), walk(join(REPO, 'packages')));
  const exporters = files.filter((f) =>
    /export\s+(?:async\s+)?(?:function|const)\s+customerEmailDisplay\b/.test(readFileSync(f, 'utf8')),
  );

  it('前置檢查:掃描是活的(掃到的檔案數 > 100)', () => {
    // 🔴 沒有這一格,walk() 壞掉回空陣列時下面每一條都恆綠。
    expect(files.length).toBeGreaterThan(100);
  });

  it('顯示點清單裡的檔案都存在(清單過期 ⇒ 下面那條會對著不存在的檔恆綠)', () => {
    for (const p of DISPLAY_POINTS) expect(() => readFileSync(p, 'utf8')).not.toThrow();
  });

  it('🔴🔴 helper 一旦進到本樹,每個顯示點都必須用它', () => {
    if (exporters.length === 0) {
      // helper 還沒 merge。**本格刻意在這裡通過** —— 它等的就是那一刻。
      // ⚠️ 而「通過」不代表沒事:收割 C 窗那條線時,這一格會變紅,那是它的用途。
      expect(exporters).toHaveLength(0);
      return;
    }
    for (const p of DISPLAY_POINTS) {
      expect(
        readFileSync(p, 'utf8'),
        `${p} 顯示客戶 email 卻沒用 customerEmailDisplay ⇒ Sean 08-16 拍板乙在這一頁失效`,
      ).toContain('customerEmailDisplay');
    }
  });
});
