// brand-content.test.ts — D1b 搬運後的結構不變量守門(2026-08-04)
//
// 這支守的**不是**文案內容(那本來就會隨新品牌上架而變),而是 D2/D3 會直接依賴、
// 一旦被打破就會在版面上長出「看起來像沒做完」的東西的那些結構性質。
//
// 🔴 為什麼不用 legal-content 那種 hash pin:那支綁的是 DB 裡的法律同意版本(改了字
//    卻沒 bump version = 稽核查無對證)。品牌內容沒有那種下游契約,而且**本來就該常變**
//    (每上架一家新品牌就變一次)——hash pin 會變成純摩擦。
//
// 所有斷言的數字都是 2026-08-04 對來源求值量出來的,不是猜的。

import { describe, expect, it } from 'vitest';
import { BRAND_CONTENT, BRAND_BY_SLUG } from './brand-content';

/**
 * 走訪一顆品牌裡所有「會被客人看到」的字串。
 * 🔴 **視覺前一字**:比對標點時要看的是**渲染後**眼睛看到的前一個字,不是原始字串的前一個 char ——
 *    `…完成</strong>,廠址…` 的原始前一 char 是 `>`,而客人看到的是「成」。
 *    R1 抓到:沒剝標記的版本對 53 處實際違規回報 0(見下面兩條的分層守法)。
 */
const allStrings = (value: unknown, out: string[] = []): string[] => {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) allStrings(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) allStrings(v, out);
  return out;
};

const stripTags = (s: string) => s.replace(/<[^>]+>/g, '');

describe('品牌內容 · 身分與查表', () => {
  it('20 家', () => {
    expect(BRAND_CONTENT).toHaveLength(20);
  });

  it('slug 唯一、且是 ?pbrand= 用得上的形狀', () => {
    // slug 直接進網址(products-url-state.tsx:92-98 的 ?pbrand= 讀取端與 D3 的 /brands/[slug])。
    const slugs = BRAND_CONTENT.map((b) => b.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9-]+$/);
  });

  it('BRAND_BY_SLUG 覆蓋全部、且指回同一個物件', () => {
    expect(Object.keys(BRAND_BY_SLUG)).toHaveLength(BRAND_CONTENT.length);
    for (const brand of BRAND_CONTENT) expect(BRAND_BY_SLUG[brand.slug]).toBe(brand);
  });
});

describe('品牌內容 · 版面會被打壞的那些數字', () => {
  it('🔴 craft.rows 筆數必為偶數(版面是 2 欄格線)', () => {
    // README 逐字:三步會在右下留一個角,「那個缺口看起來像沒做完」;
    // Kineo 因此用四步、Extreme 維持兩步。實測 19 家 2 步、1 家(kineo)4 步。
    for (const brand of BRAND_CONTENT) {
      expect(brand.craft.rows.length % 2, `${brand.slug} 的 craft 步數是奇數`).toBe(0);
      expect(brand.craft.rows.length).toBeGreaterThan(0);
    }
  });

  it('facts 每家 3 或 4 則、每則恰 3 欄', () => {
    // 欄數由 --fact-n 決定(brand-page-integration.md §5);查不到的欄位是整格拿掉、
    // 不是填「官方未載明」⇒ 3 則是合法的,不是缺漏。
    for (const brand of BRAND_CONTENT) {
      expect([3, 4], `${brand.slug} 的 facts 筆數`).toContain(brand.facts.length);
      for (const fact of brand.facts) expect(fact).toHaveLength(3);
    }
  });

  it('highlights.cards 每家恰 4 張', () => {
    for (const brand of BRAND_CONTENT) {
      expect(brand.highlights.cards.length, `${brand.slug}`).toBe(4);
    }
  });

  it('focus.order 是 0..19 的一個排列(不得重複或缺號)', () => {
    // 首頁 N°05 本月聚焦每 3 天輪一個。重號 = 有一家永遠輪不到,而畫面上看不出來。
    const orders = BRAND_CONTENT.map((b) => b.focus.order).sort((a, b) => a - b);
    expect(orders).toEqual(Array.from({ length: BRAND_CONTENT.length }, (_, i) => i));
  });

  it('categories 的色碼是整數、且在首頁 --cat-N 的值域內', () => {
    for (const brand of BRAND_CONTENT) {
      expect(brand.categories.length, `${brand.slug} 至少一個分類`).toBeGreaterThan(0);
      for (const [name, colorIndex] of brand.categories) {
        expect(name).not.toBe('');
        expect(Number.isInteger(colorIndex), `${brand.slug} 的 ${name}`).toBe(true);
        expect(colorIndex).toBeGreaterThanOrEqual(0);
        expect(colorIndex).toBeLessThanOrEqual(11);
      }
    }
  });

  it('🔴 materya 的 About 右欄影片還在(手改處、重新產生會被靜默刪掉)', () => {
    // 本檔是**機器產生**的(檔頭有重新產生的指令),而 materya 這筆 video 是
    // Sean 2026-08-04 指定的素材、Open Design 來源側尚未回寫(backlog #319)。
    // ⇒ 照檔頭重跑產生器會把它整塊刪掉,而**沒有任何既有測試會紅**:
    //   `brand-assets.test.ts` 只驗「資料引用的檔案存在」,少一筆引用它不會知道;
    //   下面那條 video 互斥性對「沒有 video」是 `continue` 直接跳過。
    const materya = BRAND_CONTENT.find((b) => b.slug === 'materya');
    expect(materya, '前提:materya 這家還在').toBeDefined();
    expect(materya!.video?.file).toBe('assets/brand-video/materya-reel.mp4');
    expect(materya!.video?.poster).toBe('assets/brands-prod/materya/reel-poster.jpg');
    // 直式(720×1280 實測)—— 掉了這個旗標,9:16 的片會被塞進 16:9 寬欄裁掉(#313 同款壞法)
    expect(materya!.video?.portrait, '直式旗標掉了 ⇒ 影片會被裁成一條橫帶').toBe(true);
    // aside 刻意保留當退路資料(有 video 時 BrandPageAbout 就不渲染產品照卡)
    expect(materya!.aside).toBeDefined();
  });

  it('🔴 video 恰有一個來源(youtube / vimeo / file 三選一、互斥)', () => {
    // 型別上是三個選填欄(D1a 檔頭寫明刻意不做 discriminated union:
    // 做成 union 會逼 D1b 改寫資料形狀,而改寫就有走樣風險)⇒ 互斥性由這裡守。
    for (const brand of BRAND_CONTENT) {
      if (!brand.video) continue;
      const sources = [brand.video.youtube, brand.video.vimeo, brand.video.file].filter(Boolean);
      expect(sources.length, `${brand.slug} 的 video 來源數`).toBe(1);
    }
  });
});

describe('品牌內容 · 資產路徑', () => {
  it('band.src 一律在 assets/brands-hero/', () => {
    for (const brand of BRAND_CONTENT) {
      if (!brand.band) continue;
      expect(brand.band.src, brand.slug).toMatch(/^assets\/brands-hero\//);
    }
  });

  it('🔴 bandLogo 目前有兩個資料夾,samco 是唯一的例外', () => {
    // brand-page-integration.md §4 的表寫「assets/brands/ 原始檔,目前沒有任何頁面引用」——
    // 但實測 samco 的 bandLogo 就指在那裡(同名的 brands-dark 版也存在)。
    // README 已知限制那節說 brands-dark/samco.png 疊在 graphite 上只有 2.57:1(其餘 ≥4.15),
    // 所以這**很可能是刻意的**,但文件沒寫。
    // 這條把現況釘住:哪天有人「順手統一」成 brands-dark,會在這裡轉紅、被迫回頭確認,
    // 而不是靜默換掉一張已知對比不足的圖。D2 上線前要向設計側確認一次(未決)。
    const odd = BRAND_CONTENT.filter((b) => !b.bandLogo.startsWith('assets/brands-dark/'));
    expect(odd.map((b) => b.slug)).toEqual(['samco']);
    expect(odd[0]?.bandLogo).toBe('assets/brands/samco.png');
    // ⚠️ 副檔名有 png 與 svg 兩種:gilles 與 motogadget 原本沒有深色版、2026-08-03 才補上
    //    (README「品牌總覽頁的 hero」那節:motogadget 純黑提亮成近白、gilles 深藍保留色相
    //    只提亮到 #0073f1 / 4.20:1),補的是 svg。寫死 .png 會把這兩家判成錯 —— 本條第一版
    //    就是這樣紅的,是斷言錯不是資料錯。
    for (const brand of BRAND_CONTENT) {
      expect(brand.bandLogo, brand.slug).toMatch(/^assets\/brands(-dark)?\/[a-z0-9-]+\.(png|svg)$/);
    }
    expect(BRAND_CONTENT.filter((b) => b.bandLogo.endsWith('.svg')).map((b) => b.slug)).toEqual([
      'gilles',
      'motogadget',
    ]);
  });

  it('logoScale 在逐家光學校正的合理範圍(預設 1)', () => {
    // 實測值域 0.88–1.08、7 家非 1。「新增品牌時要目視加一次,不是套公式」(整合文件 §4)。
    for (const brand of BRAND_CONTENT) {
      expect(brand.logoScale, brand.slug).toBeGreaterThanOrEqual(0.8);
      expect(brand.logoScale, brand.slug).toBeLessThanOrEqual(1.2);
    }
  });
});

describe('🔴 品牌內容 · 標記白名單(把 D1b 的資料釘在 D1a 的 parser 能力上)', () => {
  // 這是跨兩片的守門,也是本檔最重要的一條:
  // parser(lib/brand-rich-text)只認 <strong> / <br>,白名單外一律當純文字顯示。
  // 若哪天有人在內容裡寫了 <em> 或 <a href>,網站不會壞、但畫面上會出現那串標籤原文。
  // 那種 bug 三綠全綠、型別全過、肉眼要逐頁看才找得到 ⇒ 必須在資料層擋。
  it('全部字串裡不得出現白名單以外的標籤', () => {
    const offenders: string[] = [];
    for (const raw of allStrings(BRAND_CONTENT)) {
      for (const match of raw.matchAll(/<[^>]*>/g)) {
        if (match[0] === '<strong>' || match[0] === '</strong>' || match[0] === '<br>') continue;
        offenders.push(`${match[0]} 於「${raw.slice(0, 40)}…」`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('<strong> 全數配對、且內部不含其他標籤(parser 的扁平節點串前提)', () => {
    for (const raw of allStrings(BRAND_CONTENT)) {
      const open = raw.match(/<strong>/g)?.length ?? 0;
      const close = raw.match(/<\/strong>/g)?.length ?? 0;
      expect(open, `未配對:${raw.slice(0, 40)}`).toBe(close);
      for (const m of raw.matchAll(/<strong>([\s\S]*?)<\/strong>/g)) {
        expect(m[1]?.includes('<'), `strong 內含標籤:${raw.slice(0, 40)}`).toBe(false);
      }
    }
  });

  it('entity 只用得到白名單裡的五個(目前實際只出現 &amp;)', () => {
    const known = /^&(?:amp|lt|gt|quot|#39);$/;
    const offenders: string[] = [];
    for (const raw of allStrings(BRAND_CONTENT)) {
      for (const m of raw.matchAll(/&[a-zA-Z#0-9]+;/g)) if (!known.test(m[0])) offenders.push(m[0]);
    }
    expect(offenders).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🔶 2026-08-06 標點遷移片(H1)· 本檔由 OD 來源重產,守門三族
// ══════════════════════════════════════════════════════════════════════════════


describe('🔴 標點遷移(Sean 2026-08-05 拍板 A · 全站遷移)', () => {
  // 判準 = handoff §七逐字:「**前一個字是中文才全形**;英數字後面維持半形」。
  // 兩個方向都要守:只守單向的話,「英數字後誤用全形」那半會全綠
  // (`brand-focus-data.test.ts` 的 R1 nit 實測過同一個洞)。
  //
  // 🔴 **「前一個字」要看渲染後的,不是原始字串的前一 char**(R1 must-fix)。
  //    初版直接對原始字串比對 ⇒ `…完成</strong>,廠址…` 的前一 char 是 `>`、不是「成」,
  //    **當前資料就有 53 處實際違規而它回報 0**。那不是理論缺口:
  //    gilles 那句渲染後客人讀到的是「…Yamaha 車款上**,**並以此…」。
  //
  //    做法:把標記換成**等長**的 NUL(位置不動),往回找第一個可見字,同時記錄
  //    「有沒有跨過標記」—— 這兩件事決定它落在哪一層。
  //    🔴 為什麼不直接 stripTags:剝完之後兩層長得一模一樣,分不出來 ——
  //       實測 48 處會全部落進零容忍那層,baseline 那條就永遠不可能成立。
  const scanHalfWidthAfterCJK = () => {
    const plain: string[] = [];
    const boundary: string[] = [];
    for (const brand of BRAND_CONTENT) {
      for (const raw of allStrings(brand)) {
        const masked = raw.replace(/<[^>]+>/g, (t) => ' '.repeat(t.length));
        for (const m of masked.matchAll(/[,;:.!?]/g)) {
          let j = m.index - 1;
          let crossedTag = false;
          while (j >= 0 && (masked[j] === ' ' || /\s/.test(masked[j]!))) {
            if (masked[j] === ' ') crossedTag = true;
            j -= 1;
          }
          if (j < 0) continue;
          const prev = masked[j]!;
          const where = `${brand.slug}: 「…${raw.slice(Math.max(0, m.index - 12), m.index + 4)}…」`;
          // 右括號/右引號是「中文的收尾」,視同中文那一側;它與跨標記同屬邊界族。
          if (/[）」』】]/.test(prev)) boundary.push(where);
          else if (/[一-鿿]/.test(prev)) (crossedTag ? boundary : plain).push(where);
        }
      }
    }
    return { plain, boundary };
  };

  it('中文後面不得出現半形標點(純內文、沒有標記擋著 ⇒ 零容忍)', () => {
    // 🔴 掃描器的字元類刻意**不含 `(`**,與 `brand-focus-data.test.ts` 同一個理由:
    //    一對括號的寬度由**左括號**前面是什麼決定。實例 rpm-carbon
    //    `DryCarbon(即 PrePreg 預浸布)` —— 左括號前是 `n`(拉丁)⇒ 整對半形是對的,
    //    但右括號前面是「布」。照「前一字」判右括號,會判出一條**要求把資料改錯**的紅。
    const { plain } = scanHalfWidthAfterCJK();
    expect(plain, `有 ${plain.length} 處中文後接半形標點:\n${plain.slice(0, 20).join('\n')}`).toEqual(
      [],
    );
  });

  // 🔴 **這 53 處是已知債、不是「可接受」**(R1 抓到我原本對它們全盲)。
  //    形狀只有兩種:①隔著 `</strong>`(49 處)②在全形右括號/右引號之後(4 處)——
  //    都是「機械遷移只看緊鄰前一字」會漏掉的邊界,OD 端那次遷移用的顯然是同款規則。
  //    ⚠️ **修正點在 OD 來源、不在本檔**(本檔是機器產物);回寫債掛在 #322 旁邊。
  //    這條把數字釘死:**變多 = 有人新寫了漏網的;變少 = OD 修好了 ⇒ 回來改這個數字並結債**。
  //    🔴 絕不可為了讓它綠而放寬上面那條零容忍 —— 那是 R4 立即停止訊號。
  const KNOWN_BOUNDARY_MISSES = 53;

  it(`已知邊界漏網恰 ${KNOWN_BOUNDARY_MISSES} 處(隔著標記或右括號;修正點在 OD 來源)`, () => {
    const { boundary } = scanHalfWidthAfterCJK();
    expect(
      boundary.length,
      `邊界漏網從 ${KNOWN_BOUNDARY_MISSES} 變成 ${boundary.length} ⇒ 變多=新寫了漏網的(修 OD 資料);`
        + '變少=OD 端修好了(回來改這個數字、把 #322 旁那筆債結掉)。'
        + `**不要改上面那條零容忍守門**。\n${boundary.slice(0, 10).join('\n')}`,
    ).toBe(KNOWN_BOUNDARY_MISSES);
  });

  it('英數字後面不得誤用全形的「句中」標點(反向那一半)', () => {
    const offenders: string[] = [];
    for (const brand of BRAND_CONTENT) {
      for (const raw of allStrings(brand)) {
        // 🔴 射程刻意只到「寬度真的由前一個 token 決定」的那幾顆:`，：；（`。
        //    **不含 `。！？`(句末終止符)、也不含 `、`(列舉頓號)**。
        //    理由是實測出來的:資料裡有 12 處是「中文句子剛好以拉丁縮寫結尾」
        //    (`…遠不只 Ducati。`),55 處是「中文句子裡列舉拉丁名」(`Ducati、BMW、Honda`)。
        //    那些標點屬於**整句中文**,不屬於前面那個 token;照「前一字」判會要求寫成
        //    `…只做 Ducati.` 與 `Ducati,BMW`,夾在中文段落裡是錯的排版。
        //    ⇒ 句末終止符與列舉頓號的寬度由**句子的語言**決定,不由前一個字元決定。
        //    ⚠️ 代價講白:「純英文句子誤用全形 `。、！？`」這一族**目前沒有守門**
        //       (當前資料不存在該情形 ⇒ 零實害;哪天出現英文段落要回來補)。
        //    同樣先剝標記,理由見上面那條。
        for (const m of stripTags(raw).matchAll(/[0-9A-Za-z]\s*[，；：（]/g)) {
          offenders.push(`${brand.slug}: 「…${m[0]}…」`);
        }
      }
    }
    expect(
      offenders,
      `有 ${offenders.length} 處英數字後誤用全形標點:\n${offenders.slice(0, 20).join('\n')}`,
    ).toEqual([]);
  });

  // 前提:遷移真的發生過。上面幾條在「整批資料都沒有中文」時也會綠(空集合恆真),
  // 這條讓「有人把資料清空/換掉」也會紅。
  it('前提 — 全形逗號確實大量存在(上面幾條不是在空集合上恆真)', () => {
    const total = BRAND_CONTENT.flatMap((b) => allStrings(b)).join('').match(/，/g)?.length ?? 0;
    expect(total, '全形逗號數量異常偏低 ⇒ 遷移被回退,或資料被換掉了').toBeGreaterThan(300);
  });
});

describe('🔴 重產會踩掉的兩顆手改(重產的人照這裡對)', () => {
  // 這兩條的意義:本檔是**機器產生**的,而產生來源與本檔並非完全同步。
  // 每一顆「本檔有、OD 沒有」的覆寫都必須在這裡有一條,否則下一次重產會靜默弄丟它。
  it('KINEO 的 categories 是 Sean 拍板的兩層字面,不是 OD 的舊值', () => {
    const kineo = BRAND_BY_SLUG.kineo;
    expect(kineo, 'kineo 不見了 ⇒ 下面兩條失去對象').toBeTruthy();
    // `?? []` 不是放寬:kineo 不見時上一條已經紅了,這裡只是讓型別收斂(TS 不從 expect narrow)。
    const names = (kineo?.categories ?? []).map((c) => c[0]);
    expect(names, 'KINEO categories 退回 OD 舊值 ⇒ 分類深連結會靜默不篩選(backlog #315)').toContain(
      '懸吊與車架 · 輪圈',
    );
    expect(names, '舊字面 `輪框與傳動` 又回來了 ⇒ 重產時忘了套回覆寫').not.toContain('輪框與傳動');
  });

  // wallTagline 是這一片隨 OD 帶進來的新欄位,消費端是還沒做的 D5f 磚牆片。
  // 沒有消費端的資料最容易在下一次重構被當成死欄位刪掉,所以先釘住。
  it('20 家都有 wallTagline(D5f 磚牆片的輸入,現在還沒有消費端)', () => {
    const missing = BRAND_CONTENT.filter((b) => !b.wallTagline?.trim()).map((b) => b.slug);
    expect(missing, 'wallTagline 缺漏 ⇒ D5f 磚牆那一格會是空的').toEqual([]);
    // 🔴 R1 nit:只驗非空的話,**兩家對調、或 20 家全改成同一個字**都會綠(實測)。
    //    這欄沒有消費端可以幫忙抓錯,所以形狀之外還要釘「彼此互異」。
    expect(
      new Set(BRAND_CONTENT.map((b) => b.wallTagline)).size,
      'wallTagline 有重複 ⇒ 磚牆上會出現兩格一模一樣的副標(抄貼錯位的典型症狀)',
    ).toBe(BRAND_CONTENT.length);
  });
});
