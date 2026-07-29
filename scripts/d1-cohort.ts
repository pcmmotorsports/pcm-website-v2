import { createHash } from 'node:crypto';
export type D1CohortOrder = Readonly<{
  id: string;
  displayId: string;
}>;

export const D1_DELETE_COHORT = Object.freeze([
  { id: '50296666-0e47-4311-834e-0ffd62a66437', displayId: 'PCM-2026-0001' },
  { id: 'e65d3e86-b635-4b06-bcb4-bb4f8b5f12ee', displayId: 'PCM-2026-0002' },
  { id: 'b267a6ef-00e1-41d3-b617-ef333682c4af', displayId: 'PCM-2026-0003' },
  { id: 'fb1a7ee6-4346-4294-b4f2-e6956ac430b5', displayId: 'PCM-2026-0004' },
  { id: 'c6c610d4-b8d4-445a-8f54-6f8e421c1fa6', displayId: 'PCM-2026-0005' },
  { id: '08ff97bd-4194-4a90-8827-ebfbbad2372e', displayId: 'PCM-2026-0064' },
  { id: '5e3eaee7-2efa-4f98-ad75-1083b20f2a11', displayId: 'PCM-2026-0065' },
  { id: '2bdd0c22-f9b3-4f05-ba8c-5c72da16c484', displayId: 'PCM-2026-0066' },
  { id: 'dac5d237-47a5-45e5-9af3-d3c63ed74814', displayId: 'PCM-2026-0067' },
  { id: 'ddb578ba-341a-4a47-bc0d-ea90139736c1', displayId: 'PCM-2026-0068' },
  { id: 'a22e7aa3-71e5-4186-b851-2414f2c5971b', displayId: 'PCM-2026-0069' },
  { id: 'd481ef5b-e757-4899-8055-aaf3070ebdc0', displayId: 'PCM-2026-0070' },
  { id: '74a93389-5511-4ba9-86ea-1703fd368660', displayId: 'PCM-2026-0071' },
  { id: 'c1a24809-d9b3-435c-8c5c-7e626d57c00c', displayId: 'PCM-2026-0074' },
  { id: '0cd292c1-8652-4d3b-bacf-a13d3de9c722', displayId: 'PCM-2026-0075' },
  { id: 'a84fdf63-5206-4b4d-aab8-75f82dac81ad', displayId: 'PCM-2026-0076' },
  { id: 'dc219c62-69f3-4b85-8358-009fbbcd2e03', displayId: 'PCM-2026-0078' },
  { id: '54478b45-40c5-4e32-93b4-d9338c5272b5', displayId: 'PCM-2026-0079' },
  { id: 'd0f1f03c-6043-44f1-b044-d5fa8695336e', displayId: 'PCM-2026-0080' },
  { id: '952bec34-9b06-4dd1-9002-8d419de2d98b', displayId: 'PCM-2026-0081' },
  { id: '0feb6f34-bae9-4700-8d7c-1ad460bd6e4e', displayId: 'PCM-2026-0087' },
  { id: '30b8e9ae-9fcd-486e-92bf-1dcc2476b056', displayId: 'PCM-2026-0088' },
  { id: 'cd29e323-58fe-463f-9b65-4220f034af8a', displayId: 'PCM-2026-0089' },
  { id: '7b9fa814-e8e6-4afd-8117-99e1a2b2cc12', displayId: 'PCM-2026-0090' },
  { id: 'd4187cc2-1c73-4094-9826-0f7322493ba7', displayId: 'PCM-2026-0101' },
  { id: '053c2801-e72e-4614-bb77-9ec33e0f82b0', displayId: 'PCM-2026-0103' },
] as const satisfies readonly D1CohortOrder[]);

export const D1_RETAIN_COHORT = Object.freeze([
  { id: '37e4ef4b-b766-4627-97e6-bbaa9618ddfa', displayId: 'PCM-2026-0052' },
  { id: '2b75b50a-91c9-42b0-a9cd-35b17a2a7215', displayId: 'PCM-2026-0102' },
  { id: '6b7a783b-0c51-479d-aebb-72ae3499b52e', displayId: 'PCM-2026-0104' },
] as const satisfies readonly D1CohortOrder[]);

export const D1_COHORT = Object.freeze([
  ...D1_DELETE_COHORT,
  ...D1_RETAIN_COHORT,
]) as readonly D1CohortOrder[];

const d1CohortIds = D1_COHORT.map(({ id }) => id);

// 🔴 以下三個 import-time 檢查是 **runbook 在 production 執行時唯一生效的閘**
//    (那時 vitest 不在場)。Fable F4 更正:它們不是「與測試重複」——
//    測試在本質上觀察不到 import-time guard 被移除,所以突變測試對它們一律綠。
//    ⇒ 日後不得以「duplicate cleanup」為由刪除。
if (
  D1_DELETE_COHORT.length !== 26 ||
  D1_RETAIN_COHORT.length !== 3 ||
  D1_COHORT.length !== 29 ||
  new Set(d1CohortIds).size !== 29
) {
  throw new Error('D1 cohort 常數必須是 26 筆待刪、3 筆留存，且 29 個 UUID 不得重複');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

if (!d1CohortIds.every((id) => UUID_RE.test(id))) {
  throw new Error('D1 cohort 含格式不合法的 UUID;guard.ts 會把它字串內插進 SQL,拒繼續');
}

/**
 * cohort 指紋 = 依 displayId 排序後 `id,displayId,delete|retain` 逐行串接的 md5。
 *
 * 🔴 **第三欄(陣列歸屬)是 Fable 對抗審查 F1 補上的,不得拿掉。** 原版只雜湊
 * `id,displayId`,而兩個陣列合併排序後「哪一筆屬於哪一陣列」的資訊完全消失 ——
 * 把 PCM-2026-0052(留存、已付款)與 PCM-2026-0001(待刪)整組互換陣列,
 * 長度仍 26/3、UUID 仍 29 個不重複、指紋逐字元相同(主對話實跑複驗成立),
 * D1c 會照 D1_DELETE_COHORT 刪掉一張有真錢的留存單。
 *
 * 釘值來源 = production:以 displayId 為鍵反查 29 筆,**歸屬由資料庫自己的
 * `paid_at` 決定**(`paid_at IS NOT NULL` = retain),在庫內算同一個 md5 =
 * ba1e416a8fc20c3afa76f6e19bc283af。所以這個值不是本檔自己算給自己看的。
 *
 * 🔴 它擋不住的(codex R2 C8 更正 —— 原本這裡把 D1b1 的涵蓋面寫得比事實大):
 * ①訂單在 D1 執行當下是否仍存在 → 那是 d1-guard.ts 的 SQL count 守門。
 * ②這 26 張是否真的沒扣到錢 → **D1b1 的 TapPay read-back 只查六筆 attempt,
 *   其中屬於待刪組的只有 0064 / 0090;0101 依 §8.7 明定不查(證據 = Sean 本人
 *   查 TapPay 後確認、非系統 read-back);其餘 23 張根本沒有逐筆 read-back。**
 *   ⇒ 「26 張都沒扣款」這件事在系統內沒有可機械複驗的證據,唯一還原路徑是
 *   D1a2 的加密匯出檔(180 天)。指紋只證明本檔字面沒被改過,不證明任何金流事實。
 */
export const D1_COHORT_MD5 = 'ba1e416a8fc20c3afa76f6e19bc283af';

type D1FingerprintRow = Readonly<{ id: string; displayId: string; membership: string }>;

export const D1_COHORT_WITH_MEMBERSHIP: readonly D1FingerprintRow[] = Object.freeze([
  ...D1_DELETE_COHORT.map((row) => ({ ...row, membership: 'delete' })),
  ...D1_RETAIN_COHORT.map((row) => ({ ...row, membership: 'retain' })),
]);

/**
 * 🔴 **`rows` 參數是 codex R2 C5 的修法,不得改回讀模組常數。**
 * 原版沒有參數 ⇒ 把整個函式改成 `return D1_COHORT_MD5` 一行,所有測試照樣全綠
 * (測試只驗「算出來 == 釘值」,而被掏空的版本永遠等於釘值)。
 * 開了參數之後,測試可以餵一份「留存單被搬進待刪組」的資料進來要求算出不同值,
 * 掏空的實作就過不了那條。
 */
export function d1CohortFingerprint(
  rows: readonly D1FingerprintRow[] = D1_COHORT_WITH_MEMBERSHIP,
): string {
  const canonical = [...rows]
    .sort((a, b) => a.displayId.localeCompare(b.displayId))
    .map(({ id, displayId, membership }) => `${id},${displayId},${membership}`)
    .join('\n');

  return createHash('md5').update(canonical).digest('hex');
}

if (d1CohortFingerprint() !== D1_COHORT_MD5) {
  throw new Error('D1 cohort 指紋與釘死值不符 — 本檔字面被改過,拒繼續');
}
