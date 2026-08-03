import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

// composition-tappay-wiring.test.ts — 結構守門(M-3 RW2b;對照組 =
// apps/storefront/src/lib/payment/composition-tappay-wiring.test.ts)
//
// 🔴 值比對證不了 composition 有用那個模組:有人把 admin 改回 inline URL 字面、或在 admin 自己
// 複製一份 endpoints,composition.test.ts 的端點格照綠(它比的是「傳進建構子的值」,而那份
// 複製品的值一開始也會是對的 —— 直到有人對調 sandbox/production)。本檔直接觀察源碼。
// `packages/adapters/src/tappay/endpoints.ts:14-15` 逐字把「admin 的同款守門」列為 RW2b 交付項。
//
// 🔴 **本檔的守備範圍,講清楚**(關卡2 codex C9/C10/C11/C12;memory
// `feedback_control-named-beyond-its-actual-power`):source-text 掃描擋得住的是**無意的**第二條
// 接線 —— 複製貼上、順手 import、「我只是先寫個 quick fix」。它擋不住刻意規避:字串拼接
// (`'Tap'+'PayChargeAdapter'`)、computed property、把 wrapper 藏進 `packages/` 再 import 進來。
// 那類情境的承重點是 code review 與「composition 是唯一取得管道」的慣例,不是本檔。
// 對「這幾格到底攔得住什麼」的唯一誠實說法:攔回歸,不攔對手。

const ADMIN_SRC = path.join(__dirname, '..', '..');
const ADMIN_ROOT = path.join(ADMIN_SRC, '..');
const COMPOSITION = path.join(__dirname, 'composition.ts');

/**
 * 只剝**整行** `//` 註解(錨在行首 ⇒ 行內的 `https://…` 不受影響)。
 * 🔴 刻意**不**剝 `/* *\/` 區塊:字串裡合法出現的 `"/*"` 與 `"*\/"` 會讓那種 regex 把中間的
 * 真程式碼一起吃掉(關卡2 codex C8)—— 守門自己被喂了假輸入,比沒守門更糟。
 */
function stripLineComments(src: string): string {
  return src.replace(/^\s*\/\/.*$/gm, '');
}

/**
 * admin src 底下所有原始碼檔(js/ts/jsx/tsx/mjs/cjs)。
 * 🔴 **不**用「排除所有 `*.test.*`」當豁免(關卡2 codex R2-2):那樣的話,把 TapPay wrapper 取名
 * `foo.test.ts` 再從 production 檔 import 就整個消失在掃描外。豁免清單改成**列舉本目錄的兩支
 * 自家測試檔**(它們本來就必須提到這些識別字),其餘一律納入 —— 含其他 `*.test.ts`。
 */
function listSourceFiles(root: string): string[] {
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((rel) => /\.(m|c)?[jt]sx?$/.test(rel))
    .map((rel) => path.join(root, rel));
}

/**
 * `apps/admin` 根層的**設定檔**(`next.config.ts` / `vercel.json` / `postcss.config.mjs` …)。
 * 🔴 掃描根停在 `src/` 就等於宣稱「admin 全樹」卻看不見這些檔(Fable R3 N2)。
 * 刻意用**非遞迴** readdir:遞迴走 `apps/admin` 會一路爬進 `node_modules`/`.next`(數萬檔、無意義)。
 */
function listAdminRootConfigs(): string[] {
  return readdirSync(ADMIN_ROOT, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.((m|c)?[jt]sx?|json)$/.test(e.name))
    .map((e) => path.join(ADMIN_ROOT, e.name));
}

const SELF_EXEMPT = new Set([
  COMPOSITION,
  path.join(__dirname, 'composition.test.ts'),
  path.join(__dirname, 'composition-tappay-wiring.test.ts'),
]);

describe('admin composition ↔ tapPayUrlsFor 接線(防 inline 回歸)', () => {
  const src = readFileSync(COMPOSITION, 'utf8');
  // 🔴 斷言一律看剝過註解的版本:不剝的話,把正牌 import 寫進註解、實際 import 本地複本,
  //    來源那格照綠(關卡2 codex C13)。
  const code = stripLineComments(src);

  it('🔴 含展開注入、零 tappaysdk 端點字面、tapPayUrlsFor 來源 = @pcm/adapters/server', () => {
    expect(code).toMatch(/\.\.\.tapPayUrlsFor\(env\)/);
    expect(code).not.toMatch(/tappaysdk\.com/i);
    // 🔴 **改數「import 行」而不是 regex 撞字串**(關卡2 codex R2-3):`toMatch` 只要「某處出現」,
    // 行尾註解或區塊註解裡放一行正牌 import 當幌子、實際 import 本地複本,就照樣綠。
    // 數量 === 1 + 那一行的來源 = 唯一綁定點:幌子會讓數量變 2、換來源會讓第二條斷言紅。
    const tapPayUrlImports = code
      .split('\n')
      .filter((line) => /^import\b/.test(line) && /\btapPayUrlsFor\b/.test(line));
    expect(tapPayUrlImports).toHaveLength(1);
    expect(tapPayUrlImports[0]).toMatch(/from '@pcm\/adapters\/server';$/);
  });

  it('🔴 composition 的 import 來源恰為兩個(server-only + @pcm/adapters/server)', () => {
    // 🔴 上面那格是**行**層級的,擋不住把兩個 import 擠在同一行(Fable R3 N3):
    //    `import {tapPayUrlsFor} from './copy'; import {X} from '@pcm/adapters/server';`
    //    這一行照樣「以 import 開頭、含 tapPayUrlsFor、以正牌來源結尾」。
    // 改數**模組來源集合**就與行的排版無關:任何本地複本(相對路徑或 `@/lib/payment/...` 別名)
    //    都會讓集合多出第三個元素 —— 這格一次封掉整族「自建第二份正確值」的繞法。
    const specifiers = new Set<string>(
      [
        ...[...code.matchAll(/\bfrom\s+'([^']+)'/g)],
        ...[...code.matchAll(/^\s*import\s+'([^']+)'/gm)],
      ].map((m) => m[1] ?? ''),
    );
    expect([...specifiers].sort()).toEqual(['@pcm/adapters/server', 'server-only']);
  });

  it('🔴🔴 env 一律動態 `process.env[name]` 讀、零靜態 `process.env.X`', () => {
    // 這格守的是「守門量的東西 = 它要保護的東西」(關卡2 codex C1):
    // 靜態 `process.env.NEXT_PUBLIC_SUPABASE_URL` 會被 Next 在 build 時內聯成字面,
    // 而真正決定帳本去處的 `createSupabaseServiceClient()` 是動態讀(runtime 值)
    // ⇒ 一旦分岔,配對斷言比對的是舊值、錢寫進的是新庫,而**單元測試看不到 build-time 內聯**
    //    (vitest 只改 runtime env)⇒ 只能靠本結構斷言頂住。
    expect(code).toMatch(/const value = process\.env\[name\];/);
    expect(code).not.toMatch(/process\.env\.[A-Z]/);
  });

  it('🔴 配對斷言排在建構之前(adapter 建不出來 > 呼叫端記得先驗)', () => {
    const violationAt = code.indexOf('const violation = tapPayEnvPairingViolation(');
    const ctorAt = code.indexOf('new TapPayChargeAdapter(');
    expect(violationAt).toBeGreaterThan(-1);
    expect(ctorAt).toBeGreaterThan(violationAt);
  });
});

describe('admin 受控單檔(composition 以外不得自己接 TapPay)', () => {
  const others = [...listSourceFiles(ADMIN_SRC), ...listAdminRootConfigs()].filter(
    (f) => !SELF_EXEMPT.has(f),
  );

  // 🔴 三格都用「識別字出現與否」而不是某個呼叫寫法:寫法可以換(`import { X as Y }` 後 `new Y()`、
  //    `process.env['TAPPAY_ENV']`、解構 `const { TAPPAY_ENV } = process.env`),識別字換不掉
  //    (code-reviewer R1 MF2/MF3:原本綁 `new TapPayChargeAdapter` 與 `process.env.TAPPAY_` 三種寫法全漏)。
  // 掃描前剝整行註解:註解裡提到 `TapPayChargeAdapter.ts:63` 這種引用是**應該**存在的
  // (page.tsx 的 maxDuration 論證就靠它),把註解當程式碼審會逼人寫得含糊。
  const scan = (re: RegExp) => others.filter((f) => re.test(stripLineComments(readFileSync(f, 'utf8'))));

  it('🔴 全 admin 只有 composition.ts 碰得到 TapPayChargeAdapter', () => {
    expect(scan(/TapPayChargeAdapter/i)).toEqual([]);
  });

  it('🔴 全 admin 只有 composition.ts 出現 TAPPAY_ 字樣(繞過本檔 = 繞過環境配對斷言)', () => {
    // storefront 靠 eslint no-restricted-imports 擋整個 app 直連 @pcm/adapters/server;
    // admin 沒有那條規則(它本來就該用 server subpath)⇒ 用這格頂住同一件事的要害:
    // 誰自己讀 TAPPAY_ENV / PARTNER_KEY,誰就能建出一個沒過配對斷言的 adapter。
    expect(scan(/TAPPAY_/i)).toEqual([]);
  });

  it('🔴 全 admin 零 tappaysdk 端點字面(自己 fetch TapPay = 繞過所有守門)', () => {
    // 大小寫不敏感:`https://PROD.TAPPAYSDK.COM` 對 DNS 完全等效(關卡2 codex C11)。
    expect(scan(/tappaysdk\.com/i)).toEqual([]);
  });
});

describe('退款 route 的函式時限(plan v3.2 §1 RW2b:顯式 ≥45s)', () => {
  it('🔴 訂單明細頁顯式 export maxDuration ≥ 45', () => {
    const page = readFileSync(path.join(ADMIN_SRC, 'app', 'orders', '[id]', 'page.tsx'), 'utf8');
    // ^ 錨在行首:註解掉的 `// export const maxDuration = 60;` 不算數。
    const m = page.match(/^export const maxDuration = (\d+);$/m);
    expect(m).not.toBeNull();
    expect(Number(m?.[1])).toBeGreaterThanOrEqual(45);
  });
});
