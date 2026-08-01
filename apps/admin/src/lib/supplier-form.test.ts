import { describe, expect, it } from 'vitest';

import {
  RPC_WHITESPACE_CHARS,
  SUPPLIER_ID_FIELD,
  boundSupplierQuery,
  SUPPLIER_IS_ACTIVE_FIELD,
  SUPPLIER_LABEL_FIELD,
  parseSupplierActiveForm,
  parseSupplierCreateForm,
  parseSupplierRenameForm,
  rpcTrim,
  type FormLike,
} from './supplier-form';

// 🔴 隱形字元一律用 fromCharCode 造,不寫字面 —— 理由同 supplier-form.ts 的常數註解:
//    寫字面的測試向量沒有人能用眼睛核對,而且 CR/LF 會直接讓字串字面變成語法錯。
const ch = (code: number) => String.fromCharCode(code);
const ZWSP = ch(0x200b); // 零寬空白:JS .trim() **不剝**,RPC 會剝
const NBSP = ch(0x00a0);
const IDEOGRAPHIC_SPACE = ch(0x3000); // 全形空格
const TAB = ch(0x0009);
const LF = ch(0x000a);

const VALID_ID = '11111111-2222-3333-4444-555555555555';

/** 最小 FormLike;刻意不是真 FormData —— 真 FormData 會把值強制轉成字串,
 *  那樣就測不到「值不是字串」的分支(檔案上傳欄位會給 File)。 */
function form(fields: Record<string, FormDataEntryValue | undefined>): FormLike {
  return {
    get: (name: string) => fields[name] ?? null,
  };
}

describe('RPC_WHITESPACE_CHARS', () => {
  // 🔴 這條釘的是「與 migration 的 fail-loud 自檢同一個數字」——
  //    `20260801160000:138` 逐字 `IF pg_catalog.char_length(v_ws) <> 31`。
  //    任一邊增刪字元,兩邊會有一邊轉紅,不會靜默漂移。
  // 🔴 K2 抓:原本只驗「長度 31 + 無重複」⇒ 把 U+2000 等量換成別的碼位仍然全綠,
  //    兩端可以靜默漂移。改成**逐碼位釘死**,與 migration `:115-121` 的 v_ws 一一對應。
  it('should mirror the RPC v_ws set code point by code point', () => {
    expect([...RPC_WHITESPACE_CHARS].map((c) => c.codePointAt(0))).toEqual([
      0x0020, 0x0009, 0x000d, 0x000a, 0x000c, 0x000b,
      0x0085, 0x00a0, 0x1680, 0x180e,
      0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005,
      0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
      0x200b, 0x200c, 0x200d,
      0x2028, 0x2029, 0x202f, 0x205f, 0x2060,
      0x3000, 0xfeff,
    ]);
    // 冗餘但便宜:31 這個數字是 migration `:138` 自檢用的,留著讓失敗訊息直接指出根因。
    expect(RPC_WHITESPACE_CHARS).toHaveLength(31);
  });

  // 🔴 這條是「為什麼不能用 .trim()」的可執行證據,不是註解裡的斷言。
  // 🔴 K2 抓到我原本分組寫錯:**U+FEFF 其實會被 `.trim()` 剝掉**(Node v22.22.3 親測),
  //    U+00A0 / U+1680 / U+2028 / U+3000 也會。真正留下的只有下面這六個。
  //    原本用複合字串斷言「trim 後 !== AKOSO」⇒ 只要六個裡有一個留下就綠,
  //    證不到逐碼位的理由 ⇒ 改成**逐碼位各自斷言**。
  it.each([
    ['U+0085', 0x0085],
    ['U+180E', 0x180e],
    ['U+200B', 0x200b],
    ['U+200C', 0x200c],
    ['U+200D', 0x200d],
    ['U+2060', 0x2060],
  ])('should strip %s, which JS .trim() leaves behind', (_name, code) => {
    const padded = `${ch(code)}AKOSO${ch(code)}`;

    expect(padded.trim()).not.toBe('AKOSO'); // .trim() 做不到
    expect(rpcTrim(padded)).toBe('AKOSO'); // rpcTrim 做得到
  });

  // 🔴 R1 抓到的可觸發服務阻斷的回歸守門(must-fix #1)。
  //    舊實作是 `^[ws]+|[ws]+$` regex,對「中間夾一長段空白」是 O(n²) 回溯:
  //    親測 32,000 個空白 = 1626ms、200,000 個 ≈ 65 秒 ⇒ 一個 POST 佔住事件迴圈數分鐘。
  //    索引掃描是 O(n) ⇒ 這條在毫秒級完成。**改回 regex 會讓它撞上 vitest 預設 5s timeout 轉紅。**
  //    刻意斷言的是「回傳值正確」而不是「花了幾毫秒」—— 計時斷言在 CI 上會 flaky,
  //    而 5s timeout 與實際耗時之間有四個數量級的餘裕,不需要靠計時。
  // 🔴 K2 指出 vitest 的 timeout **中斷不了同步程式碼**,只能等函式返回後才判逾時 ——
  //    這點成立(所以失敗是「慢然後紅」不是「立刻紅」),但**守門本身有效**:
  //    我實跑過 regex 版,該條 128,907ms 後以 `Test timed out in 5000ms` 轉紅。
  //    ⇒ 採納它的 CI 衛生顧慮,把輸入從 200k 降到 100k(regex 版約 16s 而非 128s,仍遠超 5s 上限)。
  it('should stay linear on a huge interior whitespace run (ReDoS regression)', () => {
    const hostile = `a${' '.repeat(100_000)}b`;

    expect(rpcTrim(hostile)).toBe(hostile); // 前後皆非空白 ⇒ 原樣回傳
    expect(rpcTrim(`${TAB}${hostile}${TAB}`)).toBe(hostile);
  });

  it('should strip NBSP, ideographic space and tabs from both ends only', () => {
    expect(rpcTrim(`${NBSP}${IDEOGRAPHIC_SPACE}${TAB}Webike TW${TAB}`)).toBe(
      'Webike TW',
    );
    // 內部空白**不動** —— 「內部連續空白不擋」是已知缺口(plan §6),不是本層要修的事。
    expect(rpcTrim('Eazi  Grip')).toBe('Eazi  Grip');
  });
});

describe('parseSupplierCreateForm', () => {
  it('should accept a plain label', () => {
    expect(parseSupplierCreateForm(form({ [SUPPLIER_LABEL_FIELD]: 'AKOSO' })))
      .toEqual({ ok: true, label: 'AKOSO' });
  });

  it('should trim before storing so the audit records the normalized value', () => {
    expect(
      parseSupplierCreateForm(
        form({ [SUPPLIER_LABEL_FIELD]: `${TAB}Webike JP${NBSP}` }),
      ),
    ).toEqual({ ok: true, label: 'Webike JP' });
  });

  // ── 驗收 2:純 U+200B ⇒ ok:false ────────────────────────────────
  // 🔴 突變:把 rpcTrim 換成 .trim() ⇒ 本條轉紅(.trim() 留下 U+200B ⇒ 判定非空 ⇒ ok:true)。
  //    這正是「使用者看到『儲存失敗』而不是『名稱不能空白』」的那條路。
  it('should reject a label made only of zero-width spaces', () => {
    expect(
      parseSupplierCreateForm(form({ [SUPPLIER_LABEL_FIELD]: ZWSP + ZWSP })),
    ).toEqual({ ok: false });
  });

  it('should reject an empty, whitespace-only, missing or non-string label', () => {
    expect(parseSupplierCreateForm(form({ [SUPPLIER_LABEL_FIELD]: '' })))
      .toEqual({ ok: false });
    expect(
      parseSupplierCreateForm(form({ [SUPPLIER_LABEL_FIELD]: `  ${TAB} ` })),
    ).toEqual({ ok: false });
    expect(parseSupplierCreateForm(form({}))).toEqual({ ok: false });
    expect(
      parseSupplierCreateForm(
        form({ [SUPPLIER_LABEL_FIELD]: new File([], 'x') }),
      ),
    ).toEqual({ ok: false });
  });

  // ── 驗收 3:長度邊界兩側各一 ────────────────────────────────────
  it('should accept 100 characters and reject 101', () => {
    expect(
      parseSupplierCreateForm(form({ [SUPPLIER_LABEL_FIELD]: 'a'.repeat(100) })),
    ).toEqual({ ok: true, label: 'a'.repeat(100) });
    expect(
      parseSupplierCreateForm(form({ [SUPPLIER_LABEL_FIELD]: 'a'.repeat(101) })),
    ).toEqual({ ok: false });
  });

  // 🔴 PG `char_length` 數 code point、JS `.length` 數 UTF-16 單位。
  //    100 個 surrogate pair = JS .length 200、PG char_length 100 ⇒ RPC 會收。
  //    用 `.length` 判長度的話本條會紅 = 兩邊對同一個名稱給出不同結果。
  it('should count code points, not UTF-16 units, at the length boundary', () => {
    const emoji = '🏍'; // U+1F3CD,surrogate pair
    expect(emoji.length).toBe(2); // 前提:它真的是 surrogate pair
    expect(
      parseSupplierCreateForm(form({ [SUPPLIER_LABEL_FIELD]: emoji.repeat(100) })),
    ).toEqual({ ok: true, label: emoji.repeat(100) });
    expect(
      parseSupplierCreateForm(form({ [SUPPLIER_LABEL_FIELD]: emoji.repeat(101) })),
    ).toEqual({ ok: false });
  });

  // ── 驗收 4:剝完之後**內部**還有控制字元 ⇒ 拒 ────────────────────
  // 🔴 順序證據:同一個 tab,在尾端會被剝掉而放行、在中間則拒收。
  //    先判控制字元、後剝空白的實作(S2 關卡2 曾在 RPC 裡造出過那個 bug)會讓第一條紅。
  it('should reject interior control characters but allow trailing ones', () => {
    expect(
      parseSupplierCreateForm(form({ [SUPPLIER_LABEL_FIELD]: `AKOSO${TAB}` })),
    ).toEqual({ ok: true, label: 'AKOSO' });
    expect(
      parseSupplierCreateForm(form({ [SUPPLIER_LABEL_FIELD]: `AK${TAB}OSO` })),
    ).toEqual({ ok: false });
    expect(
      parseSupplierCreateForm(form({ [SUPPLIER_LABEL_FIELD]: `AK${LF}OSO` })),
    ).toEqual({ ok: false });
  });
});

describe('parseSupplierRenameForm', () => {
  it('should accept a valid uuid with a label', () => {
    expect(
      parseSupplierRenameForm(
        form({
          [SUPPLIER_ID_FIELD]: VALID_ID,
          [SUPPLIER_LABEL_FIELD]: `${NBSP}老吳車業`,
        }),
      ),
    ).toEqual({ ok: true, id: VALID_ID, label: '老吳車業' });
  });

  // ── 驗收 1:非 uuid 形狀的 id ⇒ ok:false(契約債①的第一層,RPC 根本不會被呼叫)──
  // 🔴 這是「把 id 弄丟會靜默降級成新增、多一筆刪不掉的垃圾列」那條路的入口閘。
  it.each([
    ['缺欄位', undefined],
    ['空字串', ''],
    ['非 uuid 字串', 'not-a-uuid'],
    ['少一段', '11111111-2222-3333-4444'],
    ['多一字元', `${VALID_ID}5`],
    ['帶大括號', `{${VALID_ID}}`],
    ['前後空白', ` ${VALID_ID} `],
    ['非字串', new File([], 'x')],
  ])('should reject an id that is %s', (_case, id) => {
    expect(
      parseSupplierRenameForm(
        form({ [SUPPLIER_ID_FIELD]: id, [SUPPLIER_LABEL_FIELD]: 'AKOSO' }),
      ),
    ).toEqual({ ok: false });
  });

  it('should accept an uppercase uuid (PG is case-insensitive on uuid literals)', () => {
    const upper = VALID_ID.replace(/1/g, 'A');
    expect(
      parseSupplierRenameForm(
        form({ [SUPPLIER_ID_FIELD]: upper, [SUPPLIER_LABEL_FIELD]: 'AKOSO' }),
      ),
    ).toEqual({ ok: true, id: upper, label: 'AKOSO' });
  });

  // ── 驗收 5(改名側):label 缺 ⇒ ok:false ───────────────────────
  // 🔴 這條讓 RPC 的「沒有要變更的欄位」RAISE(`20260801160000:247`)在結構上不可達 ——
  //    改名解析器不可能產出一個沒有 label 的請求。
  it('should reject a rename with no label', () => {
    expect(parseSupplierRenameForm(form({ [SUPPLIER_ID_FIELD]: VALID_ID })))
      .toEqual({ ok: false });
  });
});

describe('parseSupplierActiveForm', () => {
  it('should parse both explicit boolean literals', () => {
    expect(
      parseSupplierActiveForm(
        form({ [SUPPLIER_ID_FIELD]: VALID_ID, [SUPPLIER_IS_ACTIVE_FIELD]: 'true' }),
      ),
    ).toEqual({ ok: true, id: VALID_ID, isActive: true });
    expect(
      parseSupplierActiveForm(
        form({ [SUPPLIER_ID_FIELD]: VALID_ID, [SUPPLIER_IS_ACTIVE_FIELD]: 'false' }),
      ),
    ).toEqual({ ok: true, id: VALID_ID, isActive: false });
  });

  // 🔴 不做寬鬆解讀:'on' / '1' / 'TRUE' 一律拒。
  //    checkbox 的預設送出值是 'on' ⇒ 若哪天有人把這個欄位改成 checkbox,
  //    寬鬆解析會讓「沒勾 = 沒送出 = 缺欄位」與「勾了 = 'on'」都被誤讀成停用/啟用。
  it.each(['on', '1', '0', 'TRUE', 'yes', ''])(
    'should reject the loose boolean literal %p',
    (value) => {
      expect(
        parseSupplierActiveForm(
          form({ [SUPPLIER_ID_FIELD]: VALID_ID, [SUPPLIER_IS_ACTIVE_FIELD]: value }),
        ),
      ).toEqual({ ok: false });
    },
  );

  // ── 驗收 5(切換側):is_active 缺 ⇒ ok:false ────────────────────
  it('should reject a toggle with no is_active field', () => {
    expect(parseSupplierActiveForm(form({ [SUPPLIER_ID_FIELD]: VALID_ID })))
      .toEqual({ ok: false });
  });

  it('should reject a non-uuid id', () => {
    expect(
      parseSupplierActiveForm(
        form({ [SUPPLIER_ID_FIELD]: 'nope', [SUPPLIER_IS_ACTIVE_FIELD]: 'true' }),
      ),
    ).toEqual({ ok: false });
  });
});

// ── S3b-2:`?q=` 定位字串的收斂(驗收 4 後半的判別力來源)──────────────
// 🔴 **為什麼測在這裡而不是測在 action**:action 走的是真解析器,label 恆 ≤100
//    ⇒ 「>100 不帶 q」那條在**寫入側構造不出來**,從 action 打進去只會得到一條恆真的斷言
//    (memory `feedback_unconstructible-negative-test-means-noop-guard`)。
//    上限真正會觸發的地方是 S3b-3 **讀** URL 的那一側,那裡的輸入是任意字串。
describe('boundSupplierQuery', () => {
  it('should reject null and anything blank under the RPC whitespace set', () => {
    expect(boundSupplierQuery(null)).toBeNull();
    expect(boundSupplierQuery('')).toBeNull();
    expect(boundSupplierQuery(ZWSP + IDEOGRAPHIC_SPACE + NBSP)).toBeNull();
  });

  it('should strip surrounding whitespace but keep the inner text intact', () => {
    expect(boundSupplierQuery(`${NBSP} Webike TW ${ZWSP}`)).toBe('Webike TW');
  });

  it('should accept exactly the label limit and reject one past it', () => {
    expect(boundSupplierQuery('a'.repeat(100))).toBe('a'.repeat(100));
    expect(boundSupplierQuery('a'.repeat(101))).toBeNull();
  });

  // 🔴 用 code point 數、不是 `.length`:100 個星文字元的 `.length` 是 200。
  //    若改用 `.length`,這條會轉紅 —— 而且會與 normalizeLabel 的尺不一致
  //    (那個名字通得過解析、卻拿不到 q,撞名時定位靜默失效)。
  it('should count code points, not UTF-16 units', () => {
    const astral = '𝔄'.repeat(100);
    expect([...astral]).toHaveLength(100);
    expect(astral.length).toBe(200);
    expect(boundSupplierQuery(astral)).toBe(astral);
  });
});
