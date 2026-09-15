// @vitest-environment node
//
// card-image-placeholder-sql-parity.test.ts — 「卡片沒有真圖」的 SQL 版與 TS 版要是【同一份規則】(2026-09-15)。
//
// 目錄列表的「無圖排最後」(Sean Q9 甲)在 DB 端判斷:`public.pcm_card_image_is_placeholder(text)`
// (migration 20260916120000)。畫面換佔位圖在 TS 端判斷:`hasNoRealImage`(`@pcm/domain`)。
// 兩份清單會分岔 ⇒ 本檔讀 migrations 裡 helper 最新那一代的三條 regex,在 JS 裡照 SQL 的算法重算,
// 逐組跟 `hasNoRealImage` 比答案;規則表整串也要跟 `SUPPLIER_PLACEHOLDERS` 生出來的一字不差。
// 🛑 它擋「TS 加了一組、SQL 沒加」與反向;擋不住「兩邊一起寫錯」—— 那一半由 migration 事後閘② 的樣本表擋。

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';
import { SUPPLIER_PLACEHOLDERS, hasNoRealImage } from '@pcm/domain';

const MIGRATIONS = join(__dirname, '../../../../supabase/migrations');

function latestHelperBody(): { file: string; body: string } {
  const opener = /CREATE (?:OR REPLACE )?FUNCTION public\.pcm_card_image_is_placeholder\(/;
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort().reverse();
  for (const file of files) {
    const src = readFileSync(join(MIGRATIONS, file), 'utf8');
    const m = opener.exec(src);
    if (!m) continue;
    const end = src.indexOf('$helper$;', m.index);
    if (end < 0) throw new Error(`${file}:找到 helper 開頭但找不到 $helper$; 結尾`);
    return { file, body: src.slice(m.index, end) };
  }
  throw new Error('migrations 裡找不到 pcm_card_image_is_placeholder');
}

const { file, body } = latestHelperBody();
// 本體:`p_url IS NULL OR p_url ~ '^[[:space:]]*$' OR p_url ~* '<整個網址的 regex>'`
const ruleMatch = /p_url ~\* '((?:[^']|'')*)'/.exec(body);
const sqlRe = ruleMatch ? new RegExp(ruleMatch[1]!.replaceAll("''", "'"), 'i') : null;

function sqlIsPlaceholder(url: string | null): boolean {
  // SQL 端空白判斷是 `~ '^[[:space:]]*$'`(ASCII 空白);TS 的 trim() 還會剝 NBSP 等 unicode 空白 ⇒ 樣本只放 ASCII 空白(已知差異,只影響排序位置)
  if (url === null || /^[ \t\n\r\f\v]*$/.test(url)) return true;
  return sqlRe!.test(url);
}

const esc = (s: string) => s.replaceAll('.', '\\.');

/** 照 migration 的生成規則,從 TS 清單生出應有的 regex(host 依首次出現排序、同 host 的前綴合成一組)。 */
function expectedRegex(): string {
  const byHost = new Map<string, string[]>();
  for (const [h, p] of SUPPLIER_PLACEHOLDERS) {
    byHost.set(h, [...(byHost.get(h) ?? []), `${esc(p)}[^/?#]*`]);
  }
  byHost.set('quote.pcmmotorsports.com', ['no-photo\\.png']);
  const alts = [...byHost.entries()]
    .map(([h, ps]) => `${esc(h)}(?::[^/?#]*)?/(?:[^?#]*/)?(?:${ps.join('|')})`)
    .join('|');
  return `^[A-Za-z][A-Za-z0-9+.-]*://(?:[^@/?#]*@)?(?:${alts})(?:[?#]|$)`;
}

describe(`卡片無真圖:SQL helper(${file})× TS hasNoRealImage`, () => {
  it('抽得到 regex(抽不到 = 本檔的抽取式跟 migration 寫法分岔了)', () => {
    expect(ruleMatch).not.toBeNull();
  });

  it('regex = 由 SUPPLIER_PLACEHOLDERS + PCM 自家 no-photo.png 生出來的,一字不差', () => {
    expect(ruleMatch![1]).toBe(expectedRegex());
  });

  const samples: Array<string | null> = [
    null,
    '',
    '   ',
    '\t\n',
    'not a url',
    'https://quote.pcmmotorsports.com/storage/no-photo.png',
    'https://quote.pcmmotorsports.com/storage/NO-PHOTO.PNG',
    'https://quote.pcmmotorsports.com/storage/no-photo.png.jpg',
    'https://cdn.example.com/no-photo.png',
    'https://www.gbracing.eu:443/templates/x/NO-IMAGE-300x300.jpg?v=1#frag',
    'https://www.gbracing.eu/templates/x/real-part.jpg',
    'https://www.gbracing.eu/no-image-dir/real.jpg',
    'https://user:pw@rpmcarbon.com:8443/cdn/NO-IMAGE-2048.gif',
    'HTTPS://WWW.EXTREME-COMPONENTS.COM/img/noimage.jpg',
    'https://www.gbracing.eu',
    ...SUPPLIER_PLACEHOLDERS.flatMap(([h, p]) => [
      `https://${h}/a/b/${p}xyz.png`,
      `https://${h}/a/b/${p.toUpperCase()}xyz.png`,
      `https://other.${h}/a/b/${p}xyz.png`,
      `https://${h}/a/b/real-${p}`,
    ]),
  ];

  it.each(samples.map((u) => [u]))('同一個答案:%s', (url) => {
    expect(sqlIsPlaceholder(url)).toBe(hasNoRealImage(url));
  });

  it('自檢:少一組規則 ⇒ 會紅', () => {
    const [h, p] = SUPPLIER_PLACEHOLDERS[SUPPLIER_PLACEHOLDERS.length - 1]!;
    const url = `https://${h}/a/${p}1.png`;
    const dropped = new RegExp(ruleMatch![1]!.replace(`|${esc(h)}(?::[^/?#]*)?/(?:[^?#]*/)?(?:${esc(p)}[^/?#]*)`, ''), 'i');
    expect(dropped.test(url)).toBe(false);
    expect(hasNoRealImage(url)).toBe(true);
  });
});
