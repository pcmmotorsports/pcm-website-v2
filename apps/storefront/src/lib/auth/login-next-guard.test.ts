// login-next-guard.test.ts — 🔴 掃描守門:全 storefront 不得再出現「弄丟 next 的登入導航」(#190)
//
// 為什麼是機制不是註解(機制優先律、Sean 2026-07-22):
//   這個 bug 已經發生三輪。第一輪修 account 時在 safe-redirect.ts 寫了一句只提 account 的註解
//   ⇒ 2026-08-21 W11 在正式站量到 /checkout 兩處漏 next。第二輪我把註解寫長,而 W3 當場指出
//   **那一版又只寫了一半**(補了 login、漏了 register)。⇒ 註解正是上一次失效的那個東西。
//   ⇒ ⇒ 改成一格會紅的掃描。**新增一處弄丟 next 的登入導航就過不了,不需要任何人記得讀註解。**
//
// 🔴 分母(明寫,因為「掃錯地方也會得到一個乾淨的零」):
//   apps/storefront/src 底下**全部** .ts/.tsx,不只 app/ —— contexts/FavoritesContext.tsx、
//   components/Header.tsx、RegisterPage.tsx 都在 app/ 之外,而三處都是真的呼叫點。
//   排除 *.test.* / *.spec.*(測試檔裡的字面是斷言目標,不是導航)。
//   🔴 不含 apps/admin —— **理由是量到的不是推的**:`apps/admin/src` 非 test 檔實查【零個】/login 字面,
//   後台登入外包給報價單 SSO、機制不同 ⇒ 那個盲區目前是空的。
//
// 🔴 這格量不到的(誠實邊界,不要當成「已經守住了」):
//   · 只認【行內出現路徑字面】。把路徑存進變數再導、或導航動作寫在別行(多行三元),本格看不到。
//     ⇒ callback/page.tsx 的 redirect 刻意寫成單行,原因寫在那支檔裡。
//   · 只認 storefront。
//   · 不理解「這個 next 是不是指向對的地方」—— 只認「有沒有帶」。

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../..', import.meta.url)); // apps/storefront/src

/**
 * 🔴 **註解要先剝掉,否則分母是【整支檔的全部字元】。**
 * 第一版沒剝,結果紅在 `app/account/page.tsx` / `app/checkout/page.tsx` / `components/RegisterPage.tsx`
 * —— 這三支的**程式碼都已經帶了 next**,命中的是它們描述行為的**註解字面**。
 * ⇒ 那是誤報,而誤報會把人趕出守門的視野(memory `feedback_a-false-positive-reroutes-people-out-of-the-guards-view`)。
 *
 * 🔴 **逐字元掃、會看引號**(codex 關卡2 N3):用 regex 剝 `//` 不理解字串與 template literal,
 *    程式字串裡出現 `//` 時會把同一行後段一起刪掉 ⇒ **後段的裸導航靜靜漏報**。
 *    第一版靠 `[^:]` 擋 `http://` —— 那只是擋住最常見的一種,不是理解引號。
 * 🔴 區塊註解換成**等量空白、保留換行**:直接刪掉會讓剝完的行號與真實行號位移(實測約 2 行)。
 *    現在守門只回檔名 ⇒ 無害,而**日後印行號就會印錯** —— 那種錯不會紅。
 */
function stripComments(src: string): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += src[i + 1] ?? '';
        i += 1;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      out += c;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      i += 1;
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * 引號包住的登入類路徑字面,**含 query**。
 * 🔴 含 query 是 codex 關卡2 MF-3:第一版要求引號緊接在路徑後 ⇒ `'/login?error=oauth'` 不在分母裡,
 *    而那正是 Google / LINE 兩條真缺口的長相 —— **守門看不見它們,所以它們活到今天**。
 * 🔴 含 `/forgot`、`/reset`:**去程那一跳也會把 next 弄丟**(W3 R2 MF-A 實測的三跳動線)。
 */
const LITERAL_RE = /(['"`])(\/(?:login|register)(?:\/(?:forgot|reset))?)(\?[^'"`]*)?\1/g;

/**
 * 🔴 同一行還要有【導航動作】—— 光看路徑字面會撈到「拿它當值用」的地方,那些不是漏 next:
 *   · `lib/seo.ts`  noindex 路徑清單     · `components/MobileTabBar.tsx`  `p === '/login'` 高亮判斷
 * 這兩支是實跑撈出來的誤報。⚠️ 代價寫明:導航動作寫在別行,本格看不到。
 */
// 🔴 `return` 也算導航 sink:LINE callback 的形狀是「算出目的地字串 → 末尾單點 redirect(變數)」
//    (`api/auth/line/callback/route.ts` 的 resolveDestination)⇒ 不含 `return` 的話,
//    **那整支 route 在守門眼裡不存在**(實測:突變它的 error 目的地 ⇒ 守門 0 failed)。
const NAV = /(?:redirect\(|router\.(?:push|replace)\(|href=|location\.href|return\s)/;

/**
 * 一行裡「弄丟 next 的登入導航」有哪些(回 base path,可能多個)。
 *
 * 🔴 **逐【字面】判定,不是逐【行】**(codex 關卡2 N1):第一版是「整行任何位置有 `next=` 就放行」,
 *    ⇒ 三元一邊帶一邊裸時整行綠,而且沒有確認那個 `next=` 屬於哪個導航目的地。
 *    現在:每個字面自己帶 `next=` 才算數;**裸字面只有在同一行存在【同一個 base path 且帶 next=】
 *    的手足時才豁免** —— 那正是 `cond ? '/x?next=…' : '/x'` 這個合法形狀,而它以外的裸值一律算漏。
 */
function offendingPaths(line: string): string[] {
  if (!NAV.test(line)) return [];
  const out: string[] = [];
  for (const m of line.matchAll(LITERAL_RE)) {
    const lit = m[0];
    const base = m[2];
    // 🔴 `noUncheckedIndexedAccess` 之下捕獲群組是 `string | undefined`。**不用 `!` 也不用 `as string`**,
    //    也不 `continue` 靜靜跳過 —— 兩者都會讓「正規式切錯了」變成**本格靜默全綠**,
    //    而這支測試存在的理由正是「切錯的時候要有人知道」。
    if (base === undefined) {
      throw new Error(`LITERAL_RE 第 2 個捕獲群組取不到值(比對到「${lit}」)⇒ 正規式切錯了,本格失去判別力`);
    }
    if (lit.includes('next=')) continue;
    const sibling = new RegExp(`${base.replace(/\//g, '\\/')}\\?[^'"\`]*next=`);
    if (sibling.test(line)) continue;
    out.push(base);
  }
  return out;
}

/**
 * 允許的地方 = **終點流程**:使用者是「被送去登入」而不是「從受保護頁被彈開」,沒有可以回去的 next。
 *
 * 🔴 **key 是 `檔案::路徑`、value 帶【筆數】**(codex 關卡2 N2):第一版豁免整支檔
 * ⇒ 白名單檔日後新增一條來自受保護頁的裸登入,守門完全看不見。帶筆數之後**多一條就會紅**。
 *
 * 🔴🔴 **白名單的理由本身要被驗** —— 第一版把 `ForgotPasswordPage.tsx` 列進來、理由寫
 * 「忘記密碼流程內互跳,無來源頁」。**那句是錯的**:它的來源頁正是 `/login?next=X`
 * (W3 R2 MF-A 實測整條:結帳被攔 → /login?next=%2Fcheckout → 忘記密碼 → 回去登入 → next 掉光)。
 * ⇒ **一條寫錯的豁免理由,讓這一格對那條路永遠不會紅,而畫面上守門是綠的。**
 * ⇒ 判別句:**寫「無來源頁」之前,先問「有沒有一條路是從帶著 next 的頁面走過來的」。**
 * 下面這幾支是**信件連結或登出後進來的** —— 那才是真的沒有來源頁。
 */
const ALLOWED = new Map<string, { count: number; reason: string }>([
  ['app/logout/page.tsx::/login', { count: 1, reason: '剛登出,回去登入是終點、沒有 next' }],
  ['app/login/reset/page.tsx::/login', { count: 1, reason: '改完密碼回登入,原本那頁已失效' }],
  ['app/login/reset/page.tsx::/login/forgot', { count: 1, reason: '重設連結失效,重新要一封信' }],
  ['components/ResetPasswordPage.tsx::/login', { count: 1, reason: '重設完成後前往登入,無來源頁' }],
]);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    if (!/\.tsx?$/.test(e.name) || /\.(test|spec)\./.test(e.name)) return [];
    return [p];
  });
}

/** 全 repo 掃描結果:`檔案::路徑` → 筆數。 */
function scan(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of walk(SRC)) {
    const rel = relative(SRC, f);
    for (const line of stripComments(readFileSync(f, 'utf8')).split('\n')) {
      for (const base of offendingPaths(line)) {
        const key = `${rel}::${base}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return counts;
}

describe('#190 登入導回:不得出現弄丟 next 的登入導航', () => {
  it('前提斷言:掃到的檔數合理(掃到 0 檔 ⇒ 下面那格恆真)', () => {
    expect(walk(SRC).length).toBeGreaterThan(50);
  });

  it('前提斷言:stripComments 不改變行數,且會看引號', () => {
    const src = 'const a = 1;\n/* 區塊\n   註解 */\nconst b = 2; // 尾註\n';
    expect(stripComments(src).split('\n').length).toBe(src.split('\n').length);
    // 🔴 codex N3:字串裡的 `//` 不是註解 —— 剝錯會把同行後段的裸導航一起吃掉而漏報。
    const tricky = `const u = 'a//b'; redirect('/login');`;
    expect(stripComments(tricky)).toContain("redirect('/login')");
  });

  it('前提斷言:量具雙向表演(該紅的紅、該綠的綠)', () => {
    // 🔴 沒有這一組,「零命中」同時相容於「真的乾淨」與「判別式根本不匹配」。
    // ── 該抓到的 ──
    expect(offendingPaths("  if (!user) redirect('/login');")).toEqual(['/login']);
    expect(offendingPaths('<Link href="/register">建立帳號</Link>')).toEqual(['/register']);
    expect(offendingPaths("router.push(isAuthed ? '/account' : '/login');")).toEqual(['/login']); // 三元裡
    expect(offendingPaths('<Link href="/login/forgot">忘記密碼</Link>')).toEqual(['/login/forgot']);
    expect(offendingPaths("redirect('/login?error=oauth');")).toEqual(['/login']); // 🔴 MF-3:帶別的 query
    expect(offendingPaths("  return '/login?error=line';")).toEqual(['/login']); // 🔴 算目的地再導的形狀
    // ── 不該抓到的(誤報會把人趕出守門視野)──
    expect(offendingPaths("redirect(`/login?next=${encodeURIComponent('/checkout')}`)")).toEqual([]);
    expect(offendingPaths("<Link href={next ? `/login?next=${x}` : '/login'}>")).toEqual([]); // 三元手足
    expect(offendingPaths("redirect(n ? `/login?error=oauth&next=${e}` : '/login?error=oauth')")).toEqual([]);
    expect(offendingPaths('<Link href="/logout">登出</Link>')).toEqual([]); // 別的路由,不在分母
    expect(offendingPaths("  '/login',")).toEqual([]); // seo.ts 的清單成員,不是導航
    expect(offendingPaths("matches: (p) => p === '/login',")).toEqual([]); // MobileTabBar 的比對
    expect(offendingPaths("import Link from 'next/link';")).toEqual([]); // 沒有路徑字面
    // 🔴 N1:手足必須是【同一個 base】—— 別的路徑帶了 next 不能豁免這一個
    expect(offendingPaths("<Link href={`/register?next=${x}`}>x</Link><Link href='/login'>y</Link>")).toEqual([
      '/login',
    ]);
  });

  it('全 storefront 零「弄丟 next 的登入導航」(白名單外)', () => {
    const found = scan();
    const unexpected = [...found].filter(([k, n]) => (ALLOWED.get(k)?.count ?? 0) !== n).map(([k, n]) => `${k} ×${n}`);
    // 白名單列了卻掃不到 ⇒ 那條豁免已經過期,該刪(否則它會靜靜豁免未來新增的)
    const stale = [...ALLOWED.keys()].filter((k) => !found.has(k));

    expect(
      unexpected,
      `這幾處把使用者導去登入卻沒帶 next ⇒ 登入完落首頁、原本要做的事要重做。` +
        `修法:帶 ?next=<原頁路徑>(sink 端 sanitizeNextParam 會收斂);` +
        `若確實是終點流程,把它加進本檔 ALLOWED(含筆數)並寫一句【被驗過】的理由。`,
    ).toEqual([]);
    expect(stale, 'ALLOWED 有條目掃不到了 ⇒ 過期的豁免會靜靜放行未來新增的,請刪掉').toEqual([]);
  });
});
