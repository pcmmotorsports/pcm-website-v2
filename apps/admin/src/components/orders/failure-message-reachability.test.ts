// failure-message-reachability.test.ts —— **失敗訊息住在會被沖掉的摺疊區裡** 這一族的機制守門。
//
// 🔴 為什麼是機制不是規則(機制優先律):這個病 2026-08-21 在真瀏覽器裡才被撞到,而當時
//    **該路徑上已經有一支綠著的測試**(`note-compose-form.test.tsx [6]`「失敗 state:訊息顯示」)。
//    它綠著,是因為 **jsdom 的 `textContent` 讀得到收合 `<details>` 裡的字** ⇒ **量得到 ≠ 看得到**。
//    ⇒ 寫一條「走查時要看失敗訊息」的規則救不了下一個人;掛一道會紅的閘才救得了。
//
// 病的形狀(**受控** vs **非受控**,差別就是全部):
//   受控   `<details open={…}>`  React 每次 re-render 都會【主動把 open 設回 false】
//                                ⇒ 員工手動展開的狀態被沖掉 ⇒ 失敗訊息跟著消失   ← 病
//   非受控 `<details>`           React 從來不碰 open ⇒ 員工展開了就一直開著        ← 沒事
//
// 🔴 本閘刻意**只**看受控的那一種。把非受控的也算進來會多報,而多報的代價不是白工:
//    照著去「補 open={… || failed}」會**親手把沒事的表單變成受控** ⇒ 製造這個病。
//    (2026-08-21 我第一版就多報了兩支,理由是量了「同檔共存」拿去答「包含」。)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return tsxFiles(p);
    return name.endsWith('.tsx') && !name.includes('.test.') ? [p] : [];
  });
}

/** 一支檔裡每一個**受控** `<details open={…}>` 區塊:回傳它的 open 運算式與區塊內容。 */
function controlledDetails(src: string): { openExpr: string; body: string }[] {
  const out: { openExpr: string; body: string }[] = [];
  const re = /<details\b[^>]*?\sopen=\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    // 從 `open={` 之後開始數大括號,取出完整的 open 運算式(裡面可能有三元、`||`、巢狀物件)。
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') depth -= 1;
      i += 1;
    }
    const openExpr = src.slice(m.index + m[0].length, i - 1);
    const close = src.indexOf('</details>', i);
    out.push({ openExpr, body: close === -1 ? src.slice(i) : src.slice(i, close) });
  }
  return out;
}

const FILES = tsxFiles(ROOT);
const CONTROLLED = FILES.flatMap((f) =>
  controlledDetails(readFileSync(f, 'utf8')).map((d) => ({ file: f, ...d })),
);

describe('失敗訊息不得被關進會自己收合的摺疊區', () => {
  // 🔴🔴 **前提自斷言,而它是本檔最重要的一格**:掃描器如果指錯目錄、正則失效、或
  //    `<details open={` 的寫法換了,下面那格會變成**空迴圈 = 恆真**,而它印出來的是綠。
  //    這一格讓「掃到 0 個」與「掃過而沒事」分得開。
  //    (母題 `docs/patterns/guard-and-instrument-traps.md`:掃錯地方一樣得到一個乾淨的零。)
  it('🔴 前提:掃描器真的掃得到受控 <details>(否則下面那格是空迴圈)', () => {
    expect(FILES.length).toBeGreaterThan(20);
    expect(CONTROLLED.length).toBeGreaterThan(0);
  });

  it('🔴 受控 <details> 裡若有 role="alert",它的 open 運算式必須看得懂失敗態', () => {
    const offenders = CONTROLLED.filter(
      (d) => /role=['"]alert['"]/.test(d.body) && !/failed|error|Error/.test(d.openExpr),
    ).map((d) => `${d.file.replace(ROOT, '')}  open={${d.openExpr.trim().slice(0, 60)}…}`);
    // 失敗時把檔名印出來 —— 一個只說「有 N 個」的閘,紅了也沒有人知道要去改哪裡。
    expect(offenders, `這些受控摺疊區把失敗訊息關在裡面:\n${offenders.join('\n')}`).toEqual([]);
  });
});
