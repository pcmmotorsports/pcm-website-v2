import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// 相對路徑(#606 前 vitest @ alias 只指 storefront 的歷史遺留;#612 更新:現可用 @/,既有不回改)。
import { stripComments } from '../../lib/test-support/strip-comments';
import { MIN_CONTENT_WIDTH, MIN_PANEL_WIDTH } from '../../lib/layout/workspace-panel';

// workspace-shell.test.ts — #350b 工作區殼的**接線字面**守門。
//
// 🔴 **為什麼這些東西需要一支測試**:本片接的東西壞掉時**都沒有執行期訊號**——
//   ①`app/@panel/default.tsx` 不見了 ⇒ 開發時全程軟導航一路正常,**使用者按 F5 才 404**
//   ②layout 的 `panel` prop 名與資料夾名 `@panel` 對不上 ⇒ 面板永遠不出現、**零錯誤**
//   ③TSX 的 class 名與 `globals.css` 的 `:has()` 選擇器對不上 ⇒ 沒有面板時每頁留一條孤把手
//   而 #350 的偵察實查結論是:**root layout 零測試**、這一整層本來沒有任何守門。
//
// 🔴 **共用 `lib/test-support/strip-comments`,不自己寫一支**(code-reviewer R1 must-fix):
//   我第一版自寫的只剝 `//` 與 doc 續行 ⇒ 把 `panel={panel}` 用 `{/* … */}` 包起來就全綠;
//   而共用那支會剝 `/* */`(codex K2 nit 6 修過的同一形狀)、還帶 `https://` 的 lookbehind。
//   ⚠️ 它原本 `export` 在 `app-sidebar.test.ts` 裡,但 import 一支 `.test.ts` 會讓**它的 describe
//   一起被註冊進來、整組測試跑兩次**(R2 nit 實測)⇒ 已搬到非 test 檔。
//   CSS 那份**也要剝** —— `/* */` 是 CSS 唯一的註解形式,不剝就是把規則註解掉照樣綠。
//
// ⚠️⚠️ **本檔擋得住什麼、擋不住什麼(不要讀成「分割視窗已驗證」)**:
//   擋得住 —— 上面三樣的**檔案/字面**被刪、改名、或註解掉。
//   **擋不住** —— `default.tsx` 內容被改成會炸的東西、拖曳實際上會不會動、`:has()` 在真瀏覽器的切換、
//   重整後寬度真的還在、面板有內容後會不會把列表擠爆、**以及殼多包一層對既有頁面版面的影響**。
//   那些要**真瀏覽器**,已掛 350c 驗收清單 + Sean 肉眼驗清單(主視窗 `D-393-A:12` 核准這個分工)。

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const LAYOUT = stripComments(read('../../app/layout.tsx'));
const SHELL_RAW = read('./workspace-shell.tsx');
const SHELL = stripComments(SHELL_RAW);
const GLOBALS_RAW = read('../../app/globals.css');
const GLOBALS = stripComments(GLOBALS_RAW);

/**
 * ⚠️ **只認三種字面形狀**:`className='…'` / `"…"` / `` {`…`} ``。
 *    實測 `className={cn('workspace-row', x)}` / `clsx(...)` / 三元 / `styles.x` **全部 false**
 *    ⇒ 日後把這支 TSX 改寫成 `cn()` ⇒ **假紅**(方向安全, 而紅的訊息會說「class 不見了」,
 *      而它其實還在)⇒ **撞到時是來這裡加形狀, 不是刪掉這道守門。**
 *    今天 `workspace-shell.tsx` 那四處全是單引號字面 ⇒ 現在不會誤報。
 */
const classTokensOf = (src: string): Set<string> => {
  const out = new Set<string>();
  for (const m of src.matchAll(/className=(?:'([^']*)'|"([^"]*)"|\{`([^`]*)`\})/g)) {
    for (const t of (m[1] ?? m[2] ?? m[3] ?? '').split(/[\s]+/)) if (t) out.add(t);
  }
  return out;
};
/**
 * 🔴 **守門與自檢【一定要走這一個函式】**(審查 must-fix 2):
 * 我第一版讓自檢驗 `classTokensOf`, 而守門那格自己又寫一次比對
 * ⇒ **自檢完全沒有碰到守門的輸入** ⇒ 有人把守門那行改回 `\b`、或把 `SHELL` 換成 `SHELL_RAW`
 *   (連註解掉的 className 都會被算進去), **自檢照樣全綠**。
 * 📌 **一個驗「工具好不好」的自檢, 證不出「有沒有人在用那個工具」。**
 * ⚠️ 天花板:**它證得出這把尺會分辨, 證不出【呼叫點真的呼叫了它】。**
 * 🔴 **我原本在這裡寫「要關上那一格【只能】靠呼叫點薄 + 這段字」—— 那句是假的**,
 *    審查當場給了反例:**把負半寫進守門那格自己的 body、吃守門自己的輸入** ⇒ 換回 `\b` 當場紅。
 * ✅ 已照做, **而第一版沒有成功**:我讓正半走 `tsxHasClass`、負半自己再呼叫一次同一個函式
 *    ⇒ 把守門那行換回 `\b` ⇒ **27 格全綠**(實測)。
 *    📌 **兩半各自呼叫同一個函式, 不等於兩半綁在一起。**
 *    ⇒ 第二版把尺收成 `it.each` body 裡的一個本地 `has` / `hasCss`, 正負兩半吃同一個它
 *      ⇒ 換回 `\b` 或 `includes` **各自實測都是 3 紅**。
 * 🔴 而我在測之前就已經在這裡寫了「已照做」—— **那是我今天第二次先寫結論再驗。**
 *    📌 **「只能」是一個反例就推翻的字, 而我沒有數過就寫了它。**
 */
const tsxHasClass = (src: string, cls: string) => classTokensOf(stripComments(src)).has(cls);
/**
 * CSS 那半的尺:`.name` 而**右邊**不得再接 class 可用字元(`\w` 或 `-`)。
 * ⚠️ **沒有左界** ⇒ `content: ".workspace-row"` 這種**寫在字串裡**的也算「在」。
 *    今天 `globals.css` 沒有這種寫法 ⇒ 不會假綠;**而這是現況不是保證。**
 */
const CSS_CLASS_RULER = (cls: string) => new RegExp(`\\.${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`);
const PANEL_DEFAULT_PATH = fileURLToPath(new URL('../../app/@panel/default.tsx', import.meta.url));

describe('#350b 平行路由槽的接線', () => {
  it('🔴🔴 `app/@panel/default.tsx` **必須存在** —— 沒有它,使用者一按 F5 就 404', () => {
    // 這個坑的惡劣之處是它**只在硬導航/重整時發作**:開發時一路點都是軟導航、全部正常。
    expect(existsSync(PANEL_DEFAULT_PATH)).toBe(true);
  });

  it('🔴 layout 收 `panel` prop,且名字與資料夾 `@panel` 一致(對不上 = 面板永遠不出現、零錯誤)', () => {
    expect(LAYOUT).toMatch(/panel:\s*React\.ReactNode/);
    expect(LAYOUT).toContain('panel={panel}');
  });

  it('🔴 layout **在 server 端讀 cookie** 並把初值傳下去(否則「持久化」只寫不讀)', () => {
    expect(LAYOUT).toContain('parsePanelWidthCookie');
    expect(LAYOUT).toContain('initialPanelWidth={initialPanelWidth}');
  });

  // 🔴🔴 **`forcedTheme='light'` 是「關閉深色」的唯一機制**(2026-08-16 Sean 拍板)。
  //    ⚠️ **`defaultTheme='light'` 擋不住** —— `next-themes` 的 `setTheme` 無條件寫 localStorage,
  //    而 `defaultTheme` 只在**沒存過**時生效 ⇒ 拿掉這個 prop,**曾經切過深色的人會留在深色**,
  //    而切換入口已經移除 ⇒ **沒有出口**。
  //    🔴 **這條沒有守門的話,刪掉它三綠全綠、CI 全綠、沒存過的人全部看不到** ——
  //    症狀只在「存過 dark 的那一台機器」上出現。同 `print:hidden` 那三顆的論證:
  //    **擋得住刪除,而刪除是唯一沒人守的一條路。**
  it("🔴 layout 掛 `forcedTheme='light'`(拿掉 = 存過深色的人鎖死在深色且無出口)", () => {
    expect(LAYOUT).toContain("forcedTheme='light'");
  });
});

// ⚠️ **標題原本寫「唯一的接點」,2026-08-19 更正為「兩個接點」** —— 那句不實:
//    第二個接點是 `>` 直接子代關係(`W4-002` F1)。
//    🔴 **這一處與 `workspace-shell.tsx:124` 是【被抄走的那兩份】** ——
//    片1 當時只改了我自己新寫的那一句,這兩句原封留著。假宣稱會被下一個人抄走,
//    ⇒ **修的時候要 grep 那句話本身,不能只修被 finding 指名的那一行。**
describe('#350b TSX 的 class 名 × CSS 的 `:has()` 選擇器 —— 兩個接點之一', () => {
  // 🔴🔴 **這一格是 code-reviewer 抓到的洞**(memory `feedback_assertion-measures-the-wrong-thing`
  //    第四形狀:兩端各有測試、中間透傳一跳無人守):
  //    原本只斷言「CSS 檔裡有那兩條選擇器」+「TSX 裡有 role='separator'」——
  //    把 TSX 的 `workspace-panel` / `workspace-row` / `workspace-handle` 任一個改名或刪掉,
  //    `:has()` 規則就永遠不匹配 ⇒ **每一頁都常駐一條孤零零的可拖拉線 + 一塊空欄。**
  // 🔴🔴 **而這段註解寫下之後, 那個災難【18 天沒有被守住】, 直到 2026-08-27。**
  //    數法:`git log --format='%h %ad' --date=short --diff-filter=A -- <本檔>` ⇒ `08e56014` **2026-08-09**
  //    🔴 **我上一版的數法是 `git log -S'而測試全綠' ⇒ 唯一命中`, 而【寫下它這件事本身會讓它變假】**:
  //       這段註解自己就含著那根針 ⇒ commit 之後 pickaxe 會多列出這一顆(1 處 → 2 處也算變更)
  //       ⇒ **一道數法, 被記錄它的那個動作弄髒了。**(審查 R2 實測 1→2 的變更確實會被 `-S` 列出。)
  //    ⚠️ **我第一版寫「2026-08-19 寫下…有一年多沒被守住」—— 兩個字面都是我掰的**, 審查用上面那條
  //       git 指令當場打掉。📌 **這支檔本身就是「字面 vs 事實」的紀念碑, 而我在它上面寫了一個假數字。**
  //    原句結尾是「**而測試全綠**」—— 那不是一句警語, 那是一句**當時就成立的事實描述**,
  //    而它下面那兩道尺(`\b` 與 `includes`)在那個世界裡**一起是綠的**。
  //    實測(2026-08-27, 逐一改 TSX 的 className):
  //      workspace-row / workspace-handle 改成 `-v2` ⇒ **全綠 26 passed**
  //      workspace-panel 改成 `-v2` ⇒ 紅, 而紅的是**隔壁那格「直接子代」** —— 不是這兩道尺
  //    📌 **它寫下了那個世界, 建了兩道守門, 而兩道在那個世界裡一起變綠。**
  //       兩道看起來是【互相獨立的第二意見】, 而它們**共用同一個盲區**(都是子字串式的邊界)。
  // ✅ **現在守得住了** —— 而憑證不是「我換了更嚴的比對」, 是下面那格【尺自檢】:
  //    它每次都拿【改名後的樣本】餵這兩把尺, 而它們必須說「不在」。
  //    ⚠️ 射程(逐條, 審查 nit 5 補的那層):
  //       · 守的是**這三個 class 名在 TSX 與 CSS 兩邊各自存在**
  //       · 🔴 **它問的是「全檔某個 className 裡有這個 token」, 不是「在【對的元素】上」**
  //         ⇒ 把 `workspace-handle` 搬到別的 div 上、再刪掉把手元素 ⇒ **這格仍綠**
  //           (`role='separator'` 那格另外擋住一半, 而那是別人的守門不是這一格的)
  //       · 它**證不出**「CSS 那條 `:has()` 在真瀏覽器裡真的收合了」—— 那要量畫面, 不在本檔
  //       · 🔴 而**它證不出「呼叫點真的用了這把尺」** —— 見 `tsxHasClass` 的 docstring
  const PREFIX = '.workspace-row:not(:has(.workspace-panel > *:not(template)))';

  // 🔴🔴 **這把尺 2026-08-27 換過, 而換掉的理由是它【在它自己上面那段註解描述的世界裡是綠的】。**
  //    舊寫法 `new RegExp(\`\\b${cls}\\b\`).test(SHELL)` —— 三個 token **全都含連字號**,
  //    而 JS 的 `\b` 靠 `\w`(ASCII 字母數字底線)判邊界 ⇒ **`-` 不是 `\w`**
  //    ⇒ `/\bworkspace-row\b/` 對 `className='workspace-row-v2'` 回 **true**。
  //    🔴 **修前實測(2026-08-27, 逐一改 TSX 的 className)**:
  //         workspace-row    改成 `-v2` ⇒ **全綠 26 passed**
  //         workspace-handle 改成 `-v2` ⇒ **全綠 26 passed**
  //         workspace-panel  改成 `-v2` ⇒ 紅, **而紅的是隔壁那格「直接子代」** —— 不是這一格
  //    ⇒ **三個裡有兩個可以無聲改名, 而那兩個正是 `:has()` 選擇器指的那兩個。**
  //    ⚠️ 還有第二個更寬的洞:`workspace-shell.tsx:247` 有一個 CSS 變數 `--workspace-panel-width`
  //       ⇒ `/\bworkspace-panel\b/` **光靠那個變數就會 true** ⇒ className 整個刪掉也一樣綠。
  //    📌 母題:**一個「比較好的工具」的真正成本, 是它買到的那份安心。**
  //       `includes` 誰都知道會誤配 ⇒ 大家會另外想辦法;`\b` 讓人覺得已經處理過了。
  //
  // ⇒ 改成**精確 token 比對**:把 TSX 裡每一個 className 字面拆成 token 集合, 問「這個 token 在不在」。
  //    它對「加後綴」與「只剩 CSS 變數」兩個世界都會說不在(下面那格自檢會表演給你看)。

  // 🔴🔴 **尺自檢 —— 這一格才是這次修法的重點, 不是那個更嚴的比對。**
  //    上面那把舊尺之所以能活著, 不是因為沒有人想過改名 —— **它上面那段註解就寫著改名這件事** ——
  //    是因為**從來沒有一發東西【製造過那個世界】**。
  //    ⇒ 所以修法不是換一把更好的尺, 是把「那個世界」變成一格**每次都會跑**的斷言。
  //    📌 通用形狀:**一把尺宣稱擋 X ⇒ 就要有一格拿【X 的樣本】餵它, 而它必須說不。**
  it('🔴 尺自檢:同一把尺對【改名後】與【只剩 CSS 變數】兩個樣本, 必須說「不在」', () => {
    const varOnly = `<div style={{ '--workspace-panel-width': w }} />`;
    // 🔴 走的是守門那格【同一個】`tsxHasClass`, 不是另外複製一份比對邏輯。
    expect({
      改名後: tsxHasClass(`<div className='workspace-row-v2 flex' />`, 'workspace-row'),
      只剩變數: tsxHasClass(varOnly, 'workspace-panel'),
      被註解掉: tsxHasClass(`{/* <div className='workspace-row' /> */}`, 'workspace-row'),
      正常世界: tsxHasClass(`<div className='workspace-row flex' />`, 'workspace-row'),
    }).toEqual({ 改名後: false, 只剩變數: false, 被註解掉: false, 正常世界: true });
    // 🔴 舊尺在同樣樣本上的答案(留著當對照, 它證明這次換尺不是換個寫法而已)。
    // ⚠️ **這兩格【故意恆真】** —— `\b` 對 `-` 的行為是 JS 規範, 不會變 ⇒ 它們**是說明不是守門**。
    //    標出來, 免得下一個稽核的人把它當成一格失效的斷言重新推一次。
    expect({
      舊尺_改名後: /\bworkspace-row\b/.test(`<div className='workspace-row-v2 flex' />`),
      舊尺_只剩變數: /\bworkspace-panel\b/.test(varOnly),
    }).toEqual({ 舊尺_改名後: true, 舊尺_只剩變數: true });
    // CSS 那半的同一組表演(舊寫法是 `includes`)
    const cssRenamed = '.workspace-row-v2:not(:has(.workspace-panel > *)) { }';
    expect({
      新尺_CSS改名後: CSS_CLASS_RULER('workspace-row').test(cssRenamed),
      新尺_CSS正常: CSS_CLASS_RULER('workspace-row').test('.workspace-row:not(:has(x)) { }'),
      舊尺_CSS改名後: cssRenamed.includes('.workspace-row'),
    }).toEqual({ 新尺_CSS改名後: false, 新尺_CSS正常: true, 舊尺_CSS改名後: true });
  });

  it.each(['workspace-row', 'workspace-panel', 'workspace-handle'])(
    '🔴 class `%s` 在 TSX 與 CSS **兩邊都在**',
    (cls) => {
      // 🔴🔴 **正半與負半【必須由同一個表達式產生】** —— 這是本片最貴的一課, 而我付了兩次:
      //    第一版:守門用 `tsxHasClass`, 而負半自己另外呼叫一次 ⇒ **把守門那行換回 `\b`,
      //    27 格全綠**(我實測過, 而我在測之前已經在註解裡寫了「已照做」)。
      //    📌 **兩半各自呼叫同一個函式, 不等於兩半綁在一起。** 綁在一起的是【同一個 `has`】。
      //    ⇒ 現在把尺收成一個本地 `has`:換掉它, 正負兩半一起動 ⇒ 負半當場紅。
      const has = (src: string) => tsxHasClass(src, cls);
      expect({
        [`tsx:${cls}`]: has(SHELL_RAW),
        [`tsx改名後:${cls}`]: has(SHELL_RAW.replaceAll(cls, `${cls}-v2`)),
      }).toEqual({ [`tsx:${cls}`]: true, [`tsx改名後:${cls}`]: false });
      // 🔴 CSS 那半**也有同一個病**:`GLOBALS.includes('.workspace-row')` 是子字串
      //    ⇒ CSS 那邊改名成 `.workspace-row-v2` 它照樣 true。⇒ 釘 class 選擇器的右邊界。
      //    (下面自檢那格連這一半一起表演。)
      const hasCss = (src: string) => CSS_CLASS_RULER(cls).test(src);
      expect({
        [`css:${cls}`]: hasCss(GLOBALS),
        [`css改名後:${cls}`]: hasCss(GLOBALS.replaceAll(`.${cls}`, `.${cls}-v2`)),
      }).toEqual({ [`css:${cls}`]: true, [`css改名後:${cls}`]: false });
    },
  );

  it('🔴 空槽時面板欄**與**把手**兩者**都要被收起來(刪掉其中一條選擇器也要紅)', () => {
    expect(GLOBALS).toContain(`${PREFIX} > .workspace-panel`);
    expect(GLOBALS).toContain(`${PREFIX} > .workspace-handle`);
  });
});

// ── 片1:訂單編輯面板預設 520px、可拖寬(2026-08-21 F-81;推翻 08-19「甲=固定+拿掉拖曳」)──
//
// 🔴 **這組測試 2026-08-21 改寫,不是新增**:原本釘的是「CSS `:has()` 鎖死寬度 + 藏把手」,
//    而 Sean 在端過三張實體版本後**改拍「乙=留著拖曳、預設值改720」**,推翻了 08-19 那次的「甲」
//    (逐字見 `~/pcm-mailbox/F-81-W1-001-Q0Q1整理-20260821.md` Q0)。
//    ⇒ 舊測試釘的正是【Sean 明確反轉掉的那個行為】,不是釘正確性 —— 改測試在這裡不是
//    「為了讓測試綠而改測試」,是舊斷言的前提本身已經不成立。原本 6 個 it 區塊(標記兩邊都在
//    含CSS / 兩個return帶標記 / width:720px+不得有min-width / 把手要收掉 / {panel}直接子代)
//    改寫成下面 4 個:標記只留 TSX 側(CSS 不再有這條規則)、shell 用 JS 讀 marker 決定預設值、
//    CSS 不得再出現舊的鎖寬/藏把手規則(防止被靜默抄回來)。
//
// 🔴 **為什麼還需要守門,理由與上面那組同型**:接點換成「JS 讀 DOM 找 marker」,
//    壞掉時一樣**沒有執行期訊號** —— marker 被改名或拿掉 ⇒ 訂單面板安靜地變成「視窗一半」,
//    看起來像正常的殼行為,不像故障。
// ⚠️ **擋得住 / 擋不住**:擋得住 —— marker class 被改名/刪掉、CSS 舊鎖寬規則被抄回來、
//    shell 的預設值邏輯被改掉。**擋不住** —— 720 在 Sean 螢幕上好不好看、真的拖曳手感、
//    窄視窗下內容區被壓扁。那些要真瀏覽器 + Sean 的眼睛(2026-08-21 F-81 已用真瀏覽器
//    〔`http://localhost:3021`〕驗過兩個世界:清 cookie 後開訂單面板 ⇒
//    `--workspace-panel-width` 算出 720px;清 cookie 後開一個沒有 marker 的槽〔`/orders` 無
//    `panel` 參數〕⇒ 算出 600px = 1200 視窗的一半,兩個世界印不同的值,量法有判別力)。
const PANEL_ROUTE_RAW = read('../../app/@panel/orders/page.tsx');
const PANEL_ROUTE = stripComments(PANEL_ROUTE_RAW);

describe('片1 訂單編輯面板預設 520px、可拖寬', () => {
  // ⚠️ **射程**:本組只讀 `app/@panel/orders/page.tsx` 這一支 route。
  //    `@panel` 槽底下其餘兩支(`default.tsx` / `[...catchAll]/page.tsx`)**一律回 `null`、不渲染面板**
  //    ⇒ 今天不會有第二個產生點。日後若有人新增會渲染內容的槽路由,**本組看不到它**。
  it('🔴 標記 class `panel-width-locked` 在**面板路由**與 `workspace-shell.tsx` 兩邊都在(對不上 = 安靜地退回視窗一半)', () => {
    // 🔴 **同一個病, 同一支檔**(審查 nit 3):`panel-width-locked` 也含連字號
    //    ⇒ 舊寫法 `/\bpanel-width-locked\b/` 對 `panel-width-locked-v2` 回 true、
    //      `SHELL.includes(...)` 更寬。⇒ 兩邊都換成上面那組尺。
    //    📌 **上面那格寫「現在守得住了」, 而它當時只涵蓋一個 describe** ——
    //       一句範圍是「這一格」的話, 讀起來像範圍是「這支檔」。
    expect({ tsx: tsxHasClass(PANEL_ROUTE_RAW, 'panel-width-locked') }).toEqual({ tsx: true });
    // shell 那半它不是 className, 是 `querySelector('.panel-width-locked')` 裡的字串
    // ⇒ 用 CSS 那把尺釘右邊界。
    // ⚠️ **而這一半實測【被下面那格整句字面釘死的斷言完全涵蓋】**(審查 nit):
    //    沒有「只有這一半紅」的世界 ⇒ 它是那一格的弱化重複, 留著當可讀性, **不要當成主要防線**。
    //    🔴 **這裡刻意不寫那一格的行號** —— 我上一版寫「見 `:230`」而它其實在別處,
    //       而 `:230` 是另一件事(數 `@container` 出現兩次)⇒ **指到一個存在、相關、但不是它的行。**
    //       ⇒ 改用字面錨:grep `querySelector` + `panel-width-locked`。
    // ⚠️ 失效世界:`classList.contains('panel-width-locked')` 這種**無點**寫法 ⇒ 這把尺回 false = 假紅。
    expect({ shell: CSS_CLASS_RULER('panel-width-locked').test(SHELL) }).toEqual({ shell: true });
  });

  // 🔴 客人卡那條 return 少了標記的話,點「客人明細」面板會從 520 跳回視窗一半、
  //    關掉再跳回來 —— 一個只在**點下去那一刻**才看得到的抖動。
  // 🔴 **不要只數出現次數** —— 那把尺會被「有人在註解裡提到這個 class」推歪
  //    (本片自己就差點踩到:原始碼裡連註解共 3 次、剝註解後才是 2 次)。
  //    改成**釘在它該出現的位置**:標記必須緊貼在 `@container` 之後,那是兩個 return 的 div 各一。
  it('🔴 面板路由的**兩個** return 都帶標記(客人卡是蓋在同一塊面板上,不是獨立視圖)', () => {
    expect(PANEL_ROUTE.match(/@container panel-width-locked/g)?.length).toBe(2);
  });

  // 🔴🔴 **這一格是本片核心**:沒有 cookie 偏好時,shell 要用 JS 查 DOM 有沒有 marker,
  //    有 ⇒ 預設 520、沒有 ⇒ 退回視窗一半(defaultPanelWidth)。
  //    這是原本「CSS `:has()` 鎖死寬度」的替代品 —— 差別是這裡只決定**預設值**,
  //    寬度仍然可拖(下面「可拖」那格另外釘)。
  it('🔴 shell 沒有 cookie 偏好時:查 `.panel-width-locked` marker,有 ⇒ 預設 520,沒有 ⇒ `defaultPanelWidth`', () => {
    expect(SHELL).toMatch(/querySelector\(['"]\.panel-width-locked['"]\)/);
    // 🔴 2026-08-24 Sean 拍「520」⇒ 期望值跟著改。**改的是值,不是判準** ——
    //    這一格仍然釘著「有 marker ⇒ 用那個字面;沒有 ⇒ 退回 defaultPanelWidth」的形狀。
    expect(SHELL).toMatch(/hasOrderPanelMarker\s*\?\s*520\s*:\s*defaultPanelWidth/);
  });

  // 🔴🔴 **防止舊機制被靜默抄回來**:若有人複製前一版的 CSS 區塊貼回 globals.css,
  //    寬度會被重新鎖死、把手會被重新藏起來,而上面那格(讀 SHELL)完全看不到這件事
  //    ——兩個檔案分開守,任一邊被改都要紅。
  it('🔴 `globals.css` 不得再出現舊的「鎖寬 + 藏把手」`:has()` 規則(防止被抄回來)', () => {
    expect(GLOBALS).not.toContain('.workspace-row:has(.workspace-panel > .panel-width-locked)');
  });

  it('🔴 拖曳把手不得被任何規則藏起來(handle 必須在 TSX 裡無條件渲染,不能包在條件式後面)', () => {
    // 🔴 用詞邊界找 `panel-width-locked`/`workspace-handle` 之間**不得**同時出現在一個
    //    條件渲染表達式裡 —— 具體檢法:handle 那個 <div> 前面不能緊跟著依 marker 決定
    //    要不要渲染的三元/邏輯運算子。簡化為:SHELL 裡只有一處 `workspace-handle`
    //    className 字面,且它前面沒有 `panel-width-locked` 相關的條件包裹。
    expect(SHELL.match(/workspace-handle/g)?.length).toBeGreaterThanOrEqual(1);
    expect(SHELL).not.toMatch(/panel-width-locked[^]*?workspace-handle.*?\?/);
  });

  // 🔴🔴 **2026-08-21 B 窗(pcm-website-v2-15)審查抓到的 must-fix,修回**:
  //    上面刪掉寬度鎖那組舊 it 時,把這一格也一起刪了——理由「CSS `:has()` 整個拿掉了」
  //    只對**寬度鎖那條** `:has()` 成立。`globals.css` 裡**還有另一條沒動的** `:has()`
  //    (①「空槽收合」,`.workspace-row:not(:has(.workspace-panel > *:not(template)))`)
  //    同樣依賴「`{panel}` 是 `.workspace-panel` 的直接子代」這件事 ——
  //    在 `workspace-shell.tsx:154` 多包一層(error boundary / 捲動容器 / `<Suspense>`)
  //    一樣會讓它安靜失配,class 名一個字沒動、其餘測試照樣全綠,而**每一頁都吃掉半個畫面**。
  //    ⇒ 這格守的從來是【共用的曝險】,不是寬度鎖專屬;寬度鎖那條規則沒了,
  //      空槽收合那條**還活著**,守它的斷言不能跟著消失。
  it('🔴 `{panel}` 必須是 `.workspace-panel` 的**直接子代**(多包一層 ⇒ 空槽收合那條 `:has()` 安靜失配)', () => {
    expect(SHELL).toMatch(/className='workspace-panel shrink-0'>\{panel\}/);
  });
});

describe('#350b 寬度夾範圍:CSS 與 TS 常數是同一組規則的兩個落點', () => {
  // 🔴 夾範圍改在 CSS 做之後(第一幀就正確、不會因縮視窗把偏好永久改小),
  //    同一組數字就有了**兩個落點** ⇒ 改一邊不改另一邊,兩者會靜默分歧:
  //    CSS 說最少 320、TS 說最少 400 的話,拖曳夾出來的值與畫面實際寬度不一致,
  //    而 `aria-valuemin` 報的是 TS 那個 = 對輔具說謊。
  // 🔴🔴 **本格必須限定在規則② 的區塊內,不能掃全檔**(2026-08-19 `W4-003` F1)。
  //    片1b 讓 `calc(100% - 480px)` 在 stripped CSS 裡從 **1 處變成 2 處**
  //    (規則② `.workspace-panel` 的夾範圍 / 規則③ 鎖寬那條的讓步線)
  //    ⇒ 原本的 `GLOBALS.toContain(...)` 會**被規則③ 滿足**,而它要守的是規則②。
  //    **W4 實跑過失敗情境**:只把規則② 改成 `calc(100% - 400px)`、規則③ 原封不動
  //    ⇒ 常數已經漂移,而本檔 **20 格全綠** —— 那正是本格存在的唯一理由。
  // 🔴 **根因與我在片1b 自己踩的那個【是同一個】**:同一個字面現在有兩處,
  //    任何「找第一個 / 找全檔」的工具都會找到錯的那一處。
  //    ⇒ **修了自己的量具還不夠,要回頭看【還有誰在用同一個字面找東西】。**
  it('🔴 `min-width` / `max-width` 的數字與 `workspace-panel.ts` 的常數一致(限定規則②)', () => {
    const i = GLOBALS.indexOf('.workspace-panel {');
    expect(i).toBeGreaterThan(-1);
    // ⚠️ 依賴「規則② 的宣告區塊裡沒有 `}`」—— CSS 宣告區塊本來就不能巢狀,今天成立。
    //    (同樣的依賴在片1 那組也有,兩處都寫下來,不要靠讀的人自己推。)
    const rule2 = GLOBALS.slice(i, GLOBALS.indexOf('}', i));
    expect(rule2).toContain(`min-width: ${MIN_PANEL_WIDTH}px`);
    expect(rule2).toContain(`max-width: calc(100% - ${MIN_CONTENT_WIDTH}px)`);
  });

  it('🔴 `:has()` 要排除 `<template>`(React streaming 會插它,否則面板永遠收不起來)', () => {
    expect(GLOBALS).toContain('*:not(template)');
  });
});

describe('#350b 殼是共用基礎設施,不得為業務量身訂做', () => {
  it('🔴 殼的原始碼不得出現任何業務概念(wave-plan `:23`:E 的取消畫面與 B 的收款讀面都要掛進來)', () => {
    // 一旦殼認得 `order`,E/B/347-3 接進來時就要拆掉重做 —— 而那時它已經上線、動它要付回歸的代價。
    // 🔴 **詞邊界比對,不能用 `includes`**:Tailwind 的 `bg-border` 裡就含 `order` ⇒ 子字串會假紅,
    //    而一個只會誤報的守門,下一個人會直接把它刪掉 = 這條規則等於沒存在過。
    const code = SHELL.toLowerCase();
    for (const word of ['order', 'shipment', 'refund', 'customer']) {
      expect({ [word]: new RegExp(`\\b${word}\\b`).test(code) }).toEqual({ [word]: false });
    }
    expect({ 訂單: SHELL.includes('訂單') }).toEqual({ 訂單: false });
  });
});

describe('#350b 捲動模型:殼不得順手改掉全站的捲動行為', () => {
  // 🔴🔴 **這一格守的是一條「不要做某件事」的規則**(code-reviewer 抓到的第一條 must-fix):
  //    第一版把 row 寫成 `min-h-0 flex-1`、main 加 `overflow-auto` —— 看起來只是排版,實際上
  //    `sidebar-wrapper` 有 `min-h-svh` ⇒ row 一旦 `min-h-0` 就拿到確定高度、`overflow-auto` 真的生效
  //    ⇒ **全站從「document 捲」變成「main 內捲」**,而 `multi-check-filter` 那種非 portal 的
  //    `absolute` 下拉(訂單列表篩選在用)會被新的 scroll container **裁切**。
  //    ⇒ 殼只負責「多切一欄」,不順手改每一個既有頁面的行為;面板自己的捲動留 350c(那時看得見)。
  // 🔴🔴 **兩格都要哨兵**(code-reviewer R2 must-fix:第一格原本恆真):
  //    `?? ''` 之後 `''.not.toContain('overflow')` **會通過** ⇒ 把 className 改成雙引號、
  //    或改成 `className={cn(...)}`,regex 抽不到、斷言照樣綠,而它要擋的回歸原封不動存在。
  //    抽不到就是「守門瞎了」,必須紅 —— 這是 memory 記過的恆真形狀,我在同一支檔裡犯了一次。
  it('🔴 內容區不得成為新的 scroll container(抽不到 class 也要紅)', () => {
    const content = /className='workspace-content([^']*)'/.exec(SHELL)?.[1] ?? 'MISS';
    expect(content).not.toBe('MISS');
    expect(content).not.toContain('overflow');
  });

  it('🔴 workspace-row 不得帶 `min-h-0`(那是讓 overflow 真的生效的那一半)', () => {
    const row = /className='workspace-row([^']*)'/.exec(SHELL)?.[1] ?? 'MISS';
    expect(row).not.toBe('MISS');
    expect(row).not.toContain('min-h-0');
  });
});

describe('#350b 無障礙:分隔線不能只有滑鼠拖得動、也要報得出位置', () => {
  it('🔴 handle 有 separator 語意 + 可聚焦 + 鍵盤可調', () => {
    expect(SHELL).toContain("role='separator'");
    expect(SHELL).toContain('tabIndex={0}');
    expect(SHELL).toContain('onKeyDown');
    expect(SHELL).toMatch(/aria-label=/);
  });

  it('🔴 可聚焦的 separator 依 ARIA **必須**報得出 valuenow/min/max(只有 label 等於讀不到拖到哪)', () => {
    for (const attr of ['aria-valuenow', 'aria-valuemin', 'aria-valuemax']) {
      expect({ [attr]: SHELL.includes(attr) }).toEqual({ [attr]: true });
    }
  });
});

// 🔴 組4(§12 交接檔標「本批最大的一格」,2026-08-24 plan 批准動手)——
//    手機(≤767px)面板整片蓋滿螢幕。真瀏覽器行為/computed style/截圖已在真後台驗過,
//    本檔只是**字面哨兵**:擋住「這段 @media 區塊被靜默刪掉/改壞」,不重複驗行為。
//    🔴 14 條宣告、4 個選擇器同一片(§12 只記到 `.workspace-panel` 那 9 條,漏了 `.workspace-row`
//    display:block 與 `.workspace-handle` display:none 這 2 條 —— 少了它們會做出稿上不存在的中間態;
//    code-reviewer R1 又抓到漏搬 `.workspace-panel > .panel-width-locked` 那 3 條,2026-08-24 補上)。
/**
 * 🔴🔴 **2026-08-25:本組原本 4 處各自 `.exec(GLOBALS)` —— 而 `.exec()` 只回【第一個】命中。**
 *
 * `@media (max-width: 767px) {` 在 `globals.css` 裡 **命中 2 處**(另一處裝的是 `.fchip`)。
 * 舊寫法拿第一處,而它今天剛好就是裝 `.workspace-*` 的那一處 ⇒ **綠,但靠的是排列順序這個
 * 外部事實,不是它自己有判別力。** 有人在前面插入第三個 767px 區塊,它就讀到別人的區塊。
 *
 * ⚠️ **不能照「命中 >1 就 throw」的通用處方套** —— 命中本來就是 2(`.fchip` 那個是正常結構,
 *    不是誘餌)⇒ 照字面套會**當場紅**。**把好的弄紅,與把證據關掉,是互為反面的同一種錯。**
 * ⇒ 改成把閘收在「**裝著 `.workspace-` 的那些 767px 區塊**」上 —— 那才是本組真正在問的東西。
 *
 * 另外修掉一個潛在坑:舊的 `[\s\S]*?\n\}` 靠「內層規則有縮排、外層 `}` 頂格」來停,
 * **那是格式假設不是結構**。本函式改用**大括號配對**切,格式怎麼縮排都不影響。
 *
 * 兩個方向都會叫:0 個 ⇒ 結構變了;>1 個 ⇒ 有人把這片拆成兩塊,先確認哪一塊才是生效的。
 */
function mobilePanelMediaBlock(): string {
  const ANCHOR = '@media (max-width: 767px) {';
  const blocks: string[] = [];
  for (let at = GLOBALS.indexOf(ANCHOR); at !== -1; at = GLOBALS.indexOf(ANCHOR, at + 1)) {
    let depth = 1;
    let j = at + ANCHOR.length;
    for (; j < GLOBALS.length && depth > 0; j += 1) {
      if (GLOBALS[j] === '{') depth += 1;
      else if (GLOBALS[j] === '}') depth -= 1;
    }
    blocks.push(GLOBALS.slice(at + ANCHOR.length, j - 1));
  }
  const mine = blocks.filter((b) => b.includes('.workspace-'));
  if (mine.length !== 1) {
    throw new Error(
      `\`${ANCHOR}\` 全檔 ${blocks.length} 處,其中裝著 \`.workspace-\` 的有 ${mine.length} 處(期望剛好 1 處)。` +
        (mine.length === 0
          ? ' 結構變了 —— 這片手機面板規則被刪掉或搬走了,本守門要重寫。'
          : ' 有人把這片拆成兩塊 ⇒ 先確認哪一塊才是層疊生效的那一塊,再改本守門' +
            ' —— 不要讓它繼續讀第一塊(那正是本組 2026-08-25 修掉的病)。'),
    );
  }
  return mine[0]!;
}

describe('組4 手機面板全螢幕覆蓋(14 條宣告同一片,零覆蓋,見 globals.css 該段出處)', () => {
  it('🔴 `@media (max-width: 767px)` 裡四個選擇器都在,一個都沒有漏', () => {
    const mediaBlock = mobilePanelMediaBlock();
    expect(mediaBlock, '這個 media block 必須抓得到,抓不到代表選擇器或格式被改動').not.toBe('');
    expect(mediaBlock).toContain('.workspace-row');
    expect(mediaBlock).toContain('.workspace-handle');
    expect(mediaBlock).toContain('.workspace-panel');
    expect(mediaBlock).toContain('.workspace-panel > .panel-width-locked');
  });

  it('🔴 `.workspace-row` 手機改直排,`.workspace-handle` 手機藏起來(桌機並排/可拖曳,這兩條只在手機生效)', () => {
    const mediaBlock = mobilePanelMediaBlock();
    expect(mediaBlock).toMatch(/\.workspace-row\s*\{\s*display:\s*block;?\s*\}/);
    expect(mediaBlock).toMatch(/\.workspace-handle\s*\{\s*display:\s*none;?\s*\}/);
  });

  it('🔴 `.workspace-panel` 手機整片蓋滿(9 條宣告逐一命中,不是只有 position:fixed)', () => {
    const mediaBlock = mobilePanelMediaBlock();
    const panelBlock = /\.workspace-panel\s*\{([\s\S]*?)\}/.exec(mediaBlock)?.[1] ?? '';
    for (const decl of [
      'position: fixed',
      'inset: 0',
      'z-index: 60',
      'width: 100% !important',
      'min-width: 0',
      'max-width: none',
      'overflow: auto',
      'background: var(--card)',
      'overscroll-behavior: contain',
    ]) {
      expect(panelBlock, decl).toContain(decl);
    }
  });

  it('🔴 `.workspace-panel > .panel-width-locked` 手機覆寫(code-reviewer R1 must-fix,2026-08-24 補)', () => {
    const mediaBlock = mobilePanelMediaBlock();
    const lockedBlock = /\.workspace-panel > \.panel-width-locked\s*\{([\s\S]*?)\}/.exec(mediaBlock)?.[1] ?? '';
    for (const decl of ['height: 100%', 'max-height: 100svh', 'border-left: 0']) {
      expect(lockedBlock, decl).toContain(decl);
    }
  });

  it('🔴 `#od-stage` 不搬的理由必須寫在 comment 裡(查無元素,§12 已判不適用;查 comment 用 RAW,GLOBALS 已剝註解)', () => {
    expect(GLOBALS_RAW).toContain('od-stage');
    expect(GLOBALS_RAW).toContain('刻意不搬');
  });
});
