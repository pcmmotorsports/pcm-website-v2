import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REVERSE_CONFIRM_PAYMENT,
  REVERSE_CONFIRM_REVERSAL,
  reverseFailure,
  reverseFailureCodeFor,
  reverseFailureCodeForThrown,
  reverseMessageFor,
  type ReverseFailureCode,
} from './payment-reverse-state';

// payment-reverse-state.test.ts — #372-A12 沖銷碼表與**合約文案**的守門。
//
// 🔴 本檔的核心是 **`toBe()` 全等比對,不是 `toContain`**(關卡1 R3 F3):
//    原本的設計是「斷言不含禁詞」= blocklist,而 blocklist 天生列不完 ——
//    實測 `'再試一次'.includes('重試')` 是 **false**(「再試」≠「重試」)⇒
//    換個同義詞就繞過去了,而那正是會把員工推去沖掉沖銷列的那句話。
//    ⇒ 主閘改成「每一句都等於合約字面」,blocklist 只當第二道。

// ── 合約字面(plan D-600-PLAN.md §12,Sean 2026-08-12 批 v4;改字要回頭重問)────────
const C_UNKNOWN =
  '沖銷可能已經完成,也可能沒有。請先重新整理這一頁,再看你剛才要沖的那一筆收款:' +
  '如果它已經標成「已沖銷」,就是成功了,到此為止,不要再按任何按鈕。' +
  '如果它沒有「已沖銷」的標記,代表沖銷沒有完成,請回到原本那一筆再沖一次。' +
  '注意:不要去沖列表上新出現的那一列負數,那是沖銷紀錄本身,沖掉它會把原本那筆收款加回帳上。';

const D_NOT_REVERSIBLE =
  '這一筆現在不能沖銷。最常見的原因是它已經被沖掉了 —— 可能是你上一次按的其實成功了。' +
  '請重新整理這一頁,看那一筆是不是已經標成「已沖銷」:是的話就已經完成了,不用再做任何事。' +
  '如果不是,請通知系統維護。';

const E_WROTE =
  '沖銷已經完成了,只是系統讀不懂回應。請重新整理這一頁確認那一筆已經標成「已沖銷」。不要再沖一次。';

const A_CONFIRM_PAYMENT =
  '要沖銷這一筆收款嗎?沖掉之後,這筆錢會從「已收」裡扣掉。原本那一筆不會消失,系統會另外記一列沖銷紀錄。';

const B_CONFIRM_REVERSAL =
  '這一列是沖銷更正,不是一筆收款。沖掉它等於把原本那筆收款恢復到帳上,「已收」會加回去。確定要這樣做嗎?';

describe('🔴 五句核可句 = 合約字面(toBe 全等,不是 toContain)', () => {
  it('C 連線類 / 無碼', () => {
    expect(reverseMessageFor('unknown')).toBe(C_UNKNOWN);
  });

  it('D P2B44(終態)', () => {
    expect(reverseMessageFor('not_reversible')).toBe(D_NOT_REVERSIBLE);
  });

  it('E wrote(已 COMMIT)', () => {
    expect(reverseMessageFor('wrote')).toBe(E_WROTE);
  });

  it('A 一般收款列的確認詞', () => {
    expect(REVERSE_CONFIRM_PAYMENT).toBe(A_CONFIRM_PAYMENT);
  });

  it('B 沖銷列的確認詞', () => {
    expect(REVERSE_CONFIRM_REVERSAL).toBe(B_CONFIRM_REVERSAL);
  });

  it('🔴 A 與 B 不得相等(方向相反的兩件事,共用一句 = 在最需要分辨那刻不給分辨)', () => {
    expect(REVERSE_CONFIRM_REVERSAL).not.toBe(REVERSE_CONFIRM_PAYMENT);
  });

  it('🔴 B 必須講明「恢復」—— 沖掉一列沖銷 = 把原本那筆收款加回帳上', () => {
    expect(REVERSE_CONFIRM_REVERSAL).toContain('恢復');
    // 反面:A 不該講恢復(它的方向是扣掉)。少了這格,兩句寫成同一句也會過上面那格。
    expect(REVERSE_CONFIRM_PAYMENT).not.toContain('恢復');
  });
});

/**
 * 🔴 **剩下五句也要逐字釘死**(關卡2 R1 MF5)。
 *
 * 原本只驗「碼對得上 + 不含禁詞」—— 那擋不住**方向被講反**:
 * 把「整筆已經回滾」改成「可能已經沖掉了」照樣全綠,而那句話會讓員工不敢再操作
 * (或反過來去沖那列負數)。錢的文案,方向錯就是錯。
 */
describe('🔴 其餘五句同樣 toBe 全等(擋「方向被講反」)', () => {
  it.each([
    ['isolation', '系統設定有問題(交易隔離層級不對),這次沒有沖成,整筆已經回滾。請找工程處理。'],
    [
      'actor_invalid',
      '你的操作者身分無效或已停用,這次沒有沖成,整筆已經回滾。請重新登入;還是不行請找工程。',
    ],
    [
      'row_count',
      '沖銷沒有寫進帳本(系統異常),這次沒有沖成,整筆已經回滾,帳上沒有任何變化。請不要重複按,先找工程確認。',
    ],
    [
      'rejected',
      '這一筆現在不能沖銷,或是送出的內容不正確(例如沒有填沖銷原因),這次沒有沖成,整筆已經回滾。' +
        '請先重新整理這一頁看那一筆的狀態,再決定要不要處理。',
    ],
    ['forbidden', '沒有權限執行沖銷,這次沒有沖成,整筆已經回滾。請找工程確認權限設定。'],
    ['denied', '沒有權限或登入狀態已失效,這次沒有沖成。'],
    ['invalid', '沖銷原因是必填的,請填寫之後再送出。這次沒有沖成。'],
    [
      'bug',
      '系統狀態異常,這次沒有沖成,整筆已經回滾。請重新整理這一頁確認之後再操作,不要重複按。',
    ],
  ] as const)('%s 的字面', (code, expected) => {
    expect(reverseMessageFor(code)).toBe(expected);
  });

  it('🔴 方向面:這八句都要說「沒有沖成」,而且都不可以說「已經完成」', () => {
    const rolledBack: ReverseFailureCode[] = [
      'isolation',
      'actor_invalid',
      'row_count',
      'rejected',
      'forbidden',
      'denied',
      'invalid',
      'bug',
    ];
    for (const code of rolledBack) {
      const msg = reverseMessageFor(code);
      expect(msg, `${code} 沒有說「沒有沖成」`).toContain('沒有沖成');
      expect(msg, `${code} 竟然說「已經完成」`).not.toContain('已經完成');
    }
    // 反面對照組:唯一該說「已經完成」的是 wrote —— 少了這行,上面那族全改成
    // 空字串也會過(「不含已經完成」對空字串恆真)。
    expect(reverseMessageFor('wrote')).toContain('沖銷已經完成了');
  });
});

describe('🔴 C 是唯一的雙分支句,而且負分支要點名「原本那一筆」', () => {
  it('正分支:有標記 ⇒ 停手', () => {
    expect(C_UNKNOWN).toContain('已經標成「已沖銷」,就是成功了,到此為止,不要再按任何按鈕');
  });

  it('🔴 負分支:沒標記 ⇒ 回到原本那一筆再沖一次(R3 F1 抓到 v2 把這句封死了)', () => {
    expect(C_UNKNOWN).toContain('請回到原本那一筆再沖一次');
  });

  it('🔴 而且要明說不要去沖新出現的那列負數', () => {
    expect(C_UNKNOWN).toContain('不要去沖列表上新出現的那一列負數');
  });
});

/**
 * 第二道(blocklist)。
 *
 * ⚠️ **它擋不住同義詞**,這是它被降為第二道的原因;留著是為了擋
 * 「有人新增了一句沒進核可表的文案」。判別力來自上面的 `toBe` 全等那族。
 */
const RETRY_WORDS = ['重試', '再試一次', '再按一次', '再次送出', '重按', '重新操作', '再送一次'];

describe('🔴 除了 C 之外,每一句都不得出現重試指令', () => {
  const codes: ReverseFailureCode[] = [
    'isolation',
    'actor_invalid',
    'not_reversible',
    'row_count',
    'rejected',
    'forbidden',
    'wrote',
    'denied',
    'invalid',
    'bug',
  ];

  for (const code of codes) {
    it(`${code} 零重試指令`, () => {
      const msg = reverseMessageFor(code);
      for (const w of RETRY_WORDS) {
        expect(msg, `${code} 含禁詞「${w}」`).not.toContain(w);
      }
    });
  }

  it('C(unknown)是唯一的例外,而且它的重試指令是有條件的', () => {
    const msg = reverseMessageFor('unknown');
    // 它含「再沖一次」,但前面掛著「如果它沒有『已沖銷』的標記」這個條件。
    expect(msg).toContain('如果它沒有「已沖銷」的標記');
    expect(msg).toContain('再沖一次');
  });
});

describe('🔴 文案不得含 markdown 記號或 emoji(會原樣進 DOM)', () => {
  const all = [
    REVERSE_CONFIRM_PAYMENT,
    REVERSE_CONFIRM_REVERSAL,
    ...(
      [
        'isolation',
        'actor_invalid',
        'not_reversible',
        'row_count',
        'rejected',
        'forbidden',
        'unknown',
        'wrote',
        'denied',
        'invalid',
        'bug',
      ] as ReverseFailureCode[]
    ).map(reverseMessageFor),
  ];

  it('零 ** 與零 🔴', () => {
    for (const s of all) {
      expect(s).not.toContain('**');
      expect(s).not.toContain('🔴');
    }
  });
});

describe('逐碼映射(碼源=20260812150000:364-480 的 11 個 RAISE + PG 的 42501)', () => {
  it.each([
    ['P8C01', 'isolation'],
    ['P2B42', 'actor_invalid'],
    ['P2B44', 'not_reversible'],
    ['P2B43', 'row_count'],
    ['P0001', 'rejected'],
    ['42501', 'forbidden'],
  ] as const)('%s ⇒ %s', (sqlstate, expected) => {
    expect(reverseFailureCodeFor(sqlstate)).toBe(expected);
  });

  it.each(['08006', '08003', '57P01', '57P02', 'PGRST000', 'PGRST003'])(
    '連線類 %s ⇒ unknown(可能已經 commit,不得講「沒有寫入」)',
    (sqlstate) => {
      expect(reverseFailureCodeFor(sqlstate)).toBe('unknown');
    },
  );

  it('🔴 空字串的碼 ⇒ unknown —— 真實的 client 端網路失敗不是缺鍵、是 code: ""', () => {
    expect(reverseFailureCodeFor('')).toBe('unknown');
  });

  it.each([null, undefined])('沒有碼(%s)⇒ unknown', (sqlstate) => {
    expect(reverseFailureCodeFor(sqlstate)).toBe('unknown');
  });

  it('認不得的碼 ⇒ bug(statement 已中止、整筆回滾)', () => {
    expect(reverseFailureCodeFor('22007')).toBe('bug');
    expect(reverseFailureCodeFor('57014')).toBe('bug');
  });

  it('⚠️ 登錄那支的碼不得誤入本表(照抄隔壁 = 一格永不觸發的假映射)', () => {
    // `P2B39`/`P2B40` 是 admin_record_manual_payment 的碼,本支不噴它們。
    expect(reverseFailureCodeFor('P2B39')).toBe('bug');
    expect(reverseFailureCodeFor('P2B40')).toBe('bug');
  });
});

describe('🔴 wrote 這條路(R3 F4:它不是 SQLSTATE,漏了就會講出這 repo 燒過的謊)', () => {
  it('wrote === true ⇒ wrote,而不是任何「沒有寫入」的句子', () => {
    expect(reverseFailureCodeForThrown({ wrote: true })).toBe('wrote');
    expect(reverseMessageFor('wrote')).toBe(E_WROTE);
    expect(reverseMessageFor('wrote')).toContain('沖銷已經完成了');
    expect(reverseMessageFor('wrote')).not.toContain('沒有沖成');
  });

  it('🔴 wrote 優先於 sqlstate:兩個欄位都有時仍走 wrote', () => {
    // 拿掉 repository 那層的 `wrote` 分支、讓它落到通用 bug ⇒ 這格轉紅。
    expect(reverseFailureCodeForThrown({ wrote: true, sqlstate: 'P2B44' })).toBe('wrote');
  });

  it('有 sqlstate 欄 ⇒ 走逐碼映射', () => {
    expect(reverseFailureCodeForThrown({ sqlstate: 'P2B44' })).toBe('not_reversible');
    expect(reverseFailureCodeForThrown({ sqlstate: null })).toBe('unknown');
  });

  it('沒預期到的例外 ⇒ bug', () => {
    expect(reverseFailureCodeForThrown(new Error('boom'))).toBe('bug');
    expect(reverseFailureCodeForThrown('字串')).toBe('bug');
    expect(reverseFailureCodeForThrown(null)).toBe('bug');
  });
});

describe('reverseFailure 組出來的東西', () => {
  it('碼與訊息一對一', () => {
    const r = reverseFailure('not_reversible');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.code).toBe('not_reversible');
    expect(r.message).toBe(D_NOT_REVERSIBLE);
  });
});

describe('🔴 沖銷 RPC 沒有冪等鍵 —— 這條前提一變,整套「重送安全」的論證就垮了', () => {
  /**
   * 🔴 **釘在「現況」而不是舊 migration 字面**(關卡1 R2 MF2):
   * `20260812150000` 是**不可變的舊檔**,日後誰另下一支 migration 加了 `p_request_id`,
   * 那個檔仍然沒有 ⇒ 讀它會**恆綠**。這裡改讀 `database.types.ts`,它是每次 apply 後重生的。
   *
   * ⚠️ **誠實天花板**(關卡1 R2 MF4):`database.types.ts` 是**手動重生的快照**、不是 catalog。
   * 正式庫改了簽章但那次 apply **漏跑 regen** ⇒ 這格照樣綠。
   * 測試層沒有 DB 連線、構造不出真正的 catalog 查詢 ⇒ 這是真天花板,
   * 對應的機制面在「apply 流程要含 regen」,不在本片。
   */
  it('database.types.ts 的 Args 只有三個參數,沒有 p_request_id', () => {
    const typesPath = path.join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      '..',
      'packages/adapters/src/supabase/database.types.ts',
    );
    const src = readFileSync(typesPath, 'utf8');
    // 只取那支函式自己的區塊,不 grep 全檔(全檔 grep 會把註解與別的函式算進來)。
    const marker = '      admin_reverse_manual_payment: {';
    const start = src.indexOf(marker);
    expect(start, `在 database.types.ts 找不到錨點 ${marker}`).toBeGreaterThan(-1);
    const block = src.slice(start, start + 400);
    expect(block).toContain('p_actor: string');
    expect(block).toContain('p_payment_id: string');
    expect(block).toContain('p_reason: string');
    expect(block).not.toContain('p_request_id');
  });
});
