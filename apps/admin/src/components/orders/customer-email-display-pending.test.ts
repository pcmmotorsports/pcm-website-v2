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
// ⚠️ **我【驗過】的是什麼(2026-08-16,五態)**:
//   ① helper 未進 ⇒ 綠  ② helper 在而顯示點檔不存在 ⇒ 紅  ③ 兩處都呼叫 ⇒ 綠
//   ④ **呼叫拿掉、import 留著 ⇒ 紅**(修正前這態會綠)  ⑤ 兩處都只剩 import ⇒ 紅
//
// ⚠️ **我【沒驗過】的(不是「我以為它擋不住」,是我真的沒打)**:
//   · 只掃 `apps/admin/src` —— 別的目錄沒打過。
//   · 靠 `customerEmailDisplay` 這個識別字;**改名之後我沒打過**(名字無關那半由
//     `A-75` 的「Email 不得原樣直傳」那條負責,它已六態驗過)。
//   · 完全不驗 helper 的**行為**對不對,只驗「有沒有被呼叫」。
//
// 🔴 **本段 2026-08-16 改寫過一次**:原本寫「它守不住什麼」,而那是**推測的邊界** ——
//    我只寫了「改名會漏」,漏掉**現實得多**的那個(重構時改掉呼叫、忘了刪 import)。
//    ⇒ **太窄的限度比沒有限度更危險:它讓讀的人以為邊界已經被畫完了。**
//    ⇒ 改成寫【我驗過什麼】,沒驗的部分讀者自己看得出來還在外面。

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
        // 🔴 **數【呼叫】不數【提及】** —— `toContain('customerEmailDisplay')` 會命中
        //    `import { …, customerEmailDisplay } from …` 那一行 ⇒ **呼叫拿掉、import 留著,
        //    這一格照樣綠**(C 窗 2026-08-16 彩排構造出來、A 窗複現)。加左括號才是「真的呼叫了」。
      ).toContain('customerEmailDisplay(');
    }
  });
});
