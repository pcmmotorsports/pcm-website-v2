// hct-remark.ts — 貨運備註那一行(⟦ship-HCTREMARK⟧ · Sean 2026-09-10 逐字
// 「`[PCM] 訂單編號 + 該商品名稱 + 料號`」)。
//
// 🔴🔴 **本檔【自己組一個要送出去的字串】—— 而那讓兩個坑變成本檔的責任**:
//
// ① **`clip()` 用 `v.length` = UTF-16 單位** —— 不是 byte, **也不是「看得見的字」**:
//    ```
//    ABC        length 3 · bytes 3  · 看得見 3
//    派達有限    length 4 · bytes 12 · 看得見 4
//    一個 emoji  length 2 · bytes 4  · 看得見 1   ← 這一格
//    ```
//    ⇒ `slice(0, n)` 可能把一個**代理對切成兩半** ⇒ 孤兒 surrogate
//    ⇒ 而 `hct-client.ts` 的 `xmlEscape` **不剝它**(它只剝 C0 與 U+FFFE/FFFF)
//    ⇒ 📌 **not-well-formed 的信封 ⇒ 新竹回 soap:Fault 或直接斷 ⇒ 那一箱卡成 `unknown`。**
//    🔵 **今天觸發不到**(料號與單號都是 ASCII、商品名今天沒有 emoji)——
//    🛑 **而那不是不做的理由**:今天不會發生的 bug, 如果是【這一片親手造出它的可能性的】,
//       那就是這一片的事。⇒ ✅ 砍字一律走**碼點**(`[...s]`), 不走 `slice`。
//
// ② **`String(100)` 是 100 字元還是 100 byte —— 規格沒寫、沒問過、沒試過。**
//    ⚠️ 而 `emark` 那一欄**一次都沒有被真的送出去驗過**:2026-09-10 第一箱送的是空字串(實測)。
//    ⇒ ✅ **選保守的那一邊:按 UTF-8 byte 抓上限** ⇒ 兩種世界都不爆,
//      而代價只是**中文商品名多砍幾個字**。

/**
 * 🔴 上限按 **UTF-8 byte** 算,不是字元。
 * 規格 `String(100)` ⇒ 若它其實是 100 字元, 我們只是少用了額度(安全的那個方向)。
 */
export const HCT_REMARK_MAX_BYTES = 100;

/**
 * 🔵 料號的**固定上限**(碼點)。它砍的是自己, 不會把骨架擠掉。
 * 🔴 **而它為什麼需要一個上限**:手動建單那條路**不限制料號長度** ——
 *    一個 90 個字的料號進得來, 而那正是 codex R1 舉出來的那個輸入。
 */
export const HCT_REMARK_SKU_MAX_CODEPOINTS = 24;

const utf8 = (s: string): number => new TextEncoder().encode(s).length;

/** 🔴 按【碼點】砍到指定 byte 數以內 —— 代理對不會被切半。 */
function clipToBytes(s: string, maxBytes: number): string {
  if (utf8(s) <= maxBytes) return s;
  let out = '';
  for (const ch of s) {
    if (utf8(out + ch) > maxBytes) break;
    out += ch;
  }
  return out;
}

export type HctRemarkParts = {
  /** 這一箱對到的訂單編號(去重、已排序)。**空陣列 = 查不到訂單。** */
  readonly orderDisplayIds: readonly string[];
  /** 第一項的商品名。`null` = 沒有品項或查不到。 */
  readonly firstItemName: string | null;
  /** 第一項的料號。 */
  readonly firstItemSku: string | null;
  /** 這一箱總共幾個品項。🔵 這是**真的總數**(`count: 'exact'`), 不是拿回來的列數。 */
  readonly itemCount: number;
  /**
   * 🔴 掃訂單編號那一發**被截斷了嗎**(codex R4 must-fix 二)。
   *    `true` ⇒ 第 N+1 列上可能還有另一張訂單 ⇒ **我們不知道總共幾張**
   *    ⇒ 📌 那一格印「等 N 單以上」, 而**不是**印一個看起來確定的 N。
   */
  readonly ordersMaybeIncomplete?: boolean;
};

/**
 * 組出要送給新竹的備註。**純函式** —— 零 DB、零網路。
 *
 * ```
 * 單單單項   [PCM] CH6D75 前叉油封 SKU-1234
 * 多品項     [PCM] CH6D75 前叉油封 SKU-1234 等共 3 項
 * 多張訂單   [PCM] CH6D75 等 2 單 前叉油封 SKU-1234
 * ```
 *
 * 🔴 **砍的順序是承重的**(主視窗 2026-09-10 裁):
 *    **訂單編號永遠不砍**(那是對單的唯一憑據)· 料號盡量留 · **商品名先砍**。
 *    ⇒ 做法:先組出不可砍的部分並量它的 byte, **剩下的額度才給商品名** ——
 *      而商品名**砍到剩 0 也不動前面那些**。
 *
 * 🛑 **一單多箱時, 兩箱的備註會【長一樣】** —— 而那不是 bug:
 *    📌 本格式裡沒有箱號(Sean 給的字面沒有它), 而**箱號印在標籤的另一格**
 *      (2026-09-10 那張紙上 `S9FC6P` 在寄貨人那一區)⇒ 司機分得出來, 但**不是靠這一行**。
 *    🔵 而「一單多箱」今天**已經發生過**(`XS6XVY` 與 `ZN2HDP` 都對到 `C8MYDB`, 唯讀實測)
 *      ⇒ ⇒ 要讓這一行自己分得出箱子, 是**加一個欄位的決定**, 不是本片的判斷。
 */
export function buildHctRemark(parts: HctRemarkParts): string {
  const ids = parts.orderDisplayIds;
  // 🔴 查不到訂單 ⇒ **回空字串**, 不回一個只有 `[PCM]` 的殼 ——
  //    一張只印 `[PCM]` 的紙, 比空白更容易被讀成「系統壞了」。
  if (ids.length === 0) return '';

  // ══ 🔴🔴 三層, 而分層的判準是【司機要什麼】(codex R1 must-fix 一)═══════════
  // ⛔ ~~第一版:骨架 = `[PCM] + 訂單編號 + 料號 + 後綴`, 而後綴在尾巴~~
  //    ⇒ 出事輸入(codex 舉的, 我複驗成立):料號 90 個字元 · 3 項
  //      ⇒ 紙上只剩 `[PCM] CH6D75 ` + 88 個 S ⇒ 📌 **「等共 3 項」整個消失。**
  //      而 **手動建單【不限制料號長度】** ⇒ 那個輸入真的進得來, 不是理論。
  // ✅ 判別句:**這一格的讀者是司機。他要的是【這箱是誰的 · 有幾項】** ——
  //    那兩件都在骨架裡;**料號與品名是【方便】不是【憑據】**, 所以它們才是可砍的那一邊。
  //    🔒 骨架(不可砍)  [PCM] + 訂單編號 + 「等共 N 項」/「等 N 單」
  //    🔵 有固定上限     料號(24 碼點)—— 超過就砍它自己, 而不吃別人的額度
  //    🟡 吃剩下的       商品名 —— 額度用完砍到 0 也不動上面兩層
  // 🔴 訂單清單可能不完整 ⇒ 印「以上」。**一個確定的數字與一個下界, 不准印成一樣。**
  const more = parts.ordersMaybeIncomplete === true ? '以上' : '';
  const orderPart =
    ids.length === 1 && more === ''
      ? ids[0]!
      : `${ids[0]!} 等 ${String(ids.length)} 單${more}`;
  const head = dropWhatTransportDrops(`[PCM] ${orderPart}`);
  const tail = parts.itemCount > 1 ? ` 等共 ${String(parts.itemCount)} 項` : '';

  // 🔴🔴 **這裡【刻意不用 `String.replace`】**(codex R2 must-fix)——
  //    ⛔ ~~先組出一串, 再用 `out.replace(後綴, ' 料號' + 後綴)` 把料號插進去~~
  //    ⇒ 出事輸入:料號 = `SKU-$&` ⇒ `replace` 的**替換字串**裡 `$&` 是「剛才匹配到的那一段」
  //      ⇒ 它展開成後綴 ⇒ 📌 **`[PCM] CH6D75 前叉油封 SKU- 等共 3 項 等共 3 項`**
  //        —— 料號被吃掉一半, 而項數印了兩次。`$$` / `` $` `` / `$'` 同族。
  //    ⚠️ 而**手動建單允許那種料號** ⇒ 那是一個真的會送出去的錯字。
  //    ✅ **修法不是把第二參數換成回呼, 是【整段不要用 replace】** ——
  //      📌 一個「把資料當成指令」的 API, 換一個安全的用法只是把坑挪遠一點;
  //        而這裡本來就只要**接字串**, 不需要搜尋與替換。
  // 🔴 **先剝、再砍** —— 順序是承重的:剝完長度才是真的長度。
  const sku = clipToCodePoints(
    dropWhatTransportDrops((parts.firstItemSku ?? '').trim()),
    HCT_REMARK_SKU_MAX_CODEPOINTS,
  );
  const name = dropWhatTransportDrops((parts.firstItemName ?? '').trim());
  const join = (n: string, k: string): string =>
    `${head}${n === '' ? '' : ` ${n}`}${k === '' ? '' : ` ${k}`}${tail}`;

  // 🔵 一層一層加, **加不下就整層不加**(不放看不懂的殘段)。
  //    順序照 Sean 給的字面:訂單編號 → 商品名 → 料號。
  let out = join('', '');
  if (sku !== '' && utf8(join('', sku)) <= HCT_REMARK_MAX_BYTES) out = join('', sku);

  if (name !== '') {
    const skuInUse = out === join('', sku) ? sku : '';
    // 剩下的額度給商品名 —— 而它砍到 0 也不動骨架與料號。
    const budget = HCT_REMARK_MAX_BYTES - utf8(join('', skuInUse)) - utf8(' ');
    if (budget > 0) {
      const clipped = clipToBytes(name, budget);
      if (clipped !== '') out = join(clipped, skuInUse);
    }
  }
  return out;
}

/**
 * 🔴🔴 **把【傳輸層會刪掉的字元】先剝掉**(codex R3 must-fix)。
 *
 * `hct-client.ts` 的 `xmlEscape` 在組 SOAP 信封時會丟掉 C0 控制字元與 `U+FFFE/FFFF`
 * (理由在那支檔:它們穿得過 `JSON.stringify` 而會產生一個 not-well-formed 的信封)。
 * ⇒ 出事輸入(codex 舉的):料號含 `U+FFFF`, 而**手動建單沒有禁止那個字元**
 * ```
 * 我們回報   [PCM] CH6D75 前叉油封 SKU-A<U+FFFF>B 等共 3 項
 * 實際送出   [PCM] CH6D75 前叉油封 SKU-AB 等共 3 項
 * ```
 * ⇒ 📌 **料號在傳輸途中被改字, 而成功回報仍宣稱原字串。**
 * 🎯 **⇒ 這與 R1② 是【同一族】**:那一次是「同一串字被算了兩次」,
 *    這一次是「同一串字被**兩層各自處理**」—— 兩次都讓**回報與事實分岔**。
 * ✅ **修法:在組的那一刻就剝掉** ⇒ 預填 = 送出 = 回報**同一串**。
 * 🛑 **而它【不是】重寫一份 `xmlEscape`** —— 字集逐字抄那一支,
 *    而**兩邊漂開時以 `hct-client` 為準**(它才是真的送出去的那一層)。
 */
const TRANSPORT_DROPS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

const dropWhatTransportDrops = (v: string): string => v.replace(TRANSPORT_DROPS, '');

/** 按【碼點】砍到 n 個字 —— 代理對不會被切半。 */
function clipToCodePoints(s: string, n: number): string {
  const cps = [...s];
  return cps.length <= n ? s : cps.slice(0, n).join('');
}
