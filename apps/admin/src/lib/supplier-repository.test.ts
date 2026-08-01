import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { createSupabaseServiceClient } = vi.hoisted(() => ({
  createSupabaseServiceClient: vi.fn(),
}));

vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient }));

import { listSupplierRows } from './supplier-repository';

function makeListClient(result: { data: unknown; error: unknown }) {
  const select = vi.fn().mockResolvedValue(result);
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from }, from, select };
}

// 與 supplier.test.ts 對齊的寫法(理由見該檔註解:簡潔箭頭會把 mock 當 teardown 回傳出去)。
// 🔴 誠實邊界:在**本檔**這個差別實測**不會**造成失敗 —— 這裡的 mock 回傳的是物件不是 promise,
//    被當 teardown 呼叫一次也無害。大括號在這裡是防未來,不是修現在的紅。
beforeEach(() => {
  createSupabaseServiceClient.mockReset();
});

describe('listSupplierRows', () => {
  it('should execute the complete supplier query chain and return rows', async () => {
    const rows = [
      { id: '11111111-1111-1111-1111-111111111111', label: 'AKOSO', is_active: true },
    ];
    const query = makeListClient({ data: rows, error: null });
    createSupabaseServiceClient.mockReturnValue(query.client);

    await expect(listSupplierRows()).resolves.toEqual(rows);
    expect(query.from).toHaveBeenCalledWith('suppliers');
    expect(query.select).toHaveBeenCalledWith('id, label, is_active');
  });

  // 這條釘住的**只有**「本層把 inactive 列原樣回傳、不自己篩」——
  // S3b 的「顯示已停用同名 + 一鍵重新啟用」靠的就是這些列(plan §6 契約債)。
  // 🔴 它**擋不住**「有人日後把 .eq('is_active', true) 加回 SQL」:mock 是手刻鏈,
  //    加過濾的人會順手把 .eq 補進 mock,而 mock 照樣回傳同一批 result ⇒ 實測 4 條全綠。
  //    SQL 側是否加了過濾**沒有任何測試守門**;真正承重的是 supplier.ts 那條 JS filter 的突變
  //    (M1 拿掉 → 2 紅)。不要把這條讀成「SQL 過濾被擋住了」。
  it('should return inactive rows untouched (filtering belongs to supplier.ts)', async () => {
    const rows = [
      { id: '11111111-1111-1111-1111-111111111111', label: 'AKOSO', is_active: true },
      { id: '22222222-2222-2222-2222-222222222222', label: '已停用商', is_active: false },
    ];
    const query = makeListClient({ data: rows, error: null });
    createSupabaseServiceClient.mockReturnValue(query.client);

    await expect(listSupplierRows()).resolves.toEqual(rows);
  });

  it('should return an empty array when Supabase returns null data', async () => {
    const query = makeListClient({ data: null, error: null });
    createSupabaseServiceClient.mockReturnValue(query.client);

    await expect(listSupplierRows()).resolves.toEqual([]);
  });

  it('should throw when Supabase returns an error', async () => {
    const dbError = { message: 'permission denied' };
    const query = makeListClient({ data: null, error: dbError });
    createSupabaseServiceClient.mockReturnValue(query.client);

    await expect(listSupplierRows()).rejects.toBe(dbError);
  });
});

// ── 突變證明現況(實跑數字,非推論)────────────────────────────
// **有**突變證明的(拿掉 ⇒ 轉紅):
//   · `if (error) throw error`      → 拿掉:1 紅(M10)
//   · `return data ?? []`           → 改成 `return data`:1 紅(M12)
//   · supplier.ts 的 `.filter`      → 拿掉:2 紅;換成恆真判斷:2 紅
//   · supplier.ts 的 `.sort`        → 拿掉:1 紅;collator 換預設比較:2 紅;換 zh-CN:1 紅
//   · supplier.ts 的 `.map` 投影    → 拿掉:1 紅(`is_active` 外洩進回傳形狀,被 toEqual 抓住)
//
// ── 🔴 只有結構斷言、**沒有**突變證明的項目(不得宣稱已證承重)──────────
// · **「刻意不下 ORDER BY」**:在 source 加 `.order('label')` 之後,測試會紅在 mock 鏈的形狀
//   (mock 沒有 `.order`),**不是**紅在「順序不對」⇒ 那不是對該行為的突變證明。
//   把 `.order` 一併補進 mock 就全綠。真正承重的是 `supplier.ts` 的 JS 排序突變。
// · **SQL 側是否加了 `is_active` 過濾**:同上,mock 手刻鏈擋不住(實測補了 `.eq` 就 4 綠)。
//   承重的是 `supplier.ts` 那條 JS filter 的突變。
// · **`.from('suppliers')` 這個表名**與**三欄 projection**(關卡2 補列):兩者都只有
//   「mock 被以某參數呼叫過」的斷言。改成別的表名/欄位清單,測試會紅在 `toHaveBeenCalledWith`
//   ——那是**結構層**斷言、不是行為證明:它證明不了「真的從 suppliers 讀到那三欄」,
//   因為 mock 根本不連 DB。真正的行為證據要等 S3b 有真 DB 的 e2e,或另寫連本機 PG 的 harness。
// ⇒ 本檔證的是「本層有把列原樣交出去」,**不是**「本層永遠不會在 SQL 動手腳」。
