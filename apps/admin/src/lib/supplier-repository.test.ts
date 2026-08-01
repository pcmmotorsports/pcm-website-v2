import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { createSupabaseServiceClient } = vi.hoisted(() => ({
  createSupabaseServiceClient: vi.fn(),
}));

vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient }));

import {
  SupplierCallerBugError,
  createSupplier,
  listSupplierRows,
  updateSupplier,
} from './supplier-repository';

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

// ── 寫入面(S3b-1)────────────────────────────────────────────

function makeRpcClient(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc }, rpc };
}

const AUDIT = { actor: 'sean', requestId: 'req-1' } as const;
const TARGET_ID = '11111111-2222-3333-4444-555555555555';

describe('createSupplier', () => {
  // ── 驗收 6:逐欄斷言六個 RPC 參數 ─────────────────────────────
  // 🔴 少了「逐欄」這件事,mock 無論收到什麼都回 CREATED ⇒ 就算實作把 p_label 送成 undefined
  //    也全綠。斷言整個參數物件(toHaveBeenCalledWith 是深度相等)才擋得住。
  it('should call the RPC with p_supplier_id null and every other field pinned', async () => {
    const { client, rpc } = makeRpcClient({ data: 'CREATED', error: null });
    createSupabaseServiceClient.mockReturnValue(client);

    await expect(createSupplier({ label: 'AKOSO', ...AUDIT })).resolves.toBe(
      'CREATED',
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('admin_upsert_supplier', {
      p_supplier_id: null,
      p_label: 'AKOSO',
      p_is_active: null, // ⇒ RPC 走 coalesce(...,true) = 新供應商預設啟用
      p_note: null,
      p_actor: 'sean',
      p_request_id: 'req-1',
    });
  });

  it('should pass an audit note through when given', async () => {
    const { client, rpc } = makeRpcClient({ data: 'CREATED', error: null });
    createSupabaseServiceClient.mockReturnValue(client);

    await createSupplier({ label: 'AKOSO', note: '老闆交代', ...AUDIT });

    expect(rpc).toHaveBeenCalledWith(
      'admin_upsert_supplier',
      expect.objectContaining({ p_note: '老闆交代' }),
    );
  });

  it('should surface DUPLICATE_LABEL as a business result, not an error', async () => {
    const { client } = makeRpcClient({ data: 'DUPLICATE_LABEL', error: null });
    createSupabaseServiceClient.mockReturnValue(client);

    await expect(createSupplier({ label: 'AKOSO', ...AUDIT })).resolves.toBe(
      'DUPLICATE_LABEL',
    );
  });

  // ── 驗收 9:null / 未知碼 ⇒ throw(生成型別只保證 Returns: string)──
  // 🔴 少了這條,RPC 哪天多一個回傳碼,非窮盡的分支會讓它靜默落進成功路徑。
  it.each([
    ['null', null],
    ['未知字串', 'WHATEVER'],
    ['空字串', ''],
    ['更新路徑才有的碼 UPDATED', 'UPDATED'],
    ['更新路徑才有的碼 NOT_FOUND', 'NOT_FOUND'],
  ])('should throw when the RPC returns %s', async (_case, data) => {
    const { client } = makeRpcClient({ data, error: null });
    createSupabaseServiceClient.mockReturnValue(client);

    await expect(createSupplier({ label: 'AKOSO', ...AUDIT })).rejects.toThrow(
      /新增路徑回傳非預期碼/,
    );
  });

  // ── 驗收 10:DB error 原樣拋(不吞成業務結果)──────────────────
  it('should rethrow the Supabase error object as-is', async () => {
    const dbError = { code: '42501', message: 'permission denied' };
    const { client } = makeRpcClient({ data: null, error: dbError });
    createSupabaseServiceClient.mockReturnValue(client);

    await expect(createSupplier({ label: 'AKOSO', ...AUDIT })).rejects.toBe(
      dbError,
    );
  });
});

describe('updateSupplier', () => {
  // ── 驗收 7:p_supplier_id **必須等於**傳入的 id ───────────────
  // 🔴🔴 這是契約債①的核心斷言。少了它,實作把 p_supplier_id 送成 null 時
  //      mock 照樣回 UPDATED ⇒ 測試全綠,而正式站已經多了一筆刪不掉的垃圾列。
  it('should send the caller id as p_supplier_id when renaming', async () => {
    const { client, rpc } = makeRpcClient({ data: 'UPDATED', error: null });
    createSupabaseServiceClient.mockReturnValue(client);

    await expect(
      updateSupplier({ id: TARGET_ID, label: '老吳車業', ...AUDIT }),
    ).resolves.toBe('UPDATED');

    // 🔴 K2 抓:少了次數斷言,「同一支 RPC 被呼叫兩次」也會讓 toHaveBeenCalledWith 全過
    //    ⇒ 一次改名寫兩列稽核而測試無感。
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('admin_upsert_supplier', {
      p_supplier_id: TARGET_ID,
      p_label: '老吳車業',
      p_is_active: null, // 改名不動啟用狀態
      p_note: null,
      p_actor: 'sean',
      p_request_id: 'req-1',
    });
  });

  // ── K2 must-fix:型別擋不住 `as any`,runtime 也要擋 ───────────
  it('should reject an empty patch at runtime even when the type union is bypassed', async () => {
    const { client, rpc } = makeRpcClient({ data: 'UPDATED', error: null });
    createSupabaseServiceClient.mockReturnValue(client);

    const smuggled = { id: TARGET_ID, ...AUDIT } as unknown as Parameters<
      typeof updateSupplier
    >[0];

    await expect(updateSupplier(smuggled)).rejects.toBeInstanceOf(
      SupplierCallerBugError,
    );
    // 🔴 承重點:RPC **完全沒有被呼叫** —— 空 patch 連送都不送出去。
    expect(rpc).not.toHaveBeenCalled();
  });

  it('should send p_label null when only toggling active state', async () => {
    const { client, rpc } = makeRpcClient({ data: 'UPDATED', error: null });
    createSupabaseServiceClient.mockReturnValue(client);

    await updateSupplier({ id: TARGET_ID, isActive: false, ...AUDIT });

    expect(rpc).toHaveBeenCalledWith('admin_upsert_supplier', {
      p_supplier_id: TARGET_ID,
      p_label: null, // 停用不動名稱
      p_is_active: false,
      p_note: null,
      p_actor: 'sean',
      p_request_id: 'req-1',
    });
  });

  // 🔴 `isActive: false` 必須送 false,不能被 `??` 或 `||` 吃成 null
  //    —— `args.isActive || null` 會把「停用」變成「不動」= 按了沒反應而且零錯誤。
  it('should not collapse isActive:false into null', async () => {
    const { client, rpc } = makeRpcClient({ data: 'UPDATED', error: null });
    createSupabaseServiceClient.mockReturnValue(client);

    await updateSupplier({ id: TARGET_ID, isActive: false, ...AUDIT });

    expect(rpc).toHaveBeenCalledWith(
      'admin_upsert_supplier',
      expect.objectContaining({ p_is_active: false }),
    );
  });

  it.each(['UPDATED', 'NO_CHANGE', 'NOT_FOUND', 'DUPLICATE_LABEL'] as const)(
    'should return the business code %s untouched',
    async (code) => {
      const { client } = makeRpcClient({ data: code, error: null });
      createSupabaseServiceClient.mockReturnValue(client);

      await expect(
        updateSupplier({ id: TARGET_ID, label: 'X', ...AUDIT }),
      ).resolves.toBe(code);
    },
  );

  // ── 驗收 8:收到 CREATED ⇒ 專屬錯誤,絕不當成功 ────────────────
  // 🔴 plan §6 契約債① / `20260801160000:42`。這是**偵測**不是預防 ——
  //    走到這裡時垃圾列已經寫進去了,而供應商不可刪除。
  it('should throw SupplierCallerBugError when the RPC returns CREATED', async () => {
    const { client } = makeRpcClient({ data: 'CREATED', error: null });
    createSupabaseServiceClient.mockReturnValue(client);

    const promise = updateSupplier({ id: TARGET_ID, label: 'X', ...AUDIT });

    await expect(promise).rejects.toBeInstanceOf(SupplierCallerBugError);
    await expect(promise).rejects.toThrow(/多餘的供應商/);
  });

  it.each([
    ['null', null],
    ['未知字串', 'WHATEVER'],
    ['空字串', ''],
  ])('should throw when the RPC returns %s', async (_case, data) => {
    const { client } = makeRpcClient({ data, error: null });
    createSupabaseServiceClient.mockReturnValue(client);

    await expect(
      updateSupplier({ id: TARGET_ID, label: 'X', ...AUDIT }),
    ).rejects.toThrow(/更新路徑回傳非預期碼/);
  });

  it('should rethrow the Supabase error object as-is', async () => {
    const dbError = { code: '42501', message: 'permission denied' };
    const { client } = makeRpcClient({ data: null, error: dbError });
    createSupabaseServiceClient.mockReturnValue(client);

    await expect(
      updateSupplier({ id: TARGET_ID, label: 'X', ...AUDIT }),
    ).rejects.toBe(dbError);
  });
});

// ── 驗收 11:型別層分流(契約債①的真正預防層)─────────────────
// 🔴 這一段的驗證者是 `tsc --noEmit`(三綠的 typecheck),不是 vitest。
//    把 `updateSupplier` 的 id 改成 optional、或給 `createSupplier` 加上 id 欄位,
//    對應的 `@ts-expect-error` 會變成「沒有錯誤可期待」⇒ **typecheck 轉紅**。
describe('型別層防線', () => {
  // ── K2 must-fix:spread 繞過多餘屬性檢查 ──────────────────────
  // 🔴 TS 的多餘屬性檢查**只作用在物件字面**。`createSupplier({ ...renameParsed, ...audit })`
  //    —— 呼叫端最自然的寫法 —— 在沒有 `id?: never` 時**零診斷**通過,然後送出
  //    p_supplier_id:null 誤建一筆永久列。親驗 tsc 5.9.3:加了 `id?: never` 才紅。
  it('should reject an id smuggled in by spread (not just by object literal)', () => {
    const neverRun = async () => {
      const renameParsed = { id: TARGET_ID, label: '老吳車業' };
      // @ts-expect-error spread 帶進 id ⇒ 必須是編譯錯(`id?: never` 的存在理由)
      await createSupplier({ ...renameParsed, ...AUDIT });
    };

    expect(typeof neverRun).toBe('function');
  });

  it('should reject an id smuggled past the type layer at runtime', async () => {
    const { client, rpc } = makeRpcClient({ data: 'CREATED', error: null });
    createSupabaseServiceClient.mockReturnValue(client);

    const smuggled = { id: TARGET_ID, label: 'X', ...AUDIT } as unknown as
      Parameters<typeof createSupplier>[0];

    await expect(createSupplier(smuggled)).rejects.toBeInstanceOf(
      SupplierCallerBugError,
    );
    expect(rpc).not.toHaveBeenCalled(); // 承重點:誤建那一列連送都沒送出去
  });

  it('should make a lost id a compile error, not a runtime garbage row', () => {
    // 這個函式**永不執行** —— 它存在的唯一目的是被 tsc 檢查。
    const neverRun = async () => {
      // @ts-expect-error id 必填:傳 null 就是把 id 弄丟,必須在編譯期就死
      await updateSupplier({ id: null, label: 'X', ...AUDIT });
      // @ts-expect-error id 缺席:同上
      await updateSupplier({ label: 'X', ...AUDIT });
      // @ts-expect-error createSupplier 的參數型別裡沒有 id ⇒ 物理上餵不進去
      await createSupplier({ id: TARGET_ID, label: 'X', ...AUDIT });
      // @ts-expect-error 空 patch:label 與 isActive 都不給 ⇒ 編譯期就不合法(R1 must-fix #2)。
      //   少了這道,它會打到 RPC 的「沒有要變更的欄位」RAISE,使用者只看到通用的 error。
      await updateSupplier({ id: TARGET_ID, ...AUDIT });
    };

    expect(typeof neverRun).toBe('function');
  });
});

// ── S3b-1 寫入面的突變證明(實跑數字,非推論;基準線先驗證過是綠的)──────
//   · `id: args.id` → `id: null`(改名弄丟 id)      → **2 紅**,tsc 綠
//   · `if (data === 'CREATED') {` → 永假            → **1 紅**(專屬錯誤那條),tsc 綠
//   · `args.isActive ?? null` → `|| null`           → **2 紅**,tsc 綠
//   · 更新路徑未知碼改成靜默回 'UPDATED'            → **3 紅**,tsc 綠
//   · `id: string` → `id?: string`                  → vitest **全綠**、**tsc 紅**(TS2578 未使用的 expect-error)
//   · `SupplierPatch` 聯集 → 兩欄皆可選             → vitest **全綠**、**tsc 紅**(同上)
//   · 拿掉 `id?: never`(K2 的 spread 洞)          → vitest **全綠**、**tsc 紅**(TS2578 @ 本檔 :292)
//   · 拿掉 createSupplier 的 runtime id 閘          → **1 紅**(smuggled id 那條)
//   · 拿掉 updateSupplier 的空 patch runtime 閘     → **1 紅**(smuggled 空 patch 那條)
// 🔴 三格的判官是 **tsc,不是 vitest** —— 只看測試數會以為那三道守門不存在。
//
// 🔴 **兩條不是獨立證據(R1 抓)**:`should not collapse isActive:false into null` 被
//    `should send p_label null when only toggling active state` 的深度相等斷言嚴格蘊含;
//    `should return the business code UPDATED` 被 `should send the caller id...` 蘊含。
//    留著是為了讓失敗訊息指得更準,**不得把它們算成兩個獨立的證據面**
//    (memory `feedback_negative-test-observation-supplied-by-another-mechanism` 同型)。
// 🔴 **`expect.objectContaining` 那兩條自己抓不到「多送了不該送的參數」** ——
//    該缺口由三條深度相等斷言(`toHaveBeenCalledWith` 整個物件)覆蓋;
//    R1 實測加一個 `p_stray` 參數 ⇒ 3 紅。**別把 objectContaining 當成參數面的守門。**
//
// ── S3a 讀取面的突變證明現況(S3b-1 未改動這段的結論)───────────
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
