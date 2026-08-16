// amount-p2c13-set.test.ts — 🔴 **F5:釘住 `P2C13` 底下到底有哪些 constraint**(M-4b E10 #13 片1c-2)。
//
// **為什麼要這一格(R3/fable F1 打出來的)**:
// `amount-actions.ts` **曾經**用 `code === 'P2C13'` 分派,而第一版把它整批當成「業務拒絕」。
// ✅ `#518`(2026-08-16)已改成 `details` 白名單分派 —— 下面這段記錄的是**為什麼要改**。
// 🔴 **那是假的** —— 同一支 migration 底下有兩條 `P2C13` **不是業務拒絕**:
//   `pcm_e13_subtotal_matches_lines`(跨列不變式違反 ⇒ **資料損壞**)
//   `pcm_e13_guard_unknown_table`(trigger 掛到未登記的表 ⇒ **設定錯誤**)
// 而它們**在本 RPC 自己的交易 commit 時就可能觸發**(constraint trigger 掛在該檔 `:314-321`,
// 而本 RPC 每次都改 `line_total` 與 `subtotal`)。
//
// 🔴🔴 **本格守的是【集合本身】,不是文案** ——
// 之後有人在那支 migration 加一條 `P2C13`(或把某條從業務拒絕改成別的意思),**這一格會紅**,
// 而紅的時候要做的是**回來重看 `amount-action-state.ts` 的文案還成不成立**,不是把新成員加進清單了事。
//
// ⚠️ **它守不住什麼(寫在旁邊,不要讀成全涵蓋)**:
//   ① **只掃那一支 migration**。`supabase/migrations/**` 只有它用 `P2C13`
//      (`grep -rl "P2C13" supabase/migrations/*.sql | wc -l` ⇒ **1**),但**別人明天加一支它掃不到**。
//   ② **是正規式,不是 SQL parser** —— 動態拼出來的 `USING ERRCODE` 掃不到。
//   ③ **它分不出「執行期到得了客戶端」與「apply 時才跑」** —— 那個分類是**人**在下面手寫的,
//      新增成員時要人去判它屬於哪一類。**這一格只保證你會被叫回來判。**

import { describe, it, expect } from 'vitest';
import {
  ORDER_AMOUNT_BUSINESS_CONSTRAINTS,
  isOrderAmountBusinessRejection,
} from './amount-reject-set';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATION = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../supabase/migrations/20260815040000_m4b_e10_13_slice1_admin_update_order_item_amount.sql',
);

/**
 * 業務拒絕(員工看得懂、也可能自己處理)。
 * 🔴 **`#518` 之後這裡不再手寫** —— 直接讀原始碼那顆常數,
 *    否則「原始碼改了、測試沒改」時這一整支測試會安靜地繼續驗一份過期的清單。
 */
const BUSINESS = ORDER_AMOUNT_BUSINESS_CONSTRAINTS;

/** 🔴 **不是**業務拒絕,但執行期同樣回 `P2C13` 給客戶端 */
const NOT_BUSINESS = ['pcm_e13_subtotal_matches_lines', 'pcm_e13_guard_unknown_table'] as const;

/** apply 時的自我斷言(檔尾 `DO` 區塊)⇒ 到不了客戶端 */
const APPLY_TIME = [
  'pcm_e13_proacl_null',
  'pcm_e13_acl_extra_grantee',
  'pcm_e13_service_role_no_execute',
  'pcm_e13_function_shape',
  'pcm_e13_search_path',
  'pcm_e13_triggers_deferred',
] as const;

function p2c13Constraints(): string[] {
  const sql = readFileSync(MIGRATION, 'utf8');
  return [...sql.matchAll(/ERRCODE = 'P2C13', CONSTRAINT = '([a-z0-9_]+)'/g)].map((m) => m[1]!);
}

describe('🔴 P2C13 的 constraint 集合(F5:集合一變就紅)', () => {
  it('掃描本身是活的(分母非 0,且正向對照命中一個已知成員)', () => {
    // 🔴 先證量具在讀東西 —— 「零命中」與「掃錯檔」在畫面上一模一樣。
    const found = p2c13Constraints();
    expect(found.length).toBeGreaterThan(0);
    expect(found).toContain('pcm_e13_no_edit_after_payment');
  });

  it('🔴 集合逐字等於三份手寫清單的聯集(多一條沒歸類的 ⇒ 紅)', () => {
    expect(p2c13Constraints().sort()).toEqual(
      [...BUSINESS, ...NOT_BUSINESS, ...APPLY_TIME].sort(),
    );
  });

  it('🔴🔴 執行期到得了客戶端的不是只有業務那 7 條 —— 有 2 條不是業務拒絕', () => {
    // 這一格是給讀 code 的人看的:`code === 'P2C13'` **不等於**「業務上的問題」。
    // 🔴 `#518` 之後這句話已經被實作吃進去了(分派看 `details` 不看 `code`),
    //    這一格從「提醒」升級成「守住那個區分」。
    // ⇒ `ORDER_AMOUNT_REJECTED_MESSAGE` 因此不得宣稱是業務問題,並且要留一句「找系統維護」的出口。
    expect(BUSINESS.length).toBe(7);
    expect(NOT_BUSINESS.length).toBe(2);
    expect(BUSINESS.length + NOT_BUSINESS.length).toBe(9);
  });
});


// ══ `#518`:DETAIL 那一層 ══════════════════════════════════════════════════════
const DETAIL_MIGRATION = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../supabase/migrations/20260816040000_m4b_e10_13_518_p2c13_detail.sql',
);

describe('🔴 #518:七條業務 RAISE 的 DETAIL 逐字等於 constraint 名', () => {
  it('DETAIL migration 裡的 CONSTRAINT/DETAIL 同名配對,逐字等於原始碼那七顆', () => {
    const sql = readFileSync(DETAIL_MIGRATION, 'utf8');
    const pairs = [
      ...sql.matchAll(/CONSTRAINT = '([a-z0-9_]+)',\s*\n\s*DETAIL = '([a-z0-9_]+)'/g),
    ];
    expect(pairs.length).toBeGreaterThan(0); // 正向對照:真的抓到配對,不是 pattern 沒對上
    // 🔴 同名是硬條件 —— 打錯名字的 DETAIL 會讓那條拒絕落到通用錯誤,而畫面上看不出來。
    expect(pairs.filter((m) => m[1] === m[2]).map((m) => m[1]).sort()).toEqual([...BUSINESS].sort());
  });
});

describe('🔴🔴 isOrderAmountBusinessRejection:fail-closed 的方向', () => {
  it('七條業務名 ⇒ true', () => {
    for (const name of BUSINESS) {
      expect(isOrderAmountBusinessRejection({ code: 'P2C13', details: name })).toBe(true);
    }
  });

  it('🔴 那兩條【不是】業務拒絕的 ⇒ false(這一格就是 F1 本身)', () => {
    // 它們拿不到 DETAIL(住在別的函式)⇒ 實際到客戶端時 details 是 null;
    // 但就算哪天有人幫它們補上 DETAIL,白名單也不該收它們。
    for (const name of NOT_BUSINESS) {
      expect(isOrderAmountBusinessRejection({ code: 'P2C13', details: name })).toBe(false);
    }
  });

  it('🔴 details 為 null(= migration 還沒 apply)⇒ false,走通用錯誤', () => {
    expect(isOrderAmountBusinessRejection({ code: 'P2C13', details: null })).toBe(false);
  });

  it('code 不是 P2C13 ⇒ false(即使 details 剛好是業務名)', () => {
    expect(
      isOrderAmountBusinessRejection({ code: 'P0001', details: 'pcm_e13_total_negative' }),
    ).toBe(false);
  });

  it('非物件 / null / undefined ⇒ false,不炸', () => {
    for (const v of [null, undefined, 'P2C13', 42]) {
      expect(isOrderAmountBusinessRejection(v)).toBe(false);
    }
  });
});
