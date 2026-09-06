// hct-label-image.ts — 從 `hct_raw_response` 整包裡把那張標籤圖挖出來。⟦ship-HCTLABELCAPTURE⟧ 片 D1。
//
// 🔴🔴 **本檔【零網路、零 env、零 DB】** —— 它只回答「這一包裡有沒有一張看得懂的圖」。
//
// 📎 **它為什麼存在**:那張圖是 `TransData_Json`(建單那一支)的回傳欄位 `image`,
//    而我們**本來就把整包存進 `hct_raw_response`**(`hct-client.ts` 逐字
//    「`raw` 整包留著 —— 而它是一個【還沒出錯時看起來多餘】的欄位」)。
//    ⇒ 📌 **存那一側不用寫任何碼;缺的一直是【讀出來】這一側**。
//    ⛔ ~~「落地前全 repo 讀者 0」~~ —— **那句話是錯的**(code-reviewer 2026-09-06 抓到):
//      `shipment-repository.ts` 逐字 `.select('id, hct_status, hct_raw_response, hct_request_id')`
//      **已經在讀那一包**(⟦ship-HCTUNKNOWNSTUCK⟧ 片 C 判佔位卡住)。
//      ✅ 成立的說法是:**讀【`image` 欄】的讀者 0** —— 那一包被讀過, 而那張圖沒有。
//
// 🛑🛑 **這一片最毒的一格, 寫在最前面**(`Q-標籤8`, 主視窗 2026-09-06 裁甲):
//    官方只寫「標籤圖片字串」而範例是 C# 的 `GetBytes(HexString)` ⇒ **看起來是 hex**,
//    而既有欄位叫 `imageBase64`(`hct-label-layout.ts` 的 `BuildLabelPagesInput`)⇒ **兩個名字對不上**。
//    🔴 而一個 hex 字串**完全通得過**那支檔既有的 base64 字元檢查(逐字 `/^[A-Za-z0-9+/=\s]+$/`)
//      ⇒ 它**不會**被判 `broken` ⇒ 📌 **會變成一張安靜的空白圖, 而員工把它貼上箱子。**
//    ✅ 所以判準**不是字元集**, 是**魔術位元組**:hex 解一次、base64 解一次,
//      **誰解出來的前幾個位元組像一張圖, 誰贏**。兩個都不像 ⇒ `broken` 帶 reason, **絕不吐空白**。
//    🎯 **這就是那個「拿到第一張真圖才定」的開關 —— 而它自己會翻**:
//      第一張真圖進來的當下, `encoding` 欄就是答案, 不需要有人在旁邊。
//
// 🛑 **我沒有一張真圖** ⇒ 下面每一組測資都是我自己造的。本檔證得到的是
//    「解對了會過 / 解錯了會擋」, 證不到「新竹真的送的是這幾種格式其中之一」。

/**
 * 🔴🔴 **一張圖不是只有開頭 —— 它也要有【結尾】。**(codex 2026-09-06 R1 must-fix)
 *
 * 🛑 **我原本只問了魔術位元組** ⇒ 「PNG 簽名 + 一堆垃圾」會被判成 ok
 *    ⇒ 真的 Chromium 把它當破圖 ⇒ 📌 **`page.pdf()` 照樣回 200, 而那張紙是空白的。**
 *    ⇒ 而那正是本檔第一句宣稱擋住的那個世界。
 * ✅ 每一種格式各**再問一個獨立的問題**(結尾標記 / 檔長), 而它們都是**兩個世界印不同東西**的問句:
 *    · PNG  最後一個 chunk 必須是 `IEND`   ⇒ 截斷的 PNG 沒有它
 *    · JPEG 必須以 `FFD9`(EOI)結束        ⇒ 截斷的 JPEG 沒有它
 *    · GIF  必須以 `0x3B`(trailer)結束     ⇒ 同上
 *    · BMP  檔頭宣告的長度要等於實際長度    ⇒ 見下面 `sizeAt`
 * 🛑 **而它仍然【證不到】那是一張看得懂的標籤** —— 一張結構完整的圖可以是全黑的。
 *    ⇒ 📌 這一層擋的是**傳輸/截斷**, 不是**內容**。內容要人眼看那張紙。
 */
function tailOk(b: Uint8Array, kind: string): boolean {
  const at = (i: number) => b[b.length - i];
  if (kind === 'image/png') {
    // IEND chunk = 長度 0 + 'IEND' + CRC ⇒ 倒數第 8..5 個位元組是 `IEND`。
    return b.length >= 12 && at(8) === 0x49 && at(7) === 0x45 && at(6) === 0x4e && at(5) === 0x44;
  }
  if (kind === 'image/jpeg') return b.length >= 4 && at(2) === 0xff && at(1) === 0xd9;
  if (kind === 'image/gif') return b.length >= 6 && at(1) === 0x3b;
  return true; // BMP 走 `sizeAt` 那一道
}

/** 瀏覽器的 `<img>` 認得、而我們願意貼上箱子的格式。 */
const IMAGE_MAGIC: { mime: string; bytes: number[]; sizeAt?: number }[] = [
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  // 🔴🔴 **BMP 的魔術位元組只有兩個字元(`BM`)⇒ 它單獨【擋不住一段純文字】**
  //    (code-reviewer 2026-09-06 實測構造出來:`Buffer.from('BM,edelno,error')` ⇒ 判成 ok)
  //    ⇒ 📌 那正是本檔宣稱擋住的那個世界 ——「絕不吐空白」。
  //    ✅ 所以它**多一道**:BMP 的 byte 2-5 是 uint32-LE 的**檔案總長**, 要等於實際長度。
  //    (那段測資算出來約 1.7GB ≠ 15 ⇒ 擋掉;真的 BMP 照過。)
  { mime: 'image/bmp', bytes: [0x42, 0x4d], sizeAt: 2 },
];

/**
 * 認得出來、而 `<img>` **貼不上去**的格式。
 * 🔵 它們單獨列出來的理由是**錯誤訊息**:「這是一份 PDF」比「不是圖」讓下一個人少查半天。
 */
const KNOWN_NOT_IMG: { label: string; bytes: number[] }[] = [
  { label: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
  { label: 'tiff_le', bytes: [0x49, 0x49, 0x2a, 0x00] },
  { label: 'tiff_be', bytes: [0x4d, 0x4d, 0x00, 0x2a] },
];

export type HctLabelImage =
  | { ok: true; imageBase64: string; mime: string; encoding: 'hex' | 'base64' }
  | { ok: false; reason: string };

function startsWith(b: Uint8Array, magic: number[]): boolean {
  if (b.length < magic.length) return false;
  return magic.every((m, i) => b[i] === m);
}

/** 這串位元組是不是一張貼得上去的圖 —— 是 ⇒ 回 mime;不是 ⇒ 回一句話說它像什麼。 */
function sniff(bytes: Uint8Array): { mime: string } | { why: string } {
  for (const m of IMAGE_MAGIC) {
    if (!startsWith(bytes, m.bytes)) continue;
    // 🔵 魔術位元組太短的格式要**再問一個獨立的問題**(見 IMAGE_MAGIC 裡 BMP 那段)。
    if (m.sizeAt !== undefined) {
      if (bytes.length < m.sizeAt + 4) return { why: 'truncated_header' };
      const declared =
        bytes[m.sizeAt]! |
        (bytes[m.sizeAt + 1]! << 8) |
        (bytes[m.sizeAt + 2]! << 16) |
        (bytes[m.sizeAt + 3]! << 24);
      if ((declared >>> 0) !== bytes.length) return { why: 'size_mismatch' };
    }
    // 🔴 開頭對了還要問結尾 —— 見 `tailOk` 上面那段(截斷的圖 = 空白貼上箱子)。
    if (!tailOk(bytes, m.mime)) return { why: 'truncated_body' };
    return { mime: m.mime };
  }
  for (const k of KNOWN_NOT_IMG) if (startsWith(bytes, k.bytes)) return { why: `is_${k.label}` };
  return { why: 'unknown_magic' };
}

function decodeHex(s: string): Uint8Array | null {
  if (s.length === 0 || s.length % 2 !== 0) return null;
  if (!/^[0-9a-fA-F]+$/.test(s)) return null;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function decodeBase64(s: string): Uint8Array | null {
  // 🔴 `Buffer.from(x, 'base64')` **不會對垃圾輸入報錯, 它會靜靜地少解幾個位元組**
  //    ⇒ 📌 所以「解得出來」在這裡不是判準, **後面那道魔術位元組才是**。
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  try {
    return new Uint8Array(Buffer.from(s, 'base64'));
  } catch {
    return null;
  }
}

/**
 * 從 `hct_raw_response` 整包挖出那張標籤圖。
 *
 * 🔴 **fail-closed**:任何一層看不懂 ⇒ 回 `{ ok:false, reason }`, **不回空字串**。
 *    空字串也會被 `buildLabelPages` 判成 `broken`(那一層擋得住), 而 `reason` 多答一件事:
 *    **壞在哪一層** —— 沒有它, 值班分不出「新竹沒回圖」與「我們解錯了」。
 *
 * 🛑 **我刻意【不】重用 `hct-client.ts` 的 `firstRow`/`pick`**(它們今天沒 export):
 *    那支是網路 client ⇒ 從這支純函式 import 它, 會讓本檔的測試繼承它的 env 與 gate 依賴,
 *    而本檔的價值正是「餵一個字串就驗得完」。⇒ 📌 這裡那 6 行是**刻意的重複**, 不是沒看到。
 * 🔴🔴 **而更關鍵的理由是【語意相反】**(code-reviewer 2026-09-06 補):
 *    `firstRow` 對非物件回 `{}` = **fail-open**;本檔回 `not_object` = **fail-closed**。
 *    ⇒ 📌 它們不是同一個函式的兩份拷貝, **是兩個不同的決定** —— 下一個人不要來「消重複」。
 */
export function extractHctLabelImage(raw: unknown): HctLabelImage {
  // 🔴 **多列 ⇒ 拒絕, 不取第一列。** 逐字照 `submitTransData` 的立場
  //    (「一個多列或講別張單的回應…是把別人的成功記在我們頭上」)——
  //    ⇒ 📌 在標籤這條路上, 那句話的後果是**把別人的貨號貼上我們的箱子**。
  if (Array.isArray(raw) && raw.length !== 1) return { ok: false, reason: `row_count_${raw.length}` };
  const row: unknown = Array.isArray(raw) ? raw[0] : raw;
  if (typeof row !== 'object' || row === null) return { ok: false, reason: 'not_object' };
  const v = (row as Record<string, unknown>)['image'];
  if (typeof v !== 'string') return { ok: false, reason: 'no_image_field' };
  // 空白會被塞進去(SOAP 那一層自己會換行)⇒ 一律先剝掉再看。
  // 🔵 `data:image/png;base64,` 這種前綴要**先剝掉再看** —— 帶前綴時它其實**是** base64,
  //    而不剝的話 reason 會回 `not_hex_nor_base64` ⇒ 📌 **把值班指向錯的方向**
  //    (本檔存在的理由逐字是「分得出【新竹沒回圖】與【我們解錯了】」)。
  const s = v.replace(/\s/g, '').replace(/^data:[^,]*,/, '');
  if (s === '') return { ok: false, reason: 'empty_image' };

  // 🔵 兩把都試, 而**順序不重要** —— 判準是解出來的位元組, 不是字元集。
  //    (hex 字串拿去 base64 解 ⇒ 解得出垃圾 ⇒ 魔術位元組不會過 ⇒ 落到另一把。)
  const candidates: { encoding: 'hex' | 'base64'; bytes: Uint8Array }[] = [];
  const hex = decodeHex(s);
  if (hex !== null) candidates.push({ encoding: 'hex', bytes: hex });
  const b64 = decodeBase64(s);
  if (b64 !== null) candidates.push({ encoding: 'base64', bytes: b64 });
  if (candidates.length === 0) return { ok: false, reason: 'not_hex_nor_base64' };

  const whys: string[] = [];
  for (const c of candidates) {
    const got = sniff(c.bytes);
    if ('mime' in got) {
      return {
        ok: true,
        // 🔴 一律回 base64 —— 下游(`buildLabelPages` / `<img src="data:...">`)只吃這一種。
        imageBase64: Buffer.from(c.bytes).toString('base64'),
        mime: got.mime,
        encoding: c.encoding,
      };
    }
    whys.push(`${c.encoding}:${got.why}`);
  }
  // 🔵 reason 帶**兩把各自像什麼**, 不只是「不是圖」——
  //    `hex:is_pdf` 與 `base64:unknown_magic` 指向完全不同的下一步。
  return { ok: false, reason: `not_an_image(${whys.join(',')})` };
}
