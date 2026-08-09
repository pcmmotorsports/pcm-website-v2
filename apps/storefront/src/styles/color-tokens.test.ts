// color-tokens.test.ts — 「寫死的顏色若已經有同值 token,就該引用它」的可重跑掃描器。
//
// D-322-A / D-325-A ②:機制優先 —— 下一支新 CSS 自動被罩住,不必有人記得掃。
//
// 🔴 掃描規則(三種**不算**違規,理由逐條):
//   ① **自有色票的定義**(`--ed-c-ink: #0a0a0a`):`home.css` / `brand-page.css` / `brand-directory.css`
//      各自維護一組 scoped 色票,是刻意獨立的(例如 `.ed-*` 刻意沒有深色變體,見 home.css 該段註解)。
//      把定義處改成引用站台 token = 把兩套色票綁死,那是設計決定、不是清理。
//   ② **`var(--x, #hex)` 的 fallback**:hex 是防禦性後備、不是「忘了用 token」。
//   ③ **`url(data:...)` 裡的色**:SVG 圖示吃不到 CSS 變數,物理上做不到。
//
// 🔴 剩下的「裸用」再分兩類,只有第二類算客觀缺陷:
//   · **對應到多個 token**(`#fff` 同時等於 `--c-bg` / `--c-surface` / `--c-text-inverse`)
//     ⇒ 選哪一顆**是語意決定**(白字在紅底上語意是 text-inverse、不是 bg),不是機械替換
//     ⇒ 列進 allowlist、**留給 Sean 拍一次政策**,不在夜裡自行改 69 處。
//   · **對應到唯一 token、且同檔已有人用了 token 寫法** ⇒ 檔內自我矛盾 = 客觀,直接修。
//     (2026-08-09 實例:`home.css` 的 `#202225` 在 `:1143` 是 `var(--c-graphite, …)`、
//      在 `:145`/`:1555` 卻是裸寫 —— 已統一。)

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));

const normalize = (c: string): string => {
  const s = c.trim().toLowerCase();
  const m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  return m ? `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}` : s;
};

/** tokens.css 的 `--x: #hex` 全表:正規化色值 → token 名清單。 */
function tokenTable(): Map<string, string[]> {
  const src = readFileSync(resolve(DIR, 'tokens.css'), 'utf8');
  const t = new Map<string, string[]>();
  for (const m of src.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    const k = normalize(m[2] ?? '');
    t.set(k, [...(t.get(k) ?? []), m[1] ?? '']);
  }
  return t;
}

type Hit = { file: string; line: number; color: string; tokens: string[] };

function scanBareHardcodes(): Hit[] {
  const tokens = tokenTable();
  const hits: Hit[] = [];
  for (const f of readdirSync(DIR).filter((n) => n.endsWith('.css') && n !== 'tokens.css')) {
    const raw = readFileSync(join(DIR, f), 'utf8');
    // 剝註解(註解大量引用色值),等長空白代換讓行號不位移
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    src.split('\n').forEach((line, i) => {
      const scan = line.replace(/url\(["']?data:[^)]*\)/g, ''); // ③
      for (const m of scan.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
        const tok = tokens.get(normalize(m[0]));
        if (!tok) continue;
        const before = scan.slice(0, m.index);
        if (/--[\w-]+:\s*$/.test(before)) continue; // ①
        if (/var\(\s*--[\w-]+\s*,\s*$/.test(before)) continue; // ②
        hits.push({ file: f, line: i + 1, color: normalize(m[0]), tokens: tok });
      }
    });
  }
  return hits;
}

/**
 * 已知且已判定「不是缺陷」的裸用 —— 每一條都要有理由,不是為了讓測試變綠而加。
 * 新增任何一筆都等於在說「這個色刻意不吃 token」,要在 STOP / commit 裡講得出理由。
 *
 * 🔴 **`files` 是承重的,不是註記**。第一版的 ALLOW 只用顏色當 key,結果:
 *    `#202225` 因為漸層停點被豁免 ⇒ **連 `home.css` 剛修好的那兩處都一起被豁免了**,
 *    把修法改回裸寫、測試照樣綠 = 我自己剛修的東西沒有守門(突變 M2 當場證明)。
 *    ⇒ 改成「顏色 × 檔案」雙鍵:豁免只在**舉得出理由的那幾支檔**成立,別處出現同色照樣紅。
 *    `files: null` = 全站豁免(只有語意上真的與檔案無關才可以,例如 `#fff` 的多 token 歧義)。
 */
const ALLOW: Readonly<Record<string, { why: string; files: readonly string[] | null }>> = {
  // 🔴 2026-08-09 Sean 拍 Q4=B「現在就改」後,實際去看 69 處的上下文,**結論與題目的前提相反**:
  //    絕大多數的 `#fff` 是**應該保持字面**的,換 token 會在深色模式上線那天讓它們消失。
  //
  //    病根:`--c-text-inverse` 在 `[data-theme="dark"]` 被覆寫成 `#0a0a0a`(tokens.css:190)。
  //    所以「白字改吃 --c-text-inverse」只有在**底色也會跟著翻**的時候才成立。
  //      · 底色 `var(--c-text)`(淺 #121214 / 深 #fafafa)⇒ 真正的反相配對 ⇒ **已改**(7 處)
  //      · 底色固定(--c-red / --c-graphite / --cs-ink / --ed-c-action / #06C755 /
  //        照片疊字的 rgba 黑)⇒ 深色模式**不翻** ⇒ 字跟著翻成 #0a0a0a = 深底上的黑字 = 消失
  //        ⇒ **必須保持 `#fff` 字面**。這不是我的新判斷:tokens.css:102-105 早就為 `--c-graphite`
  //        寫過同一句話(「搭配寫死的 color:#fff…跟著翻會讓深底變淺底、白字消失」)。
  //      · `background: #fff` 那 8 處另有第二層歧義(--c-bg vs --c-surface,深色下 #0a0a0a vs #18181b),
  //        其中商品圖底(.pcard-img-wrap / .pd-bs-mcard-img)還牽涉「白底商品照需要白底襯」
  //        ⇒ 這族**沒有機械答案**,列在 STOP 裡等一次真正的決定。
  //
  //    ⚠️ 「深色模式現在走不到」不能當理由:`data-theme` 目前全樹零產生端(2026-08-09 實測),
  //    但那是**時點觀察、不是恆真** —— CSS 已經寫好了,顯然是為將來準備的。
  //    這條豁免的失效條件 = 有人接上 data-theme 產生端;那天要回來逐條複驗,而不是沿用本註解。
  '#ffffff': {
    why: '底色不隨主題翻的白字必須保持字面(--c-text-inverse 在深色是 #0a0a0a、字會消失);真反相配對那 7 處已改',
    files: null,
  },
  // 漸層停點:同一條 gradient 的兄弟停點是 `rgba(32,34,37,.x)`,而 rgba() 吃不進 CSS 變數
  // (除非另立 `--x-rgb` 三元組)。只把其中一個停點換成 var() 會讓同一條漸層一半吃 token、
  // 一半寫死 —— token 一改就裂成兩個灰。**整條保持字面才是正確的。**
  // 🔴 只在這兩支檔成立;`home.css` 的同色是單純背景、已改吃 token,再出現就是回歸。
  '#202225': {
    why: '僅存於漸層停點,兄弟停點是 rgba() 吃不進變數 ⇒ 整條保持字面才一致',
    files: ['brand-page.css', 'brand-directory.css'],
  },
};

describe('顏色 token 靜掃(寫死的色若已有同值 token 就該引用)', () => {
  it('🔴 前提 — token 表讀得到、而且不是空的', () => {
    const t = tokenTable();
    expect(t.size, 'tokens.css 解析不到任何 `--x: #hex` ⇒ 下面整組掃描會恆綠').toBeGreaterThan(10);
  });

  it('🔴 沒有「未經判定」的裸用色(新的一律要先在 ALLOW 裡說明理由)', () => {
    const unexplained = scanBareHardcodes().filter((h) => {
      const rule = ALLOW[h.color];
      if (!rule) return true;
      return rule.files !== null && !rule.files.includes(h.file); // 豁免不及於未列名的檔
    });
    const detail = unexplained
      .slice(0, 12)
      .map((h) => `${h.file}:${h.line} ${h.color} == ${h.tokens.join('/')}`)
      .join('; ');
    expect(
      unexplained.map((h) => `${h.file}:${h.line} ${h.color}`),
      `有 ${unexplained.length} 處寫死的色已經有同值 token 卻沒引用(改用 var(--token) 或在 ALLOW 說明為何刻意不用):${detail}`,
    ).toEqual([]);
  });

  it('🔴 ALLOW 每一條都要有理由字串(防止有人只加 key 讓測試變綠)', () => {
    for (const [color, rule] of Object.entries(ALLOW)) {
      expect(rule.why.length, `${color} 的豁免理由是空的 ⇒ 那不是判定,是消音`).toBeGreaterThan(15);
      // `files: []` 等於「豁免誰都不及」= 寫了跟沒寫一樣,多半是手滑
      expect(rule.files === null || rule.files.length > 0, `${color} 的 files 是空陣列 ⇒ 豁免不及於任何檔,寫它沒有意義`).toBe(true);
    }
  });

  // 🔴 反面:ALLOW 不得無限膨脹。它每長一條就代表站台多一個「刻意不吃 token」的色,
  //    那是要被看見的事;數量一大就該回頭問「色票是不是該擴充」而不是繼續豁免。
  it('🔴 ALLOW 條目數不得超過 4(超過代表該重新檢討色票而不是繼續豁免)', () => {
    expect(Object.keys(ALLOW).length).toBeLessThanOrEqual(4);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2026-08-09 Q4=B 的**反方向**守門 —— 這條比上面那組更重要。
//
// 上面那組擋的是「該吃 token 卻寫死」。這條擋的是**過度熱心**:
// 有人(包括未來的我)看到 STOP 寫「69 處只改了 7 處」,順手把剩下 62 處也改成
// `var(--c-text-inverse)` —— 淺色模式下**像素完全相同、全站測試全綠、肉眼零差異**,
// 而深色模式一上線,紅底按鈕、graphite 頁尾、照片疊字的白字**全部變成 #0a0a0a 消失**。
//
// 🔴 這是「改動當下零症狀、症狀延到另一個條件才出現」那一族,
//    純靠 code review 看不出來(每一行單看都完全合理)。所以要用機制釘住。
//
// 不變量:`color: var(--c-text-inverse)` 只有在同一條規則的底色是 `var(--c-text)` 時才成立
//        —— 那是 token 表裡**唯一**與它成對翻轉的顏色。
// ───────────────────────────────────────────────────────────────────────────
describe('深色模式安全性 · --c-text-inverse 只能配 --c-text 底', () => {
  /** 掃出所有 `color: var(--c-text-inverse)` 的位置,連同所屬規則的底色宣告。 */
  function inverseUsages(): { file: string; line: number; sel: string; bg: string | null }[] {
    const out: { file: string; line: number; sel: string; bg: string | null }[] = [];
    for (const f of readdirSync(DIR).filter((n) => n.endsWith('.css') && n !== 'tokens.css')) {
      const raw = readFileSync(join(DIR, f), 'utf8');
      const src = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        if (!/color:\s*var\(\s*--c-text-inverse\s*\)/.test(line)) return;
        let start = i;
        while (start >= 0 && !lines[start]!.includes('{')) start -= 1;
        let end = i;
        while (end < lines.length && !lines[end]!.includes('}')) end += 1;
        const body = lines.slice(start, end + 1).join(' ');
        const sel = lines[start]!.slice(0, lines[start]!.indexOf('{')).trim();
        const bg = body.match(/(?:^|[;{\s])background(?:-color)?\s*:\s*([^;}]+)/)?.[1]?.trim() ?? null;
        out.push({ file: f, line: i + 1, sel, bg });
      });
    }
    return out;
  }

  it('🔴 前提 — 真的掃得到 `--c-text-inverse` 的用例(掃不到 = 下面那條恆綠)', () => {
    expect(
      inverseUsages().length,
      '全站找不到任何 `color: var(--c-text-inverse)` ⇒ 下面的不變量沒有對象、恆真',
    ).toBeGreaterThan(0);
  });

  /**
   * 底色來自父層、自己那條規則沒宣告 background 的用例。
   *
   * 🔴 這不是豁免清單,是**把驗證轉嫁到具名父層**:下一條會去讀父層的 background、
   *    確認它真的是 `var(--c-text)`。父層底色哪天被改成紅底/graphite,這裡照樣紅。
   *    (單純把它們跳過 = 靠註解放行,那就是「守門只檢查存在、沒檢查效果」那一族。)
   */
  const INHERITS_BG: Readonly<Record<string, { parent: string; why: string }>> = {
    'product-page.css:.pd-install-cta-title': {
      parent: '.pd-install-cta',
      why: '安裝 CTA 深色滿版條的標題,底色由 .pd-install-cta 提供',
    },
    'product-page.css:.pd-install-cta-desc': {
      parent: '.pd-install-cta',
      why: '同上,說明行',
    },
  };

  it('🔴 每一處 `--c-text-inverse` 的底色都必須是 `var(--c-text)`(唯一與它成對翻轉的顏色)', () => {
    const bad = inverseUsages().filter((u) => {
      if (u.bg) return !/var\(\s*--c-text\s*[),]/.test(u.bg);
      return !INHERITS_BG[`${u.file}:${u.sel}`]; // 沒自己的底色、也沒登記父層 ⇒ 判不了 ⇒ 算違規
    });
    expect(
      bad.map((u) => `${u.file}:${u.line} [${u.sel}] 底色=${u.bg ?? '(該規則沒宣告 background、也沒登記父層)'}`),
      '這些地方把白字換成了 --c-text-inverse,但底色不會跟著主題翻 ⇒ ' +
        '深色模式上線那天,字會變成 #0a0a0a 蓋在不變的深底上 = 直接消失。' +
        '淺色模式下這個錯誤**像素完全相同、看不出來**。' +
        '固定底(--c-red / --c-graphite / 照片疊字)上的白字請保持字面 `#fff`(tokens.css:102 已立字)。' +
        '若底色真的來自父層,請登記進 INHERITS_BG 指名那個父層 —— 下一條會去驗父層的底色,' +
        '不是讓你寫一行註解就放行。',
    ).toEqual([]);
  });

  it('🔴 INHERITS_BG 登記的父層,底色必須真的是 `var(--c-text)`(轉嫁不是免驗)', () => {
    for (const [key, rule] of Object.entries(INHERITS_BG)) {
      const [file, sel] = key.split(':');
      const raw = readFileSync(resolve(DIR, file!), 'utf8');
      const src = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
      const at = src.indexOf(`${rule.parent} {`);
      expect(at, `${key}:登記的父層 ${rule.parent} 在 ${file} 裡找不到 ⇒ 轉嫁對象不存在,這條登記是空的`).toBeGreaterThan(-1);
      const body = src.slice(src.indexOf('{', at) + 1, src.indexOf('}', at));
      const bg = body.match(/(?:^|[;{\s])background(?:-color)?\s*:\s*([^;}]+)/)?.[1]?.trim() ?? null;
      expect(
        bg ?? '(父層也沒宣告 background)',
        `${key} 的字色是 --c-text-inverse、底色轉嫁給 ${rule.parent}(${rule.why}),` +
          `但那個父層的底色是 ${bg ?? '(沒宣告)'}、不是 var(--c-text) ⇒ 深色模式下字會消失`,
      ).toMatch(/var\(\s*--c-text\s*[),]/);
    }
  });

  // 🔴 正方向 —— **這條在守我自己這一片改的東西**。
  //    `#ffffff` 在 ALLOW 裡是 `files: null` 全站豁免(多 token 歧義),所以把本片改好的 7 處
  //    改回 `color: #fff`,上面那組掃描**照樣全綠** = 我剛修的東西沒有守門
  //    (`#202225` 那次已經被同一個形狀咬過一次,ALLOW 的註解裡就寫著)。
  //    ⇒ 用「底色是 var(--c-text) 就必須配 --c-text-inverse」把這 7 處單獨釘住:
  //      這個配對是客觀的(token 表裡唯一的反相對),不是語意選擇,所以釘得起來。
  it('🔴 底色是 `var(--c-text)` 的規則,字色不得寫死 `#fff`(必須用 --c-text-inverse)', () => {
    const bad: string[] = [];
    for (const f of readdirSync(DIR).filter((n) => n.endsWith('.css') && n !== 'tokens.css')) {
      const raw = readFileSync(join(DIR, f), 'utf8');
      const src = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        if (!/(?:^|[;{\s])background(?:-color)?\s*:\s*var\(\s*--c-text\s*[),]/.test(line)) return;
        let start = i;
        while (start >= 0 && !lines[start]!.includes('{')) start -= 1;
        let end = i;
        while (end < lines.length && !lines[end]!.includes('}')) end += 1;
        const body = lines.slice(start, end + 1).join(' ');
        const m = body.match(/(?:^|[;{\s])color\s*:\s*(#[0-9a-fA-F]{3,8})/);
        if (m && normalize(m[1] ?? '') === '#ffffff') {
          bad.push(`${f}:${i + 1} [${lines[start]!.slice(0, lines[start]!.indexOf('{')).trim()}]`);
        }
      });
    }
    expect(
      bad,
      '這些規則的底色是 `var(--c-text)`(會隨主題翻:淺 #121214 / 深 #fafafa),' +
        '字色卻寫死 `#fff` ⇒ 深色模式上線那天會變成白底白字。' +
        '這是 token 表裡**唯一**的反相配對,答案是客觀的:改用 `var(--c-text-inverse)`。' +
        '(2026-08-09 Q4=B 已把當時的 7 處全部改過,這條是防止它們被改回去。)',
    ).toEqual([]);
  });

  it('前提 — `--c-text-inverse` 在深色模式真的被覆寫成深色(它若不再翻,上面整組就該重估)', () => {
    // 🔴 必須先剝註解:tokens.css 的**註解裡**就出現過 `[data-theme="dark"]`(:36),
    //    第一版直接 indexOf 命中那則註解 ⇒ 切出來的片段從檔頭開始 ⇒ 抓到亮色的
    //    `--c-text-inverse: #ffffff`,斷言當場自打嘴巴。字串出現 ≠ 那是規則。
    const tokens = readFileSync(resolve(DIR, 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const at = tokens.indexOf('[data-theme="dark"]');
    expect(at, 'tokens.css 剝掉註解後找不到 [data-theme="dark"] 規則 ⇒ 深色模式段沒了、上面整組要重估').toBeGreaterThan(-1);
    const m = tokens.slice(at).match(/--c-text-inverse:\s*(#[0-9a-fA-F]{3,8})/);
    expect(m, '深色模式段不再覆寫 --c-text-inverse ⇒ 「換 token 會讓白字消失」這個前提沒了、上面整組要重估').toBeTruthy();
    expect(
      normalize(m?.[1] ?? ''),
      `深色模式的 --c-text-inverse 是 ${m?.[1]}、不再是深色 ⇒ 同上,前提已變`,
    ).not.toBe('#ffffff');
  });
});
