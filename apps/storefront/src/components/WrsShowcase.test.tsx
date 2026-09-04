// @vitest-environment jsdom
//
// WrsShowcase smoke test — 上架第 20 家 N°01 + N°02(2026-09-04)。
// 驗 eyebrow logo / h2 / lead / 3 卡 + N°02 影片 facade(點擊前不載 iframe、點擊後才載)
// + 故事兩段 + 信任狀四格(逐格釘官網字面)。骨架與斷言形狀對照 `DbkShowcase.test.tsx`。

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { WrsShowcase } from './WrsShowcase';

afterEach(cleanup);

describe('WrsShowcase', () => {
  it('N°01:eyebrow logo + h2 + lead + 3 卡', () => {
    render(<WrsShowcase />);
    expect(document.querySelector('#pd-h-wrs01')).not.toBeNull();
    expect(screen.getByAltText('WRS')).toBeDefined();
    expect(screen.getByRole('heading', { level: 2, name: '為什麼選 WRS' })).toBeDefined();
    expect(screen.getByText(/2008 年成立於義大利 Cattolica/)).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '自手工部門長成獨立產線' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '四項設備，都在自家廠裡' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: '算得出來，還要吹得過' })).toBeDefined();
    expect(document.querySelectorAll('.pd-feature-card').length).toBe(3);
  });

  it('N°02:故事兩段 + 信任狀四格(pd-bs 共用骨架)', () => {
    render(<WrsShowcase />);
    expect(screen.getByRole('heading', { level: 2, name: '兩件外包做不到的事' })).toBeDefined();
    expect(screen.getByText('自有產線切型')).toBeDefined();
    expect(screen.getByText('風洞裡的實測')).toBeDefined();
    expect(document.querySelectorAll('.pd-bona-brow').length).toBe(2);
    expect(document.querySelectorAll('.pd-bs-stat').length).toBe(4);
  });

  // 🔴 **facade 的重點是【點擊前不載 iframe】** —— 只斷言「點完有 iframe」會在
  //    「一開始就直接放 iframe」那個世界裡照樣綠 ⇒ 兩個世界要分別問一次。(照抄 dbk 那支的形狀。)
  it('🔴 影片 facade:點擊前【沒有】iframe、點擊後才有,且 src 帶正確的 YouTube ID', () => {
    render(<WrsShowcase />);
    expect(document.querySelector('iframe'), '點擊前就有 iframe ⇒ facade 沒作用, 白載一支 YouTube').toBeNull();
    const facade = screen.getByRole('button', { name: '播放 WRS 官方形象影片' });
    // 🔴 縮圖必須是**我們自己的檔**, 不是 img.youtube.com ——
    //    外連他家伺服器正是 dbk 3,727 張圖今天踩的坑(板 ⟦supply-DBKIMGHOTLINK⟧)。
    //    🧬 突變:把 src 改成 `https://img.youtube.com/vi/…/hqdefault.jpg` ⇒ 這一行必須紅。
    expect(document.querySelector('.pd-bona-video-thumb')?.getAttribute('src')).toBe(
      '/brands/wrs/video-thumb.jpg',
    );
    fireEvent.click(facade);
    const frame = document.querySelector('iframe');
    expect(frame, '點擊後仍沒有 iframe ⇒ facade 點不開').not.toBeNull();
    // 🟡 ID 釘死:換掉這支影片的人會被迫在這裡留下痕跡。
    //    ⚠️ 而它與 dbk 那支不同 —— **這支 ID 只有【一個來源】**(官方頻道), `brand-content.ts`
    //      的 wrs 那筆沒有 video 欄位可以交叉驗證。檔頭有標。
    expect(frame?.getAttribute('src')).toContain('h2lY1Cs3HRI');
  });

  it('🔴 信任狀四格逐格釘死字面(官網當場查證值;改動 = 對外可見的事實變更)', () => {
    render(<WrsShowcase />);
    // 四格佐證全部來自 wrs.it / manufacturing.wrs.it(2026-09-04 查證)
    //   "Fondata nel 2008, WRS è una azienda specializzata nella produzione di cupolini per moto"
    expect(screen.getByText('2008')).toBeDefined();
    expect(screen.getByText('Fondata nel 2008')).toBeDefined();
    //   "Dal 2018 ... diventando sponsor tecnico e fornitori Ufficiali dei più prestigiosi Team"
    expect(screen.getByText('2018')).toBeDefined();
    expect(screen.getByText('fornitori Ufficiali dei più prestigiosi Team')).toBeDefined();
    //   "Dal 2021 grazie alle nuove omologazioni ricevute"
    expect(screen.getByText('2021')).toBeDefined();
    expect(screen.getByText('nuove omologazioni ricevute')).toBeDefined();
    //   "…garantendo prodotti di altissima qualità e precisione Made in Italy."
    // ⛔ ~~原本這一格釘的是「4」+「taglio laser · scanner 3d · frese Cnc · simulazione」~~
    //   ⇒ code-reviewer M3:原文 `Utilizziamo … quali …` = 我們【使用】…【諸如】… ⇒ 開放式舉例,
    //     把 `quali` 讀成閉合集合才數得出 4 ⇒ 那一格換成一句閉合的。
    expect(screen.getByText('Made in Italy')).toBeDefined();
    expect(screen.getByText('precisione Made in Italy')).toBeDefined();
    // 🔴 而「廠隊」那個詞也是 M3 抓到的:原文是 `i Team più prestigiosi`(最頂尖的【車隊】),
    //   而版面自己點名的 Prima Pramac 是衛星隊不是廠隊 ⇒ 那是把射程講【歪】。
    //   🧬 突變:把它改回「起 廠隊官方供應商」⇒ 這一行必須紅。
    expect(screen.getByText('起 頂尖車隊官方供應商')).toBeDefined();
  });

  // 🔴 **年份白名單(照搬 dbk R1 F4 的形狀, 而白名單的內容不同)。**
  //   dbk 那支只准 2014, 因為它有四個互不相容的年份;WRS **沒有那個問題** ——
  //   2008 三個來源獨立一致(官網 / brand-content.ts / design-reference),
  //   而 2018 與 2021 是官網逐字的另外兩件事 ⇒ **三個年份是遞進的時間線, 不是矛盾。**
  //   ⇒ 本格擋的是「有人把第四個年份搬進四格湊數字」, 而黑名單擋不住沒列到的那一個。
  // ⚠️ **這一格的射程, 由 code-reviewer(N4)量出來寫在這裡 —— 不要把它讀得比實際強**:
  //   ① `toEqual` 對**格子順序**敏感 ⇒ 有人把四格重排就紅(那是誤報, 不是抓到東西)
  //   ② 去重之後它**答不出「哪個年份住在哪一格」** —— 實測把第一格的佐證
  //      `Fondata nel 2008` 改成 `Fondata nel 2018`, 去重後仍是 `['2008','2018','2021']` ⇒ **綠**。
  //      🎯 真正接住那一種的是上面那格逐格釘字面的斷言, 不是本格。
  //   🟢 而審查者**構造不出**讓本格恆真的突變 ⇒ 它不是恆真, 只是射程比它的標題窄。
  it('🛑 四格裡的年份【白名單】:只准 2008 / 2018 / 2021 這三個', () => {
    render(<WrsShowcase />);
    // 🔴🔴 **這把尺第一版是壞的, 而它壞的方式值得留著**:原本直接對 `.pd-bs-stats` 的整段
    //   `textContent` 下 `\b(?:19|20)\d{2}\b` ⇒ 只撈到 `['2008']`。
    //   🔬 成因:四格的文字在 textContent 裡是【連著的】—— 第一格結尾 "Fondata nel 2008" 直接接上
    //     第二格開頭 "2018" ⇒ 字串裡是 `20082018` ⇒ **`\b` 兩邊都是數字 ⇒ 靜靜不匹配**。
    //   🎯 **⇒ 它不會報錯, 它回一個看起來很合理的少一半的答案。**(同一個病在本 repo 記過:
    //     memory 流程分冊「grep 量具族 · `\b` 靜默不匹配」。)
    //   ✅ 改成**逐格取、用分隔符接起來**, 讓每一格的邊界是真的邊界。
    const cells = [...document.querySelectorAll('.pd-bs-stat')].map((el) => el.textContent ?? '');
    expect(cells.length, '一格都沒抓到 ⇒ 這把尺沒接上, 不是四格沒有年份').toBe(4);
    // ⚠️ 去重是必要的:第一格的數字是 `2008`, 而它的佐證原文 "Fondata nel 2008" **也含 2008**
    //   ⇒ 同一個年份出現兩次。本格問的是「**哪些**年份出現」, 不是「出現幾次」。
    const years = [...new Set(cells.join(' | ').match(/\b(?:19|20)\d{2}\b/g) ?? [])];
    // 🟢 這一格同時是正對照:三個年份真的在四格裡 ⇒ 尺抓得到年份、不是恆空
    //    (若它回 [] 就表示尺根本沒接上, 而那會讓 not-contain 式的斷言恆真)
    expect(years, '四格出現了白名單以外的年份 ⇒ 有人搬了一個沒有來源的數字進來').toEqual([
      '2008',
      '2018',
      '2021',
    ]);
  });

  // 🔴 **這一格擋的是【合作車隊數】那個矛盾** —— 版面刻意不寫筆數, 只列車隊名。
  //   🔬 成因:`brand-content.ts` 的 stats 逐字寫「10 支合作車隊」, 而官網 `/racing/` 當天可數 30+ 支
  //     ⇒ 兩處印不同數字給同一個客人看;且該數字每次多簽一隊就過期一次而【零訊號】。
  //   🧬 突變:把「10 支合作車隊」那一格搬回四格 ⇒ 這一格必須紅。
  it('🛑 版面【不得】出現合作車隊的筆數(來源自相矛盾, 只列名不列數)', () => {
    const { container } = render(<WrsShowcase />);
    const text = container.textContent ?? '';
    // ⛔ ~~`not.toContain('支合作車隊')`~~ ⇒ **code-reviewer M5:那是【單一字面黑名單】, 而它漏掉
    //   最可能被貼過來的兩個寫法** —— `brand-content.ts` 的 wrs 段逐字有「合作車隊共**十支**」
    //   (about.tail)與「…等**十支**」(highlights.cards[3]), **兩句都不含 `支合作車隊`**
    //   ⇒ 貼上去這一格照樣綠。它只擋得住 `stats.items[0]` 那一種形狀。
    // 🎯 **黑名單永遠在跟下一個沒想到的寫法賽跑**(同 dbk 年份那格 R1 F4 的同一條)
    //   ⇒ 改成問「版面上有沒有【數字 + 支】這個形狀」, 不需要知道它叫什麼。
    const counted = text.match(/[0-9０-９一二三四五六七八九十百]+\s*支/g) ?? [];
    expect(
      counted,
      `版面出現了車隊筆數 ${JSON.stringify(counted)} ⇒ 有人把那個自相矛盾的數字搬上來了` +
        '(brand-content.ts 寫 10 支, 而官網 /racing/ 當天可數 30+ 支)',
    ).toEqual([]);
    // 🟢 正對照:車隊【名】要在, 否則上一行會在「整段車隊都被刪掉」那個世界裡照樣綠。
    //    ⚠️ 這四支是【官網與 brand-content.ts 都有】的那幾支(單一來源撐著的不上版面)。
    for (const team of ['Ducati Lenovo', 'KTM Factory Racing', 'Prima Pramac Yamaha', 'ROKiT BMW Motorrad WorldSBK']) {
      expect(text, `車隊名「${team}」不見了 ⇒ 上一行的 not.toContain 變成恆真`).toContain(team);
    }
  });

  // 🔵 素材路徑釘死:三張圖都要在【showcase 自己的命名空間】`/brands/wrs/` 底下。
  //   🎯 擋的是「直接引 /brand-assets/assets/ 原檔」—— `GillesShowcase.tsx:41-42` 逐字說明
  //     那會被 brand-content 重產的副作用波及, 而畫面在那一刻看起來完全正常。
  it('🔵 三張圖都在 /brands/wrs/ 底下(不得跨去引 /brand-assets/assets/)', () => {
    const { container } = render(<WrsShowcase />);
    const srcs = [...container.querySelectorAll('img')].map((el) => el.getAttribute('src') ?? '');
    // ⛔ ~~`expect(srcs.length).toBeGreaterThan(0)` + 逐個比前綴~~ ⇒ **code-reviewer M4:那是恆真的**
    //   —— 刪掉任一張 story 圖, `srcs` 從 4 剩 3, 仍 `> 0`、剩下的仍全部 `^/brands/wrs/` ⇒ **全綠**。
    //   而全套裡**沒有第二格**看得到 story 圖在不在(數 `.pd-bona-brow` 只數容器, 不問裡面有沒有圖)。
    // ✅ 改成釘住**完整集合** —— 少一張、多一張、改名, 三種都紅。
    expect(srcs.sort(), '圖片集合變了 ⇒ 少一張 / 多一張 / 改了名, 三種都要有人看一眼').toEqual([
      '/brands/wrs/logo.png',
      '/brands/wrs/story-laser.jpg',
      '/brands/wrs/story-windtunnel.jpg',
      '/brands/wrs/video-thumb.jpg',
    ]);
    // 🔴 **N6:路徑對 ≠ 檔案在。** 檔名打錯一個字 ⇒ 上面那格照樣綠 + 線上破圖。
    //   做法照 `brand-logo.test.ts` 的既有那格(「表裡每一個路徑在磁碟上真的存在」)。
    for (const src of srcs) {
      const disk = resolve(process.cwd(), `apps/storefront/public${src}`);
      expect(existsSync(disk), `${src} 在磁碟上不存在 ⇒ 線上會破圖, 而版面結構測試不會紅`).toBe(true);
    }
  });
});
