/**
 * D1 cohort:D1c 會永久刪除的 26 張訂單 + 必須留下的 3 張。
 *
 * 🔴 本檔只負責「範圍」。**「這份清單有沒有被改壞」由 production 驗**(見 d1-guard.ts:
 * SQL 逐組比對 (id, display_id) 配對、數量必須是 29)—— 打錯一碼、貼錯一筆、少一筆,
 * 配對就對不上、當場中止。不在本檔自己算雜湊給自己看。
 */
export type D1CohortOrder = Readonly<{ id: string; displayId: string }>;

/**
 * 待刪的 26 張多帶一個 `restoreDisplayId`:**還原時要用的新格式單號**(D1a3)。
 *
 * 為什麼需要:還原情境有兩種 —— ①N3c 收窗**之前**還原,舊格式仍合法,直接用原單號
 * ②N3c **之後**還原,`display_id` 的 CHECK 已收緊成新格式 only,**26 張舊號會被 CHECK 擋住、
 * 整個還原失敗**。所以要預先備好新號:還原時 `display_id ← restoreDisplayId`、
 * `legacy_display_id ← 原本的 displayId`(與留存 3 張同一個模式)。
 *
 * 產生方式(§5.4a 合約):在 production 用 `extensions.gen_random_bytes` 產生 ——
 * 規格禁用 `random()`(非密碼學安全、客人能猜別人單號)。取樣用 rejection sampling:
 * **只保留 < 252 的位元組再取 `% 28`**(252 = 9 × 28,留下來的分佈才是均勻的);
 * 規格禁的是對 0-255 全範圍取模,不是禁取模本身。
 * 產生當下已驗:符合 regex、26 組彼此不重複、不與留存 3 張的新號衝突、
 * 不與現網任何 `display_id` / `legacy_display_id` 衝突。
 *
 * 🔴 **這份映射會過期**:N3b 換產號器之後,現網會開始長出新的 6 碼單號,
 * 可能撞到這裡凍結的值。⇒ restore script 執行當下**必須重驗一次碰撞**,
 * 撞到就依 §5.4a 重產;重產仍撞則 abort 人工處理。這是 D1a5 的驗收條件。
 */
export type D1DeleteCohortOrder = D1CohortOrder & Readonly<{ restoreDisplayId: string }>;

export const D1_DELETE_COHORT = Object.freeze([
  { id: '50296666-0e47-4311-834e-0ffd62a66437', displayId: 'PCM-2026-0001', restoreDisplayId: '2D3ZZZ' },
  { id: 'e65d3e86-b635-4b06-bcb4-bb4f8b5f12ee', displayId: 'PCM-2026-0002', restoreDisplayId: '2FT6TD' },
  { id: 'b267a6ef-00e1-41d3-b617-ef333682c4af', displayId: 'PCM-2026-0003', restoreDisplayId: '2H8TWB' },
  { id: 'fb1a7ee6-4346-4294-b4f2-e6956ac430b5', displayId: 'PCM-2026-0004', restoreDisplayId: '2XQVFZ' },
  { id: 'c6c610d4-b8d4-445a-8f54-6f8e421c1fa6', displayId: 'PCM-2026-0005', restoreDisplayId: '2Z3C8Z' },
  { id: '08ff97bd-4194-4a90-8827-ebfbbad2372e', displayId: 'PCM-2026-0064', restoreDisplayId: '33PGH2' },
  { id: '5e3eaee7-2efa-4f98-ad75-1083b20f2a11', displayId: 'PCM-2026-0065', restoreDisplayId: '38JQ9R' },
  { id: '2bdd0c22-f9b3-4f05-ba8c-5c72da16c484', displayId: 'PCM-2026-0066', restoreDisplayId: '3BM723' },
  { id: 'dac5d237-47a5-45e5-9af3-d3c63ed74814', displayId: 'PCM-2026-0067', restoreDisplayId: '3BQ8KS' },
  { id: 'ddb578ba-341a-4a47-bc0d-ea90139736c1', displayId: 'PCM-2026-0068', restoreDisplayId: '3DB7VP' },
  { id: 'a22e7aa3-71e5-4186-b851-2414f2c5971b', displayId: 'PCM-2026-0069', restoreDisplayId: '3FFYPJ' },
  { id: 'd481ef5b-e757-4899-8055-aaf3070ebdc0', displayId: 'PCM-2026-0070', restoreDisplayId: '3N46GB' },
  { id: '74a93389-5511-4ba9-86ea-1703fd368660', displayId: 'PCM-2026-0071', restoreDisplayId: '3T46CX' },
  { id: 'c1a24809-d9b3-435c-8c5c-7e626d57c00c', displayId: 'PCM-2026-0074', restoreDisplayId: '3WC3WR' },
  { id: '0cd292c1-8652-4d3b-bacf-a13d3de9c722', displayId: 'PCM-2026-0075', restoreDisplayId: '3XW58Y' },
  { id: 'a84fdf63-5206-4b4d-aab8-75f82dac81ad', displayId: 'PCM-2026-0076', restoreDisplayId: '46C4D7' },
  { id: 'dc219c62-69f3-4b85-8358-009fbbcd2e03', displayId: 'PCM-2026-0078', restoreDisplayId: '4DMBND' },
  { id: '54478b45-40c5-4e32-93b4-d9338c5272b5', displayId: 'PCM-2026-0079', restoreDisplayId: '4FJDF5' },
  { id: 'd0f1f03c-6043-44f1-b044-d5fa8695336e', displayId: 'PCM-2026-0080', restoreDisplayId: '4K4NZS' },
  { id: '952bec34-9b06-4dd1-9002-8d419de2d98b', displayId: 'PCM-2026-0081', restoreDisplayId: '54K8FG' },
  { id: '0feb6f34-bae9-4700-8d7c-1ad460bd6e4e', displayId: 'PCM-2026-0087', restoreDisplayId: '5CDMMJ' },
  { id: '30b8e9ae-9fcd-486e-92bf-1dcc2476b056', displayId: 'PCM-2026-0088', restoreDisplayId: '5XB2GY' },
  { id: 'cd29e323-58fe-463f-9b65-4220f034af8a', displayId: 'PCM-2026-0089', restoreDisplayId: '5Z6FF5' },
  { id: '7b9fa814-e8e6-4afd-8117-99e1a2b2cc12', displayId: 'PCM-2026-0090', restoreDisplayId: '6RHDK9' },
  { id: 'd4187cc2-1c73-4094-9826-0f7322493ba7', displayId: 'PCM-2026-0101', restoreDisplayId: '6TR5K2' },
  { id: '053c2801-e72e-4614-bb77-9ec33e0f82b0', displayId: 'PCM-2026-0103', restoreDisplayId: '6WQS8X' },
] as const satisfies readonly D1DeleteCohortOrder[]);

export const D1_RETAIN_COHORT = Object.freeze([
  { id: '37e4ef4b-b766-4627-97e6-bbaa9618ddfa', displayId: 'PCM-2026-0052' },
  { id: '2b75b50a-91c9-42b0-a9cd-35b17a2a7215', displayId: 'PCM-2026-0102' },
  { id: '6b7a783b-0c51-479d-aebb-72ae3499b52e', displayId: 'PCM-2026-0104' },
] as const satisfies readonly D1CohortOrder[]);

export const D1_COHORT: readonly D1CohortOrder[] = Object.freeze([
  ...D1_DELETE_COHORT,
  ...D1_RETAIN_COHORT,
]);

/**
 * 🔴 留存的三張單號寫死在這裡,是因為 (id, display_id) 配對比對**證明不了歸屬**:
 * 把 0052(已付款、有真錢)與某張待刪單整組互換,兩邊配對都還是對的、數量還是 29,
 * D1c 照 D1_DELETE_COHORT 就會刪掉 0052。歸屬只能在本檔釘死。
 * (Fable 對抗審查 F1;主對話實跑複驗成立。)
 */
const RETAINED_DISPLAY_IDS = ['PCM-2026-0052', 'PCM-2026-0102', 'PCM-2026-0104'] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DISPLAY_ID_RE = /^PCM-\d{4}-\d{4}$/;

/** §5.4a 產號合約:28 字元字母表(去 0O1IL 易混淆、去 AEU 母音)、固定 6 碼、無前綴。 */
const RESTORE_ID_RE = /^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$/;

/** D1c 步驟 11 給留存 3 張改的新號。還原號不得與它們相撞。 */
const RETAINED_NEW_IDS = ['YWP3PC', 'BKPR5M', 'ZNHY8B'] as const;

const restoreIds = D1_DELETE_COHORT.map(({ restoreDisplayId }) => restoreDisplayId);

// 🔴 import 時就擋:runbook 在 production 跑的時候測試不在場,這裡是唯一還生效的閘。
//    UUID / 單號格式必須驗 —— d1-guard.ts 會把它們字串內插進 SQL。
if (
  D1_DELETE_COHORT.length !== 26 ||
  D1_RETAIN_COHORT.length !== 3 ||
  new Set(D1_COHORT.map(({ id }) => id)).size !== 29 ||
  !D1_COHORT.every(({ id, displayId }) => UUID_RE.test(id) && DISPLAY_ID_RE.test(displayId)) ||
  D1_RETAIN_COHORT.map(({ displayId }) => displayId).join() !== RETAINED_DISPLAY_IDS.join() ||
  !restoreIds.every((code) => RESTORE_ID_RE.test(code)) ||
  new Set(restoreIds).size !== 26 ||
  restoreIds.some((code) => (RETAINED_NEW_IDS as readonly string[]).includes(code))
) {
  throw new Error('D1 cohort 常數已被改動(筆數 / 重複 / 格式 / 留存名單 / 還原號);拒繼續');
}
