// title-shape-gate.ts — 品名形狀判別(rpm-import 第七道 gate;2026-08-21 W1)
//
// 🔴 **起因**:客人站上真的出現一件品名 `#N/A` 的商品(`PED-GP EVO PPV4`,NT$1,600)。
//    源頭 `product_name_zh` 是試算表的 `#N/A`,原文 `product_name`(Master cylinder brake pin)是好的。
//    它穿過既有六道 gate 上架 —— **因為那六道沒有一道看品名**。
//
// 🔴 **判準(codex 關卡2 沒有質疑這句,質疑的是實作比它窄)**
//      「**這個字串本身有沒有任何商品資訊?**」
//        · 完全沒有 ⇒ **block**(WRITE 整批 abort)。任何供應商都不會這樣命名。
//        · 有資訊但形狀可疑 ⇒ **warn,永不擋**。那是啟發式,擋了等於為一個猜測停掉整家同步。
//
// 🔴 **字集 vs 正規化(codex 關卡2 A 堆,5 條 must-fix 的共同形狀)**
//    第一版的字集是**照著今天那一件的長相**列的 ⇒ `#n/a` / `#N/A!` / `Ｎ／Ａ` / `(null)` /
//    `TBD.` / 零寬字元包住的 null 全部繞過,**而結果長得像零命中**。
//    ⇒ 修法**不是再加十個字面**(那是打地鼠),是**先正規化再判**:
//      NFKC + 去零寬/雙向控制字 + 解 HTML 空白實體 + 去標籤 + 兩端去標點 + casefold。
//      MF-2 / MF-3 / MF-4 / MF-5 因此一起解掉。
//
// 🔴 **而 codex MF-1 是同一格的【反方向】**:我為了不誤殺 17 件英文品名把「中文」放寬成 `\p{L}`,
//    而 `\p{L}` 仍然擋掉「沒有字母但有資訊」的那一類 —— 純數字型號、`360°`、圈號、emoji。
//    ⇒ 「沒有商品資訊」的正確定義是**整串只有標點/空白/格式字元**,不是「沒有字母」。
//
// ⚠️ **擋不到的**:名字看起來正常但**翻錯**(A 的名字掛到 B)。形狀檢查對語意無能為力。

export type TitleVerdict = { level: 'block' | 'warn'; id: string; why: string } | null;

/** 零寬與雙向格式字(可以把 null / TBD 包起來繞過字面比對)。 */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/gu;
/** C0/C1 控制字元(不含 \n \r \t —— 那三個只 warn,見 J)。 */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;
/** 渲染後等於空白的 HTML 實體 + 換行標籤(瀏覽器看到的是空品名)。 */
const BLANK_HTML = /&(nbsp|ensp|emsp|thinsp|zwnj|zwj|ZeroWidthSpace|#x?0*(a0|A0|160|8203|8204|8205|2002|2003);?);|<br\s*\/?>/gi;
/** 任何 HTML 標籤。 */
const ANY_TAG = /<[^>]*>/g;
/** 兩端的標點與空白(讓 `(null)` / `-- TBD --` / `待補。` 收斂到核心字)。 */
const EDGE_PUNCT = /^[\p{P}\p{Z}\s]+|[\p{P}\p{Z}\s]+$/gu;

/**
 * 正規化到「拿來比對的核心字」。**這是 A 堆五條 must-fix 的單一修法。**
 * NFKC 把全形 `Ｎ／Ａ`、`ｎｕｌｌ`、全形數字收斂成 ASCII;去隱形字;把渲染成空白的 HTML 變成空白;
 * 去標籤;兩端去標點;casefold。
 */
export function canonicalTitle(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(BLANK_HTML, ' ')
    .replace(ANY_TAG, ' ')
    .replace(EDGE_PUNCT, '')
    .toLowerCase();
}

/** 只做前後空白正規化(含全形空白),給「顯示層是不是空的」用。 */
export function normalizeTitle(raw: string): string {
  return raw.replace(/^[\s\u3000\u00A0]+|[\s\u3000\u00A0]+$/g, '');
}

/** 渲染後的可見文字(解實體 + 去標籤 + 去隱形字);用來判「客人看到的是不是空的」。 */
export function renderedTitle(raw: string): string {
  return normalizeTitle(
    raw.normalize('NFKC').replace(INVISIBLE, '').replace(BLANK_HTML, ' ').replace(ANY_TAG, ' '),
  );
}

/** 試算表錯誤代碼詞彙(比對前已 casefold;尾隨 ! ? . 由樣式吸收)。 */
const ERROR_WORDS = ['n/a', 'ref', 'value', 'div/0', 'name', 'null', 'num', 'spill', 'calc', 'getting_data', 'error'];
/** 「空值的字串形式」詞彙。 */
const NULLISH = ['null', 'undefined', 'nan', 'none', 'nil', 'n/a', 'na', 'nul', 'nothing'];
/** 佔位詞彙。 */
const PLACEHOLDER = ['tbd', 'todo', 'tba', 'xxx', 'test', 'testing', 'sample', 'untitled', 'placeholder',
  '測試', '未命名', '待補', '待確認', '待填', '無', '暫定', '未定'];

const ERROR_RE = new RegExp(`^#(${ERROR_WORDS.map((w) => w.replace(/[/]/g, '\\/')).join('|')})[!?.]*$`);

/**
 * 錯誤代碼專用正規化:**保留開頭的 `#`**。
 * 🔴 `canonicalTitle` 會把兩端標點都吃掉(`#REF!` → `ref`),而那樣就分不出
 *    「試算表錯誤代碼 `#REF!`」與「一個真的叫 REF 的商品」——
 *    `name` / `value` / `num` / `error` 都是真的英文字,少了 `#` 這道錨就會誤殺。
 */
function errorCore(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(/^[\s\u3000\u00A0]+|[\s\u3000\u00A0]+$/g, '')
    .toLowerCase();
}

type Rule = { id: string; why: string; hit: (c: string, raw: string) => boolean };

/** 零商品資訊 ⇒ block。 */
const BLOCK: ReadonlyArray<Rule> = [
  { id: 'A 試算表錯誤字串', why: '來源公式沒算出來', hit: (_c, raw) => ERROR_RE.test(errorCore(raw)) },
  { id: 'B 字面 null', why: '翻譯或欄位對應拿到空值的字串形式', hit: (c) => NULLISH.includes(c) },
  // 🔴 C 看的是【渲染後】:`&nbsp;` / `&#xA0;` / `<br>` 在瀏覽器上就是空品名(codex MF-5)。
  { id: 'C 空或渲染後為空', why: '客人看到的是空品名', hit: (_c, raw) => renderedTitle(raw) === '' },
  // 🔴 D:「沒有商品資訊」= 整串只有標點/空白/格式字元。**不是「沒有字母」**(codex MF-1):
  //    純數字型號 `360`、`360°`、圈號 `①`、emoji 都是合法品名,`\p{L}` 會把它們全擋掉。
  { id: 'D 只有標點或空白', why: '沒有任何可讀資訊', hit: (_c, raw) => {
      const r = renderedTitle(raw);
      return r !== '' && /^[\p{P}\p{Z}\p{C}\s]+$/u.test(r);
    } },
  { id: 'E 亂碼', why: '編碼壞掉(U+FFFD 替代字元)', hit: (_c, raw) => raw.includes('\uFFFD') },
  { id: 'F 佔位字', why: '有人留了佔位沒填', hit: (c) => PLACEHOLDER.includes(c) },
  { id: 'G 控制字元', why: '欄位被切壞', hit: (_c, raw) => CONTROL.test(raw) },
];

/** 形狀可疑但仍有資訊 ⇒ warn,永不擋。 */
const WARN: ReadonlyArray<Rule> = [
  // 🔴 J 排在 I 前面(codex nit :73):換行/tab 也是「前後空白」,先命中 I 的話診斷標籤會指錯方向。
  { id: 'J 含換行或 tab', why: '可修的內容問題', hit: (_c, raw) => /[\n\r\t]/.test(raw) },
  { id: 'I 前後有多餘空白', why: '可修的內容問題,不值得停掉整批', hit: (_c, raw) => raw !== normalizeTitle(raw) },
  { id: 'K 含 HTML 標籤或實體', why: '來源沒解碼,可修', hit: (_c, raw) => /<[^>]+>|&[a-z]+;|&#x?[0-9a-f]+;/i.test(raw) },
  // 🔴 L 排在 H 前面:單字元同時像料號也算極短,而【極短】才是更具體的描述。
  //    用 code point 數,不用 UTF-16 length(codex nit :67:é 的 NFD 形與 astral 字元會數錯)。
  { id: 'L 品名極短', why: '可能是切壞,但單字商品名存在', hit: (_c, raw) => {
      const r = renderedTitle(raw);
      return r.length > 0 && [...r].length < 2;
    } },
  { id: 'H 疑似料號當品名', why: '可能沒翻譯到,但也可能本來就這樣叫',
    hit: (_c, raw) => { const r = normalizeTitle(raw); return /^[A-Z0-9][A-Z0-9._/\- ]*$/.test(r) && !/[a-z]/.test(r) && [...r].length <= 20; } },
];

/** 判一個品名:block(零資訊)/ warn(可疑)/ null(正常)。block 優先於 warn。 */
export function classifyTitle(raw: string): TitleVerdict {
  const c = canonicalTitle(raw);
  const b = BLOCK.find((r) => r.hit(c, raw));
  if (b) return { level: 'block', id: b.id, why: b.why };
  const w = WARN.find((r) => r.hit(c, raw));
  if (w) return { level: 'warn', id: w.id, why: w.why };
  return null;
}

/**
 * 🔴 **門檻(主視窗 2026-08-21 裁定「丙」)**:一筆壞品名 ⇒ 跳過那一筆、其餘照匯;
 * 一整片壞掉 ⇒ 整批 abort。
 *
 * **為什麼不是整批 abort(甲)**
 *   · 一筆壞品名的損害 = 一件商品沒更新。局部、可見、可修。
 *   · 整批 abort 的損害 = 那家【全部】商品的價格與庫存停更,而畫面上一切正常。
 *     那是件一 EBC 那條線的形狀:後果不是「68 件掉未分類」,是**整家停更**。
 *   · 誤擋機率不會歸零 ⇒ 把單筆誤擋的後果設成整家停更 = 把小錯放大成大事故。
 *   · 🔴 而甲**今天根本沒有保護到客人**:那件 `#N/A` 現在就在架上賣 NT$1,600,
 *     abort 不會讓它下架,只會讓其他 6,407 群停更 ⇒ **代價是真的,買到的保護是零。**
 *
 * **這兩個數字怎麼來的(其中一個我答不出來,明說)**
 *   · 比例 5% = **沿用本 repo 既有慣例**,不是我發明的:rpm-import 的抓取完整性 gate `>5%`、
 *     null-v2 比例 gate `>5%` 都用同一個數字表示「來源看起來壞了」。不發明第七種門檻。
 *   · 絕對下限 3 = 🔴 **保守值,沒有歷史分布可以推**。可查到的只有當下狀態:
 *     全站 20,357 件中壞品名 1 件、報價單庫 52,651 筆中 1 筆。**沒有第二個時間點**
 *     (2026-07-15 那兩張備份表是 fitment 修正備份、沒有品名欄)⇒ 我量不到「歷史上壞過幾筆」。
 *     取 3 的理由:1 是實測值;2 仍可能是兩個獨立個案;3 是最小的「不像巧合」值。
 *     ⇒ **有第二個時間點之後要重新檢討這個數字**,不要把它當成量出來的。
 */
export const TITLE_GATE_ABORT_MIN = 3;
export const TITLE_GATE_ABORT_RATIO = 0.05;

export type TitleGateAction = 'pass' | 'skip' | 'abort';

/** 兩個條件都成立才 abort:數量夠多【且】占比夠高。任一不成立 ⇒ 跳過那幾筆、其餘照匯。 */
export function decideTitleGateAction(blocked: number, total: number): TitleGateAction {
  if (blocked === 0) return 'pass';
  const systemic = blocked >= TITLE_GATE_ABORT_MIN && total > 0 && blocked / total > TITLE_GATE_ABORT_RATIO;
  return systemic ? 'abort' : 'skip';
}

/** abort 訊息:整批不寫。**與 skip 訊息刻意長得不一樣** —— 否則兩種情境在畫面上又變成同一件事。 */
export function titleGateAbortMessage(n: number, total: number, listed: number): string {
  const pct = total > 0 ? ((n / total) * 100).toFixed(1) : '?';
  return (
    `🔴 品名形狀 gate:整批 abort、【一筆都不寫】。\n` +
    `  ${n} / ${total} 群(${pct}%)的品名沒有任何商品資訊 —— 這個比例不像個案,像來源壞了。\n` +
    `  (上表列出 ${listed} 筆${n > listed ? `,尚有 ${n - listed} 筆未列出 —— 修完上表【還會再擋】,請一次修完全部 ${n} 筆` : ''})\n` +
    `  下一步:先確認【報價單側的來源或翻譯流程是不是壞了】,不要逐筆手改。\n` +
    `  修好之後重跑 dry-run 確認本 gate 回 0,再帶 --confirm-write。`
  );
}

/**
 * skip 訊息。🔴 **不准寫「已跳過」** —— 那聽起來像處理完了。
 * 主視窗 2026-08-21 裁定:跳過的那幾筆**留在架上、不自動下架**(自動下架是靠啟發式驅動、
 * 對客人可見的動作,而這把尺今天才剛被證明會製造「太寬」;而且下架要 Sean 拍)。
 * ⇒ 訊息必須把「它還在賣、而它停止更新了」講出來。
 */
export function titleGateSkipMessage(ids: ReadonlyArray<string>): string {
  return (
    `⚠️ 品名形狀 gate:${ids.length} 群品名沒有任何商品資訊,**本次不寫入它們**,其餘照常同步。\n` +
    `  🔴 這 ${ids.length} 件【現在仍在架上販售】,而它們的價格與庫存從這一刻起停止更新。\n` +
    `  🔴 本工具【不會】自動下架它們 —— 下架是對客人可見的動作,要人決定。\n` +
    `  受影響的料號:${ids.join(', ')}\n` +
    `  下一步:到【報價單庫】把這些 sku 的 products.product_name_zh 改成真的中文品名` +
    `(原文品名在同一列的 product_name,通常是好的)。\n` +
    `  🔴 若 translation_locked = true,那個壞值是【被鎖住的】,重跑翻譯不會修好它 ⇒ 要先解鎖再改。\n` +
    `  🔴 改完【要把 translation_locked 設回 true】—— 不鎖回去的話,下一輪翻譯流程會再覆蓋掉人工修的名字,` +
    `同一件事會再發生一次。`
  );
}

export type TitleRow = { external_id: string; handle: string; title: string };
export type TitleGateResult = {
  action: TitleGateAction;
  blocked: Array<{ external_id: string; handle: string; title: string; 判為: string; 可能原因: string }>;
  warned: Array<{ external_id: string; title: string; 判為: string }>;
  /** action==='skip' 時要從寫入集合移除的主碼。**呼叫端必須真的移除它們**(見 rpm-import 接線)。 */
  skipExternalIds: string[];
};

/**
 * 第七道 gate 的接線。抽成函式的理由:讓「接線本身」可被測 ——
 * 判別式對而沒接上去,測試一樣全綠(codex 關卡2 MF-6/MF-7)。
 *
 * · dry-run:只報告,永不 throw(對齊既有六道 gate)。
 * · WRITE + action==='abort':throw、整批不寫。
 * · WRITE + action==='skip':**不 throw**,回傳 skipExternalIds,由呼叫端移除後照常寫其餘。
 */
export function runTitleShapeGate(rows: ReadonlyArray<TitleRow>, opts: { dryRun: boolean; maxList?: number }): TitleGateResult {
  const verdicts = rows.map((p) => ({ p, v: classifyTitle(p.title ?? '') }));
  const blocked = verdicts.filter((x) => x.v?.level === 'block')
    .map((x) => ({ external_id: x.p.external_id, handle: x.p.handle, title: JSON.stringify(x.p.title), 判為: x.v!.id, 可能原因: x.v!.why }));
  const warned = verdicts.filter((x) => x.v?.level === 'warn')
    .map((x) => ({ external_id: x.p.external_id, title: JSON.stringify(x.p.title), 判為: x.v!.id }));
  const action = decideTitleGateAction(blocked.length, rows.length);
  const cap = opts.maxList ?? 100;
  console.log(
    `\n=== 品名形狀 gate(W1、#N/A 事故)===\n` +
      `檢查 ${rows.length} 群 / 🔴零資訊品名 ${blocked.length} 群 / ⚠️只報不擋 ${warned.length} 群 / 判定 ${action}`,
  );
  if (warned.length) console.table(warned.slice(0, cap));
  if (blocked.length) console.table(blocked.slice(0, cap));
  else console.log('✅ 無零資訊品名');
  const skipExternalIds = action === 'skip' ? blocked.map((b) => b.external_id) : [];
  if (action === 'abort') {
    // dry-run 仍只報告(對齊既有六道 gate);WRITE 才 throw。
    if (opts.dryRun) console.log(titleGateAbortMessage(blocked.length, rows.length, Math.min(blocked.length, cap)));
    else throw new Error(titleGateAbortMessage(blocked.length, rows.length, Math.min(blocked.length, cap)));
  } else if (action === 'skip') {
    console.warn(titleGateSkipMessage(skipExternalIds));
  }
  return { action, blocked, warned, skipExternalIds };
}

/**
 * 把 skip 的主碼從**三個容器**移除。抽成函式的理由與 `runTitleShapeGate` 相同:
 * 🔴 第一版把移除寫在 rpm-import 裡,而測試只斷言原始碼「出現 skipExternalIds 這個字」——
 *    **把移除整段停掉,測試照樣全綠**(實測突變 ⑨:0 failed)。
 *    那正是「grep 的分母是整支檔的全部字元」:字在,不代表它在做事。
 *
 * 🔴 **三個容器都要移**:
 *   · `productRows`   —— 不移就照樣寫進 DB
 *   · `variantsByExtId` —— 不移會讓 rpm-import 的「variant work 分流計數不一致」擋下**整批**寫入
 *   · `variantRows`   —— 它是從 map 攤平來的,不同步會讓 delta 報告與實寫不一致
 */
export function applyTitleGateSkip<P extends { external_id: string }, V>(
  productRows: P[],
  variantsByExtId: Map<string, V[]>,
  variantRows: V[],
  skipExternalIds: ReadonlyArray<string>,
): void {
  if (!skipExternalIds.length) return;
  const skip = new Set(skipExternalIds);
  for (let i = productRows.length - 1; i >= 0; i -= 1) {
    if (skip.has(productRows[i]!.external_id)) productRows.splice(i, 1);
  }
  for (const ext of skip) variantsByExtId.delete(ext);
  variantRows.length = 0;
  variantRows.push(...[...variantsByExtId.values()].flat());
}
