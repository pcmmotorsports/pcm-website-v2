import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MANUAL_REFUND_CARD_CONFIRM_LABEL } from './manual-refund-action-state';

/**
 * 🔴🔴 **這一格守的是【兩個檔案裡的同一句話】,而它們沒有辦法 import 對方。**
 *
 * DB 的錯誤訊息叫員工去勾某一格,而那一格的字住在畫面上。
 * ⛔ **改之前它們是【不一樣的】**:訊息說「我確認卡上沒退」,畫面寫「我確認卡上那筆沒有退成功」
 *    🔬 實測 `grep -c '我確認卡上沒退' manual-refund-entry-section.tsx` ⇒ **0**
 *    ⇒ 📌 **員工照著錯誤訊息找,找不到那一格。** 而那個壞法**完全安靜** ——
 *      兩邊各自都是一句通順的中文,沒有任何一個工具會紅。
 *
 * 🛑 **所以這一格不是「多測一下」,它是那個一致性【唯一的持有人】。**
 * 🔵 為什麼比對的是 **migration 檔案文字**而不是 DB:施工窗沒有正式庫寫入,
 *    而那支 migration 是這句話進 DB 的入口。
 *
 * 🛑🛑 **而它證不到什麼(codex R1 nit① 打掉我原本那句「守住入口就守住了那句話」)**:
 *   ⛔ ~~守住入口就守住了那句話~~ —— **那是把還沒證明的事寫成已保證。**
 *   codex 用記憶體反例重現:**把新標籤搬進 SQL 註解、讓真正的 `RAISE` 改說別句
 *   ⇒ 這六格【全部還是綠的】**;把確認閘改成 `IF false AND …` 也全綠。
 *   ⇒ 📌 **它守的是「那個字串出現在那支檔案裡」,不是**:
 *     · ① 它出現在**真正的 `RAISE` 裡**(而不是註解)
 *     · ② 那道確認閘**還活著**
 *     · ③ **畫面真的把那個常數渲染出來**(本檔完全沒有讀元件)
 *     · ④ **正式庫現在跑的那一版**含這句話 —— 那是該 migration 貼後對帳②③的事
 *   🔵 而 ①④ 由那支 migration 的**貼後對帳**接住(它比對的是 `prosrc`,不是檔案)。
 *      **②③ 今天沒有人守** ⇒ 寫在這裡,不要讓下一個人以為有。
 */
const MIGRATION = 'supabase/migrations/20260909090000_m4b_cardalreadyrefunded_confirm_label.sql';

describe('⟦b4-CARDALREADYREFUNDED⟧ 勾選格字面:畫面與 DB 訊息必須逐字相同', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('🟢 正對照:那支 migration 讀得到而且不是空的', () => {
    expect(sql.length).toBeGreaterThan(1000);
    expect(sql).toContain('admin_record_manual_refund');
  });

  it('🔴 DB 的錯誤訊息逐字引用畫面上那一格的字', () => {
    // 訊息裡是用「」括起來的 ⇒ 連引號一起比,避免「字有出現但不是在引用它」也算過
    expect(sql).toContain(`把「${MANUAL_REFUND_CARD_CONFIRM_LABEL}」那一格勾起來`);
  });

  it('🔴 舊字面不可以再被【當成標籤引用】', () => {
    // 🛑 **不可以直接斷言「這個檔案不含舊字面」** —— 我第一版那樣寫, 而它紅了,
    //    因為那支 migration 的**檔頭註解**與**前置閘⑤**本來就要提到舊字面
    //    (閘⑤ 要證「我要換的東西真的在那裡」)。
    // ⇒ 📌 **那不是測試錯了, 是我把尺下得太粗** —— 真正不可以再出現的是
    //   【被引號括起來當成一格標籤】的那個形狀, 因為那才是員工照著去找的東西。
    expect(sql).not.toContain('把「我確認卡上沒退」那一格勾起來');
    expect(MANUAL_REFUND_CARD_CONFIRM_LABEL).not.toContain('我確認卡上沒退');
  });

  it('🛑 那句話對混合單的兩半都要講到 —— 只講一半就是舊的那個 bug', () => {
    expect(sql).toContain('卡那半不要在這裡登記');
    expect(sql).toContain('而現金/匯款那半仍然要登記');
  });

  it('🛑 `v_has_card` 那道防並發的述詞一字未動(Sean 拍的是文案不是判準)', () => {
    expect(sql).toContain("WHERE op.order_id = p_order_id AND op.rail = 'card'");
  });

  it('⚪ 負對照:現造一句不存在的話,必須找不到', () => {
    expect(sql).not.toContain('zzq_nope_label_20260909');
  });
});
