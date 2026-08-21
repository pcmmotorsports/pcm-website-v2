import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * rpm-carbon-description-fuse.test.ts — **rpm-carbon 描述接線的延遲引信觸發器**(機制,不是提醒)。
 *
 * ## 🔴 我【守不到】什麼(第一句就講,因為它比你以為的窄)
 *
 * ```
 * ❌ 我看不到【資料】。那 933 筆描述裡到底還有沒有 HTML 標籤,我掃不到 ——
 *    它住在正式庫的 products.description,不在 repo 裡。
 *    ⇒ 所以我【不是】在守「客人會不會看到 <p><span>」,我是在守
 *      「**讓客人看到它的那個 code 條件成不成立**」。資料那一半要人去查(查法在最下面)。
 * ❌ 我只看原始碼字面。有人用別的寫法達到同樣效果(換元件、抽 helper),我掃不到。
 * ❌ 我不驗描述內容對不對、不驗 XSS。那是別人的事。
 * ```
 *
 * ## 我守的是哪一刻
 *
 * 今天 **914 個商品頁的真描述根本不會被渲染** —— `ProductTabs.tsx` 對 `brandSlug === 'rpm-carbon'`
 * 走一段**寫死的碳纖樣板**,`product.description` 被整個跳過。所以那些 HTML 標籤今天沒有人看得到。
 *
 * 🔴 **而那段樣板是暫時的。** `ProductTabs.tsx` 檔頭逐字:
 * 「per-廠牌 / per-product 真實功能描述**待後台 product_description 接線**」。
 *
 * ```
 * 接線那天,有人把 isRpmCarbon 那個分支拿掉 ⇒ 真描述開始渲染
 * 而渲染方式是【純文字】(React 預設 escape、刻意不用 dangerouslySetInnerHTML、防 XSS)
 * ⇒ ⇒ 914 個商品頁**當場**開始印出字面 `<p><span>Carbon Fiber Engine Cover…`
 * ⇒ ⇒ 而三綠不紅、其他測試不紅、build 不紅 —— **沒有任何東西會紅。**
 * ```
 *
 * ⇒ **兩個訊號同時成立才紅**:
 *   · A 樣板分支不見了(真描述會被渲染)
 *   · B 渲染方式仍是純文字(標籤會照字面印出來)
 *
 * 🔴 **兩個訊號都是 code**,所以這一格是靜態測試守得住的 ——
 * 這與 E8-B B5 那支不同:那一片的觸發點在對面 repo 的 runtime,我方一個字都不會變。
 *
 * ## 怎麼讓我閉嘴(兩條路,都算修好)
 *
 * ```
 * 甲 保留樣板分支      ⇒ A 不成立 ⇒ 我不紅(今天的狀態)
 * 乙 拿掉樣板分支,但【同時】把描述的 HTML 處理掉 ⇒ B 不成立 ⇒ 我不紅
 *    (清資料 / 渲染前 strip / 改成受控的富文字元件 —— 哪一種都行,我只看 B 這個條件)
 * ```
 * 🔴 **危險的是「只做甲的相反、沒做乙」** —— 那正是我存在的理由。
 *
 * ## 🔴 什麼時候該把我刪掉
 *
 * **rpm-carbon 的描述接線做完、而且那些描述確認不含 HTML 之後。**
 * 那時本檔會永遠綠 ⇒ **刪掉它,不要留著當紀念**:一個永遠綠的觸發器會被下一個人讀成
 * 「這件事有人在守」,而它已經沒有對象了。
 *
 * ## 資料那一半怎麼查(我守不到,所以把查法留在這裡)
 *
 * ```sql
 * -- 正式庫(bmpnplmnldofgaohnaok)唯讀
 * SELECT b.slug, count(*) AS html_desc, count(*) FILTER (WHERE p.delisted_at IS NULL) AS visible
 *   FROM products p JOIN brands b ON b.id = p.brand_id
 *  WHERE p.description ~ '<[a-zA-Z/][^>]*>' GROUP BY 1;
 * ```
 * **2026-08-21 02:2x 實測**:`rpm-carbon` 933 筆含 HTML 標籤、其中 **914 筆客人看得到**
 * (全站有描述的商品 19,856 / 客人看得到 19,594)。
 * ⚠️ 這個數字**會變**,而且本檔**不會**跟著更新 —— 引用前當場重跑上面那段 SQL。
 *
 * @see docs/patterns/guard-and-instrument-traps.md(量具與守門陷阱)
 */

const TABS = readFileSync(new URL('./ProductTabs.tsx', import.meta.url), 'utf8');

/** 剝註解再比對:註解裡提到某段字,不代表那段 code 還在(guard-and-instrument-traps 的常客)。 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * 訊號 A:**寫死的碳纖樣板分支還在嗎**。
 *
 * 🔴 量的是【結構】(JSX 裡的 `{isRpmCarbon ? …}` 三元),**不是樣板的文案字面**。
 *    第一版兩個都量,結果人造世界④(只改文案、分支還在)**誤紅** ——
 *    文案是會被行銷改的東西,把它當訊號 = 為了一個不相干的改動叫人來看。
 * ⚠️ 代價寫明:有人**保留 `isRpmCarbon` 三元但把它改成別的用途**時,我看不出來。
 *    那個寫法會讓我靜靜地不紅 —— 這是本訊號已知的盲區。
 */
function templateBranchPresent(code: string): boolean {
  return /\{\s*isRpmCarbon\s*\?/.test(code);
}

/**
 * 訊號 B:**描述仍以純文字渲染**。
 * 成立條件:會渲染 `product.description`,而那條路上既沒有 `dangerouslySetInnerHTML`,
 * 也沒有任何剝標籤 / 解實體的動作。任一出現 ⇒ 有人處理過 HTML 了 ⇒ B 不成立 ⇒ 本檔閉嘴。
 */
function descriptionRenderedAsPlainText(code: string): boolean {
  if (!code.includes('product.description')) return false; // 連渲染都不做 ⇒ 沒有這個風險
  const handlesHtml =
    code.includes('dangerouslySetInnerHTML') ||
    /striptags|sanitizeHtml|DOMPurify|stripHtml|replace\(\s*\/<\[\^>\]/.test(code);
  return !handlesHtml;
}

/** 引信是否已經上膛:樣板不見了【而且】還是純文字渲染。 */
function fuseArmed(code: string): boolean {
  return !templateBranchPresent(code) && descriptionRenderedAsPlainText(code);
}

const CODE = stripComments(TABS);

describe('rpm-carbon 描述接線 · 延遲引信觸發器', () => {
  it('前提斷言:量具接到真的檔了(掃到空字串 ⇒ 下面那格恆假、恆綠)', () => {
    expect(TABS.length, 'ProductTabs.tsx 讀不到或是空的').toBeGreaterThan(2000);
    expect(CODE, '剝註解把整支檔吃光了').toContain('ProductTabs');
  });

  it('前提斷言:量具雙向表演(餵人造世界,**不依賴今天的原始碼長什麼樣**)', () => {
    // 🔴 這一格刻意【不】斷言「今天樣板還在」——
    //    那種寫法在「有人正確地拿掉樣板並處理好 HTML」的那天會誤紅,
    //    而誤紅會把人趕出守門的視野(memory feedback_a-false-positive-reroutes-people-out-of-the-guards-view)。
    const withTemplate = '{isRpmCarbon ? (<p>採用真碳纖維材質</p>) : (<p>{product.description}</p>)}';
    const templateReworded = '{isRpmCarbon ? (<p>碳纖維材質改寫</p>) : (<p>{product.description}</p>)}';
    const noTemplate = '{false ? (<p>x</p>) : (<p>{product.description}</p>)}';
    const noTemplateButStripped =
      '{false ? (<p>x</p>) : (<p>{product.description.replace(/<[^>]*>/g, "")}</p>)}';
    const noTemplateButHtmlAware = '{false ? (<p>x</p>) : (<div dangerouslySetInnerHTML={{__html: product.description}} />)}';

    expect(fuseArmed(withTemplate), '樣板還在 ⇒ 不該上膛').toBe(false);
    // 🔴 只改文案、分支還在 ⇒ 不該上膛(第一版在這裡誤紅過)
    expect(fuseArmed(templateReworded), '改個文案就叫人來看 ⇒ 誤報,會把人趕出守門視野').toBe(false);
    expect(fuseArmed(noTemplate), '🔴 樣板拿掉又沒處理 HTML ⇒ 必須上膛').toBe(true);
    expect(fuseArmed(noTemplateButStripped), '有剝標籤 ⇒ 已修好、不該上膛').toBe(false);
    expect(fuseArmed(noTemplateButHtmlAware), '改成受控富文字 ⇒ 已修好、不該上膛').toBe(false);
  });

  it('🔴 樣板分支被拿掉時,描述的 HTML 必須已經有人處理', () => {
    expect(
      fuseArmed(CODE),
      [
        '🔴 rpm-carbon 的寫死樣板分支不見了 ⇒ 真的 description 會開始被渲染,',
        '   而渲染方式仍是【純文字】⇒ 描述裡的 HTML 標籤會照字面印在商品頁上。',
        '',
        '   下一步(擇一,做完本格就綠):',
        '   ① 先把那些描述的 HTML 清掉,再拿掉樣板分支;或',
        '   ② 渲染前 strip 標籤 / 改用受控的富文字元件(不要直接開 dangerouslySetInnerHTML)。',
        '',
        '   🔴 先去量還有幾筆(本檔守不到資料,數字會變):',
        "   SELECT count(*) FROM products p JOIN brands b ON b.id=p.brand_id",
        "    WHERE b.slug='rpm-carbon' AND p.description ~ '<[a-zA-Z/][^>]*>' AND p.delisted_at IS NULL;",
        '   2026-08-21 02:2x 實測 = 914 筆客人看得到。',
      ].join('\n'),
    ).toBe(false);
  });
});
