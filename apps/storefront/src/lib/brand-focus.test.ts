// @vitest-environment node
//
// brand-focus.test.ts — 首頁 N°05 輪播決策(D5e-1;2026-08-05)
//
// 🔴 這支是本片的**主要驗收面**。理由:輪播是「今天是哪一天」的函式,而
//    「量時間的東西」有兩個經典失敗形狀,兩個都不會在畫面上立刻看得出來:
//    ① 時區:設計稿的 `new Date('2026-08-03T00:00:00')` 是**本地時區**,server 跑 UTC
//       ⇒ 換人會發生在台灣時間早上 8 點而不是午夜。這種錯要等到有人半夜看首頁才發現。
//    ② 邊界:`elapsed / 3` 的取整與 `% count` 的環繞,差一天就整期錯開。
//    ⇒ 決策函式一律收 `now` 參數、內部不碰時鐘,測試才給得出定值答案。

import { describe, expect, it } from 'vitest';
import type { BrandContent } from '@/data/brand-content-types';
import { BRAND_CONTENT } from '@/data/brand-content';
import { BRAND_FOCUS, type BrandFocusOverlay } from '@/data/brand-focus';
import {
  FOCUS_ROTATION_DAYS,
  FOCUS_ROTATION_START,
  focusRotationIndex,
  resolveBrandFocus,
  taipeiDayNumber,
} from './brand-focus';

/** 定長三元組的最小填充(型別要求恰好三則)。 */
const TRIPLE = [['a', '1'], ['b', '2'], ['c', '3']] as const;

/** 只給本支用的最小假品牌;`as unknown as BrandContent` 是因為真型別有 20 個欄位、本支只碰 6 個。 */
function brand(slug: string, order: number, enabled = true): BrandContent {
  return {
    slug,
    name: slug.toUpperCase(),
    origin: `${slug}-產地`,
    lede: `${slug} 的 lede。`,
    facts: [
      ['F1', `${slug}-v1`, '小註一'],
      ['F2', `${slug}-v2`, '小註二'],
      ['F3', `${slug}-v3`, '小註三'],
      ['F4', `${slug}-v4`, '小註四'],
    ],
    focus: { enabled, order },
  } as unknown as BrandContent;
}

// 🔴🔴 **把本支的時區釘成 UTC,而且斷言它真的釘上了。**
//    開發機實測 `Intl.DateTimeFormat().resolvedOptions().timeZone === 'Asia/Taipei'`
//    ⇒ 在這台機器上,把實作裡的 `timeZone: 'Asia/Taipei'` **整個拿掉,下面每一條照樣全綠**
//    (本地時區剛好就是台北)= 這一族守門在本機**零判別力**,而正式站的 server 跑 UTC ——
//    也就是說「會出事的環境」正好是「測不到的環境」。這是
//    memory `feedback_fixture-value-makes-guard-vacuous` 那一族最典型的形狀。
//    ⇒ 釘 UTC 之後,拿掉 `timeZone` 選項會讓下面第一條轉紅(已親跑突變驗證)。
// ⚠️ 這是 **process 全域**、且不還原(R3 F7):同一個 worker process 被重用時會外溢到後續測試檔。
//    今天不咬人 —— 全 repo 另一個 Asia/Taipei 消費端(`lib/orders/order-display.ts`)同樣顯式
//    帶 `timeZone`、對本地時區免疫,沒有任何測試依賴機器的本地時區。
//    真要根治是 `vitest.config.ts` 的 `test.env.TZ`;此處不動全域設定。
process.env.TZ = 'UTC';

describe('taipeiDayNumber — 用台灣曆日,不是 UTC 曆日', () => {
  // 前提斷言:上面那行**真的生效了**才有下面的判別力。
  // Node 對執行期改 `process.env.TZ` 的支援視平台而定;沒生效就必須大聲紅,
  // 不能讓整組時區斷言默默退化成恆真。
  it('🔴 前提:本支的執行時區已釘成 UTC(沒釘上的話下面的時區斷言全部零判別力)', () => {
    expect(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      '執行時區不是 UTC ⇒ 若這台機器剛好是 Asia/Taipei,下面的斷言拿掉實作裡的 timeZone 也不會紅',
    ).toBe('UTC');
  });

  it('🔴 UTC 還是前一天、台灣已經隔天的那個窗口,算成台灣的隔天', () => {
    // 2026-08-05T16:30:00Z = 台灣 2026-08-06 00:30 ⇒ 台灣曆日已經是 8/6。
    // 這條就是「照抄設計稿會錯 8 小時」的那個窗口;拿掉時區設定的話它會紅。
    const utcStillFifth = new Date('2026-08-05T16:30:00Z');
    const taipeiSixth = new Date('2026-08-06T04:00:00Z'); // 台灣 8/6 12:00,同一個台灣曆日
    expect(taipeiDayNumber(utcStillFifth)).toBe(taipeiDayNumber(taipeiSixth));
  });

  it('🔴 台灣同一天的頭尾算同一個曆日(00:00 與 23:59 不得跨號)', () => {
    const dawn = new Date('2026-08-04T16:00:00Z'); // 台灣 8/5 00:00
    const dusk = new Date('2026-08-05T15:59:00Z'); // 台灣 8/5 23:59
    expect(taipeiDayNumber(dawn)).toBe(taipeiDayNumber(dusk));
    // 前提斷言:兩者確實跨了 UTC 的日界 —— 否則這條在 UTC 實作下也會綠 = 零判別力
    expect(dawn.toISOString().slice(0, 10)).not.toBe(dusk.toISOString().slice(0, 10));
  });

  it('相鄰兩個台灣曆日恰好差 1', () => {
    expect(taipeiDayNumber(new Date('2026-08-06T04:00:00Z')) - taipeiDayNumber(new Date('2026-08-05T04:00:00Z'))).toBe(1);
  });
});

describe('focusRotationIndex — 每 3 天進一格、到底環回', () => {
  /** 台灣當地中午,避開任何日界爭議。 */
  const noonTaipei = (ymd: string) => new Date(`${ymd}T04:00:00Z`);

  it('起算日當天 = 第 0 格', () => {
    expect(focusRotationIndex(noonTaipei(FOCUS_ROTATION_START), 20)).toBe(0);
  });

  it('🔴 邊界:第 0/1/2 天都是第 0 格,第 3 天才進第 1 格', () => {
    expect(focusRotationIndex(noonTaipei('2026-08-03'), 20)).toBe(0);
    expect(focusRotationIndex(noonTaipei('2026-08-04'), 20)).toBe(0);
    expect(focusRotationIndex(noonTaipei('2026-08-05'), 20)).toBe(0);
    expect(focusRotationIndex(noonTaipei('2026-08-06'), 20)).toBe(1);
    expect(focusRotationIndex(noonTaipei('2026-08-08'), 20)).toBe(1);
    expect(focusRotationIndex(noonTaipei('2026-08-09'), 20)).toBe(2);
  });

  it('🔴 走完一輪環回第 0 格(20 家 × 3 天 = 60 天)', () => {
    expect(focusRotationIndex(noonTaipei('2026-10-02'), 20)).toBe(0); // 起算 +60 天
    expect(focusRotationIndex(noonTaipei('2026-10-05'), 20)).toBe(1); // +63 天
  });

  it('🔴 起算日之前夾到第 0 格(不得回負數索引 ⇒ 取到 undefined、版位靜默消失)', () => {
    expect(focusRotationIndex(noonTaipei('2026-07-01'), 20)).toBe(0);
  });

  it('🔴 count = 0 回 0 而不是 NaN(`% 0` 是 NaN,拿去當索引會取到 undefined)', () => {
    expect(focusRotationIndex(noonTaipei('2026-08-20'), 0)).toBe(0);
    expect(Number.isNaN(focusRotationIndex(noonTaipei('2026-08-20'), 0))).toBe(false);
  });

  it('輪播週期常數就是設計稿的 3 天 / 2026-08-03(改了要回頭看設計稿)', () => {
    expect(FOCUS_ROTATION_DAYS).toBe(3);
    expect(FOCUS_ROTATION_START).toBe('2026-08-03');
  });
});

describe('resolveBrandFocus — 決定當期顯示什麼', () => {
  const now = new Date('2026-08-04T04:00:00Z'); // 台灣 8/4 中午 ⇒ 第 0 格
  const pool = [brand('cee', 2), brand('aay', 0), brand('bee', 1)];
  const overlay: BrandFocusOverlay = {
    title: '鉤子一句。',
    photo: '/p/aay.jpg',
    facts: [['O1', 'v1'], ['O2', 'v2'], ['O3', 'v3']],
  };

  it('🔴 依 focus.order 排序,不是依陣列原順序', () => {
    // 陣列給的順序是 cee/aay/bee;order 是 aay=0 ⇒ 第 0 格必須是 aay。
    // 拿掉 sort 的話這條會紅(會取到 cee)。
    const r = resolveBrandFocus({ brands: pool, overlays: {}, now });
    expect(r?.slug).toBe('aay');
  });

  it('🔴 focus.enabled = false 的不進輪播池', () => {
    const r = resolveBrandFocus({ brands: [brand('off', 0, false), brand('on', 1)], overlays: {}, now });
    expect(r?.slug).toBe('on');
  });

  it('可用品牌為空 ⇒ 回 null(呼叫端不渲染這一段)', () => {
    expect(resolveBrandFocus({ brands: [], overlays: {}, now })).toBeNull();
    expect(resolveBrandFocus({ brands: [brand('x', 0, false)], overlays: {}, now })).toBeNull();
  });

  it('🔴 沒有 overlay 的那一家退回品牌名當標題、lede 當敘述、facts 前三則(版位不會空)', () => {
    const r = resolveBrandFocus({ brands: pool, overlays: {}, now });
    expect(r?.title).toBe('AAY');
    expect(r?.body).toBe('aay 的 lede。');
    expect(r?.caption).toBe('aay-產地');
    // 🔴 四則砍成三則,而且每則只留前兩欄 —— 小註留在品牌頁(OD 契約)。
    //    少了 slice 的話會多渲染一格;少了 factToPair 的話小註會漏到首頁。
    expect(r?.facts).toEqual([['F1', 'aay-v1'], ['F2', 'aay-v2'], ['F3', 'aay-v3']]);
    expect(r?.photo).toBeNull();
  });

  it('🔴 有 overlay 就整組覆寫(title / facts / photo),body 沒填仍退回 lede', () => {
    const r = resolveBrandFocus({ brands: pool, overlays: { aay: overlay }, now });
    expect(r?.title).toBe('鉤子一句。');
    expect(r?.facts).toEqual([['O1', 'v1'], ['O2', 'v2'], ['O3', 'v3']]);
    expect(r?.photo).toBe('/p/aay.jpg');
    // body 是選填:overlay 沒給 ⇒ 用品牌頁的 lede,同一句話不維護兩份(OD 契約逐字)
    expect(r?.body).toBe('aay 的 lede。');
  });

  it('overlay 有填 body 才覆寫敘述', () => {
    const r = resolveBrandFocus({ brands: pool, overlays: { aay: { ...overlay, body: '首頁專用敘述。' } }, now });
    expect(r?.body).toBe('首頁專用敘述。');
  });

  it('🔴 override 指定哪一家就固定顯示哪一家(D5e-1 用它把當期釘在 RIZOMA)', () => {
    const r = resolveBrandFocus({ brands: pool, overlays: {}, now, override: 'cee' });
    expect(r?.slug).toBe('cee');
  });

  it('🔴 override 指到不存在的 slug ⇒ **退回輪播**,不是讓整個版位消失', () => {
    const r = resolveBrandFocus({ brands: pool, overlays: {}, now, override: 'typo-slug' });
    expect(r?.slug).toBe('aay');
  });

  // 🔴 `sort` 是就地排序,而傳進來的是 `BRAND_CONTENT` 模組單例(品牌頁與 /brands 總覽也吃它)
  //    ⇒ 直接 `brands.sort(...)` 會把全站共用資料的順序改掉。
  //    ⚠️ **這條的判別力來自哪裡**:實作靠 `filter` 已回新陣列而安全,能讓它紅的改法是
  //    「把 filter 拿掉、直接 `brands.sort(...)`」(該突變實測轉紅)。
  it('🔴 不得就地排序傳進來的陣列(會污染 BRAND_CONTENT 這個模組單例)', () => {
    const input = [brand('cee', 2), brand('aay', 0), brand('bee', 1)];
    const before = input.map((b) => b.slug);
    resolveBrandFocus({ brands: input, overlays: {}, now });
    expect(input.map((b) => b.slug), '傳進來的陣列被就地排序了').toEqual(before);
  });

  it('🔴 日期一走,選出來的品牌真的會換(否則「輪播」等於沒接上)', () => {
    const day0 = resolveBrandFocus({ brands: pool, overlays: {}, now: new Date('2026-08-04T04:00:00Z') });
    const day3 = resolveBrandFocus({ brands: pool, overlays: {}, now: new Date('2026-08-07T04:00:00Z') });
    const day6 = resolveBrandFocus({ brands: pool, overlays: {}, now: new Date('2026-08-10T04:00:00Z') });
    expect([day0?.slug, day3?.slug, day6?.slug]).toEqual(['aay', 'bee', 'cee']);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 🔴 生產接線守門(R1 must-fix:上面整組都用合成 fixture,**沒有一條碰到真資料**)
//
// 失敗情境很具體:`BRAND_FOCUS_PIN` 或 `BRAND_FOCUS` 的鍵打錯一個字 ⇒ `resolveBrandFocus`
// 依設計**靜默退回輪播**(打錯字不該讓版位消失),首頁就換成別家、標題退成品牌名、
// 照片變 null 整個媒體欄不渲染 —— 而全套測試照樣全綠、`page.test.tsx` 也綠
// (那支只數 section 在不在,不看是哪一家)。R1 實測 `override: undefined` 今天會落在
// AKRAPOVIČ 且 photo=null ⇒ 這條沒有的話,PIN 打錯字的症狀是「首頁少半個版位」。
// ══════════════════════════════════════════════════════════════════════════
describe('🔴 生產接線(真的 BRAND_CONTENT + BRAND_FOCUS,無 PIN)', () => {
  it('BRAND_FOCUS 的每一個鍵都是真 slug(鍵打錯 = 那家永遠吃不到覆蓋層)', () => {
    const slugs = new Set(BRAND_CONTENT.map((b) => b.slug));
    for (const key of Object.keys(BRAND_FOCUS)) {
      expect(slugs.has(key), `BRAND_FOCUS['${key}'] 不對應任何品牌`).toBe(true);
    }
  });

  it('🔴 用真資料解出來的當期版位,每一欄都有東西(不是退化成 fallback)', () => {
    // D5e-2:PIN 已移除 ⇒ 這裡不給 override,量的是**真正會顯示給客人的那一家**。
    const r = resolveBrandFocus({
      brands: BRAND_CONTENT,
      overlays: BRAND_FOCUS,
      now: new Date('2026-08-05T04:00:00Z'),
    });
    expect(r, '真資料解不出當期品牌').not.toBeNull();
    // 🔴 標題不得等於品牌名 —— 相等就代表「沒吃到 overlay、退回 fallback 了」
    expect(r!.title, '標題退化成品牌名 ⇒ 覆蓋層沒被吃到(鍵打錯?)').not.toBe(r!.name);
    expect(r!.body.length).toBeGreaterThan(10);
    expect(r!.caption.length).toBeGreaterThan(0);
    expect(r!.facts, '事實不是三則').toHaveLength(3);
    for (const [label, value] of r!.facts) {
      expect(label.length, '事實標籤是空的').toBeGreaterThan(0);
      expect(value.length, '事實值是空的').toBeGreaterThan(0);
    }
    // 🔴 照片必須解得出來,否則整個媒體欄不渲染 = 首頁少半個版位
    expect(r!.photo, '當期沒有照片 ⇒ 媒體欄整欄不會渲染').not.toBeNull();
  });

  it('🔴 repo 相對路徑的 photo 會被補上 /brand-assets/ 前綴(D5e-2 搬 OD 20 家的必要條件)', () => {
    const r = resolveBrandFocus({
      brands: BRAND_CONTENT,
      overlays: { [BRAND_CONTENT[0]!.slug]: { title: 't', photo: 'assets/brands-prod/x/y.jpg', facts: TRIPLE } },
      now: new Date('2026-08-05T04:00:00Z'),
      override: BRAND_CONTENT[0]!.slug,
    });
    expect(r!.photo).toBe('/brand-assets/assets/brands-prod/x/y.jpg');
  });

  it('絕對網址與站內絕對路徑原樣放行(不得被補成 /brand-assets/https://…)', () => {
    const mk = (photo: string) =>
      resolveBrandFocus({
        brands: BRAND_CONTENT,
        overlays: { [BRAND_CONTENT[0]!.slug]: { title: 't', photo, facts: TRIPLE } },
        now: new Date('2026-08-05T04:00:00Z'),
        override: BRAND_CONTENT[0]!.slug,
      })!.photo;
    expect(mk('https://example.test/a.jpg')).toBe('https://example.test/a.jpg');
    expect(mk('/already-absolute.jpg')).toBe('/already-absolute.jpg');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 🔴 R3 F1:上面那組只驗「被 PIN 的那一家」。D5e-2 把 PIN 改成 `undefined` 之後,
//    20 家裡**漏填一家 overlay**(不是打錯鍵 —— 打錯鍵上面那條接得住,是整家漏掉)
//    ⇒ 那家輪到時標題退成品牌名、`photo` 變 null 整個媒體欄不渲染,**連續三天**,
//    而全套測試照樣全綠。這一段就是把那個坑從註解變成守門。
//
//    ✅ **那個「自己上膛」的機制已經生效**:D5e-1 把 photo / title 兩格用
//    `BRAND_FOCUS_PIN === undefined` 包著,D5e-2 拿掉 PIN 的那一刻條件自動消失
//    ⇒ 現在是**無條件**要求 20 家每一家都有 overlay。不需要下一棒記得回來加測試(機制優先律)。
//    非 overlay 的那幾格(facts / lede / origin)吃的是 `BRAND_CONTENT`,一直都在驗。
// ══════════════════════════════════════════════════════════════════════════
describe('🔴 輪播池裡的每一家都要能撐起版位(D5e-2 已上膛:20 家逐一驗,非抽樣)', () => {
  const pool = BRAND_CONTENT.filter((b) => b.focus?.enabled);
  const now = new Date('2026-08-05T04:00:00Z');

  it('前提:輪播池不是空的、而且是預期的 20 家', () => {
    expect(pool.length, '輪播池為空 ⇒ 下面每一條都變成空迴圈、恆真').toBe(20);
  });

  it('🔴 focus.order 不得重複或缺號(重複 ⇒ 排序不穩定、某幾家可能永遠輪不到)', () => {
    const orders = pool.map((b) => b.focus.order).sort((a, b) => a - b);
    expect(orders, 'focus.order 不是 0..19 的連續整數').toEqual([...Array(pool.length).keys()]);
  });

  for (const b of BRAND_CONTENT.filter((x) => x.focus?.enabled)) {
    it(`每一家撐得起版位:${b.slug}`, () => {
      const r = resolveBrandFocus({ brands: BRAND_CONTENT, overlays: BRAND_FOCUS, now, override: b.slug });
      expect(r, `${b.slug} 解不出來`).not.toBeNull();
      expect(r!.slug).toBe(b.slug);
      // 這幾格吃 BRAND_CONTENT,今天就該全部有值
      expect(r!.body.length, `${b.slug} 的敘述是空的`).toBeGreaterThan(10);
      expect(r!.caption.length, `${b.slug} 的圖說(產地)是空的`).toBeGreaterThan(0);
      expect(r!.facts, `${b.slug} 的事實不是三則`).toHaveLength(3);
      for (const [label, value] of r!.facts) {
        expect(label.length, `${b.slug} 有空的事實標籤`).toBeGreaterThan(0);
        expect(value.length, `${b.slug} 有空的事實值`).toBeGreaterThan(0);
      }
      // 🔴 這兩格要 overlay 才有。D5e-1 用 `if (BRAND_FOCUS_PIN === undefined)` 包著讓它「自己上膛」,
      //    **D5e-2 已拿掉 PIN ⇒ 條件消失、改成無條件要求**(20 家 overlay 全到齊了)。
      expect(r!.title, `${b.slug} 的標題退化成品牌名 ⇒ 這一家的 overlay 漏填了`).not.toBe(r!.name);
      expect(r!.photo, `${b.slug} 沒有照片 ⇒ 輪到它那三天媒體欄整欄不會渲染`).not.toBeNull();
    });
  }
});
