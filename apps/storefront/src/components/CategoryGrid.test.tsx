// @vitest-environment jsdom
//
// CategoryGrid(首頁 N°03 分類 icon chip 磚面)—— D5c / 首頁對齊批 H3 重寫,2026-08-06。
//
// 這支守三族:
//   ① 說明文字那兩個數字**真的是算出來的**(抄稿上的 11 / 15 會在分類增減那天開始說謊,
//      而畫面看起來完全正常 —— 這是 Sean 拍板時特別點名的那件事)
//   ② icon 與色碼綁**分類名**、不綁名次(名次每天都在動)
//   ③ 沒有 icon 的分類**照樣有入口**(不隱藏、不當機),而且看得出來是哪一顆
//
// ⚠️ **它擋不住什麼**:①jsdom 不算 cascade ⇒ 色條/框線/欄數在這裡看不到(那半在
//    `styles/home.test.ts` 與真瀏覽器);②**這支看不到真目錄** ⇒「真目錄上真的有分類上榜卻沒 icon」
//    要靠接真資料的 E2E,本檔能證的是兩件:發生時的**行為**對(純文字 chip、入口還在),
//    以及發生時**真的會叫**(執行期告警,見下方那兩條)。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CategoryGrid, HOME_WALL_EXCLUDED } from './CategoryGrid';
import type { MockCategory } from '../data/mock-categories';

afterEach(cleanup);

/** 2026-08-06 實測主樹 3111 真目錄的前 11 名(名稱逐字、順序即當時排名)。 */
const TOP_11 = [
  '外觀與後視鏡', '騎士用品與配件', '碳纖維部品', '車身防護與防摔', '拉桿與把手',
  '精品螺絲與螺帽', '引擎與冷卻', '止滑貼與保護膜', '腳踏後移與傳動', '排氣系統', '燈具與電子',
] as const;

/** 未進榜的 4 類(OD 沒有畫 icon 的那些)。 */
// ⚠️ 最後那顆 2026-08-11(#412)由「服務／其他」改名為「服務與其他」——
//    字面來源 = migration `20260811120000_m4b_storefront_412_service_other_category.sql`。
const BELOW_LINE = ['煞車系統', '懸吊與車架', '四輪 ATV/UTV', '服務與其他'] as const;

const mk = (names: readonly string[], base = 3000): MockCategory[] =>
  names.map((name, i) => ({ id: `id-${i}`, name, count: base - i * 100, children: [] }));

const LIVE_15: MockCategory[] = [...mk(TOP_11), ...mk(BELOW_LINE, 300)];

describe('CategoryGrid · 12 格磚面(D5c/H3)', () => {
  it('🔴 11 顆 chip + 第 12 格「全部分類」,兩顆的目的地都對', () => {
    const { container } = render(<CategoryGrid categories={LIVE_15} />);
    const chips = [...container.querySelectorAll('.b-cat-chip')];
    expect(chips, '不是 11 顆 chip ⇒ 6×2 磚面會缺角或溢位').toHaveLength(11);
    expect(container.querySelectorAll('.b-cat-more')).toHaveLength(1);
    // chip 深連結 = 真分類名(products-url-state.parseCategoryFromUrl 的比對鍵)
    expect(chips[0]!.getAttribute('href')).toBe(`/products?category=${encodeURIComponent(TOP_11[0])}`);
    expect(container.querySelector('.b-cat-more')?.getAttribute('href')).toBe('/products');
  });

  it('🔴 說明文字那兩個數字是**算出來的**,不是稿上的 11 / 15', () => {
    // 15 類 → 前 11 名
    const { container, unmount } = render(<CategoryGrid categories={LIVE_15} />);
    expect(container.querySelector('.b-cats-note')?.textContent)
      .toBe('依件數排序取前 11 名 · 全站共 15 類');
    unmount();
    // 🔴 判別力在這裡:只有 6 類時,寫死的版本仍會說「前 11 名 · 全站共 15 類」= 對客人說謊,
    //    而畫面完全正常、其他測試零紅。
    const { container: c2 } = render(<CategoryGrid categories={mk(TOP_11.slice(0, 6))} />);
    expect(c2.querySelector('.b-cats-note')?.textContent)
      .toBe('依件數排序取前 6 名 · 全站共 6 類');
    expect(c2.querySelectorAll('.b-cat-chip')).toHaveLength(6);
    // 「全部分類」那一格不受影響:分類再少,完整清單的入口都要在
    expect(c2.querySelectorAll('.b-cat-more')).toHaveLength(1);
  });

  it('🔴 依件數遞減取前 11:第 12 名被擠掉、但它不是被刪掉(它在 /products 側欄)', () => {
    const { container } = render(<CategoryGrid categories={LIVE_15} />);
    const labels = [...container.querySelectorAll('.b-cat-label')].map((el) => el.textContent ?? '');
    expect(labels).toHaveLength(11);
    // 件數最大的在第一顆、第 12 名(BELOW_LINE 的第一個)不在牆上
    expect(labels[0]!.startsWith(TOP_11[0])).toBe(true);
    expect(labels.some((t) => t.startsWith(BELOW_LINE[0]))).toBe(false);
  });

  it('🔴 件數是 server 帶的即時值,原樣渲染(不得補零、不得四捨五入)', () => {
    const { container } = render(<CategoryGrid categories={[
      { id: 'a', name: '外觀與後視鏡', count: 2822, children: [] },
      { id: 'b', name: '排氣系統', count: 7, children: [] },
    ]} />);
    const counts = [...container.querySelectorAll('.b-cat-count')].map((el) => el.textContent);
    // 前一版是 `padStart(3, '0')`(8 卡時代的排版習慣)⇒ 7 會變成 "007"
    expect(counts).toEqual(['2822', '7']);
  });

  it('🔴 icon 與色碼綁分類名、不綁名次:同一個分類換名次,`data-cat` 不變', () => {
    const { container, unmount } = render(<CategoryGrid categories={LIVE_15} />);
    const byName = (root: ParentNode) =>
      Object.fromEntries([...root.querySelectorAll('.b-cat-chip')].map((a) => [
        a.querySelector('.b-cat-label')?.textContent?.replace(/\d+$/, '') ?? '',
        a.getAttribute('data-cat'),
      ]));
    const first = byName(container);
    unmount();
    // 把排名整個倒過來
    const reversed = [...LIVE_15].reverse().map((c, i) => ({ ...c, count: 3000 - i * 100 }));
    const { container: c2 } = render(<CategoryGrid categories={reversed} />);
    const second = byName(c2);
    for (const [name, cat] of Object.entries(first)) {
      if (second[name] !== undefined) {
        expect(second[name], `${name} 的色碼跟著名次跑了 ⇒ 同一個分類會在不同天變色`).toBe(cat);
      }
    }
    // 前提斷言:真的有 chip 換過位置,否則上面那圈恆真
    expect(Object.keys(second).length).toBeGreaterThan(0);
    expect(Object.keys(second)[0]).not.toBe(Object.keys(first)[0]);
  });

  it('🔴 OD 畫過的 11 個分類都有 icon 與色碼(表打錯字 = 那一格靜默沒有圖)', () => {
    const { container } = render(<CategoryGrid categories={mk(TOP_11)} />);
    const chips = [...container.querySelectorAll('.b-cat-chip')];
    expect(chips).toHaveLength(11);
    const cats = chips.map((a) => a.getAttribute('data-cat'));
    // 11 顆色碼互不重複、且都在 1..11(色碼撞號 = 兩個分類同色)
    expect(new Set(cats).size, `色碼有重複:${cats.join(',')}`).toBe(11);
    for (const c of cats) expect(Number(c)).toBeGreaterThanOrEqual(1);
    for (const c of cats) expect(Number(c)).toBeLessThanOrEqual(11);
    for (const a of chips) {
      expect(a.querySelector('.b-cat-icon svg'), 'chip 少了 icon').not.toBeNull();
      expect(a.classList.contains('b-cat-chip--noicon')).toBe(false);
    }
  });

  it('🔴 沒有 icon 的分類:照樣有入口、不當機,而且標記得出來(Sean 2026-08-06 拍 A)', () => {
    // OD 沒畫 icon 的那幾類,以及未來新增的分類,都會走這條路。
    // ⚠️ 2026-08-11(#412):這裡**不能**再用 `BELOW_LINE` 全集 —— 它的最後一顆「服務與其他」
    //    已進 `HOME_WALL_EXCLUDED`、根本不會渲染成 chip ⇒ 用全集會讓本格數字對不上,
    //    而且會把「排除生效」誤讀成「沒有 icon 的分類被丟掉」。改用未被排除的那三類。
    const NO_ICON_ON_WALL = BELOW_LINE.filter((n) => !HOME_WALL_EXCLUDED.includes(n));
    // 🔴 前提斷言(R3 I2 立、codex R4 收緊):上一行是**從受測物導出**的 —— 排除清單哪天誤長,
    //    這格會跟著縮、然後靜默地繼續全綠(判別力歸零)。
    //    ⚠️ 只釘**數量**還不夠(R4):「誤排除一顆 + 漏排除服務與其他」數量一樣是 3、照樣假綠。
    //    改釘**精確集合**,同數量替換也會紅。
    expect(NO_ICON_ON_WALL, '排除清單誤傷了沒有 icon 的分類 ⇒ 客人少了入口')
      .toEqual(['煞車系統', '懸吊與車架', '四輪 ATV/UTV']);
    const { container } = render(<CategoryGrid categories={mk(NO_ICON_ON_WALL)} />);
    const chips = [...container.querySelectorAll('.b-cat-chip')];
    expect(chips, '沒有 icon 的分類被整顆丟掉 ⇒ 客人少了那個入口')
      .toHaveLength(NO_ICON_ON_WALL.length);
    for (const a of chips) {
      expect(a.classList.contains('b-cat-chip--noicon'), '沒有標記 ⇒ 真瀏覽器 / E2E 掃不出來').toBe(true);
      expect(a.querySelector('.b-cat-icon'), '不該畫一個空的 icon 方塊(看起來像圖沒載出來)').toBeNull();
      expect(a.getAttribute('data-cat'), '沒有色碼時不該輸出 data-cat').toBeNull();
      // 入口本身照舊
      expect(a.getAttribute('href')).toMatch(/^\/products\?category=/);
    }
  });

  // 🔴 主視窗要求「進榜分類缺 icon = 要被看見」。單元測試看不到真目錄 ⇒ 能驗的是**告警本身**:
  //    餵一個沒有 icon 的分類進來,server log 要真的叫、而且叫得出是哪一家、幾件。
  //    拿掉 `warnMissingIcon()` 的呼叫 = 回到靜默,這條會紅。
  it('🔴 有分類上榜卻查無 icon → 執行期告警真的叫,且報得出分類名與件數', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      render(<CategoryGrid categories={[
        { id: 'x', name: '煞車系統', count: 285, children: [] },
        { id: 'y', name: '碳纖維部品', count: 1991, children: [] },
      ]} />);
      expect(warn, '缺 icon 卻沒有任何告警 ⇒ 回到靜默').toHaveBeenCalledTimes(1);
      const msg = String(warn.mock.calls[0]![0]);
      expect(msg, '沒報出是哪一個分類').toContain('煞車系統');
      expect(msg, '沒報出件數(判斷急不急要靠它)').toContain('285');
      // 反面:有 icon 的那家不該被列進去,否則訊息會把人帶錯方向
      expect(msg).not.toContain('碳纖維部品');
    } finally {
      warn.mockRestore();
    }
  });

  it('🔴 全部都有 icon 時**不得**叫(誤報會訓練人忽略這行告警)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      render(<CategoryGrid categories={mk(TOP_11)} />);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('分類為空 → 整段不渲染(不顯假卡 / 空磚面)', () => {
    const { container } = render(<CategoryGrid categories={[]} />);
    expect(container.querySelector('.b-cats')).toBeNull();
  });

  // ── #412:磚牆排除清單(Sean 2026-08-11 Q2=A)────────────────────────────────
  it('🔴 #412:「服務與其他」件數再多也不上磚牆,而且不是靠「它件數本來就少」', () => {
    // 🔴 判別力的關鍵在 fixture:給它 2500 件 ⇒ **沒有排除的話它一定佔一格**(排在第 6 名附近),
    //    並把原本的第 11 名擠出榜外。若拿它當「件數少所以不上榜」的樣本,這格就恆真、什麼都沒守到。
    //    正式站的真實情境正是「件數多到會上榜」:落筆當日報價單側該分類 800+ 件,
    //    而磚牆第 10/11 名是 738 / 553。
    const WITH_SERVICE: MockCategory[] = [
      ...mk(TOP_11),
      { id: 'svc', name: '服務與其他', count: 2500, children: [] },
    ];
    const { container } = render(<CategoryGrid categories={WITH_SERVICE} />);
    const labels = [...container.querySelectorAll('.b-cat-label')].map((el) => el.textContent ?? '');

    expect(labels.join('|'), '排除清單失效 ⇒ 首頁最顯眼的磚面被維修零件佔一格')
      .not.toContain('服務與其他');
    expect(container.querySelectorAll('.b-cat-chip')).toHaveLength(11);
    // 正向對照:原本的第 11 名還在(= 排除的是那一顆、不是把整排砍短)
    expect(labels.some((l) => l.includes(TOP_11[TOP_11.length - 1]!))).toBe(true);
    // 「全站共 N 類」講的是全站分類數,**不**因磚牆排除而變小(排除的是曝光位置、不是可及性)
    expect(container.querySelector('.b-cats-note')?.textContent)
      .toBe('依件數排序取前 11 名 · 全站共 12 類');
  });

  it('🔴 #412:被排除的分類不算進「查無 icon」告警(否則每次渲染都叫一次假警報)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      render(<CategoryGrid categories={[...mk(TOP_11), { id: 'svc', name: '服務與其他', count: 2500, children: [] }]} />);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('表頭是 N°03 標題 + 排序說明(OD 表頭右側放的是說明,不是連結)', () => {
    const { container } = render(<CategoryGrid categories={LIVE_15} />);
    expect(screen.getByText('Categories · 部品分類')).toBeDefined();
    expect(container.querySelector('.ed-section-head .b-cats-note')).not.toBeNull();
    // 「全部分類」只有一個入口(第 12 格),表頭不再另放一顆同義連結
    expect([...container.querySelectorAll('a')].filter((a) => a.getAttribute('href') === '/products'))
      .toHaveLength(1);
  });
});
