import { describe, expect, it } from 'vitest';
import {
  contractFailureMessage,
  type ContractProbe,
} from './contract-message';

/**
 * 🔴 **為什麼這支測試住在這裡, 而被測的檔在 `e2e-prod/`**:
 *   `vitest.config.ts` 的 `SHARED_EXCLUDE` 逐字含 `'**\/e2e-prod\/**'`
 *   (理由寫在那裡:那個目錄是 @playwright/test 的, vitest 拿自己的 runner 跑它 = 假紅)
 *   ⇒ **測試檔放進 `e2e-prod/` 永遠不會被跑。**
 *   而 `exclude` 只決定「哪些檔算測試」, **不影響 import** ⇒ 從這裡 import 進去是可以的。
 *   📌 **⇒ 「我寫了測試」與「它會被跑」是兩個宣稱。**
 */

const base: ContractProbe = {
  cardCount: 100,
  totalOk: true,
  total: 1234,
  cardsRendered: true,
  navTimeoutMs: 45_000,
};

describe('e2e-prod 資料合約:紅的時候說哪一句', () => {
  it('🟢 世界好的 ⇒ 回 null(對照組:證明它不是恆回一句)', () => {
    expect(contractFailureMessage(base)).toBeNull();
  });

  it('🔴 卡片有而【件數沒有】⇒ 指向件數查詢, 而**不得**說「DB 未連通」', () => {
    const msg = contractFailureMessage({ ...base, totalOk: false, total: 0 });
    expect(msg).toContain('商品卡=100');
    expect(msg).toContain('件數');
    expect(msg).toContain('不是 DB 未連通');
    // 🔴 這一條是本片存在的理由:那四發紅拿到的就是下面這句, 而它指錯方向。
    expect(msg).not.toContain('疑似 DB 未連通或冷快取為空');
  });

  it('🔴 件數有而【卡片沒渲染】⇒ 既有那句, 字面不得被我改掉', () => {
    const msg = contractFailureMessage({ ...base, cardsRendered: false, cardCount: 0 });
    expect(msg).toContain('件數=1234(DB 有回應)');
    expect(msg).toContain('疑似 streaming/前端渲染卡住');
  });

  it('🔴 卡片是 0 ⇒ 泛用那句【留著】—— 那才是它真的成立的世界', () => {
    const msg = contractFailureMessage({
      ...base, cardCount: 0, totalOk: false, total: 0, cardsRendered: false,
    });
    expect(msg).toContain('疑似 DB 未連通或冷快取為空');
    expect(msg).toContain('商品卡=0');
  });

  it('🔵 四個世界回四個【互不相同】的東西(少了這一格, 上面四格可能都在讀同一句)', () => {
    const all = [
      contractFailureMessage(base),
      contractFailureMessage({ ...base, totalOk: false, total: 0 }),
      contractFailureMessage({ ...base, cardsRendered: false, cardCount: 0 }),
      contractFailureMessage({ ...base, cardCount: 0, totalOk: false, total: 0, cardsRendered: false }),
    ];
    expect(new Set(all).size).toBe(4);
  });
});
