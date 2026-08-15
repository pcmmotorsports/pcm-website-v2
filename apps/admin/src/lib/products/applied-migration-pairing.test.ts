import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// `#20` 片2c 的**硬前提守門**:後台 SELECT 到的欄位,不得早於它的 migration apply 而上線。
//
// ── 為什麼需要這支(關卡 R1 must-fix-1)────────────────────────────────────────
// 片2c 把 `listing_set_by` / `source_missing_at` 放進 **無條件** 的 SELECT 清單
// (`product-repository.ts` 的 `PRODUCT_LIST_COLUMNS` 與 `PRODUCT_DETAIL_COLUMNS`)。
// 而 `20260815030000` 尚未 apply ⇒ 這段 code 若先上線,PostgREST 每次都回 `42703`:
//   · 列表頁 → 走 catch → 顯示「商品列表載入失敗」
//   · 詳情頁 → 走 catch → `notFound()` → **404,讀起來像「這個商品不存在」而不是「系統壞了」**
// 🔴 而三道守門全部看不到:單測 `vi.mock` 掉 Supabase client、typecheck 因為
//    `database.types.ts` 被手改成「這兩欄存在」而全綠。
//    ⇒ **三綠全綠、突變全紅、正式站 42703** —— 08-07 A9h 事故(正式站壞約 8 小時)同一形狀。
//
// ── 為什麼寫成 `it.fails`,而不是一條普通斷言 ─────────────────────────────────
// 普通斷言會**現在就紅**,擋住 commit;而 Sean 的 apply 是獨立停點,不是我或主視窗能代的。
// 🔴 `it.fails` 讓這件事變成**「現在綠、apply 之後紅」**:
//   · 未 apply(現在)→ 內層斷言失敗 → `it.fails` 通過 → 可以 commit
//   · Sean apply 之後 → 內層斷言成立 → **`it.fails` 開始紅** → 逼下一個人回到這裡
//     ⇒ **而那正是該重 gen `database.types.ts` 並刪掉它檔頭第 ④ 段的同一刻。**
// ⚠️ **這不是把紅藏起來** —— 它把紅**挪到有人能處理的那一刻**。
//    現在紅沒有人能修(要 Sean),apply 後紅的人手上剛好有全部材料。
//
// ⚠️ **本守門不驗正式庫**,它讀的是 `supabase/APPLIED.tsv`(**自陳帳**)。
//    帳與真實不符時它會誤判 —— 那本帳按設計就是自陳的,這裡只是不假裝它不是。

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const MIGRATION_VERSION = '20260815030000';
const NEW_COLUMNS = ['listing_set_by', 'source_missing_at'] as const;

function read(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

describe('🔴 #20 片2c:SELECT 的欄位不得早於 migration apply 而上線', () => {
  it('前提斷言:repository 真的有 SELECT 那兩欄(不然本檔整支恆綠、白站崗)', () => {
    const code = read('apps/admin/src/lib/products/product-repository.ts');
    for (const col of NEW_COLUMNS) {
      expect({ [`repository 有 select ${col}`]: code.includes(col) }).toEqual({
        [`repository 有 select ${col}`]: true,
      });
    }
  });

  it('前提斷言:APPLIED.tsv 讀得到、而且格式是我以為的那樣(正向對照)', () => {
    const applied = read('supabase/APPLIED.tsv');
    // 拿一支「一定已 apply」的當正向對照 —— 沒有它,下面那格的「0 命中」可能只是路徑或格式錯。
    expect(applied).toContain('20260815020000');
  });

  // 🏁 2026-08-15 13:3x:Sean 已 apply,本格已依設計「開始紅」並被處理 ——
  //    主視窗重 gen database.types.ts、把它檔頭第 ④ 段標成作廢留痕(未刪,它記錄了一個真實發生過的狀態),
  //    並把本格從 `it.fails` 改成普通斷言。上面那段「為什麼寫成 it.fails」保留當紀錄:
  //    🔴 它是本 repo 第一次把「紅」刻意排到【有人能處理的那一刻】，而不是刻意讓它現在就紅或永遠不紅。
  //    ⇒ 從現在起本格的意義變成「這片的 SELECT 與那支 migration 必須成對存在」的常設守門。
  it('SELECT 用到的兩欄，其 migration 必須已登記在 APPLIED.tsv（成對存在）', () => {
    const applied = read('supabase/APPLIED.tsv');
    expect(applied).toContain(MIGRATION_VERSION);
  });
});
