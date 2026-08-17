import { describe, expect, it } from 'vitest';
// 🔴 matcher 是 proxy(登入閘)的【覆蓋邊界】:被 matcher 排除的路徑,proxy 根本不會跑
//    ⇒ 在排除清單裡多塞一段(例如 |api)= 那批路徑的登入驗證整個靜默消失,零紅燈。
//    本檔把 matcher 字面與排除清單綁死,任何改動都必須先過這裡、被迫想清楚。
//
// ⚠️ 量具邊界(誠實缺口,不擴大宣稱):Next 的 middleware matcher 語意非裸 JS regex
//    (框架自有解析,細節不在此宣稱)—— 本檔【不】模擬 Next 的路徑比對(自己端一份語意近似品=會漂的量具,
//    V-036 那型病)。「這條 pattern 在 Next runtime 下實際放行/攔截哪些路徑」本檔這層
//    不驗 —— 可由 build manifest 檢查/整合測試/E2E 覆核(codex nit:別寫成只有 E2E
//    驗得到);本檔守的是【字面與清單結構】這一層。
// ⚠️ 格2 對 code 無獨立判別力(reviewer Minor 1:格1 精確相等蘊含格2)——它守的是
//    【格1 期待值被人盲更新】那條人為路徑,錯誤訊息也比格1 講得清楚;當兩道獨立量測讀就錯了。
import { config } from './proxy';

/** 從 matcher pattern 抽出 (?!…) 排除清單。
 *  ⚠️ 只解析【目前這種簡單 alternation】(無跳脫、無巢狀括號):pattern 若進化成含 \|
 *  或巢狀括號會切錯 —— 但字面綁定格會先紅(fail-loud),紅了再把抽取器跟上(codex nit)。
 *  ⚠️ 只解【第一個】lookahead(reviewer Minor 2):第二個 (?!…) 會被靜默漏掉;
 *  本盲點的安全性【依賴格1 的精確相等】,格1 若放寬成 toContain/正則,本盲點立即生效。 */
function exclusionsOf(pattern: string): string[] {
  const m = pattern.match(/\(\?!([^)]*)\)/);
  if (!m) return [];
  return (m[1] ?? '').split('|');
}

describe('proxy matcher(登入閘覆蓋邊界)', () => {
  it('matcher 字面綁定:恰一條 pattern、逐字面相等(改 matcher 必先過本格)', () => {
    expect(
      config.matcher,
      'matcher 變了。它是登入閘的覆蓋邊界:排除清單多一段=那批路徑的 auth 靜默消失。改動請同步:①本格與下面排除清單格的期待值 ②proxy.ts export const config 上方那句「排除靜態資源」註解 ③向 Sean 說明為何要改覆蓋面(auth 邊界=鐵則 12②)。',
    ).toEqual(['/((?!_next/static|_next/image|favicon.ico).*)']);
  });

  it('排除清單=恰三項靜態資源,一項都不能多(多一項=該路徑 auth 靜默消失)', () => {
    // 正向對照:先證明抽取器在已知樣本上工作(抽取器壞掉 ⇒ 本格紅在這裡,不是矇混過關)
    expect(exclusionsOf('/((?!aa|bb).*)')).toEqual(['aa', 'bb']);
    const exclusions = exclusionsOf(config.matcher[0] ?? '');
    expect(exclusions.length).toBeGreaterThan(0); // 抽不到=pattern 形狀變了,也要紅
    expect(
      exclusions,
      '排除清單變了。每一項排除=proxy 登入閘對該前綴完全不跑;新增項目請逐字說明它為什麼可以未登入可達。',
    ).toEqual(['_next/static', '_next/image', 'favicon.ico']);
  });
});
