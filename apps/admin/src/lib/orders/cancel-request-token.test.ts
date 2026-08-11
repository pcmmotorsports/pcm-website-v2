// 🔴 `import 'server-only'`(被測模組的第一行)在 vitest 會拋 ⇒ 逐檔 mock 掉。
//    本 repo 既有處置,前例:`lib/payment/composition.test.ts` 等五支、
//    jsdom 前例 `app/orders/[id]/cancel-wiring.test.tsx`。root config 無 setupFiles。
import { vi } from 'vitest';
vi.mock('server-only', () => ({}));

import { describe, expect, it } from 'vitest';
import { generateCancelRequestToken } from './cancel-request-token';
import { isCancelRequestToken } from './cancel-action-state';

// cancel-request-token.test.ts — #363:產生器搬進 server-only 模組後,**它的守門跟著搬過來**。
//
// 🔴🔴 **這三條是 D2b 刀下的倖存者,再搬一次家**(原本住在 `cancel-action-state.test.ts` 那個
//    「token 產生器與形狀驗證(跨形狀活著,D2b 已保留)」describe 裡,該檔頭逐字警告過
//    「混在同一個 describe 裡的話,一刀切下去會把這幾條守門一起帶走,而且沒有任何人會轉紅」)。
//    ⇒ #363 把產生器搬走時,**沒有只改 import 就了事** —— 依賴解耦與**物理搬離**兩件事都做,
//    否則下一個刪 `cancel-action-state` 某個 describe 的人會連鍋端走它們
//    (memory `feedback_decouple-dependency-but-forgot-to-move-out-of-dying-container`)。
//    🔴 **留在原檔的是第四條**(純大小寫驗證、不碰產生器)—— 它測的是驗證器,而驗證器沒搬。
//    對帳:原 describe 四條 = 本檔三條 + 原檔一條,**總數不變**。
describe('#363 cancel-request-token — 產生器(server-only 模組)', () => {
  it('產生器與驗證器同源:產出來的一定過得了驗證(#363 之後這條跨兩個檔)', () => {
    const token = generateCancelRequestToken();
    expect(isCancelRequestToken(token)).toBe(true);
  });

  // 🔴 關卡2 must-fix(原檔逐字保留):把產生器換成回一顆固定合法 uuid,原本所有測試仍全綠 ——
  //    而那正是「同一張單下一次不同 payload 撞既有 token/hash」的形狀。
  it('🔴 產生器每次都不同(換成固定 uuid 要紅)', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateCancelRequestToken()));
    expect(tokens.size).toBe(50);
  });

  it('🔴 `req_<uuid>` 形狀不算 token(前例 Fable F3:重用 generateRequestId 會讓整個功能死掉)', () => {
    expect(isCancelRequestToken(`req_${generateCancelRequestToken()}`)).toBe(false);
  });
});

// ── #363 登記面補齊:client 端亂數的**機制層**完整性守門 ──────────────────────────────
//
// 🔴🔴 **為什麼是機制不是文字**(CLAUDE.md 機制優先律:「機制做不到才寫規則文字」):
//    `#363` 自陳的痛點就是**假前提擴散** —— 本模組檔頭那份「例外登記」原本是一段**散文**,
//    而散文不會因為有人新增一條 client 鑄鍵線而轉紅。實錘兩次:
//      ① 那份登記寫成當下只點名備註線,**出貨線兩支 100% client 鑄鍵沒被登記**(`#373` 審查揭出);
//      ② 本守門第一版只掃 `apps/admin/src`,卻把結論寫成「全樹沒有第五條鑄鍵線」——
//         **關卡2 審查當場打掉**:`apps/storefront/src/contexts/CartContext.tsx` 就是第五條,
//         而且它鑄的 `cart_session_id` 是 **3DS-7 雙扣防線的去重把手**(該檔逐字:碰撞會讓
//         兩筆不同結帳被誤判為同一筆)⇒ 比 admin 這幾條都重要。
//    ⇒ 現在掃的是 **`apps/` 與 `packages/` 全部**,不是單一 app。
//
// 🔴 **掃「client 端亂數」而不是「client 端 token」**,刻意放寬:分辨一顆亂數是不是冪等鍵
//    需要讀語意,機器做不到;而**漏判**的代價正是本片在補的洞 ⇒ 一律攔下,由登記表逐條標註它是什麼。
//
// 🔴 **登記單位是「檔 + 命中數」,不是「檔」**(關卡2 must-fix 5,審查實測打掉我上一版):
//    只比對路徑集合的話,**已登記檔裡新長出第二顆鑄鍵點,守門完全零訊號** ——
//    審查者在被我標成「不是 token」的 `ui/sidebar.tsx` 尾巴加一顆 `randomUUID`,**六格全綠**。
//    被標成「不是 token」的檔等於拿到免死金牌,那是上一版設計自己開的洞。
//    ⇒ 改成對**數量**:任何一檔的命中數變了就紅,強迫人回來重新分類。
//    ⚠️ 仍**刻意不寫行號**(行號會被任何一次編輯推移 ⇒ 守門變假紅;
//       memory `feedback_line-numbers-go-stale-from-your-own-later-edits`)。數量不吃編輯推移。
//
// ⚠️ **能力邊界(不要讀成「client 不可能鑄鍵」)—— 五條**:
//    ① **掃描範圍 = `apps/` + `packages/`**(排除 `node_modules` / `dist` / `.next` / `.turbo`)。
//       repo 根其他位置(`scripts/`、`supabase/`、`design-reference/`)不在內。
//    ② 只掃**剝完註解後第一行是 `'use client'`** 的檔。被 client 元件 import 的**無指令 .ts**
//       (module graph 意義上也在 client bundle 裡)掃不到。**這一面今天有活例、不是假想**:
//       `lib/orders/note-action-state.ts` 的 `generateNoteRequestToken()` 就是導出的 `randomUUID`
//       產生器、該檔明文不得加 `server-only`,而 `'use client'` 的 `note-compose-form.tsx` import 它。
//       (取消線那一面由 `server-only` 機制擋;退款線由本模組檔頭登記 ③ 具名。)
//    ③ 只認三種字面(`randomUUID` / `Math.random` / `getRandomValues`)。自己刻一個 LCG、
//       或用 `nanoid` / `uuid` 這類第三方套件,都掃不到(實查全 repo 今天零命中,故非活洞)。
//    ④ 只認 `.ts` / `.tsx`。`.js` / `.jsx` / `.mjs` 掃不到(實查今天零命中,故非活洞)。
//    ⑤ 掃的是**原始碼字面**,不是執行期行為。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { stripComments } from '../test-support/strip-comments';

/** monorepo 根(本檔在 `apps/admin/src/lib/orders/`)。 */
const REPO_ROOT = fileURLToPath(new URL('../../../../..', import.meta.url));
const SCAN_ROOTS = ['apps', 'packages'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage']);

/**
 * 三種本 repo 真的用過的亂數來源(`getRandomValues` 見 `lib/sso/state.ts`、`lib/session/session.ts`)。
 * ⚠️ **帶 `/g` 的模組層常數有狀態(`lastIndex`)**:目前只被 `String.prototype.match` 用,
 *    那支對 `/g` 會自己重置 `lastIndex` ⇒ 今天安全。**若日後改用 `.test()` / `.exec()`,
 *    結果會隔一次為假** —— 那時請就地 `new RegExp(...)`,別沿用這顆。(R2 nit-6)
 */
const RANDOMNESS = /randomUUID|Math\s*\.\s*random|getRandomValues/g;

/**
 * 🔴 **已登記的 client 端亂數點:`路徑 → 命中數`。**
 *
 * | 檔 | 命中 | 是不是冪等鍵 | 為什麼可以在 client |
 * |---|---|---|---|
 * | `storefront/.../CartContext.tsx` | 3 | **是**(結帳線) | `cart_session_id` = 3DS-7 雙扣防線的去重把手。刻意用 `getRandomValues` 不用 `randomUUID`:後者是 secure-context-only,舊版在非 HTTPS 直接 throw、整頁 crash;**明文絕不使用 `Math.random`**(該檔 `:61-72`)。 |
 * | `admin/.../note-compose-form.tsx` | 3 | **是**(備註線) | 刻意:bfcache 還原要換一把新鍵,而 bfcache 的定義就是不重新渲染 ⇒ server 鑄不到。含 `Math.random` fallback 是因為真機 LAN http 非 secure context 沒有 `randomUUID`。⚠️ 主鍵仍是 server 鑄的,client 只鑄「換鍵」那一把。 |
 * | `admin/.../shipment-launcher.tsx` | 1 | **是**(出貨線) | 100% client 鑄鍵:鍵在按下去那一刻生成一次、重試沿用同一把。**本片之前完全沒被登記**。 |
 * | `admin/.../shipment-void-button.tsx` | 1 | **是**(出貨線) | 同上,作廢那一支。 |
 * | `admin/.../receipt-record-form.tsx` | 3 | **是**(#352-b 到貨登錄) | 100% client 鑄鍵,而且**必須**是 client:server 一次 render 只鑄得出一把,若走 bfcache 還原或同一頁連續登錄兩筆不同到貨,第二筆會沿用第一把鍵而被判成 `DUPLICATE_REQUEST` —— 那是「貨沒記進去卻顯示已登錄」。三顆的形狀同備註線(判斷、呼叫、`Math.random` fallback);fallback 存在的理由也同它:真機 LAN http 非 secure context 沒有 `randomUUID`。 |
 * | `admin/.../ui/sidebar.tsx` | 1 | **不是** | skeleton 骨架的隨機寬度(`Math.floor(Math.random() * 40) + 50`%)。登記它是因為守門刻意掃「亂數」而非「token」。 |
 *
 * 🔴 **命中數是「字面出現次數」不是「產生點數」**,而且兩個 3 的來源形狀**不一樣**(R2 nit-5 更正):
 *    · `CartContext.tsx` 的 3 = **兩行**:`if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();`
 *      這一行本身命中兩次(判斷 + 呼叫),再加 `getRandomValues` 一次。
 *    · `note-compose-form.tsx` 的 3 = **三行各一顆**(判斷、呼叫、`Math.random` fallback)。這個粒度是刻意的 —— 它比「產生點數」機械、不需要讀語意,
 *    而守門要的是「**動了就紅**」。⚠️ 副作用:純改寫(例如把 `typeof` 判斷抽成變數)也會紅一次。
 *    那是可接受的代價:那種改寫本來就該讓人回來看一眼這顆鍵有沒有被動到。
 * 🔴 **這張表的第一版我把 `CartContext` 寫成 2 —— 沒量就寫,守門第一次跑就抓到我**
 *    (我是照審查者信裡的行號抄的,而那兩行裡有一行出現兩次)。三來源律連在寫守門本身時也適用。
 *
 * ⚠️ 取消線**不在**本表:產生器已在 `server-only` 模組,client 檔 import 會在 build 期紅。
 * ⚠️ 退款線**也不在**本表:呼叫點今天全在 server,但 `refund-action-state.ts` 有 client importer
 *    (`refund-section.tsx`、`refund-exception-resolve.tsx` 兩支)⇒ 要上 `server-only` 得先拆模組。
 */
const REGISTERED: Record<string, number> = {
  'apps/storefront/src/contexts/CartContext.tsx': 3,
  'apps/admin/src/components/orders/note-compose-form.tsx': 3,
  'apps/admin/src/components/orders/shipment-launcher.tsx': 1,
  'apps/admin/src/components/orders/shipment-void-button.tsx': 1,
  'apps/admin/src/components/orders/receipt-record-form.tsx': 3,
  'apps/admin/src/components/ui/sidebar.tsx': 1,
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p) && !p.includes('.test.')) out.push(p);
  }
  return out;
}

/** 掃描結果:`相對 repo 根的路徑 → 亂數字面命中數`(只含 `'use client'` 檔)。 */
function scanClientRandomness(): Record<string, number> {
  const found: Record<string, number> = {};
  for (const root of SCAN_ROOTS) {
    for (const p of walk(join(REPO_ROOT, root))) {
      // 🔴 先剝註解再判兩件事(既有前例 `cancel-order-forms.test.tsx` 的 must-fix:
      //    拿未剝註解的原始碼比 `'use client'` 會把「註解裡提到它」的檔一起算進來)。
      const code = stripComments(readFileSync(p, 'utf8'));
      if (!/^\s*['"]use client['"]/.test(code)) continue;
      const hits = code.match(RANDOMNESS);
      if (hits) found[relative(REPO_ROOT, p)] = hits.length;
    }
  }
  return found;
}

describe('#363 登記面:client 端亂數必須逐檔逐點登記', () => {
  it('🔴 掃到的 client 端亂數 = 登記表(多一個檔、或同一檔多一顆,都要紅)', () => {
    expect(scanClientRandomness()).toEqual(REGISTERED);
  });

  // 🔴 正向對照:沒有這格,「掃描器壞掉回空物件」+「登記表被清空」會一起變綠。
  it('掃描器真的掃得到東西,且含兩支具名的已知 client 鑄鍵點(admin 與 storefront 各一)', () => {
    const found = scanClientRandomness();
    expect(Object.keys(found).length).toBeGreaterThan(0);
    // 出貨線那支 = 本片在補的洞;CartContext = 關卡2 打掉我「只掃 admin」那版的那一條。
    expect(found).toHaveProperty('apps/admin/src/components/orders/shipment-launcher.tsx');
    expect(found).toHaveProperty('apps/storefront/src/contexts/CartContext.tsx');
  });

  // 🔴 證明掃描器的兩個判準**各自**有作用(否則「只判亂數、不判 use client」也會全綠)。
  it('掃描器對「有 use client 但沒亂數」與「有亂數但沒 use client」都不收', () => {
    // 🔴🔴 **前置錨點:先證明這兩個檔真的在掃描範圍內。**
    //    R2 審查實測打掉我上一版 —— 改寫成 `Record` 比對時我**把這兩行掉在原地了**,
    //    結果:把 `cancel-form-body.tsx` 整個搬走,六格**全綠**(本格宣稱「證明兩個判準
    //    各自有作用」,而它唯一的正例錨點消失後就恆真)。
    //    這是 memory `feedback_decouple-dependency-but-forgot-to-move-out-of-dying-container`
    //    的同型:換了容器,守門的**前置條件**要跟著搬,不是只搬斷言。
    const scanned = walk(join(REPO_ROOT, 'apps')).map((p) => relative(REPO_ROOT, p));
    expect(scanned).toContain('apps/admin/src/components/orders/cancel-form-body.tsx');
    expect(scanned).toContain('apps/admin/src/lib/orders/cancel-request-token.ts');

    const found = scanClientRandomness();
    // `cancel-form-body.tsx` 是 client 但不鑄鍵(取消線靠 server-only)⇒ 不該在結果裡。
    expect(found).not.toHaveProperty('apps/admin/src/components/orders/cancel-form-body.tsx');
    // 本模組有 randomUUID 但不是 client 檔 ⇒ 不該在結果裡。
    expect(found).not.toHaveProperty('apps/admin/src/lib/orders/cancel-request-token.ts');
  });
});
