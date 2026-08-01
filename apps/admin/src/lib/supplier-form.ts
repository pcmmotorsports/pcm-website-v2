// supplier-form.ts — M-4b E10 S3b-1:供應商設定頁 server action 的純表單解析器(無 IO / 無 Next 依賴)。
//
// 🔴 本檔鏡像的是 `admin_upsert_supplier`(`20260801160000`)的 **label 與 id 規則,不是它的全部輸入驗證**。
//    (R1 抓:原字面「是 RPC 輸入驗證的鏡像」說滿了。)逐條講清楚:
//      ✅ **有鏡像**:label 的剝空白字元集 / 判空 / 長度上限 / 控制字元 / 驗證順序。
//      ⚠️ **id 不是「鏡像」**(K2 抓):RPC 的 `p_supplier_id` 型別就是 `uuid`,
//         文字→uuid 的轉型發生在 **PostgREST**、不在函式體 `:137-204` ⇒ 那裡沒有 id 規則可鏡像。
//         本檔的 uuid 形狀閘是**獨立的、更嚴格的**一道(只收正規形式);
//         PostgREST 對非正規寫法(大括號等)的端到端接受集合**未確認**,不影響安全性
//         —— 更嚴格的那側先擋掉了。
//      ❌ **沒有鏡像**:`p_actor` / `p_request_id` 的「非空 + ≤200 字元 + 無控制字元」
//         (`20260801160000:159-179`)與 `p_note` 的同一組規則(`:182-188`)。
//         這三個值**不是使用者填的表單欄位** —— actor/request_id 由 session 與稽核 context 供給,
//         note 目前無 UI(呼叫端一律送 null)。**哪天 S3b-2 真的加了備註輸入框,鏡像要一起補**,
//         否則一則 201 字的備註會炸成 `error` 而不是 `invalid`。
//    ⇒ 可主張的是:**經由本檔解析的 label/id,不會觸發 RPC 那幾條對應的 RAISE**;
//      不是「RPC 的所有 RAISE 都不可達」。
//
// 🔴 三個解析器各自要求自己那個欄位(改名要 label、切換要 is_active)
//    ⇒ **經由解析器**不可能產生一個空 patch。呼叫面的同一道防線在 `supplier-repository.ts`
//      的 `updateSupplier` 型別聯集(R1 抓:原字面說「結構上不可達」而當時呼叫面擋不住)。

/** 供應商 id(uuid);改名與切換啟用狀態共用。新增表單**沒有**這個欄位。 */
export const SUPPLIER_ID_FIELD = 'id';
export const SUPPLIER_LABEL_FIELD = 'label';
export const SUPPLIER_IS_ACTIVE_FIELD = 'is_active';

/**
 * RPC 的 `v_ws` 空白字元全集,逐字鏡像 `20260801160000:115-121`。
 *
 * 🔴 **寫成碼位陣列、不寫字元字面** —— 這 31 個字全部是隱形的。寫字面等於留下一段
 *    沒有人能用眼睛核對的規格,而且其中六個是真的控制字元(CR/LF 直接讓字串字面變成語法錯)。
 *    本檔初稿就是這樣寫壞的。
 * 🔴 **不能用 JS 的 `.trim()` 代替** —— `.trim()` 不剝 U+200B / U+180E / U+2060,而 RPC 會剝。
 *    後果:純由 U+200B 組成的名稱在 `.trim()` 下是「非空」⇒ 通過解析 ⇒ 到 RPC 才被剝成空字串、
 *    炸成 `供應商名稱必填` ⇒ 使用者看到的是**一般性的儲存失敗**,而不是「這個名字不合法」。
 *    🔴 誠實邊界(R1 抓):三個解析器都只回單一 `{ ok: false }`,plan §3.7 也只有一個 `invalid` 碼
 *    ⇒ **空白 / 過長 / 控制字元三種原因在 UI 上分不出來**。要分得出來得先擴回傳型別,S3b-1 不做。
 */
const RPC_WHITESPACE_CODEPOINTS = [
  0x0020, 0x0009, 0x000d, 0x000a, 0x000c, 0x000b, // 空格 tab CR LF FF VT(PG 的 E'\013')
  0x0085, 0x00a0, 0x1680, 0x180e,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005,
  0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x200b, 0x200c, 0x200d, // 零寬空白 / 零寬非連字 / 零寬連字
  0x2028, 0x2029, 0x202f, 0x205f, 0x2060,
  0x3000, 0xfeff, // 全形空格 / BOM
] as const;

/**
 * 🔴 長度必須是 **31** —— RPC 自己在 `:138` 用 `char_length(v_ws) <> 31` 做 fail-loud 自檢。
 * 本常數的單元測試釘同一個數字 ⇒ 任一邊漂移都會有一邊轉紅。
 */
export const RPC_WHITESPACE_CHARS = String.fromCharCode(
  ...RPC_WHITESPACE_CODEPOINTS,
);

const RPC_WHITESPACE_SET = new Set<number>(RPC_WHITESPACE_CODEPOINTS);

/**
 * 控制字元。用 Unicode 類別 `Cc`(= C0 `U+0000-U+001F` + DEL + C1 `U+0080-U+009F`)。
 *
 * 🔴 **與 PG `[[:cntrl:]]` 的關係(本機 PG17 實測,非推論;R1 要求查證)**:
 *    `datctype=C` 的庫上 `U+0085`→true、`U+009F`→true、`U+2028`→false、`U+206E`→false、`U+FFF9`→false
 *    ⇒ 這五點與 `\p{Cc}` **完全一致**(原註解寫「本鏡像偏保守」是未查證的猜測,已刪)。
 * 🔴 **正式站是 `en_US.UTF-8`、未測**(#305 同族)⇒ 不外推。
 *    真正的保證來自順序:RPC 是最後一道,本檔漏放行的東西 RPC 仍會擋(結果是 `error` 不是 `invalid`,
 *    是體驗問題不是正確性問題)。
 */
const CONTROL_CHAR_RE = /\p{Cc}/u;

/** RPC 的 `v_label_max`(`20260801160000:126`)。 */
const SUPPLIER_LABEL_MAX = 100;

/** 只認正規形式的 uuid;產生端是 PG 的 `gen_random_uuid()`,不需要容忍其他寫法。 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FormLike {
  get(name: string): FormDataEntryValue | null;
}

function asString(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * 剝除 RPC 認定的全部空白字元(前後,不動內部)。
 *
 * 🔴🔴 **刻意用索引掃描而不是 regex(R1 抓到的可觸發服務阻斷)**:
 *    原本寫成 `value.replace(/^[ws]+|[ws]+$/g, '')`,而 `[ws]+$` 這個交替項對
 *    「**中間**夾一長段空白」是 **O(n²) 回溯** —— 實測 `'a' + 空白×n + 'b'`:
 *    2000→6.6ms / 8000→103.6ms / 32000→**1626.6ms**(親跑,非轉述)。
 *    server action 的 body 上限是 Next 預設 1MB ⇒ 單一 POST 就能把 admin 的事件迴圈佔住數分鐘。
 *    🔴 **RPC 的長度上限救不了** —— 爆炸發生在請求進 RPC **之前**。
 *    索引掃描是 O(n),而且連帶消滅「字元類用字串內插組、日後多一個 `-`/`]`/`\` 會靜默變成範圍」那個坑。
 */
export function rpcTrim(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && RPC_WHITESPACE_SET.has(value.charCodeAt(start))) {
    start += 1;
  }
  while (end > start && RPC_WHITESPACE_SET.has(value.charCodeAt(end - 1))) {
    end -= 1;
  }
  return value.slice(start, end);
}

/**
 * 供應商名稱正規化 + 驗證,順序**逐字對齊 RPC**(`20260801160000:192-204`):
 * 先剝空白 → 判空 → 判長度 → 判控制字元。
 * 🔴 順序是規格的一部分:先判控制字元的話,一個尾隨 tab 的名稱會被拒收,
 *    而 RPC 會把它剝掉後放行 ⇒ 兩邊對同一個輸入給出不同結果。
 */
function normalizeLabel(raw: string | null): string | null {
  if (raw === null) return null;

  const label = rpcTrim(raw);
  if (label === '') return null;
  // PG `char_length` 數的是字元(code point),JS `.length` 數 UTF-16 單位
  // ⇒ 含 surrogate pair 的名稱兩邊會不一致,用展開取 code point 數對齊。
  if ([...label].length > SUPPLIER_LABEL_MAX) return null;
  if (CONTROL_CHAR_RE.test(label)) return null;

  return label;
}

function parseSupplierId(form: FormLike): string | null {
  const id = asString(form.get(SUPPLIER_ID_FIELD));
  return id !== null && UUID_RE.test(id) ? id : null;
}

export type SupplierCreateParse = { ok: true; label: string } | { ok: false };

/** 新增:只吃 label。🔴 回傳結構裡**沒有** id —— 新增路徑物理上餵不出 id。 */
export function parseSupplierCreateForm(form: FormLike): SupplierCreateParse {
  const label = normalizeLabel(asString(form.get(SUPPLIER_LABEL_FIELD)));
  return label === null ? { ok: false } : { ok: true, label };
}

export type SupplierRenameParse =
  | { ok: true; id: string; label: string }
  | { ok: false };

/** 改名:id + label 兩者皆必要。 */
export function parseSupplierRenameForm(form: FormLike): SupplierRenameParse {
  const id = parseSupplierId(form);
  const label = normalizeLabel(asString(form.get(SUPPLIER_LABEL_FIELD)));
  if (id === null || label === null) return { ok: false };
  return { ok: true, id, label };
}

export type SupplierActiveParse =
  | { ok: true; id: string; isActive: boolean }
  | { ok: false };

/** 切換啟用狀態:id + 明確的 'true'/'false'。缺欄位或其他字面一律拒(不做寬鬆解讀)。 */
export function parseSupplierActiveForm(form: FormLike): SupplierActiveParse {
  const id = parseSupplierId(form);
  const active = asString(form.get(SUPPLIER_IS_ACTIVE_FIELD));
  if (id === null || (active !== 'true' && active !== 'false')) {
    return { ok: false };
  }
  return { ok: true, id, isActive: active === 'true' };
}
