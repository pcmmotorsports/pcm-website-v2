import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from '../test-support/strip-comments';

// csv-single-producer.test.ts —— 掃描式守門:**有人另外開第二份 CSV 實作時,這裡要紅。**
//
// 🔴 為什麼存在:`order-export-page.ts:75` 已經逐字寫著
//    「走片A 的 `toCsv`, 不自己組一份 —— 抄一份的話, BOM / CRLF / 逃脫會有兩個實作」。
//    **那是一段必須被讀到才會生效的字** —— 下一個人在別的目錄新增匯出時不會經過那一行,
//    而**既有的每一支測試都照樣綠**(它們的分母是【已經想到的那幾支】)。
//
// 🔴 後果是靜默的:少了 BOM,Excel 開中文變亂碼,而 **Numbers / VS Code / 我們的測試全都正常**
//    ⇒ 只有 Windows 上的員工看得到,而他會以為是資料壞了,不會以為是匯出壞了。
//
// 🛑 **兩條規則,分母強度不一樣 —— 刻意分開,不要當成一條:**
//
//  規則一「碰 CSV 的檔要具名 import」:分母 = 檔案裡出現 `text/csv` 或 `.csv` 字面。
//    ⚠️ **這個分母是弱的,而弱在哪我量過了**:今天被它強制到的只有 `order-export-page.ts` 一支,
//      而它進分母的理由是 `:102` 一個【檔名模板】,不是它在組 CSV —— 真正組 CSV 的
//      `buildOrderPageCsv` 兩個字面一個都沒有。⇒ **把檔名 helper 搬去別檔(完全正常的重構),
//      它就掉出分母,而這條規則會變成零強制。**(code-reviewer 2026-08-30 實測)
//    🔴 **而【零訊號】那半要加限定(R3 F2 親驗)**:helper 搬進**新檔** ⇒ 新檔帶 `.csv` 字面
//      而它 import 的名字不在下面那份名單裡 ⇒ **規則一會紅,只是紅在錯的檔上**;
//      只有搬進 `order-export.ts`(白名單內)才是真的零訊號。
//      📌 **兩個分支裡「組 CSV 那支失去強制」都是無聲的 —— 差別只在有沒有一個指錯地方的紅。**
//
//  規則二「CSV 組裝實作只准有一份」:分母 = `apps/` + `packages/` 每一支非測試 `.ts/.tsx`。
//    ⚠️ **它【也】靠字面,只是靠得比較少** —— 兩個拼法(BOM 字面 AND CRLF 字面)要同時出現。
//      ~~早先這裡寫「不靠任何字面巧合」,那是假的~~(R2 must-fix 2)。
//      分離裕度只有**一個 predicate**:實量射程內(`apps/` + `packages/`)非測試檔有 **6 支**
//      帶其中之一、**零支同時帶兩個**(`order-export.ts` 除外)。
//      ⚠️ ~~早先寫 5 支~~ 是擴到 `packages/` 之前的口徑(R3 F4)——
//      📌 **裕度盤點要跟射程【同一輪】重數,否則它會安靜地變成上一個射程的數字。**
//
// 🛑 **共同的射程限制(寫實際做到的,不寫想做到的)**:
//    · 掃 `apps/` **與 `packages/`**。🔴 `packages/` 是 R2 補的 —— **漏掉它是最貴的假陰**:
//      把 `toCsv` 抄進 `packages/ui`(想「共用」的人第一個會去的地方)原本兩條規則都看不到。
//    · `scripts/d1-export.ts` / `d1-restore.ts` **刻意在射程外**:那是 psql `\copy` 的
//      機器對機器備份,**加 BOM 會讓還原壞掉**(BOM 會被讀成第一個欄名)⇒ 它們的正確狀態
//      就是沒有 BOM。**一條看起來全域正確的規則,例外住在一條沒有人在跑的路上。**
//    · 🔴 **已知假陰(寫出來,不假裝沒有)**:一支檔 `import { CSV_BOM }` 之後自己
//      `.join('\r\n')` 重寫逃脫 ⇒ **有 CRLF 沒 BOM 字面 ⇒ 規則二綠**,而那正是 `:75` 在防的事。
//      規則一在它有 `.csv` 字面時接得住,沒有字面就接不住。**這一格目前沒有機制。**
//    · ⚠️ **未來「讀」CSV 的功能(供應商匯入,runbook 已存在)會假紅** —— 它帶 `.csv` 字面
//      而不需要 `toCsv`。**讀不是產** ⇒ 那時要加白名單並寫明理由,不要放寬規則一(R3 F5)。
//    · 🔴 **所有已知的偏差都往【紅】的方向倒**(所以不修):`await import()`、`.js` 後綴、
//      走 barrel `from '@/lib/orders'` ⇒ 都判違規 = 假紅。**假紅會叫,假綠不會。**
const ROOT = path.resolve(__dirname, '../../../../..');
const SCAN_ROOTS = ['apps', 'packages'] as const;

/** 白名單:每一條【各自附理由與退場條件】。
 *  🔴 **它【只】作用於規則一** —— 規則二不讀它(R3 F1)。
 *  規則二紅的人若照字面把自己加進來,會發現**還是紅**,而下一步通常是 skip 整支。 */
const ALLOWED: Record<string, string> = {
  'apps/admin/src/lib/orders/order-export.ts':
    '它【就是】那唯一實作 —— `CSV_BOM` 與 `toCsv` 定義在這裡。規則二會反過來斷言它【必須】是唯一那一支。',
  'apps/admin/src/components/orders/order-export-button.tsx':
    '它只把 server 端組好的字串交給瀏覽器存檔,自己不組 CSV(`csv: string` 是 prop)。' +
    '⇒ 退場條件已機械化:下面有一格斷言它【一個 `.join(` 都沒有】(今天實量 0 個),它哪天開始拼字串就會紅。',
};

const THE_ONLY_IMPLEMENTATION = 'apps/admin/src/lib/orders/order-export.ts';

/** 這支檔在講 CSV 檔案嗎(規則一的分母) */
export function mentionsCsv(src: string): boolean {
  return /text\/csv/.test(src) || /\.csv['"`]/.test(src);
}

/** 有沒有【具名 import】到組裝函式 —— `import type` 不算,註解不算 */
export function namedImportOfExporter(src: string): boolean {
  const m = src.match(/(?:^|\n)\s*import\s+(type\s+)?\{([^}]*)\}\s*from\s*['"][^'"]*order-export['"]/);
  if (!m || m[1]) return false;
  return /\b(toCsv|buildOrderExportCsv|buildOrderPageCsv|CSV_BOM)\b/.test(m[2] ?? '');
}

/** 這支檔自己在【組】CSV 嗎:BOM 字面 + CRLF 字面同時出現 = 抄了一份 `toCsv` 的形狀。
 *  ⚠️ 只有 BOM 不算 —— `tier-form.ts` / `wallet-form.ts` / `product-listing-form.ts`
 *     都含 BOM 字面,而它們是 note 欄位的**零寬字驗證**,不是 CSV。
 *  🔴 而這個 AND 今天成立的理由要寫清楚:**那三支剛好沒有做換行正規化**。
 *     哪天有人加一句 `note.replace(/\r\n/g, '\n')` ⇒ **假紅**(會叫,方向是安全的)。 */
export function isCsvImplementation(src: string): boolean {
  const hasBom = /﻿/.test(src) || /\\u\{?[fF][eE][fF][fF]\}?/.test(src) || /fromCharCode\(\s*0x[fF][eE][fF][fF]/.test(src);
  return hasBom && /\\r\\n/.test(src);
}

/** 只下載、不組裝 —— 認【任何】`.join(`,不認分隔字元的寫法(`join(SEP)` / 反引號都跑不掉) */
export function buildsStringsByJoining(src: string): boolean {
  return /\.join\(/.test(src);
}

/** 🔴 兩條規則都走這一個函式 ⇒ 真實檔與合成突變**餵同一支尺**。
 *  ⚠️ 而它綁的是 **predicate**,不是 `walk` —— `walk` 由下面「走訪自檢」那兩格單獨守(R2 must-fix 4)。 */
export function findViolations(files: readonly { rel: string; src: string }[]): {
  missingImport: string[];
  extraImplementation: string[];
} {
  const clean = files.map((f) => ({ rel: f.rel, src: stripComments(f.src) }));
  return {
    missingImport: clean
      .filter((f) => !(f.rel in ALLOWED) && mentionsCsv(f.src) && !namedImportOfExporter(f.src))
      .map((f) => f.rel),
    extraImplementation: clean
      .filter((f) => f.rel !== THE_ONLY_IMPLEMENTATION && isCsvImplementation(f.src))
      .map((f) => f.rel),
  };
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '.turbo', 'dist', 'coverage'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) out.push(p);
  }
  return out;
}

describe('CSV 只准有一個實作', () => {
  const real = SCAN_ROOTS.flatMap((r) => walk(path.join(ROOT, r))).map((p) => ({
    rel: path.relative(ROOT, p),
    src: readFileSync(p, 'utf8'),
  }));
  const found = findViolations(real);

  // 🔴 走訪自檢 —— 這兩格是 `walk` 唯一的守門(合成 mutant 繞過 walk,綁不到它)。
  it('走訪自檢:三個根都要有檔進來(只比總數的話,半個 app 掉出去也會綠)', () => {
    for (const prefix of ['apps/admin/', 'apps/storefront/', 'packages/']) {
      expect(real.filter((f) => f.rel.startsWith(prefix)).length, `${prefix} 一支都沒掃到`).toBeGreaterThan(20);
    }
  });

  it('走訪自檢:那支唯一實作本人要在走訪結果裡(路徑搬家會讓整支尺空轉)', () => {
    expect(real.map((f) => f.rel)).toContain(THE_ONLY_IMPLEMENTATION);
  });

  it('白名單每一條都還指得到真的檔(白名單爛掉是無聲的)', () => {
    const missing = Object.keys(ALLOWED).filter((rel) => !real.some((f) => f.rel === rel));
    expect(missing, `白名單指到不存在的檔 ⇒ 它豁免的是空氣:\n${missing.join('\n')}`).toEqual([]);
  });

  it('規則一:碰 CSV 的檔要具名 import 組裝函式', () => {
    expect(
      found.missingImport,
      `這些檔自己碰 CSV 卻沒接上 toCsv ⇒ BOM/CRLF/逃脫會有第二個實作:\n${found.missingImport.join('\n')}`,
    ).toEqual([]);
  });

  it('規則二:全 apps/ + packages/ 只准一支檔自己組 CSV', () => {
    expect(
      found.extraImplementation,
      [
        `這些檔自己組了 CSV(BOM+CRLF 都有)⇒ 第二份實作:`,
        ...found.extraImplementation,
        ``,
        `🛑 白名單對【本規則】無效 —— 加進 ALLOWED 不會讓這一格變綠。`,
        `唯一實作 = ${THE_ONLY_IMPLEMENTATION}`,
        `· 在 apps/ 底下 ⇒ 具名 import 它的 toCsv,不要自己組。`,
        `· 在 packages/ 底下 ⇒ 你 import 不到 apps/admin(workspace 依賴方向不通)。`,
        `  正解是把【正本】搬進 packages,並同步改三處:本檔的 THE_ONLY_IMPLEMENTATION、`,
        `  namedImportOfExporter 的 module 樣式、以及白名單那兩條的路徑。`,
      ].join('\n'),
    ).toEqual([]);
  });

  // 🔴 正對照 —— 餵【同一支 `findViolations`】,與上面兩條規則綁在一起。
  it('正對照:四種違規形狀都要被抓到', () => {
    const mutants = [
      { rel: 'apps/admin/x/comment-only.ts', src: "// 走 order-export 的 toCsv\nconst m = 'text/csv';\n" },
      { rel: 'apps/admin/x/type-only.ts', src: "import type { A } from './order-export';\nconst m = 'text/csv';\n" },
      { rel: 'apps/admin/x/borrowed-name.ts', src: "import { orderExportFilename } from './order-export';\nconst m = 'text/csv';\n" },
      { rel: 'packages/ui/src/copied-impl.ts', src: "const B = '﻿';\nexport const j = (r: string[][]) => B + r.join('\\r\\n');\n" },
    ];
    const bad = findViolations(mutants);
    expect(bad.missingImport).toEqual([
      'apps/admin/x/comment-only.ts',
      'apps/admin/x/type-only.ts',
      'apps/admin/x/borrowed-name.ts',
    ]);
    expect(bad.extraImplementation).toEqual(['packages/ui/src/copied-impl.ts']);
  });

  it('負對照:真的具名 import 的檔不會被誤判', () => {
    const ok = [{ rel: 'apps/admin/x/good.ts', src: "import { toCsv } from '@/lib/orders/order-export';\nconst m = 'text/csv';\n" }];
    expect(findViolations(ok).missingImport).toEqual([]);
  });

  it('按鈕那支必須維持「只下載、不組裝」', () => {
    const btn = stripComments(
      readFileSync(path.join(ROOT, 'apps/admin/src/components/orders/order-export-button.tsx'), 'utf8'),
    );
    expect(buildsStringsByJoining(btn)).toBe(false);
    expect(isCsvImplementation(btn)).toBe(false);
  });

  // 🔴 上面那格今天是「0 個 `.join(`」⇒ 它從來沒有紅過 ⇒ 沒有這一格,它與恆真分不開。
  it('正對照:按鈕那一格的尺,遇到任何 join 寫法都要紅', () => {
    for (const s of ["r.join(SEP)", "r.join(`,`)", "r.join('\\t')", "r.join(',')"]) {
      expect(buildsStringsByJoining(s), s).toBe(true);
    }
    expect(buildsStringsByJoining("const a = 1;")).toBe(false);
  });
});
