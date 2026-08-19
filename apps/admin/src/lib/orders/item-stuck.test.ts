import { describe, expect, it } from 'vitest';
import type { AdminOrderItemProcurement, AdminProcurementReplyStatus } from '@pcm/domain';
import { describeItemStuck, resolveItemStuck, type ItemStuckVerdict } from './item-stuck';

// item-stuck.test.ts — 片6(丙)的守門。
//
// 🔴 **本檔守的核心是【不對稱】**:截斷吃掉的是「否定」的效力,不是「肯定」的。
//    把四格塌成 `procurements.some(...)` 一行,**三格照樣綠**,只有「可能被截斷而沒看到」
//    那一格會從 `unknown` 變成 `not-stuck` —— 而那是一句**沒有證據的否定**,
//    症狀是卡住的那一項不會自己打開,**而畫面完全正常**。
//    ⇒ 下面每一格都標了它擋的是哪一種塌法。

/**
 * 🔴 **完整 base + `Partial` override,不用 `as unknown as` 繞型別(R1 nit J)。**
 *    第一版少給了 `voidedAt` 等欄位、靠 `as unknown as` 通過 —— 而那正好**關掉了會讓
 *    `voidedAt` 出現在我眼前的那道保護**,於是「作廢列會讓品項永遠卡住」那個 bug
 *    在 12 格全綠之下活了下來(R1 must-fix 3)。
 *    📎 同族實錘就在隔壁:`procurement-view.ts:125-126` 逐字記著
 *    「或**手寫 fixture 繞過型別**」是 `voidedAt` 變 `undefined` 的來源之一。
 */
const BASE: AdminOrderItemProcurement = Object.freeze({
  id: 'proc-1',
  supplierId: 'sup-1',
  supplierLabel: '鴻鎧國際',
  supplierIsActive: true,
  allocatedQuantity: 1,
  receivedQuantity: 0,
  replyStatus: 'confirmed',
  contactChannel: null,
  submittedAt: null,
  supplierOrderNo: null,
  exceptionReason: null,
  voidedAt: null,
  voidReason: null,
  expectedArrivalDate: null,
  firstOrderedAt: null,
  statusChangedAt: null,
  createdAt: '2026-08-01T00:00:00+08:00',
});

const row = (
  replyStatus: AdminProcurementReplyStatus,
  over: Partial<AdminOrderItemProcurement> = {},
): AdminOrderItemProcurement => ({ ...BASE, replyStatus, ...over });

describe('resolveItemStuck —— 四個世界各自不同的答案', () => {
  it('看到一筆缺貨 ⇒ stuck', () => {
    expect(resolveItemStuck([row('out_of_stock')], false)).toEqual({
      kind: 'stuck',
      reason: 'out_of_stock',
    });
  });

  it('🔴🔴 缺貨 + 清單可能被截斷 ⇒ **仍然** stuck(正面發現不受截斷影響)', () => {
    // 擋的塌法:「truncated 就一律 unknown」——那會把一個【已經看到的事實】丟掉。
    expect(resolveItemStuck([row('out_of_stock')], true)).toEqual({
      kind: 'stuck',
      reason: 'out_of_stock',
    });
  });

  it('沒看到缺貨 + 清單完整 ⇒ not-stuck(這才是一個真正的否定)', () => {
    expect(resolveItemStuck([row('confirmed'), row('partial')], false)).toEqual({
      kind: 'not-stuck',
    });
  });

  it('🔴🔴 沒看到缺貨 + 清單**可能被截斷** ⇒ unknown,不是 not-stuck', () => {
    // 擋的塌法:`procurements.some(...)` 一行 —— 那會讓這一格變成 not-stuck。
    // 沒看到的那幾筆裡可能就有缺貨,而我們沒有證據說沒有。
    expect(resolveItemStuck([row('confirmed')], true)).toEqual({
      kind: 'unknown',
      why: 'possibly-incomplete',
    });
  });

  it('🔴🔴 清單整個沒回來(null)⇒ unknown/unreadable,**不是**「沒有採購」', () => {
    // 擋的塌法:`(procurements ?? []).some(...)` —— 那會把「讀不到」變成「沒卡住」。
    expect(resolveItemStuck(null, false)).toEqual({ kind: 'unknown', why: 'unreadable' });
    expect(resolveItemStuck(null, true)).toEqual({ kind: 'unknown', why: 'unreadable' });
  });

  it('✅ 空陣列 ⇒ not-stuck —— 「沒有採購」與「讀不到」必須分得開', () => {
    // 正向對照:空陣列是一個【真的答案】(這個品項還沒跟任何供應商訂),
    // 而它與 `null`(讀不到)在上一格拿到不同結果 ⇒ 兩個世界沒有被塌成一個。
    expect(resolveItemStuck([], false)).toEqual({ kind: 'not-stuck' });
  });

  it('🔴 起手值只認 out_of_stock —— 其餘四個狀態都不算卡住', () => {
    // 這一格同時是**擴充的守門**:有人往 STUCK_REPLY_STATUSES 加值,這裡就會紅,
    // 而擴充是線主的決定(見受測檔檔頭)⇒ 紅了要去問,不是把這格改掉。
    for (const s of ['no_reply', 'confirmed', 'price_changed', 'partial'] as const) {
      expect(resolveItemStuck([row(s)], false)).toEqual({ kind: 'not-stuck' });
    }
  });

  it('🔴🔴 **已作廢**的缺貨列不算卡住 —— 否則那張卡永遠自己展開,而貨早就到了', () => {
    // 失敗情境(日常流程,R1 must-fix 3):
    //   供應商 A 回缺貨 → 員工作廢該列、改向 B 重下 → B 已確認且貨到。
    //   A 那列仍在 `procurements` 裡(voidedAt 非 null)⇒ 不過濾就永遠 stuck。
    // 依據:types.ts:773 逐字「任何 find/some/length 只要不帶 voidedAt === null 就可能命中作廢那列」。
    // 🔴 `voidedAt` 與 `voidReason` **同進同出**(`types.ts:783-784`:DB 由
    //    `order_item_procurement_void_pair` 雙向配對)⇒ 只給一個是 DB 構造不出來的狀態。
    //    本函式只讀 `voidedAt`,但 fixture 一旦被複製走就會帶著那個不可能狀態跑。(R3 nit M)
    const voided = row('out_of_stock', {
      voidedAt: '2026-08-10T00:00:00+08:00',
      voidReason: '改向其他供應商下單',
    });
    expect(resolveItemStuck([voided], false)).toEqual({ kind: 'not-stuck' });
    // 正向對照:同一列沒被作廢 ⇒ 就是卡住(證明上一行不是把整條路關掉)
    expect(resolveItemStuck([row('out_of_stock')], false)).toEqual({
      kind: 'stuck',
      reason: 'out_of_stock',
    });
  });

  it('🔴 作廢的缺貨 + 生效的已確認 ⇒ not-stuck(重下單之後的正常世界)', () => {
    expect(
      resolveItemStuck(
        [
          row('out_of_stock', {
            supplierId: 'sup-A',
            voidedAt: '2026-08-10T00:00:00+08:00',
            voidReason: '改向其他供應商下單',
          }),
          row('confirmed', { supplierId: 'sup-B' }),
        ],
        false,
      ),
    ).toEqual({ kind: 'not-stuck' });
  });

  it('🔴 `voidedAt` 為 `undefined`(缺欄)⇒ 當成生效列,不得整批判成作廢', () => {
    // `== null` 而不是 `=== null`:`=== null` 會把缺欄的每一列都判成作廢
    // ⇒ 這裡會退化成「永遠不卡住」= 靜默關掉整個功能(procurement-view.ts:124-133 的慣例)。
    // 兩個一起缺 —— 同進同出,且與先例 `item-procurement-section.test.tsx:551` 一致。
    const missing = {
      ...row('out_of_stock'),
      voidedAt: undefined,
      voidReason: undefined,
    } as unknown as AdminOrderItemProcurement;
    expect(resolveItemStuck([missing], false)).toEqual({ kind: 'stuck', reason: 'out_of_stock' });
  });

  it('多筆之中只要有一筆缺貨就算卡住(不是全部都要缺貨)', () => {
    expect(resolveItemStuck([row('confirmed'), row('out_of_stock'), row('partial')], false)).toEqual(
      { kind: 'stuck', reason: 'out_of_stock' },
    );
  });
});

describe('describeItemStuck —— unknown 一定要出聲', () => {
  it('🔴 兩種 unknown 各有各的話,而且**都不是空的**', () => {
    const unreadable = describeItemStuck({ kind: 'unknown', why: 'unreadable' });
    const incomplete = describeItemStuck({ kind: 'unknown', why: 'possibly-incomplete' });
    expect(unreadable).toBeTruthy();
    expect(incomplete).toBeTruthy();
    // 🔴 兩句必須不同 —— 相同的話等於又把兩個世界塌回一個。
    expect(unreadable).not.toBe(incomplete);
  });

  it('🔴🔴 【截斷】那一種不得提重整 —— 兩種表面形式都要擋', () => {
    // `types.ts:840` 逐字:「這個世界重整不會好,文案不得叫員工**重整**」。
    //
    // 🔴🔴 **而只擋「重整」兩個字是不夠的,這是 R3 must-fix 5** ——
    //    決定性實驗(可重跑):
    //      '請重新整理'.includes('重整')  ⇒ **false**   (重|新|整|理,'重整' 不是連續子字串)
    //      '請重整'    .includes('重整')  ⇒ true
    //    ⇒ 有人把文案寫成「請**重新整理**」⇒ 違反 types.ts:840,而這一格**照樣綠**。
    // 🔴 **而那不是假想**:`types.ts:847`(**同一個 doc block、7 行之下**)逐字寫著
    //    「畫面要說『讀取不完整、**請重新整理**』」⇒ **repo 自己的文件裡就躺著那句會擊穿守門的話**,
    //    下一個人照它抄是最可能的路徑。
    //
    // ⚠️ **這一行到今天是第三次被改**(禁「重新整理」→ 禁「重整」→ 兩個都禁)。
    //    前兩次各修對了一半:nit I 修對了「逐字引用權威的用詞」,
    //    而順手把「守門要蓋住的表面形式」收窄了。
    //    ⇒ 📌 **「逐字引用權威」與「擋住危害的實際寫法」是兩件事,不要用一個字串同時做。**
    for (const surface of ['重整', '重新整理'] as const) {
      expect(describeItemStuck({ kind: 'unknown', why: 'possibly-incomplete' })).not.toContain(
        surface,
      );
    }
  });

  it('🔴🔴 而【讀不到】那一種【必須】給條件句 —— 兩種的要求方向相反', () => {
    // ⚠️ 我第一版把兩種都禁「重新整理」,而 `types.ts:826-830` 對 `procurements === null`
    //    要求的**恰好相反**:成因有兩種、分不出是哪一種 ⇒「標未確認,兩種都當可能
    //    ⇒ 顯示端一律用條件句,不得往任一邊斷言」,`:834` 並要求話裡要有「重新整理」。
    //    ⇒ 🔴 **那一格會【擋住把它修對】** —— 一個把錯誤釘住的守門,比沒有守門更貴。
    const text = describeItemStuck({ kind: 'unknown', why: 'unreadable' });
    expect(text).toContain('重新整理'); // 這一種真的可能會好
    expect(text).toContain('如果還是這樣'); // 而它是條件句,不是斷言
  });

  it('stuck 有字;not-stuck 是唯一可以沉默的那一格', () => {
    expect(describeItemStuck({ kind: 'stuck', reason: 'out_of_stock' })).toBeTruthy();
    expect(describeItemStuck({ kind: 'not-stuck' })).toBeNull();
  });

  it('🔴 負向對照:四種判決只有一種回 null —— 沉默不得外溢', () => {
    const all: ItemStuckVerdict[] = [
      { kind: 'stuck', reason: 'out_of_stock' },
      { kind: 'not-stuck' },
      { kind: 'unknown', why: 'unreadable' },
      { kind: 'unknown', why: 'possibly-incomplete' },
    ];
    expect(all.filter((v) => describeItemStuck(v) === null)).toHaveLength(1);
  });
});
