import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ORDER_LIST_HIDE_PREDICATE, isHiddenFromDefaultOrderList } from './order-hidden-rule';

// `#841`:隱藏規則的真值表 + 一份**資料庫實際回傳**的量測紀錄。
//
// 🔴 **為什麼不做成「兩邊互比」**(`20260816050000` 檔頭逐字):
//    「守門不能做成兩邊互比:兩邊【一起】用錯分母時,互比對同一組輸入會得到同一個錯答案、
//      **一致通過**。」⇒ 真值表是**人寫的第三方**。
//
// ══ 🔴🔴 **而「兩種表述【各自】對它比」那句宣稱,前一版是假的**(codex 第二輪 B1)═══
//
// 前一版的 120 格窮舉**只餵 `isHiddenFromDefaultOrderList()`** —— PostgREST 那個字串
// 從頭到尾**沒有逐列對過 `hidden`**,只被驗了 substring / 頂層三項 / 有沒有 `and(`。
// ⇒ **只有一邊真的在比,而檔頭寫著兩邊都在比。**
//
// 🔴 **而「寫一個 parser 去解析自己的字串」不是解法** —— 那個 parser 是我寫的,
//    它會跟著我對那句字串的理解一起錯 ⇒ 那正是「兩邊互比」換一個載體。
//
// ⇒ 走的是第三條路:**把 2026-08-23 真的打在 PostgREST 上的那一發【結果】記成 fixture**,
//   讓 TS 那一半去對「**資料庫實際回了什麼**」,而不是對「我以為它會回什麼」。
//   見下面 `MEASURED_POSTGREST_RUN`。**那一份是量到的,不是推的。**
//
// ══ 🔴🔴 而「真值表」本身也是人列舉的 —— 所以本檔【先把分母寫出來,再窮舉】═══════
//
// 初版手列 9 列,而**沒有任何東西說得出那 9 列佔多少**(主視窗 2026-08-23 第二輪點名)。
// ⇒ 改成:**把兩個欄位的值域從 migration 取出來,做完整交叉乘積,一格不漏。**
// ```
// payment_status   5 值  'unpaid','paid','partiallyPaid','refunded'
//                        (`20260604120000_m3_s2a_orders_order_items.sql:50`)
//                        + 'partiallyRefunded'(`20260725130000_…:45` ALTER TYPE ADD VALUE)
// payment_channel  4 值  CHECK (payment_channel IN ('tappay','bank_transfer','cash','none'))
//                        (`20260712203000_m4a_orders_admin_columns.sql:50-51`)
// netPaid          3 類  負 / 0 / 正      ← 等價類,不是值域;`amount` 有 CHECK (<> 0),而【淨額】可為 0
// cancelled        2 值
// ⇒ 分母 = 5 × 4 × 3 × 2 = **120**,而下面每一格都會被斷言。
// ```
// ⚠️ **本檔的限度,照實寫**:上面那兩份值域是**抄過來的第三份副本** ——
//    有人 `ALTER TYPE … ADD VALUE` 或改 CHECK 而沒回來改這裡,本檔**不會自己知道**。
//    擋它的是下面那格「分母 = 120」:值域一變,乘積就對不上 ⇒ **紅**。
//    🔴 但那只擋得住「這裡的清單變短/變長」,擋不住「DB 那邊變了而這裡沒變」。**那一格未解。**
//
// ⚠️ **本檔守得到與守不到的,分開講**:
//    · 那句 PostgREST 字串**實際撈回哪幾張單** ⇒ 本檔底部的 `MEASURED_POSTGREST_RUN` 有 6 格,
//      而它是 **2026-08-23 的一次性量測紀錄,不是本檔跑得出來的**(那座環境已收攤)。
//    · 那一發的完整內容(含負向、正對照、亂語法回 400、兩道 `.or()` 疊起來、`Content-Range` 的 count)
//      紀錄在 `supabase/migrations/20260823030000_m4b_841_order_paid_total_view.sql` 檔頭 §4。
//    🔴 **改了述詞要重量一次** —— 而這一次有機制盯著:述詞一變,底部那格綁定會紅。

/** 逐字取自 `20260604120000:50` + `20260725130000:45`。 */
const PAYMENT_STATUSES = ['unpaid', 'paid', 'partiallyPaid', 'refunded', 'partiallyRefunded'] as const;
/** 逐字取自 `20260712203000:50-51` 的 CHECK。 */
const PAYMENT_CHANNELS = ['tappay', 'bank_transfer', 'cash', 'none'] as const;
/** 淨額的**等價類**(不是值域):沖銷可讓淨額為 0 或負。 */
const NET_PAID_CLASSES = [-100, 0, 1500] as const;
const CANCELLED = [false, true] as const;

type Row = {
  paymentChannel: string;
  paymentStatus: string;
  netPaid: number;
  cancelled: boolean;
};

const ALL: readonly Row[] = PAYMENT_CHANNELS.flatMap((paymentChannel) =>
  PAYMENT_STATUSES.flatMap((paymentStatus) =>
    NET_PAID_CLASSES.flatMap((netPaid) =>
      CANCELLED.map((cancelled) => ({ paymentChannel, paymentStatus, netPaid, cancelled })),
    ),
  ),
);

/**
 * 🔴 **只有這 6 種組合可能被藏** —— `tappay` × `unpaid` 那一片,逐格人寫期望值,**一格不漏**。
 *
 * 鍵 = `${netPaid}|${cancelled}`。6 = 3 個淨額等價類 × 2 個取消狀態。
 */
const TAPPAY_UNPAID_EXPECTED: Readonly<Record<string, { hidden: boolean; why: string }>> = {
  '0|false': { hidden: true, why: '帳本零收款 ⇒ 藏。Sean 要的行為,治本前後一致' },
  '0|true': { hidden: true, why: '零收款 + 已取消 ⇒ 藏' },
  '1500|false': { hidden: false, why: '🔴 `#841` 本體:收到匯款 ⇒ 放出來' },
  '1500|true': { hidden: true, why: '🔴 有錢但已取消 ⇒ 仍然藏(復活條件兩項都要成立)' },
  '-100|false': { hidden: false, why: '淨額為負(退超過收的,資料異常)⇒ 不是 0 ⇒ 放出來讓人看到' },
  '-100|true': { hidden: true, why: '淨額為負 + 已取消 ⇒ 藏' },
};

describe('#841 隱藏規則:分母', () => {
  it('🔴 交叉乘積 = 5 × 4 × 3 × 2 = 120(值域變了這格就紅 ⇒ 逼人回來重列)', () => {
    expect(ALL.length).toBe(120);
  });

  it('🔴 前提:兩面都有(全 true 或全 false 的表,下面每一格都恆真)', () => {
    const hidden = ALL.filter((r) => isHiddenFromDefaultOrderList(r));
    expect(hidden.length, '沒有任何一格被藏 ⇒ 本檔沒有判別力').toBeGreaterThan(0);
    expect(hidden.length, '每一格都被藏 ⇒ 本檔沒有判別力').toBeLessThan(ALL.length);
  });

  it('🔴 `tappay` × `unpaid` 那一片恰好 6 格(下面逐格期望值的分母)', () => {
    expect(ALL.filter((r) => r.paymentChannel === 'tappay' && r.paymentStatus === 'unpaid').length).toBe(6);
    expect(Object.keys(TAPPAY_UNPAID_EXPECTED).length).toBe(6);
  });
});

describe('#841 隱藏規則:120 格逐一斷言', () => {
  // ── 片外 114 格:一格都不准被藏 ──────────────────────────────────────────────
  // 🔴 理由不是「規則這樣寫」,是 **Sean 要藏的是「刷卡未付款」那批**
  //    (`packages/domain/src/order/types.ts` 的 `includeUnpaidCardOrders` docstring)。
  //    ⇒ 任何一格落在這片之外卻被藏 = **藏到了他沒要藏的單**,那是靜默漏單。
  const outside = ALL.filter((r) => !(r.paymentChannel === 'tappay' && r.paymentStatus === 'unpaid'));

  it(`片外 ${outside.length} 格(114)一格都不准被藏`, () => {
    expect(outside.length).toBe(114);
    const wrong = outside.filter((r) => isHiddenFromDefaultOrderList(r));
    expect(
      wrong.map((r) => `${r.paymentChannel}/${r.paymentStatus}/net=${r.netPaid}/cancelled=${r.cancelled}`),
      '這些格不是「刷卡未付款」,卻被藏起來了 ⇒ 藏到 Sean 沒要藏的單',
    ).toEqual([]);
  });

  // ── 片內 6 格:逐格人寫期望值 ────────────────────────────────────────────────
  for (const [key, { hidden, why }] of Object.entries(TAPPAY_UNPAID_EXPECTED)) {
    const [netPaidRaw, cancelledRaw] = key.split('|');
    const row: Row = {
      paymentChannel: 'tappay',
      paymentStatus: 'unpaid',
      netPaid: Number(netPaidRaw),
      cancelled: cancelledRaw === 'true',
    };
    it(`tappay/unpaid net=${row.netPaid} cancelled=${row.cancelled} ⇒ ${hidden ? '藏' : '不藏'} — ${why}`, () => {
      expect(isHiddenFromDefaultOrderList(row)).toBe(hidden);
    });
  }
});

describe('#841 PostgREST 述詞的逐項形狀', () => {
  // 🔴 `or()` 寫的是【顯示】面 ⇒ 每一項都是隱藏條件的**否定**。
  //    逐項釘住,而不是整串 byte-equal:整串比對在「換了等價寫法」時會誤紅,
  //    而逐項比對說得出**是哪一項不見了**。
  const TERMS = [
    { term: 'payment_channel.neq.tappay', why: '否定「channel = tappay」' },
    { term: 'payment_status.neq.unpaid', why: '否定「status = unpaid」' },
    {
      term: 'and(paid_total.neq.0,cancelled_at.is.null)',
      why: '🔴 復活條件:有錢【而且】未取消 —— 兩項必須在同一個 and() 裡',
    },
  ] as const;

  it('🔴 前提:述詞不是空字串(空字串會讓下面每一格的 includes 恆假 —— 這格讓原因看得見)', () => {
    expect(ORDER_LIST_HIDE_PREDICATE.length).toBeGreaterThan(0);
  });

  for (const t of TERMS) {
    it(`含 \`${t.term}\` —— ${t.why}`, () => {
      expect(ORDER_LIST_HIDE_PREDICATE.includes(t.term)).toBe(true);
    });
  }

  it('🔴 恰好三項(頂層以逗號分隔,而 and(...) 裡面的逗號不算)', () => {
    let depth = 0;
    let top = 1;
    for (const ch of ORDER_LIST_HIDE_PREDICATE) {
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      else if (ch === ',' && depth === 0) top += 1;
    }
    expect(
      top,
      '頂層項數變了。多一項 = 多放行一種單;少一項 = 多藏一種單。兩個方向都要回頭核真值表。',
    ).toBe(3);
  });

  it('🔴 第三項【不得】被拆成平鋪 —— 拆了會讓已取消的單跑出來(2026-08-23 PostgREST 實測)', () => {
    expect(
      ORDER_LIST_HIDE_PREDICATE.includes('and('),
      '述詞裡沒有 and(…) ⇒ 復活條件被拆成平鋪 ⇒ 已取消單會出現在預設列表',
    ).toBe(true);
  });
});

// ══ 🔴 2026-08-23 拋棄式 PG 17.10 + PostgREST 14.16 的【實際回傳】═══════════════
//
// 六張測試單餵進去,那句述詞當 `or=` 打過去,**PostgREST 真的回了哪幾張**:
// ```
// or=(payment_channel.neq.tappay,payment_status.neq.unpaid,and(paid_total.neq.0,cancelled_at.is.null))
//   ⇒ 回 1, 3, 6        （2, 4, 5 沒回來 = 被藏)
// 同一組資料的對照:
//   現行(舊)述詞      ⇒ 回 1, 6
//   三項平鋪(不含 and) ⇒ 回 1, 3, 5, 6     ← 5 是已取消單,那就是拆掉 and() 的後果
// ```
// 🔴🔴 **這份 fixture【不可重跑】** —— 那座環境已經收攤。它是一次性量測的**紀錄**。
//    ⇒ 下面兩道綁定會在【兩種特定漂移】下讓它自己喊過期(詳見那兩格上方的說明),
//      而**不是任何漂移都叫得出來**。
// ⚠️ **它守不到的**:六張單不是 120 格的樣本,它只覆蓋 6 個組合。
//    它的價值不在覆蓋率,在**它記的是「資料庫真的怎麼回」,不是「我以為它會怎麼回」**。

/** 當時被實際量測的那兩個算式(逐字取自 `20260823030000_…:180` 與 `:279-283`)。 */
const MEASURED_INNER_SUM = 'COALESCE(SUM(p.amount), 0) AS paid_total';
const MEASURED_OUTER_COALESCE = `COALESCE((
    SELECT t.paid_total
      FROM public.order_paid_totals_v t
     WHERE t.order_id = o.id
  ), 0) AS paid_total`;

/** 當時被實際量測的那一串(逐字)。fixture 與它綁定。 */
const MEASURED_PREDICATE =
  'payment_channel.neq.tappay,payment_status.neq.unpaid,and(paid_total.neq.0,cancelled_at.is.null)';

const MEASURED_POSTGREST_RUN: ReadonlyArray<Row & { label: string; returnedByPostgrest: boolean }> = [
  { label: '1 刷卡已付款', paymentChannel: 'tappay', paymentStatus: 'paid', netPaid: 0, cancelled: false, returnedByPostgrest: true },
  { label: '2 刷卡未付+零收款', paymentChannel: 'tappay', paymentStatus: 'unpaid', netPaid: 0, cancelled: false, returnedByPostgrest: false },
  { label: '3 刷卡未付+收 1500', paymentChannel: 'tappay', paymentStatus: 'unpaid', netPaid: 1500, cancelled: false, returnedByPostgrest: true },
  { label: '4 刷卡未付+一收一沖', paymentChannel: 'tappay', paymentStatus: 'unpaid', netPaid: 0, cancelled: false, returnedByPostgrest: false },
  { label: '5 刷卡未付+有錢但已取消', paymentChannel: 'tappay', paymentStatus: 'unpaid', netPaid: 1500, cancelled: true, returnedByPostgrest: false },
  { label: '6 現金未付+零收款', paymentChannel: 'cash', paymentStatus: 'unpaid', netPaid: 0, cancelled: false, returnedByPostgrest: true },
];

describe('#841 SQL 那一半:TS 判定 vs 資料庫【實際回傳】', () => {
  it('綁定①:述詞漂移(**只擋這一種**)', () => {
    expect(
      ORDER_LIST_HIDE_PREDICATE,
      '述詞變了,而下面那六格是舊述詞的量測結果 ⇒ 它們不再證明任何事。回拋棄式 PG 重打一次。',
    ).toBe(MEASURED_PREDICATE);
  });

  // 🔴🔴 **綁定②:述詞【沒變】而 fixture 已不成立的那條路**(主視窗 2026-08-23 最後一輪 A 項)。
  //
  // 綁定① 只擋得住「述詞被改」。而同一句述詞餵給**不同的 `paid_total`** 會回不同的單:
  // 例如有人把窄 view 的加總改成「只算非沖銷列」⇒ 第 4 張(一收一沖、淨額 0)的 `paid_total`
  // 從 0 變成 340 ⇒ **PostgREST 會回它** ⇒ fixture 說「沒回」就成了假的,而述詞一個字都沒動。
  // ⇒ 所以把 fixture 也綁到**當時被量的那兩個算式**上(從 migration 檔實讀,不憑記憶)。
  //
  // ══ 🔴🔴 **這兩道綁定擋得住什麼 —— 上一版我寫太滿了,這是更正版**(codex 第三輪 A)══
  //
  // 我上一版寫「改述詞 ⇒ 紅 ⇒ **逼人重量一次**」。**那句話講得比它做得到的多。**
  // codex 構造出一個它擋不住的:
  // ```
  // 述詞【一個字都沒動】,而窄 view 改成「只加非沖銷列」
  //   ⇒ 第 4 單(一收一沖)的 paid_total 從 0 變成非零 ⇒ PostgREST 會回它
  //   ⇒ 而 fixture 仍寫「沒回」⇒ **綁定① 完全不紅**
  // ```
  // (綁定② 是為了接這一種而後加的 —— 而它也只接得住「算式的**字面**變了」那一半。)
  //
  // ⇒ **量得到的說法**:
  // ```
  // ✅ 擋得住:述詞字面漂移(綁定①)、那兩個 paid_total 算式的字面漂移(綁定②)
  // ❌ 擋不住:PostgREST 版本改變巢狀 and() 的語意
  //           `cancelled_at` / `payment_status` 的欄位語意改變
  //           換一種等價寫法達成同樣的算式改動(綁定② 是字面比對)
  //           那六張測試單的形狀是我造的,不是從正式資料抽樣
  // ```
  // ⇒ **它不是一道持續守門,是一份【會在兩種特定漂移下自己喊過期】的一次性證據。**
  //   ⚠️ 不要再把它寫成「逼人重量一次」——**它只在那兩種漂移發生時才叫得出來。**
  it('🔴 綁定②:兩個 paid_total 算式若變了,fixture 也過期(述詞沒變也一樣)', () => {
    const migration = readFileSync(
      join(__dirname, '../../../../supabase/migrations/20260823030000_m4b_841_order_paid_total_view.sql'),
      'utf8',
    );
    // 正向對照:讀不到檔或抓不到錨點時,下面兩格會恆假而不是恆真 —— 這格讓原因看得見。
    expect(migration.length, '讀不到那支 migration ⇒ 下面兩格沒有判別力').toBeGreaterThan(0);
    expect(
      migration.includes(MEASURED_INNER_SUM),
      '窄 view 的加總算式變了 ⇒ 同一句述詞會回不同的單 ⇒ 六格 fixture 過期,回去重量',
    ).toBe(true);
    expect(
      migration.includes(MEASURED_OUTER_COALESCE),
      '外層 paid_total 的算式變了 ⇒ 同上',
    ).toBe(true);
  });

  it('🔴 前提:那一發量測兩面都有(全回或全不回 ⇒ 下面每一格恆真)', () => {
    expect(MEASURED_POSTGREST_RUN.some((r) => r.returnedByPostgrest)).toBe(true);
    expect(MEASURED_POSTGREST_RUN.some((r) => !r.returnedByPostgrest)).toBe(true);
  });

  for (const r of MEASURED_POSTGREST_RUN) {
    it(`${r.label}:PostgREST ${r.returnedByPostgrest ? '回了' : '沒回'} ⇒ TS 必須判「${r.returnedByPostgrest ? '不藏' : '藏'}」`, () => {
      expect(isHiddenFromDefaultOrderList(r)).toBe(!r.returnedByPostgrest);
    });
  }
});
