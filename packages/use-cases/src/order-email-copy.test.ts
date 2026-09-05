import { describe, expect, it } from 'vitest';
import {
  ORDER_CANCELLED_HEADLINE_NO_ID,
  ORDER_CANCELLED_HEADLINE_WITH_ID,
  ORDER_MEMBER_CENTER_SENTENCE,
  ORDER_PAID_HTML_LEAD_SENTENCE,
  ORDER_PAID_NEXT_STEP_SENTENCE,
  ORDER_UNPAID_CANCELLED_NO_CHARGE_SENTENCE,
} from './order-email-copy';
import { renderPaidEmailHtml } from './paid-email-html';
import type { PaidEmailContext } from '@pcm/ports';
import type { MoneyAmount } from '@pcm/domain';

const m = (n: number) => n as MoneyAmount;

/** 🔴 形狀抄 `paid-email-html.test.ts` 的 `ctxWithDiscount()`,**不自己發明一個** —— 我第一版發明的那個缺 `lines`,當場 TypeError。 */
function ctx(): PaidEmailContext {
  return {
    orderDisplayId: 'PCM-2026-9001',
    linesTruncated: false,
    lines: [{ title: '測試品', variantSku: 'SKU-1', quantity: 1, lineTotal: m(100) }],
    subtotal: m(100),
    shippingFee: m(0),
    discountTotal: m(0),
    total: m(100),
    // 🔵 今天恆為 0(⟦b4-INVOICE5PCT⟧ 第 6 步加的必填欄)。
    taxTotal: m(0),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔴🔴 **這一格是這一片【唯一會紅】的守門**(Sean 2026-09-03 02:5x 拍甲)。
//
// 沒有它,兩份文案下次再漂**一樣沒有人知道** —— 而它們**已經漂過一次**:
//   純文字 `U+002C`(半形逗號) vs HTML `U+FF0C`(全形逗號),2026-09-03 逐字元量到。
//   🎯 **同一個客人、同一封信,而收信軟體挑哪一份是【客人那端】決定的。**
//
// 🛑 **判別點是「兩份的那一句【逐位元組相同】」,不是「各自比對字面」** ——
//    各自比對字面的話,兩邊一起改錯會**一致通過**(本 repo 對這個形狀有明確立場:
//    `20260816050000` 檔頭逐字「守門不能做成兩邊互比:兩邊【一起】用錯分母時,
//    互比對同一組輸入會得到同一個錯答案、**一致通過**」)。
//    ⇒ 所以下面**同時**做兩件:①兩個消費端的產出都含**同一個常數** ②那個常數逐字元對得上稿。
// ─────────────────────────────────────────────────────────────────────────────
describe('訂單信文案:一份定義、兩邊各自取用(Sean 2026-09-03 拍甲)', () => {
  it('🔴 純文字與 HTML 的主句【逐位元組相同】—— 逗號漂掉就要紅', () => {
    // 期望值來自**稿**(OD `pcm-524f/email-order-paid-A.html`,Sean 2026-08-23 拍 A 版),
    // 不是從實作抄的:逗號 U+FF0C、句號 U+3002。
    expect(ORDER_PAID_NEXT_STEP_SENTENCE).toBe(
      '我們會盡快為您安排出貨，出貨後會再寄一封通知給您。',
    );
    // 🛑 半形逗號 = 漂回去了
    expect(ORDER_PAID_NEXT_STEP_SENTENCE).not.toContain(',');
  });

  it('🔴 HTML 產出真的用了那個常數(不是自己又打了一份)', () => {
    const html = renderPaidEmailHtml(ctx(), {});
    expect(html).toContain(ORDER_PAID_NEXT_STEP_SENTENCE);
    expect(html).toContain(ORDER_PAID_HTML_LEAD_SENTENCE);
    // 🔴 負對照:半形逗號那一版**不准**出現在產出裡
    expect(html).not.toContain('我們會盡快為您安排出貨,');
  });

  // ✅ **這一格被證明會叫的方式(2026-09-03 自我稽核,兩個消費端【各突變一次】)**:
  //    · `paid-email-html.ts` 改回手打同樣的字面 ⇒ 🔴 本格紅(而 `toContain` 那兩格仍綠)
  //    · `sweep-email-outbox.ts` 改回手打同樣的字面 ⇒ 🔴 本格紅
  //    🔴 **而第二發是稽核時才補的** —— 我原本只突變了 HTML 那一端就收工,
  //      ⇒ 📌 **「這把尺會叫」與「它對【每一個】它宣稱涵蓋的對象都會叫」是兩個宣稱。**
  //      一個只掃到第一個 consumer 的實作,在只突變第一個 consumer 的稽核下**完美通過**。
  //    🔵 而那一發突變本身也被自己的自檢擋過一次:錨字串同時命中 **import 那一行**與模板本體
  //      ⇒ 腳本 assert 命中數 = 1 失敗而停 ⇒ **它沒有靜靜改到 import**(那會是「突變沒落在目標上」第五種)。
  it('🔴🔴 production 裡【不准有第二份手打副本】—— 這一格才證得了「來源」', async () => {
    // 🔴 codex 2026-09-03 兩條 must-fix 的根:`toContain` 只證「那個值出現在產出裡」,
    //    **證不了它是從常數來的** —— 把消費端改成手打同樣的字面,上面那兩格照樣全綠。
    // ✅ 所以這一格換一個分母:**掃原始碼**,問「除了定義檔以外,還有誰把這句話打進去了」。
    //    形狀對齊 `order-hidden-rule.ts` 的立場:副本在【測試】裡 = 絆線;
    //    副本在【production】裡 = 會漂的第二份真相。
    const { readFile } = await import('node:fs/promises');
    const consumers = ['./paid-email-html.ts', './sweep-email-outbox.ts'];
    for (const rel of consumers) {
      const src = await readFile(new URL(rel, import.meta.url), 'utf8');
      // 🛑 只看【非註解】的行 —— 註解裡引用這句話是刻意的(訃聞與說明),那不是副本。
      const codeLines = src
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
      const hardcoded = codeLines.filter((l) => l.includes(ORDER_PAID_NEXT_STEP_SENTENCE));
      expect(hardcoded, `${rel} 裡有手打副本:${hardcoded.join(' | ')}`).toHaveLength(0);
    }
  });

  it('🟢 正對照:上面那個 0 不是恆 0 —— 定義檔自己【必須】命中', async () => {
    // 🔴 沒有這一格,上面那個 `toHaveLength(0)` 在「尺根本沒讀到檔」時也會過。
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('./order-email-copy.ts', import.meta.url), 'utf8');
    const codeLines = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
    const hits = codeLines.filter((l) => l.includes(ORDER_PAID_NEXT_STEP_SENTENCE));
    expect(hits.length, '定義檔裡應該【正好一處】非註解命中').toBe(1);
  });

  it('🟢 正對照:這把尺對「常數被改壞」會動', () => {
    // 證明上面兩格不是恆真 —— 一個刻意錯的字面必須對不上。
    expect(ORDER_PAID_NEXT_STEP_SENTENCE).not.toBe('我們會盡快為您安排出貨,出貨後會再寄一封通知給您。');
    expect(ORDER_MEMBER_CENTER_SENTENCE).not.toBe('');
  });
});

/**
 * 🔴🔴 **「會員中心」那句對【後台手動建的單】不一定成立 —— 而分母裡本來沒有那個世界。**
 *
 * 病:`apps/admin/src/lib/customers/manual-customer.ts` 替打電話來的散客開 `auth.users` 時,
 * `email` 是**佔位信箱**(`@` + `SYNTHETIC_EMAIL_BASE_DOMAIN`,不可路由的網域)、
 * `createUser` **沒有帶 password** ⇒ 🛑 **那個客人登不進會員中心**;
 * 而 `apps/storefront/src/app/account/orders/[displayId]/page.tsx` 未登入時 `redirect('/login…')`
 * ⇒ 📌 **句子與連結對他而言都是死路。**
 *
 * ⚠️ **它不是對所有手動單為假**(`manual_line` 的客人可能有 LINE 帳號、拿既有客人建的單也登得進去)
 * ⇒ 🎯 修法是**加條件**不是拿掉 —— 拿掉會讓能登入的那一群失去指路。
 *
 * ## 🛑 這幾格【證不到】什麼(先讀,它決定下面每一格能不能當結論)
 * · 純文字信的內容**不隨收信人變化** ⇒ 「餵一張手動單進去看它印什麼」在這裡**零判別力**:
 *   兩個世界會印**同一個字串**。⇒ 📌 **所以這裡守的是【那句話有沒有下條件】, 不是「它對誰成立」。**
 * · 它答不出「那個客人到底登不登得進去」—— 那要真的去打那條登入路。
 */
/**
 * 🔴🔴 **把一段文字切成【句】—— 而這一支是主格與負對照【共用的同一支】**(codex R9 ②)。
 *
 * ⛔ ~~原本切段邏輯在主格寫一次、負對照再抄一次~~
 * ⇒ 🛑 **負對照抄的是【它自己那一份】** —— 兩份漂開的那天,
 *    負對照仍然印綠, 而它宣稱在守的那把尺已經不是主格用的那一把。
 * 📌 **一個負對照若不呼叫被測的那支函式, 它證的是它自己。**
 *
 * ## 🔴 它為什麼長這樣
 * 1. **不先剝換行** —— 舊版 `replace(/\s+/gu, '')` 先把**換行也吃掉**
 *    ⇒ 多行文案的段界**整個消失** ⇒ 條件與敘述被讀成同一句。**換行本身算段界。**
 * 2. **句點集合要補齊** —— 舊版只認 `。！？`,漏了 **`．`(全形句點)與 ASCII `.`**。
 * 3. **括號內的標點不算段界。**
 *    🔴🔴 ⛔ ~~原本這裡寫「舊版對『…(需先註冊?),…』**會誤紅**」~~ —— **那句話是假的**
 *    (code-reviewer 2026-09-05 實測抓到):舊版的段界是 `/[。！？]/u` **三個全形字元**,
 *    而那個 fixture 的 `?` 是 **U+003F 半形** ⇒ 🛑 **舊版根本不會切它, 它印綠。**
 *    ⇒ 📌 **那個誤紅是【新版自己加了半形 `!?.` 之後才生出來的】** —— 我把一個
 *      **自造的病**寫成了「舊版的實錘」。⚠️ 括號保護仍然留著(對新版是真的需要),
 *      **而它的來歷要說對**:它守的是本函式自己引入的形狀,不是既有缺陷。
 *
 * ## 🛑 它【證不到】什麼(這一節上一版**報了一個不存在的限制、漏了存在的那個**)
 * · 🔴 **未關的開括號 ⇒ 其後【整段不再切】**(`（` 沒有 `）`)。
 *   下面用「同一行的括號要成對才給保護」擋掉它 —— 而**跨行成對的括號不受保護**。
 * · 🔴 **`；` 與 `，` 不在段界集合裡** ⇒ 用分號拆句的文案(中文很常見)判得出「同一句」。
 * · ⛔ ~~巢狀引號…一樣會被當段界~~ —— **那句是假的**:`「『』」` 就在括號集合裡 ⇒ 它們**受保護**。
 * · 英文縮寫裡的 `.`(`Inc.`)確實會被當段界。今天的文案沒有這些形狀 ——
 *   **而那是「今天剛好安全」, 不是「它處理得了」。**
 */
const CLAUSE_OPEN = '（(【[「『';
const CLAUSE_CLOSE = '）)】]」』';
// 🔴 `；` / `;` 也在裡面(code-reviewer F4):中文文案用分號拆句很常見,
//    而「條件在分號前、敘述在分號後」與「被句號切走」是**同一個病**。
//    🔵 `，` **刻意不放** —— 本片的正確文案自己就用逗號連接條件與敘述。
const CLAUSE_BREAK = '。．.！!？?；;';

/**
 * 🔴🔴 **括號保護只在【這一行的括號成對】時才給**(code-reviewer F1/F2)。
 *
 * ⛔ ~~舊版無條件相信括號~~ ⇒ 一個**沒有關的** `（` 讓 `depth` 永遠 > 0
 *   ⇒ 🛑 **它後面整段不再切** ⇒ 條件被句號切走了而這把尺說「在同一句」——
 *   **方向是假綠**, 而那正是這把尺存在要防的那個世界。
 * 📌 ⇒ **一個「為了少誤報而加的寬容」, 在輸入不合法時變成了無條件放行。**
 */
function bracketsBalanced(line: string): boolean {
  let d = 0;
  for (const ch of line) {
    if (CLAUSE_OPEN.includes(ch)) d += 1;
    else if (CLAUSE_CLOSE.includes(ch)) {
      d -= 1;
      if (d < 0) return false;
    }
  }
  return d === 0;
}

function clausesOf(text: string): string[] {
  const out: string[] = [];
  // 🔴 **先切換行**(它一律是段界, 不受括號保護)—— 這一步同時把「跨行括號」關進單行裡。
  for (const line of text.split(/\r?\n/u)) {
    const guard = bracketsBalanced(line);
    let cur = '';
    let depth = 0;
    for (const ch of line) {
      if (CLAUSE_OPEN.includes(ch)) depth += 1;
      else if (CLAUSE_CLOSE.includes(ch)) depth = Math.max(0, depth - 1);
      if (CLAUSE_BREAK.includes(ch) && (!guard || depth === 0)) {
        out.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
    }
    out.push(cur);
  }
  // 🔵 切完【才】剝空白。**它不是寬容, 是必要條件**(code-reviewer F9):
  //    真常數是 `若您有 PCM 會員帳號`(**有**空格), 而下面比對用的 needle **沒有**空格
  //    ⇒ 不剝的話主格根本過不了。⚠️ 有人覺得它多餘而刪掉 ⇒ 主格會紅, 而理由看起來像文案錯。
  return out.map((c) => c.replace(/\s+/gu, '')).filter((c) => c.length > 0);
}

describe('會員中心那句【有沒有把條件掛在「有沒有帳號」上】', () => {
  // 🔴🔴 codex R6 ②:⛔ ~~原本這個 describe 叫「要對【兩種來源】都成立」~~ ——
  //    🛑 **那句話超出下面三格能證的範圍**:它們讀的是**一個字串常數**,
  //       答不出「這句話對哪一種訂單來源成立」——那要真的去打登入那條路。
  //    ⇒ ✅ 改成它真的在守的東西:**條件有沒有掛在「有沒有 PCM 會員帳號」上。**
  //    📌 **一個比證據寬的標題, 會讓下一個人以為這一族已經有人守了。**
  it('🔴 條件必須掛在【有沒有 PCM 會員帳號】上, 不是隨便一個「若您有」', () => {
    // 🔴🔴 codex R6 ②:⛔ ~~原本只找 `'若您有'`~~ ——
    //    🛑 那把尺放行一個很自然的錯誤改法:
    //       「**若您有任何問題**, 訂單明細與最新狀態可至會員中心查看。」
    //       ⇒ 它有「若您有」、沒有舊字面、也指得到會員中心 ⇒ **上一版三格全綠**,
    //         而那句話對手動單客人**一樣是假的**(它的條件掛在別的東西上)。
    //    ⇒ ✅ 釘**整個子字串**:條件與它所條件的那個東西必須綁在一起。
    // 🔴 codex R7 nit:**比對前把【空白】拿掉。**
    //    ⛔ ~~原本直接比 `includes('若您有 PCM 會員帳號')`~~ ⇒ 有人把它寫成「若您有PCM會員帳號」
    //    (少了那個空格)時, 這一格會紅, **而它印的訊息是「條件沒有掛在帳號上」—— 那句話是假的**:
    //    語意上條件掛得好好的, 壞掉的只有【字面】。
    //    🛑 **一個報錯理由的紅, 會被下一個人用錯的方式修掉**(他會去改語意, 而該改的是字面)。
    //    ⇒ ✅ **兩件事分家**:這一格只問**語意**(容許空白差);
    //       **字面**由下面那格「整句逐字釘死」負責 —— 它會紅, 而它的訊息說得出是字面。
    // 🔴🔴 codex R8 ②:**條件與它所條件的敘述必須在【同一句】裡。**
    //    ⛔ ~~原本只問「這兩串字都在嗎」~~ ⇒ 下面這個改法**照樣全綠**, 而它是假的:
    //       「若您有 PCM 會員帳號**, 可享會員服務。**訂單明細與最新狀態可至**會員中心**查看。」
    //       ⇒ 條件被句號切走了 ⇒ **第二句又變回一句無條件的斷言**, 而它對手動單客人仍是假的。
    //    📌 **兩個字串都在, 不代表它們有關係** —— 關係住在【它們之間有沒有句號】。
    //    ⇒ ✅ 以句號切段, 要求**有一段同時含兩者**。
    // 🔴🔴 code-reviewer F11:**拆成兩句 assert, 因為這一格原本有【三種紅法】而只講得出一種。**
    //    ⛔ ~~舊版只有一句 `some(…)`, 訊息寫「條件被句號切走了」~~ ——
    //    而它也會在①字面被改 ②剝空白那步被拿掉 時紅, **那兩種的理由是假的**。
    //    📌 **一個報錯理由的紅, 會被下一個人用錯的方式修掉**(本線今晚第三次撞到同一族)。
    const whole = clausesOf(ORDER_MEMBER_CENTER_SENTENCE).join('');
    expect(
      whole.includes('若您有PCM會員帳號'),
      '🔴 全文裡【根本找不到】「若您有 PCM 會員帳號」這串字 —— 這是【字面】問題, 不是「被切走」',
    ).toBe(true);

    const clauses = clausesOf(ORDER_MEMBER_CENTER_SENTENCE);
    expect(
      clauses.some((c) => c.includes('若您有PCM會員帳號') && c.includes('會員中心')),
      '🔴 那串字【在】而與「會員中心」【不在同一句】⇒ 條件被段界切走了 ⇒ 剩下的仍是一句對手動單客人為假的斷言',
    ).toBe(true);
  });

  it('🔴 而整句要逐字釘死 —— 對外字面不得無聲改變', () => {
    // 🔵 這一格與上一格**問的不是同一件事**:上一格問「條件掛對地方了嗎」,
    //    這一格問「有沒有人改了它而沒有人知道」。⇒ 改文案時**兩格一起改, 而那一次改動就是那個「按一下」**。
    expect(ORDER_MEMBER_CENTER_SENTENCE).toBe(
      '若您有 PCM 會員帳號，訂單明細與最新狀態可至會員中心查看。',
    );
  });

  it('🔴 而它不得退回舊的那個【無條件】版本', () => {
    // 🔵 舊字面寫死在這裡當絆線 —— 有人改回去時這一格會紅, 而不是靜靜地過。
    expect(ORDER_MEMBER_CENTER_SENTENCE).not.toBe('訂單明細與最新狀態請至 PCM 會員中心查看。');
    expect(ORDER_MEMBER_CENTER_SENTENCE).not.toContain('請至 PCM 會員中心查看');
  });

  it('🟢 正對照:它仍然指得到會員中心(條件句不該把指路本身弄丟)', () => {
    expect(ORDER_MEMBER_CENTER_SENTENCE).toContain('會員中心');
  });

  it('🔵 負對照:未關的開括號【不得】讓其後整段不再切(code-reviewer F1)', () => {
    // 🛑 舊版無條件相信括號 ⇒ 一個沒關的 `（` 讓 depth 永遠 > 0 ⇒ 後面的 `。` 全被吞
    //    ⇒ **假綠**, 而那正是這把尺存在要防的那個世界。
    expect(
      clausesOf('若您有PCM會員帳號（限已註冊，可享會員服務。訂單明細可至會員中心查看。').some(
        (c) => c.includes('若您有PCM會員帳號') && c.includes('會員中心'),
      ),
      '🔴 未關的括號讓段界失效 ⇒ 條件被切走了而這把尺說「在同一句」',
    ).toBe(false);
  });

  it('🔵 負對照:跨行的括號【不得】把換行段界吃掉(code-reviewer F2)', () => {
    expect(
      clausesOf('若您有PCM會員帳號（限已註冊\n可享會員服務）訂單明細可至會員中心查看').some(
        (c) => c.includes('若您有PCM會員帳號') && c.includes('會員中心'),
      ),
      '🔴 跨行括號把換行段界吃掉了',
    ).toBe(false);
  });

  it('🔵 負對照:分號也算段界(code-reviewer F4)', () => {
    for (const semi of ['；', ';']) {
      expect(
        clausesOf(`若您有PCM會員帳號${semi}訂單明細可至會員中心查看`).some(
          (c) => c.includes('若您有PCM會員帳號') && c.includes('會員中心'),
        ),
        `🔴 「${semi}」沒被當成段界 ⇒ 用分號拆句的文案判得出「同一句」`,
      ).toBe(false);
    }
  });

  it('🔵 負對照:換行也算段界(舊版先剝空白 ⇒ 換行整個消失)', () => {
    expect(
      clausesOf('若您有PCM會員帳號\n訂單明細與最新狀態可至會員中心查看').some(
        (c) => c.includes('若您有PCM會員帳號') && c.includes('會員中心'),
      ),
      '🔴 換行沒被當成段界 ⇒ 多行文案的段界會整個消失',
    ).toBe(false);
  });

  it('🔵 負對照:全形「．」與 ASCII「.」也算段界(舊版只認 。！？)', () => {
    for (const dot of ['．', '.']) {
      expect(
        clausesOf(`若您有PCM會員帳號${dot}訂單明細與最新狀態可至會員中心查看`).some(
          (c) => c.includes('若您有PCM會員帳號') && c.includes('會員中心'),
        ),
        `🔴 「${dot}」沒被當成段界`,
      ).toBe(false);
    }
  });

  it('🟢 正對照:括號【內】的問號不算段界(否則這把尺會誤紅)', () => {
    // 🛑 一道會誤紅的閘, 比一道漏報的閘更容易被整支關掉。
    expect(
      clausesOf('若您有PCM會員帳號(需先註冊?)，訂單明細與最新狀態可至會員中心查看。').some(
        (c) => c.includes('若您有PCM會員帳號') && c.includes('會員中心'),
      ),
      '🔴 括號內的標點被當成段界 ⇒ 一句合法的文案會被誤判成「條件被切走」',
    ).toBe(true);
  });

  it('🔵 負對照:把條件與敘述拆成兩句 ⇒ 上面那格【必須】看得出來', () => {
    // 🛑 這一格不驗生產碼, 它驗**上面那把尺**:一把「要求同一句」的尺,
    //    在【真的被拆成兩句】時必須說不。少了它, 上面那格可能是恆真的。
    // 🔴 呼叫的是【上面那一支具名函式】, 不是再抄一份切段邏輯(codex R9 ②)。
    const 拆成兩句 = '若您有PCM會員帳號，可享會員服務。訂單明細與最新狀態可至會員中心查看。';
    expect(
      clausesOf(拆成兩句).some(
        (c) => c.includes('若您有PCM會員帳號') && c.includes('會員中心'),
      ),
      '🔴 這把尺對「條件被句號切走」印不出差別 ⇒ 上面那格是恆真的',
    ).toBe(false);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// ⟦取消信-模板⟧ 2026-09-03 · `order_unpaid_cancelled` 的**全文逐字**
//
// 🔴 **這一格就是那份文案唯一的鎖。** Sean 2026-09-03 拍「文案工程師改、不做後台可編輯」
//    ⇒ **改文案一定是改碼** ⇒ 沒有這一格,對外字面可以無聲改變,而 cron 會直接把它寄給客人。
// 🛑 **改這個期望值 = 把鎖重設,而重設一道鎖需要授權** —— 下一個想改的人:
//    先找到你的兩格(**統一/內容的拍板** + **依據**),沒有就不要改。
//    「測試過期了順手更新」**不是依據**。
//
// 🔵 而期望值**從規格推,不從實作抄**:規格 = `docs/specs/2026-09-03-cancel-email-scope-spec-draft.md`
//    §11(取消原因帶既有七值映射、不新造)+ Sean 2乙(只涵蓋員工按下取消)。
// ─────────────────────────────────────────────────────────────────────────────
describe('⟦取消信-文案常數⟧ order_unpaid_cancelled 的字面', () => {
  // 🔴🔴 **本 describe 原本還有四格,而我把它們刪掉了 —— 因為它們什麼都沒測。**
  //    那四格的期望值是我**在測試裡重打一份模板組裝邏輯**再跟自己比
  //    ⇒ 📌 **測的是「我抄得對不對」,不是那支函式** ⇒ 把生產碼整段換掉,它們照樣全綠。
  //    ✅ **全文逐字那一族已搬到 `sweep-email-outbox.test.ts`**,在那裡走**真的 `sweepEmailOutbox`**、
  //      拿**真的送出去的 `text`** 來比(錨:`⟦取消信-模板⟧ order_unpaid_cancelled`)。
  //    🔵 **這裡只留【常數本身的字面】** —— 那是本檔測得到的東西:它們是**寄出去的那些字**。

  it('🔴 三塊常數逐字', () => {
    expect(ORDER_CANCELLED_HEADLINE_WITH_ID('PCM-2026-0001')).toBe('您的訂單 PCM-2026-0001 已取消。');
    expect(ORDER_CANCELLED_HEADLINE_NO_ID).toBe('您的訂單已取消。');
    expect(ORDER_UNPAID_CANCELLED_NO_CHARGE_SENTENCE).toBe('這張訂單尚未付款，不會有任何款項產生。');
  });

  it('🔴 那三塊自己都不可以出現退款字樣', () => {
    // 未付款的單 ⇒ 客人從頭到尾沒付過錢 ⇒ 提退款會讓他等一筆不存在的退款。
    const all = [
      ORDER_CANCELLED_HEADLINE_WITH_ID('X'),
      ORDER_CANCELLED_HEADLINE_NO_ID,
      ORDER_UNPAID_CANCELLED_NO_CHARGE_SENTENCE,
    ].join('\n');
    for (const banned of ['退款', '退還', '退回']) expect(all).not.toContain(banned);
    // 🟢 正對照:尺對真的有那些字會叫
    expect(`${all}\n退款`).toContain('退款');
  });
});
