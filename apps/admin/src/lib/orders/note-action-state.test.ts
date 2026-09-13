import { describe, expect, it } from 'vitest';
import { noteDeleteFailure, noteFailure } from './note-action-state';

// note-action-state 的**文案守門**(2026-09-13 建)。
//
// 🔴🔴 **為什麼值得一支自己的測試檔**:這裡有一句話曾經**叫員工去做一件會弄壞帳的事**,
//    而它從 2026-08-02 起就在正式後台上,**沒有任何東西會叫**。
//    ⛔ 舊字面逐字:「這筆備註已經被更正過了,一筆只能更正一次;**請改為重新登記一筆新的紀錄**。」
//
//    可重現的壞結局(2026-09-13 codex + Fable 兩輪各自構造,我逐跳開檔核過):
//      ① 員工 X 與 Y 同時開著同一張單;X 先更正了第 2 版 ⇒ 第 3 版寫入。
//      ② Y 在舊分頁按第 2 版的「更正」⇒ RPC 回 `ALREADY_CORRECTED` ⇒ Y 讀到那句話。
//      ③ Y **照做**:登記一筆**沒有 `corrects_note_id` 指標**的新 `customer_notified`。
//      ④ ⇒ 時間軸出現兩個互不指向的現行版 ⇒ `mappers/order-notes.ts` 的
//         `some(customer_notified && !corrected)` 回 **true**
//         ⇒ **U6 告知義務被一個「照系統指示做事」的員工翻回「已告知」。**
//
// 📌 **本意是守【方向】,而要老實說這幾格【守得到的只是字面】**
//    (codex 2026-09-13 nit 1 實際重放過四個定向突變):
//      · 換回舊句                                    ⇒ 會紅 ✅
//      · 只剩「這一版已經被更正過了。」                ⇒ 會紅 ✅
//      · 「請勿更正最新那一版。請另新增一筆已告知客人的紀錄。」⇒ **四格全過** ❌
//      · 把「沒有寫入」改成「已經寫入」                ⇒ **四格全過** ❌
//    ⇒ 🔴 **一組字串錨點擋不住一個【換句話說】的壞方向。** 這幾格是**回歸檢查**,不是語意守門。
//    ⇒ 而它仍然值得留:它擋的是「有人把舊句貼回來」與「有人把指路那半句刪掉」這兩件真的會發生的事。
//    🛑 **潤稿的時候不要只看這裡綠不綠** —— 方向對不對要人讀一次。
//
// 🔵 正確的路今天就走得通(2026-09-13 拋棄式 PG + 真瀏覽器實測):
//    `A ← B ← C` 的更正鏈本來就合法(A3 `20260729030000:158-159` 逐字
//    「要再更正 = 去更正那筆更正」),而**最新那一版有可按的「更正」**。

describe('ALREADY_CORRECTED 的文案 —— 字串回歸檢查(⚠️ 不是語意守門,見檔頭)', () => {
  const message = () => {
    const state = noteFailure('ALREADY_CORRECTED', '員工打的字', 'tok');
    // noteFailure 的回傳是聯集型別;失敗型才有 message。
    return state.status === 'failed' ? state.message : '';
  };

  it('🔴🔴 **不得**再叫員工「重新登記一筆新的紀錄」—— 那條路會把 U6 翻回「已告知」', () => {
    expect(
      message(),
      '照這句話做 = 登記一筆沒有 corrects 指標的新紀錄 ⇒ 兩個互不指向的現行版 ⇒ U6 說謊',
    ).not.toContain('重新登記');
  });

  it('🔴 而且要**指出正確的路**:去更正最新那一版(光是拿掉舊方向還不夠)', () => {
    // 🔵 兩格分開只是為了**紅的時候看得出是哪一半掉了**;
    //    ⛔ ~~我第一版寫「不可以合併,否則判別力會降」~~ —— **那不成立**
    //    (codex nit 1):放進同一個 `it` 判別力一樣。理由改成可讀性,不要把它說成安全性。
    expect(message()).toContain('最新那一版');
  });

  it('🔵 「一筆只能更正一次」那句也拿掉了 —— 字面為真,而讀者會推出「不能再改」這個假結論', () => {
    expect(message()).not.toContain('一筆只能更正一次');
  });

  // ⛔ ~~「否則上面三格是恆綠的」~~ —— **那句話是假的**(codex nit 1):
  //    空字串會被上面那個 `toContain('最新那一版')` 正向錨點擋下。
  //    這一格留著的理由比較小:它讓「訊息表整個回傳空字串」這種壞掉當場看得出來。
  it('🔵 訊息不是空的(讓「整張表壞掉」這種情形當場看得出來)', () => {
    expect(message().length).toBeGreaterThan(10);
  });
});

describe('刪除那組的文案(貼板 138)', () => {
  const message = () => {
    const state = noteDeleteFailure('ALREADY_DELETED', '理由', 'tok');
    return state.status === 'failed' ? state.message : '';
  };

  // 🔵 codex 2026-09-13 nit 1:同一個人開兩個分頁也會走到 `ALREADY_DELETED`,
  //    那時 `deleted_by` 記的就是他自己 ⇒ **不得推定是「別人」做的**。
  it('🔵 不得推定是「別人」刪的(同一個人開兩個分頁也會走到這裡)', () => {
    expect(message()).not.toContain('別人');
  });

  it('🔵 正對照:這把尺讀得到內容', () => {
    expect(message()).toContain('收起');
  });
});
