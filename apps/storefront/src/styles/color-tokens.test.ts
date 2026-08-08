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
  // `#fff` 同時等於三顆 token ⇒ 選哪顆是語意決定(白字在紅底上是 text-inverse,不是 bg)。
  // 全站 69 處、零視覺差 ⇒ 列為**政策題**等 Sean 拍一次,不在夜裡自行機械替換。
  // 這條與檔案無關(歧義來自 token 表本身)⇒ files: null。
  '#ffffff': {
    why: '對應多顆 token(--c-bg/--c-surface/--c-text-inverse),選哪顆是語意決定 ⇒ 待 Sean 拍政策',
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
