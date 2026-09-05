// search-log.ts — 把客人真的打了什麼記下來(`#183` / ⟦search-NOSEARCHLOG⟧ 2026-09-04)
//
// 🔴🔴 **Sean 2026-09-04 拍板(原話逐字, 正本 `~/pcm-mailbox/Sean拍板-20260904-七題.md` 檔尾)**:
//    > Q-搜尋紀錄: 開始記客人打的字, 但【不記是誰打的】?
//    > 甲 = 好, 不記誰 (推薦)
//    ⇒ 📌 **這一板【取代】他 2026-08-21 拍的「要記, 連誰搜的一起記」**(引用時寫「09-04 甲 取代 08-21」)。
//
// 🛑 **不存身分 —— 而【IP 與 user-agent 也不存, 它們是身分的替身】。**
//    這一句不是多餘的:一個「不記身分」的表, 最容易長出來的下一欄就是 IP。
//
// ══════════════════════════════════════════════════════════════════════════
// 🔴🔴 記 log 這一發走 **anon client** —— 而那與 DB 那半的 GRANT 成對
// ══════════════════════════════════════════════════════════════════════════
//    migration `20260904200000` 只把 EXECUTE 給了 `anon`。
//    🛑 **兩半不可只取前半**:改成別的 client ⇒ **每一筆都被權限擋掉、被下面的 catch 吞掉,
//       而畫面完全正常、語料永遠是空的。**
//
// ── 🔴🔴 而 codex 2026-09-04 對這件事開了一條 must-fix, 我【沒有照它改】, 理由寫在這裡 ──
//    他說(對):「`anon` 可直接無限呼叫 RPC, 自填搜尋字與結果數;RLS 擋不到 `SECURITY DEFINER`。」
//    ⛔ ~~我第一版照他改成 `createSupabaseServiceClient()`~~ ⇒ 🛑 **那一版被 lint 擋下來**:
//       `eslint.config.js` 對 `apps/storefront/**` **整片禁止** import `@pcm/adapters/server`
//       (ADR-0005 §6/§7 · service_role key 三層防)。既有的唯一例外是
//       `apps/storefront/src/lib/auth/line-admin.ts:32`, 而它逐字寫著:
//       **「多開第五道門 = 要 Sean 拍板 + ADR 記錄的事, 不是實作窗自己批得了的」。**
//    ⇒ 🎯 **所以這不是「我忘了」, 是【一個安全片的修法撞到另一道安全線】。**
//    ✅ **我選的**:留在 `anon`(= plan v5 §3, Sean 批過的那版)+ **在 DB 那一層加一道去重**
//       (`UNIQUE (query_raw, path, created_at)` 而 `created_at` 是**整點**
//        ⇒ **同一個字每小時最多留一列**)⇒ 灌爆的成本從「無限列」降成「無限個【不同的字】」。
//    🛑 **殘餘風險我不自宣接受** ⇒ 板列 `⟦search-LOGFLOOD⟧`;
//       而「要不要為它開第五道門」是**要 Sean 拍的**, 已端。
//
// ══════════════════════════════════════════════════════════════════════════
// 🔴 失敗要【留痕】, 不是吞掉(Sean 2026-09-04 的字面要求)
// ══════════════════════════════════════════════════════════════════════════
//    寫入失敗**不得影響搜尋回應** ⇒ fire-and-forget;
//    而 `catch {}` 一個字都不印的話, 「一直失敗」與「一直成功」在 log 裡是同一個安靜。
//    ⇒ ✅ 一律 `console.error` 帶前綴, 讓查 log 的人 grep 得到函式名。
//
// 🛑 **而它仍然有三個世界會【安靜地永遠零語料】**(plan v5 §6, 本片不解):
//    ① RPC 名/參數與 migration 對不上 ② 日後安全強化把 anon 的 EXECUTE 收掉
//    ③ `after()` 在 Vercel 沒執行
//    ⇒ 📌 三者都是「畫面完全正常而表是空的」⇒ **要一格「昨天有搜尋而表昨天 0 列 ⇒ 叫」**,
//      而那條 route 的 reader 被斷言釘在零權限 ⇒ 那是**第二支要 Sean 貼的 migration**
//      ⇒ 板列 `⟦search-LOGSILENTZERO⟧`。**本片不假裝做了它。**

import 'server-only';

import { after } from 'next/server';

import { createSupabaseAnonClient } from '@pcm/adapters';

/** 客人這一發搜尋走的是哪條路。與 DB 的 `CHECK (path IN ('keyword','capsule'))` 同一組字面。 */
export type SearchLogPath = 'keyword' | 'capsule';

export type SearchLogInput = {
  readonly query: string;
  readonly path: SearchLogPath;
  /** 膠囊那條路上【沒被解析掉】的字 —— 「我們的分類缺什麼」的直接訊號。 */
  readonly unmatched?: string | null;
  readonly resultCount?: number | null;
};

/**
 * 記一筆搜尋語料。**永不 throw、永不影響呼叫端。**
 *
 * 🔵 空字串直接不記 —— DB 那邊有 `CHECK (btrim(query_raw) <> '')`,
 *    送過去只會換來一次被 catch 掉的失敗,而那會在 log 裡製造雜訊。
 */
export function logSearchQuery({ query, path, unmatched, resultCount }: SearchLogInput): void {
  const q = query.trim();
  if (q === '') return;
  try {
    after(async () => {
      try {
        // 🔴 `rpc` 的型別來自產生的 `Database`, 而這支函式是本片新加的 ⇒ 型別還沒重產。
        //    cast 的是**整個 client**, 不是把方法拆下來 —— 拆下來 `this` 會掉
        //    (2026-09-03 正式站 503 就是那個形狀, 見 `SupabaseProductAdapter.ts` 那段註解)。
        const sb = createSupabaseAnonClient() as unknown as {
          rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
        };
        const { error } = await sb.rpc('log_search_query', {
          p_query_raw: q,
          p_path: path,
          p_unmatched: unmatched ?? null,
          p_result_count: resultCount ?? null,
        });
        if (error) {
          console.error('[logSearchQuery] RPC 回了 error(語料沒記到):', error);
        }
      } catch (err) {
        console.error('[logSearchQuery] 背景寫入 throw 了(語料沒記到):', err);
      }
    });
  } catch (err) {
    // 🔴 `after()` 在【沒有請求作用域】時會 throw(測試、build 期)。
    //    ⇒ 它不該把搜尋弄壞, 而它也不該安靜 —— 兩件事都要。
    console.error('[logSearchQuery] after() 用不了(不在請求作用域?):', err);
  }
}
