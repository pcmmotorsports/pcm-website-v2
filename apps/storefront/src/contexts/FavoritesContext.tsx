// FavoritesContext.tsx — 收藏的單一資料源(M-4b #191)
//
// plan:`docs/specs/2026-08-18-g3-favorites-plan.md` §1-c / §1-d(Sean 2026-08-18 批)。
//
// 🔴 **它存在的理由是「兩顆愛心要同步」**:在這之前 `ProductCard` 與 `ProductInfo` 各自
//   `useState(false)` ⇒ 同一件商品在列表與商品頁**互不知道**,重新整理 12 顆愛心紅的 0 顆。
//   ⇒ 有了單一資料源之後「同步」是**自然結果**,不另寫同步邏輯。
//
// 🔴 **鍵是 handle 不是 uuid**:理由與代價寫在 `app/account/favorites/actions.ts` 檔頭(不重抄)。
//
// Q2(主視窗代裁,Sean 授權「愛心的問題給你決定就好」):**沒登入 ⇒ 愛心照樣顯示,按了帶去登入**。
//   理由:藏起來的話沒登入的人不知道有這個功能 ⇒ 少一個註冊誘因。
//   ⚠️ 這一題與 Q1(手機常駐顯示)**出處不同** —— Q1 是 Sean 本人講的,Q2 是代裁。不要一起升級。
//
// 樂觀更新:點了先變色、失敗**退回並讓客人看得見**(下方 `.fav-error` 那條)。
//   不退回 = 又變成「畫面說成功、其實沒有」—— 那正是本片要治的病。
//   ⚠️ 而 `add` 是冪等的(adapter `ignoreDuplicates`)⇒ **雙擊不會走到失敗路徑**;
//     真正會失敗的是網路斷 / session 過期 / 商品在這期間被下架。

'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';

/**
 * 🔴 server action **動態載入,不寫成頂層 import** —— 這一行是承重的,不是風格。
 *
 * `app/account/favorites/actions.ts` 會經 `lib/auth/composition.ts` 拉進 `@pcm/adapters`,
 * 而那條鏈頂層有 `import 'server-only'`。Next 打包時 `'use server'` 檔會被換成 client reference,
 * 所以**正式站沒事**;但 **vitest 是照著 import 圖真的去載它** ⇒ 只要有一支測試 render 到商品卡,
 * 就會炸「This module cannot be imported from a Client Component module」。
 * 實測(2026-08-18):改成頂層 import ⇒ **11 支既有測試檔整支 fail**(ProductCard / ProductsPage /
 * ProductRail / ProductPage / ProductInfo / HomeSelect / AccountView / OverviewTab / BrandPageRoot /
 * brands[slug]/page / product-card-quick-add)。
 * ⇒ 若改回頂層 import,那 11 支各要補一次 `vi.mock` —— 而且**下一支 render 商品卡的測試也要記得補**。
 * ponytail: 動態 import 換掉 11 處 mock 樣板;副作用是未登入的訪客根本不會載到這段。
 */
const actions = () => import('@/app/account/favorites/actions');

/**
 * 🔴 客人看到的失敗文案**固定一句**(codex 對抗審查 must-fix 5)。
 * 原本把 `e.message` 直接印到畫面上 —— 那裡面可能是動態 import 失敗帶的 chunk 網址、
 * 模組路徑或執行期例外字串。**細節留 console、畫面只講人話。**
 */
const FAILED_MESSAGE = '收藏沒有存成功,請再試一次';

export type FavoritesContextValue = {
  /** 這件商品在不在收藏裡(未登入恆 false)。 */
  isFavorite: (handle: string) => boolean;
  /** 切換收藏;未登入 → 帶去 /login?next=<現在這頁>。 */
  toggleFavorite: (handle: string) => void;
};

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

/**
 * 沒有 Provider 時的退化值:**不丟錯**。
 * 理由:兩顆愛心散在四個掛載面 + 測試會單獨 render 它們;少一個 Provider 就整頁炸掉
 * 是比「愛心暫時沒作用」更糟的失敗方式。
 */
const FALLBACK: FavoritesContextValue = {
  isFavorite: () => false,
  toggleFavorite: () => {},
};

export function useFavorites(): FavoritesContextValue {
  return useContext(FavoritesContext) ?? FALLBACK;
}

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [handles, setHandles] = useState<Set<string>>(() => new Set());
  /**
   * 🔴 **存的是 user id,不是 `isAuthed` 布林**(codex 對抗審查 must-fix 1)。
   * 原本存布林 ⇒ **A 帳號直接切成 B 帳號時,它從 `true` 變 `true`**
   * ⇒ 載入清單那個 effect **不會重跑** ⇒ **B 看到的是 A 的紅心。**
   * ⚠️ 它不會讓 B 動到 A 的資料(那一層是 server session + RLS 守的),
   *   但畫面會對 B 說謊 —— 而那正是本片要治的病。
   */
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** 非同步回來時要問「現在還是同一個人嗎」,而 state 在 closure 裡是舊的 ⇒ 用 ref 讀當下值。 */
  const userIdRef = useRef<string | null>(null);
  userIdRef.current = userId;

  /**
   * 🔴 **同一個 tick 裡連按兩下時,`handles` 這個 state 還沒更新**
   * ⇒ 若用它算「現在是不是已收藏」,第二下會**再算一次「還沒收藏」⇒ 又送一個 add**
   * ⇒ 客人連按兩下,期待是「加了又取消」,實際是**留在已收藏**。
   * (2026-08-18 真瀏覽器實測到這個:連按兩下 ⇒ `aria-pressed` 停在 `true`。)
   * ⇒ 用 ref 當**當下真值**,按下的瞬間就更新它 ⇒ 第二下讀到的是第一下的結果。
   */
  const handlesRef = useRef<Set<string>>(handles);

  /**
   * 客人按了幾次(codex must-fix 2;我同輪自己也抓到、修法相同)。
   * 登入後那趟「載入既有收藏」要跑一小段時間,而客人**在它回來之前就按了愛心**的話,
   * 晚回來的清單會把他剛按的那顆**蓋掉** ⇒ 畫面退回未收藏,而 DB 裡其實已經寫進去了。
   * ⇒ 做法:載入開始前記下計數,回來時**如果有人動過就整份丟掉**(下次重整自然會對)。
   * ⚠️ 不用「合併」解:合併會讓載入期間的**取消**被那份舊清單復活,那是反方向的同一種病。
   */
  const toggleCount = useRef(0);

  /**
   * 每個商品自己的一條佇列(codex 對抗審查 must-fix 3)。
   * 🔴 病:同一顆愛心快速開→關,`add` 與 `remove` 會**同時在路上**;
   *   若 `remove` 先到、`add` 後到,**兩個都成功**,而 DB 最後是「有收藏」、畫面是「沒收藏」。
   *   ⚠️ 既有的雙擊測試只證明「不報錯」,**沒有證明最終狀態一致** —— codex 這句是對的。
   * ⇒ 做法:同一個 handle 的操作**串成一條鏈**,後一個等前一個結束才送
   *   ⇒ 到達順序 = 按下順序 ⇒ DB 的最終狀態 = 客人最後一次的意思。
   * ponytail: 一個 Map 的 promise 鏈;跨分頁一致要別的機制(那是 realtime 的題目,不在本片)。
   */
  const queues = useRef(new Map<string, Promise<unknown>>());

  // 會員態:鏡像 `Header.tsx` 的 onAuthStateChange 慣例(訂閱後即 emit INITIAL_SESSION、
  // 讀本地 session 不打網路)⇒ 未登入的訪客**不會**因為本 Provider 多打一趟 server action。
  useEffect(() => {
    let active = true;
    let subscription: { unsubscribe: () => void } | undefined;
    try {
      const supabase = createBrowserSupabaseClient();
      subscription = supabase.auth.onAuthStateChange((_event, session) => {
        if (active) setUserId(session?.user?.id ?? null);
      }).data.subscription;
    } catch {
      // env / browser client 不可用(如測試環境)→ 維持未登入預設、不阻斷 render。
    }
    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, []);

  // 登入(或換人)後載入那個人的收藏;登出清空。
  // 🔴 `userId` 進 deps ⇒ **換帳號會重跑**(存布林的舊版不會,見上)。
  useEffect(() => {
    handlesRef.current = new Set();
    setHandles(new Set());
    queues.current.clear();
    setError(null);
    if (!userId) return;
    let active = true;
    const startedAt = toggleCount.current;
    actions()
      .then((m) => m.listFavoriteHandlesAction())
      .then((list) => {
        // 載入期間客人動過、或人已經換了 ⇒ 丟掉這份(它已經過期)。
        if (active && userIdRef.current === userId && toggleCount.current === startedAt) {
          handlesRef.current = new Set(list);
          setHandles(new Set(list));
        }
      })
      .catch(() => {
        // 讀不到就當作空的(愛心顯示為未收藏);使用者一按仍會走 server、不會寫壞資料。
      });
    return () => {
      active = false;
    };
  }, [userId]);

  const isFavorite = useCallback((handle: string) => handles.has(handle), [handles]);

  const toggleFavorite = useCallback(
    (handle: string) => {
      // Q2:未登入 ⇒ 帶去登入、並記得回到他原本那一頁。
      if (!userId) {
        router.push(`/login?next=${encodeURIComponent(pathname || '/')}`);
        return;
      }
      toggleCount.current += 1;
      // 🔴 讀 ref 不讀 state(見 `handlesRef` 的說明):同 tick 連按兩下才會真的一開一關。
      const wasFavorite = handlesRef.current.has(handle);
      // 樂觀更新:先動畫面,ref 同步跟上。
      const optimistic = new Set(handlesRef.current);
      if (wasFavorite) optimistic.delete(handle);
      else optimistic.add(handle);
      handlesRef.current = optimistic;
      setHandles(optimistic);
      setError(null);

      const owner = userId;
      /** 失敗時把畫面退回去(只在還是同一個人的時候)。 */
      const rollback = () => {
        if (userIdRef.current !== owner) return;
        const reverted = new Set(handlesRef.current);
        if (wasFavorite) reverted.add(handle);
        else reverted.delete(handle);
        handlesRef.current = reverted;
        setHandles(reverted);
        // 🔴 **只顯示固定文案**(codex must-fix 5):原本顯示 `e.message`,而動態 import 失敗的
        //   訊息裡會帶著 chunk 網址 / 模組路徑 —— 那是講給工程師聽的,不該出現在客人畫面上。
        setError(FAILED_MESSAGE);
      };

      const run = async () => {
        const m = await actions();
        const res = await (wasFavorite ? m.removeFavoriteAction : m.addFavoriteAction)(handle);
        // 🔴 回來時人已經換了(或登出了)⇒ **什麼都不做**(codex must-fix 4):
        //   否則 A 的失敗會把 A 的紅心 rollback 到 B 的畫面上。
        if (userIdRef.current !== owner) return;
        if (!('ok' in res)) rollback();
      };

      // 同一個 handle 串一條鏈(must-fix 3);前一環無論成功失敗都要接下去,鏈不能斷。
      const prev = queues.current.get(handle) ?? Promise.resolve();
      queues.current.set(handle, prev.then(run, run).catch(rollback));
    },
    [pathname, router, userId],
  );

  return (
    <FavoritesContext.Provider value={{ isFavorite, toggleFavorite }}>
      {children}
      {error && (
        <div className="fav-error" role="alert">
          {error}
          <button type="button" onClick={() => setError(null)} aria-label="關閉提示">
            ×
          </button>
        </div>
      )}
    </FavoritesContext.Provider>
  );
}
