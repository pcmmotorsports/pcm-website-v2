import { afterEach, describe, expect, it, vi } from 'vitest';

// keyword-search-action.test.ts — `#525`:搜尋 action 的 cookie 語意守門。
//
// 🔴🔴 **這支檔存在的理由是一個真的、而且【已經上線】的 bug**(codex 對抗審查 2026-08-16):
//    cookie 用 `path: '/customers'` **設**、卻用 `delete(name)` **刪** ——
//    而 `delete(name)` 在 Next 展開成 `set({ name, value: '', expires: new Date(0) })`
//    (`next/dist/compiled/@edge-runtime/cookies/index.js:302-305`)⇒ **不帶 `Path` 屬性**
//    ⇒ 瀏覽器算出的 default-path 是 `/`,與 `/customers` 不同 ⇒ **原 cookie 活著、清不掉。**
//
// 🔴 **當時全套 8159 個測試綠** —— 因為這一層**一格測試都沒有**。
//    plan §驗收 寫著「cookie 三道閘」,而**沒有任何東西在驗那句話**
//    (house:**寫下來 ≠ 處理掉**)。
//
// 🔴 **2026-08-16 更新上一版寫在這裡的自陳缺口 —— 它已經過期了**:
//    上一版寫「真正的證明要一顆真瀏覽器…**未驗,不宣稱**」。
//    ✅ **那個 bug 當天已在【正式站真瀏覽器】實證**(主視窗量測),而且**比推的嚴重一級**:
//    按「清除搜尋」⇒ **chip 消失、列表回到全部 = 畫面【看起來成功了】**,
//    唯一異常訊號是搜尋框裡還留著舊詞;**完全重新載入 ⇒ 全部回來,cookie 從沒被刪掉。**
//    🔴 **「假裝成功」比「沒反應」難察覺得多** —— 沒反應會讓人再按一次,**假裝成功會讓人走開**,
//    下次回到該頁又被篩著,而他會以為**單子不見了**。(backlog `#535` 全文)
//
// ⚠️ **仍然守不到的(範圍已收窄,照實寫)**:
//    · **上面實證的是【bug 存在】,不是【修法有效】** —— **修法只在本機驗過,上線後要回頭再確認一次。**
//      🔴 這兩件事在報告上長得一樣,不要混。
//    · 本檔只驗「我們送出的 cookie options 一致」,不驗瀏覽器如何處理那個 Set-Cookie。
//    · 不驗 `redirect()` 的目的地在瀏覽器端真的被跟隨。

const hoisted = vi.hoisted(() => ({
  set: vi.fn(),
  del: vi.fn(),
  authorize: vi.fn(async () => ({ actor: 'someone' })),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ set: hoisted.set, delete: hoisted.del, get: vi.fn() }),
}));
// `redirect()` 正常流程就是**擲例外**(Next 用它中斷 render)⇒ 測試端要接住,
// 否則每一格都會因為「action 擲錯」而紅,而那個紅與真缺陷長得一樣。
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { to });
  },
}));
vi.mock('../session/authorize', () => ({ authorizeAdminMutation: hoisted.authorize }));
vi.mock('server-only', () => ({}));

import { applyCustomerKeywordSearchAction } from './keyword-search-action';
import {
  CUSTOMER_KEYWORD_COOKIE,
  CUSTOMER_KEYWORD_FIELD,
  CUSTOMER_KEYWORD_RETURN_TO_FIELD,
} from './customer-keyword-cookie';

afterEach(() => vi.clearAllMocks());

/** 跑 action 並吞掉 `redirect()` 的例外;回傳它想導去哪。 */
async function run(fields: Record<string, string>): Promise<string> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  try {
    await applyCustomerKeywordSearchAction(fd);
  } catch (e) {
    return (e as { to?: string }).to ?? '(無 to)';
  }
  throw new Error('action 沒有 redirect —— PRG 斷了(F5 會重送整個 POST)');
}

describe('#525 搜尋 action 的 cookie 語意', () => {
  it('🔴🔴 清除搜尋:`delete` 帶的 path 必須與 `set` 的【逐字相同】,否則清不掉', async () => {
    // 先設一次,把 set 用的 path 記下來 —— **不寫死字面**:
    // 寫死的話,哪天 set 改了 path 而 delete 沒改,這格照樣綠(兩邊各自對著一個常數點頭)。
    await run({ [CUSTOMER_KEYWORD_FIELD]: '王小明' });
    const setPath = hoisted.set.mock.calls[0]?.[2]?.path;
    expect(setPath, 'set 沒帶 path ⇒ 本格失去比對基準,先修 set').toBeDefined();

    hoisted.set.mockClear();
    await run({ [CUSTOMER_KEYWORD_FIELD]: '' });

    expect(hoisted.del).toHaveBeenCalledTimes(1);
    // 🔴 只接受物件形式:`delete('name')` 這種呼叫**不帶 path** = 正是那個 bug。
    expect(hoisted.del.mock.calls[0]?.[0]).toEqual({
      name: CUSTOMER_KEYWORD_COOKIE,
      path: setPath,
    });
  });

  it('🔴 `invalid`(超長)也走刪除出口,而且【一樣要帶 path】—— 否則 fail-closed 沒有 closed', async () => {
    // 舊 cookie 若活下來,畫面顯示的搜尋詞與實際查詢的**不是同一個**。
    await run({ [CUSTOMER_KEYWORD_FIELD]: 'a'.repeat(500) });
    expect(hoisted.set).not.toHaveBeenCalled();
    expect(hoisted.del.mock.calls[0]?.[0]).toMatchObject({ path: '/customers' });
  });

  it('🔴 搜尋詞【不進 URL】:redirect 目的地不得含搜尋詞(PII 紅線)', async () => {
    const to = await run({ [CUSTOMER_KEYWORD_FIELD]: '0912345678' });
    expect(to).not.toContain('0912345678');
  });

  it('🔴🔴 `return_to` 夾帶 PII ⇒ 一律退回 `/customers`(白名單,不是只驗前綴)', async () => {
    // 這是整個 cookie+PRG 設計唯一要防的事:搜尋詞**不得**出現在 `Location` header。
    const to = await run({
      [CUSTOMER_KEYWORD_FIELD]: '陳',
      [CUSTOMER_KEYWORD_RETURN_TO_FIELD]: '/customers?q=%E7%8E%8B%E5%B0%8F%E6%98%8E&tier=store',
    });
    expect(to).toBe('/customers');
  });

  it('已知鍵名(tier/page)照舊放行 —— 否則上一格會因為「什麼都退回」而恆真', async () => {
    // 🔴 沒有這一格,把 `safeListReturnTo` 改成 `return '/customers'` 也照樣全綠,
    //    而那會讓「搜尋一次就把會員等級篩選洗掉」。
    const to = await run({
      [CUSTOMER_KEYWORD_FIELD]: '陳',
      [CUSTOMER_KEYWORD_RETURN_TO_FIELD]: '/customers?tier=store&page=3',
    });
    expect(to).toBe('/customers?tier=store&page=3');
  });

  it('🔴 cookie 是 httpOnly + session(不給 max-age)—— 搜尋詞不留在硬碟', async () => {
    await run({ [CUSTOMER_KEYWORD_FIELD]: '陳' });
    const opts = hoisted.set.mock.calls[0]?.[2] ?? {};
    expect(opts.httpOnly).toBe(true);
    expect(opts).not.toHaveProperty('maxAge');
  });

  it('未授權 ⇒ 什麼 cookie 都不寫(縱深防禦,不靠 proxy 登入閘)', async () => {
    hoisted.authorize.mockResolvedValueOnce(null as never);
    await run({ [CUSTOMER_KEYWORD_FIELD]: '王' });
    expect(hoisted.set).not.toHaveBeenCalled();
    expect(hoisted.del).not.toHaveBeenCalled();
  });
});
