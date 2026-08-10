// 🔴 `import 'server-only'`(被測模組的第一行)在 vitest 會拋 ⇒ 逐檔 mock 掉。
//    本 repo 既有處置,前例:`lib/payment/composition.test.ts` 等五支、
//    jsdom 前例 `app/orders/[id]/cancel-wiring.test.tsx`。root config 無 setupFiles。
import { vi } from 'vitest';
vi.mock('server-only', () => ({}));

import { describe, expect, it } from 'vitest';
import { generateCancelRequestToken } from './cancel-request-token';
import { isCancelRequestToken } from './cancel-action-state';

// cancel-request-token.test.ts — #363:產生器搬進 server-only 模組後,**它的守門跟著搬過來**。
//
// 🔴🔴 **這三條是 D2b 刀下的倖存者,再搬一次家**(原本住在 `cancel-action-state.test.ts` 那個
//    「token 產生器與形狀驗證(跨形狀活著,D2b 已保留)」describe 裡,該檔頭逐字警告過
//    「混在同一個 describe 裡的話,一刀切下去會把這幾條守門一起帶走,而且沒有任何人會轉紅」)。
//    ⇒ #363 把產生器搬走時,**沒有只改 import 就了事** —— 依賴解耦與**物理搬離**兩件事都做,
//    否則下一個刪 `cancel-action-state` 某個 describe 的人會連鍋端走它們
//    (memory `feedback_decouple-dependency-but-forgot-to-move-out-of-dying-container`)。
//    🔴 **留在原檔的是第四條**(純大小寫驗證、不碰產生器)—— 它測的是驗證器,而驗證器沒搬。
//    對帳:原 describe 四條 = 本檔三條 + 原檔一條,**總數不變**。
describe('#363 cancel-request-token — 產生器(server-only 模組)', () => {
  it('產生器與驗證器同源:產出來的一定過得了驗證(#363 之後這條跨兩個檔)', () => {
    const token = generateCancelRequestToken();
    expect(isCancelRequestToken(token)).toBe(true);
  });

  // 🔴 關卡2 must-fix(原檔逐字保留):把產生器換成回一顆固定合法 uuid,原本所有測試仍全綠 ——
  //    而那正是「同一張單下一次不同 payload 撞既有 token/hash」的形狀。
  it('🔴 產生器每次都不同(換成固定 uuid 要紅)', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateCancelRequestToken()));
    expect(tokens.size).toBe(50);
  });

  it('🔴 `req_<uuid>` 形狀不算 token(前例 Fable F3:重用 generateRequestId 會讓整個功能死掉)', () => {
    expect(isCancelRequestToken(`req_${generateCancelRequestToken()}`)).toBe(false);
  });
});
