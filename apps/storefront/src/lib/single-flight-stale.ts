// single-flight-stale.ts —— 同一台機器上的「單飛 + 留上一份好的值」(2026-09-15 主視窗第 20 件)。
//
// 🔬 為什麼:正式站 log(dpl_6sbJ)21:49:01–11 那 10 秒 /products 冷了 16 發 —— unstable_cache 沒命中時,
//   重建結果要等回應送完才寫進快取(next/dist/server/web/spec-extension/unstable-cache.js:213-220
//   pendingRevalidates)⇒ 同時湧進來的請求全部沒命中、各自打一次 RPC。
// ✅ 這裡做兩件事, 都只在【同一個 process】內有效:
//   ① 同時進來的只觸發一次 load, 其他人等同一個 Promise
//   ② 記住上一份成功值;未超過 ttl 直接回(不進 unstable_cache)
//   ③ load 失敗 ⇒ 上一份好值未超過 staleForMs(預設 2×ttl)就回舊值並 log;超過就照舊 throw(呼叫端既有的失敗提示)
// 🛑 跨機器那半解不了 —— 每台機器仍各自冷一次。
// ⚠️ 回傳的是【同一個參照】:呼叫端若會就地改, 要自己 clone。
// 🔵 2026-10-04 健檢:包在 unstable_cache 的讀取函式【裡面】時傳 ttl 0 + staleForMs ——
//   背景更新每次都真的去讀, 失敗才回舊值;回的值會被 Next 存回快取 ⇒ 下一次重試排在 revalidate 秒之後,
//   不再是「每個請求都重試一次、每次都等滿逾時」。

export function singleFlightStale<T>(
  load: () => Promise<T>,
  ttlMs: number,
  label: string,
  now: () => number = Date.now,
  staleForMs: number = 2 * ttlMs,
): () => Promise<T> {
  let last: { value: T; at: number } | null = null;
  let inflight: Promise<T> | null = null;
  return async () => {
    if (last && now() - last.at < ttlMs) return last.value;
    if (!inflight) {
      inflight = load()
        .then((value) => {
          last = { value, at: now() };
          return value;
        })
        .finally(() => {
          inflight = null;
        });
    }
    try {
      return await inflight;
    } catch (err) {
      if (last && now() - last.at < staleForMs) {
        console.error(
          `[${label}] 重建失敗, 回上一份好的值(${Math.round((now() - last.at) / 1000)} 秒前取得):`,
          err,
        );
        return last.value;
      }
      throw err;
    }
  };
}
