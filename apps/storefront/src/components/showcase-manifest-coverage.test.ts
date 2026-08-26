// showcase-manifest-coverage.test.ts — 「新建 Showcase 元件忘了登記進 design manifest」的守門(2026-08-27)
//
// 背景:2026-08-27 Gilles 上架片,codex 對抗審查抓到 `GillesShowcase.tsx` 沒進
// `docs/design-storefront-manifest.yaml`(鐵則 11 manifest sync)。補的時候順手數了一下,
// 發現**這不是第一次**。
//
// 🔴 追根因時撞到一個【看起來已經沒事】的數字:
//   `grep -c 'Showcase.tsx' docs/design-storefront-manifest.yaml` ⇒ **17**
//   磁碟上 `*Showcase.tsx` ⇒ **17**
//   ⇒ 兩個 17 相等,看起來完全同步。**而它是假的** ——
//     那個 grep 把「補漏紀錄的**註解行**裡提到的檔名」也數進去了。
//     只數真正被登記成一筆 path 的清單項 ⇒ **14**。真正缺的是 **3 支**。
//   📌 **「兩個數字相等」與「兩邊是同一組東西」是兩個宣稱。**本檔的比對因此比對**集合**、不比對筆數。
//
// 🔴 而真正的根因不是「某個人那次忘了」:
//   `git log -S<元件名> -- docs/design-storefront-manifest.yaml` 對這三支各自只有 **1 次**命中,
//   而那一次就是 2026-08-27 補漏那顆 commit(= 本檔誕生的那顆)。
//   ⇒ **它們從來沒有被登記過**,不是被哪次 revert 刪掉的
//     (2026-08-07 那顆 `6a5ffca3` 還原 35 檔的 revert 也動了 manifest,但它沒有刪掉任何 Showcase 行)。
//   ⇒ 三次獨立地漏掉同一件事 ⇒ **這是缺一道閘,不是缺一次注意力。**
//   (`~/.claude/rules/00-work-rules.md` §4 機制優先律:先做機制,機制做不到才寫規則文字。)
//
// 本閘做的事:磁碟上每一支 `*Showcase.tsx` 都要在 manifest 裡被登記成一筆 path。
// 已知未登記的三支放進 KNOWN_UNREGISTERED —— **那是一張要被清空的欠帳表,不是白名單**;
// 它讓既有的債可見可數,同時讓**下一支新的**元件漏登記時立刻紅。

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const COMPONENTS_DIR = fileURLToPath(new URL('./', import.meta.url));
const MANIFEST_PATH = fileURLToPath(
  new URL('../../../../docs/design-storefront-manifest.yaml', import.meta.url),
);

/**
 * 🔴 只認【真正被登記成一筆清單項】的行,不認註解裡提到的檔名。
 * 這正是「兩個 17」那個假同步的來源:註解也含檔名,`grep -c` 分不出來。
 */
function registeredShowcases(manifest: string): Set<string> {
  return new Set(
    [
      ...manifest.matchAll(
        /^\s*-\s+"apps\/storefront\/src\/components\/([A-Za-z0-9]*Showcase\.tsx)"/gm,
      ),
    ].map((m) => m[1]!),
  );
}

function showcasesOnDisk(): Set<string> {
  return new Set(
    readdirSync(COMPONENTS_DIR).filter((f) => f.endsWith('Showcase.tsx') && !f.includes('.test.')),
  );
}

/**
 * 2026-08-27 盤點時就已經欠著的三支。**目標是把這張表清空。**
 * 補的人 = 各自那條線(代寫等於替自己沒做過的元件寫描述)。
 * · KspeedShowcase / ExtremeComponentsShowcase — 2026-07-24 上架第三批(元件現況見 `6a5ffca3`)
 * · DnaShowcase — 2026-08-21 首灌(`0fd337ea`)
 */
const KNOWN_UNREGISTERED: readonly string[] = [
  // ✅ **2026-08-27 已清空** —— 三支(Dna / Kspeed / ExtremeComponents)當天全部補進 manifest。
  //    補法一致 = **逐字搬運各自元件的檔頭**,不是替它們發明描述
  //    ⇒ 搬運可以被逐字核對,發明不行;每一筆都標了「未經該元件的線確認」。
  // 🔴 **清空之後這道閘的意義變了**:它從「盯著三筆已知欠帳」變成「盯著【下一支】新元件」。
  //    ⇒ 下一個人新建 <Brand>Showcase.tsx 而忘了登記 ⇒ 上面那條直接紅。**不要往這裡加東西來消紅** ——
  //    加進來只會讓那支元件的缺口變成永久豁免,而豁免不會提醒任何人它該被清空。
  //    真的需要暫時豁免時:加進來 + 寫清楚為什麼 + 寫清楚誰在什麼條件下移除它。
] as const;

describe('registeredShowcases(自檢:抽取邏輯要先被驗證,不能只信它跑出來的答案)', () => {
  it('只抓清單項,不抓註解裡提到的同一個檔名', () => {
    const fixture = [
      '      - "apps/storefront/src/components/FooShowcase.tsx"  # 註解',
      '      # 這一行只是提到 BarShowcase.tsx,不是登記',
      '      - "apps/storefront/src/components/BazShowcase.tsx"',
    ].join('\n');
    expect(registeredShowcases(fixture)).toEqual(new Set(['FooShowcase.tsx', 'BazShowcase.tsx']));
  });

  it('負對照:沒有任何清單項時回空集合(不是「有東西就算過」)', () => {
    expect(registeredShowcases('      # BarShowcase.tsx 只出現在註解裡')).toEqual(new Set());
  });
});

describe('design manifest vs 磁碟上的 Showcase 元件', () => {
  it('🔴 每一支磁碟上的 *Showcase.tsx 都要登記進 design-storefront-manifest.yaml', () => {
    const onDisk = showcasesOnDisk();
    const registered = registeredShowcases(readFileSync(MANIFEST_PATH, 'utf-8'));

    // 分母非空才有判別力(抽取壞掉時要紅,不是靜靜變成「零缺口」)
    expect(onDisk.size, '磁碟掃不到任何 Showcase 元件 ⇒ 路徑錯了,本條會恆真').toBeGreaterThan(10);
    expect(registered.size, 'manifest 抽不到任何清單項 ⇒ 正規式與檔案格式對不上').toBeGreaterThan(10);

    const missing = [...onDisk].filter((f) => !registered.has(f)).sort();
    const unexpected = missing.filter((f) => !KNOWN_UNREGISTERED.includes(f as never));

    expect(
      unexpected,
      `這些 Showcase 元件在磁碟上,但沒有登記進 docs/design-storefront-manifest.yaml:` +
        `${unexpected.join(', ')}。新增一支 <Brand>Showcase.tsx 時要同一個 commit 補上 manifest 那一行` +
        `(鐵則 11 manifest sync;2026-08-27 codex 對抗審查抓到過一次)。`,
    ).toEqual([]);
  });

  it('🔴 欠帳表要能被清空:KNOWN_UNREGISTERED 裡的每一支都必須【真的還沒登記】', () => {
    const registered = registeredShowcases(readFileSync(MANIFEST_PATH, 'utf-8'));
    const alreadyFixed = KNOWN_UNREGISTERED.filter((f) => registered.has(f));
    expect(
      alreadyFixed,
      `這些已經補進 manifest 了,請從 KNOWN_UNREGISTERED 移除:${alreadyFixed.join(', ')}。` +
        `留著等於讓這張欠帳表變成永久白名單 —— 而白名單不會提醒任何人它該被清空。`,
    ).toEqual([]);
  });

  it('🔴 manifest 不該登記磁碟上不存在的 Showcase(檔案改名/刪除時要紅)', () => {
    const onDisk = showcasesOnDisk();
    const registered = registeredShowcases(readFileSync(MANIFEST_PATH, 'utf-8'));
    const ghosts = [...registered].filter((f) => !onDisk.has(f)).sort();
    expect(ghosts, `manifest 登記了磁碟上沒有的檔:${ghosts.join(', ')}`).toEqual([]);
  });
});
