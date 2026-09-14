// page-title-site-name.test.ts — 分頁標題的站名一律用中文(Sean 2026-09-05 `Q-分頁標題站名 = 甲`)
//
// 🔴 **為什麼要有這一支**:2026-09-05 `-front` 量到顧客站的瀏覽器分頁標題**兩套站名在跑** ——
//    多數寫「— PCM重機零件販售」, 而少數寫英文「PCM MOTOR PARTS」(其中兩處連分隔符都用 `|` 不是 `—`)。
//    Sean 逐字答 **`20 甲`** = **全部統一成中文**。
//    🛑 而拍板落在【五個分散的字面】上, **沒有任何東西會在有人寫回英文時叫**。
//
// ⚠️ **射程 —— 這一支【不】管什麼**:
//    · **只管 `metadata.title` 這一族**(瀏覽器分頁標題)。
//    · 🔵 **logo 的 `alt='PCM MOTOR PARTS'` 與首頁標語【不在射程內】** —— 那是品牌名的正當用法,
//      本檔動它們一個字都不對。(量到:`.tsx` 裡非 title 的英文站名 9 處, 一處未動。)
//    · 🔴 **本檔是【掃描型】守門:它 `readFileSync` 讀檔字串、不 `import` 任何被測頁**
//      ⇒ **`vitest related` 的分母裡結構上沒有它**(板 `⟦b9-NOCARRIER1⟧` 那一族)。
//      **改那五支頁面的人不會自動跑到這一格** —— 它靠全套測試 / CI 抓。
//      ✅ 而這個代價是刻意換來的:逐頁測只釘得住**今天這五處**, 掃描型連**明天新開的頁**一起釘。
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';

/** 站名的英文寫法 —— 拍板之後它不該再出現在任何分頁標題裡。 */
const EN = 'PCM MOTOR PARTS';
/** 拍板要的那一個。 */
const ZH = 'PCM重機零件販售';

// 🔵 **[2026-09-14 · Sean 拍 Q14 甲「全站統一 PCM重機零件販售」之後,本檔守的東西升級了]**
//   **原本守什麼**:掃 `title: '…'` 單引號字面, 斷言沒有一個含英文站名。
//     ⇒ 它只擋得住「寫回英文」, 擋不住「又寫出第四種中文寫法」(例如 `— PCM`)。
//   **現在誰接手**:站名收斂成 `lib/site-config.ts` 的 `SITE_NAME` / `SITE_TITLE_SUFFIX`
//     ⇒ 判準從「不含英文」升成 **「分頁標題裡【一個站名字面都不准有】, 一律吃常數」**。
//     英文那一格沒有被放掉 —— 它是新判準的子集(寫英文 = 寫了字面 = 紅)。
//   ⇒ 🔴 掃描要同時吃 `title: '…'` 與 `title: \`…\`` 兩種寫法, 因為這一片把多數頁改成了樣板字串;
//     只掃單引號的話, 分母會掉到 0 而「沒有英文」恆真 —— 那正是正對照那一格在擋的事。

/** 掃 app/ 底下所有 `title:` 後面的字面(單引號與反引號兩種)。 */
function titleLiterals(): string[] {
  // 🔴 用 `git grep` 而不是自己走目錄:它天然吃 .gitignore, 不會掃到 .next 產物
  //    (掃到產物 ⇒ 同一個字面被數兩次, 而那個多出來的數看起來完全合理)。
  let out = '';
  try {
    out = execFileSync('git', ['grep', '-h', '-o', '-E', "title: *('[^']*'|`[^`]*`)", '--', 'apps/storefront/src/app'],
      { encoding: 'utf8' });
  } catch {
    return [];   // git grep 零命中時 rc=1 ⇒ 這裡回空, 由下面那格正對照抓
  }
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

describe('分頁標題的站名一律中文(Sean 2026-09-05 Q-分頁標題站名 = 甲)', () => {
  const titles = titleLiterals();

  it('🔵 正對照:掃得到分頁標題字面(否則下面兩格的綠沒有意義)', () => {
    expect(titles.length, 'git grep 一個 title 字面都沒撈到 ⇒ 這把尺沒接上, 下面的綠是假的').toBeGreaterThan(10);
    // 🔴 正對照改成「**吃常數**的那些」—— 拍 Q14 甲之後, 含 `ZH` 字面的 title 應該是 0 個,
    //   拿它當正對照會恆紅。真正該證的是「尺撈得到東西, 而那些東西確實走常數」。
    expect(
      titles.filter((t) => t.includes('SITE_TITLE_SUFFIX') || t.includes('SITE_NAME')).length,
      `撈到 ${titles.length} 個 title 而吃站名常數的是 0 ⇒ 尺或寫法變了`,
    ).toBeGreaterThan(10);
  });

  it(`🔴 沒有任何分頁標題含英文站名「${EN}」`, () => {
    const bad = titles.filter((t) => t.includes(EN));
    expect(
      bad,
      `這些分頁標題還寫著英文站名:${JSON.stringify(bad)}\n` +
        `Sean 2026-09-05 逐字答「20 甲」= 全部統一成中文「${ZH}」。\n` +
        `⚠️ 注意射程:logo 的 alt='${EN}' 與首頁標語【不算】—— 那是品牌名的正當用法, 不要一起改。`,
    ).toEqual([]);
  });

  // 🔴🔴 2026-09-14 Sean 拍 Q14 甲之後的新判準:**一個站名字面都不准有。**
  //   為什麼比「不含英文」強:2026-09-14 量到站名有【三種】寫法, 而只有一種是英文
  //   ⇒ 舊判準對另外兩種(`— PCM` 與 `— PCM重機零件販售` 各寫一份)全綠。
  //   ⛔ 這一格紅掉時的修法是**吃 `SITE_TITLE_SUFFIX`**, 不是把字面改成「對的那一種」——
  //     改成對的那一種只是把第四種寫法延後到下一頁。
  it('🔴 分頁標題不准硬寫站名字面(一律吃 SITE_NAME / SITE_TITLE_SUFFIX)', () => {
    const bad = titles.filter((t) => t.includes(ZH) || t.includes(EN) || /— *PCM['`]/.test(t));
    expect(
      bad,
      `這些分頁標題自己寫了一份站名字面:${JSON.stringify(bad)}\n` +
        `⇒ 改成吃 \`SITE_TITLE_SUFFIX\`(lib/site-config.ts)。\n` +
        `理由:站名散成 25 份字面, 就是 2026-09-14 量到三種寫法的成因。`,
    ).toEqual([]);
  });
});
