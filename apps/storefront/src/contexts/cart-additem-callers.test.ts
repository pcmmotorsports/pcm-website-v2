import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADDITEM_CALLERS_EXEMPT_FROM_DROP } from './cart-additem-callers';

/**
 * `N4` 守門:**每一個 `addItem(` 呼叫點都要接住回傳值**(被上限夾掉幾件)。
 *
 * 🔴 判別句(78 給的):**這道守門在「有人加了第四個呼叫端而沒接」的那一天,會不會紅?**
 *   ⇒ 會。分母是這支測試**自己走檔案樹數出來的**,不是誰在測試裡列的清單
 *     ⇒ 新檔案一出現就自動進分母,沒有人需要記得來更新它。
 *
 * ⚠️ **已知限度(寫在這裡,不要讀成沒有限度)**:
 *   ① 判「是不是註解」只看該行**開頭**是不是 `//` / `*` / `/*`。
 *      行尾註解裡寫 `addItem(` 會被算成呼叫點 ⇒ **測試變紅**。
 *      🔴 這是**刻意挑的失敗方向**:誤擋會吵、會被人看到;漏擋是安靜的。
 *   ② 判「有沒有接住」只看**同一行**有沒有 `= addItem(` / `return addItem(`。
 *      把回傳值繞一大圈才用到的寫法會被誤判成沒接 ⇒ 一樣是**紅**、一樣會被看到。
 */

const SRC = join(__dirname, '..');
const APP_ROOT = join(__dirname, '..', '..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
      continue;
    }
    if (!/\.tsx?$/.test(name)) continue;
    if (/\.test\.tsx?$/.test(name)) continue;
    out.push(full);
  }
  return out;
}

type CallSite = { file: string; where: string; line: string; captured: boolean };

function findCallSites(): CallSite[] {
  const sites: CallSite[] = [];
  for (const file of walk(SRC)) {
    // 定義檔本身不算呼叫點(介面宣告 + 實作 + provider value 都在裡面)。
    if (file.endsWith(join('contexts', 'CartContext.tsx'))) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!line.includes('addItem(')) return;
      const t = line.trimStart();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      const rel = relative(APP_ROOT, file);
      sites.push({
        file: rel,
        where: `${rel}:${i + 1}`,
        line: t,
        captured: /(=|return)\s*addItem\(/.test(line),
      });
    });
  }
  return sites;
}

describe('N4 守門:addItem 的回傳值(被上限夾掉幾件)沒有人可以安靜地忽略', () => {
  it('分母不是空的 —— 掃不到任何呼叫點就代表這把尺壞了,不是代表全過', () => {
    // 🔴 沒有這一格,「掃法壞掉」與「全部都接了」會印同一句話(兩個世界同一個綠)。
    expect(findCallSites().length).toBeGreaterThan(0);
  });

  it('每一個呼叫點都接住回傳值,否則必須具名豁免', () => {
    const exempt = new Set(ADDITEM_CALLERS_EXEMPT_FROM_DROP);
    const offenders = findCallSites()
      .filter((s) => !s.captured)
      .filter((s) => !exempt.has(s.file))
      .map((s) => `${s.where}\n    ${s.line}`);
    expect(
      offenders,
      [
        '有 addItem( 呼叫點沒有接住回傳值(= 被上限夾掉幾件)。',
        '車上已滿時它一件都沒進去,而畫面若照樣說「已加入」就是一句斷言它沒有造成的事。',
        '修法:const dropped = addItem({...}) 再照 dropped 決定顯示什麼;',
        '真的不需要那個數字 ⇒ 具名寫進 contexts/cart-additem-callers.ts 並附理由。',
      ].join('\n'),
    ).toEqual([]);
  });

  it('豁免名單裡不留死條目 —— 指到不存在的檔或其實已經接住的檔都要清掉', () => {
    // 過期的豁免會讓下一個人以為那支檔「被審過而決定不接」,而它可能早就接了。
    const sites = findCallSites();
    const stale = ADDITEM_CALLERS_EXEMPT_FROM_DROP.filter(
      (f) => !sites.some((s) => s.file === f && !s.captured),
    );
    expect(stale).toEqual([]);
  });
});
