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

  /** 畫面上的收藏(樂觀值:客人按下去的當下就變)。 */
  const [handles, setHandles] = useState<Set<string>>(() => new Set());
  /**
   * 🔴 **存的是 user id,不是 `isAuthed` 布林**(codex R1 must-fix 1)。
   * 原本存布林 ⇒ **A 帳號直接切成 B 帳號時,它從 `true` 變 `true`**
   * ⇒ 載入清單那個 effect **不會重跑** ⇒ **B 看到的是 A 的紅心。**
   */
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * 非同步回來時要問「現在還是同一個人嗎」,而 state 在 closure 裡是舊的 ⇒ 用 ref 讀當下值。
   * 🔴 **在 effect 裡寫、不在 render 期間寫**(codex R2 must-fix 4):
   *   render 期間改 ref 是 React 明文的 side effect —— 併發 render 下,
   *   一個**還沒 commit、甚至最後被丟掉**的 render 會先把它改掉,
   *   讓還在畫面上的舊請求被誤判成「換人了」而跳過該做的退回。
   */
  const userIdRef = useRef<string | null>(null);
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  /**
   * 🔴 **同一個 tick 裡連按兩下時,`handles` 這個 state 還沒更新**
   * ⇒ 若用它算「現在是不是已收藏」,第二下會再算一次「還沒收藏」⇒ 又送一個 add
   * ⇒ 客人連按兩下,期待「加了又取消」,實際**留在已收藏**
   * (2026-08-18 真瀏覽器實測到這個:連按兩下 ⇒ `aria-pressed` 停在 `true`)。
   */
  const handlesRef = useRef<Set<string>>(handles);

  /**
   * 🔴🔴 **這三個 ref 是 codex R2 四條 must-fix 的共同修法** —— 從「補丁式退回」換成
   * 一個**會收斂的狀態機**。R2 打破的正是補丁式退回:
   * ```
   * 舊做法：每次操作記住「我按之前是什麼」，失敗時把那個差量套回去
   * 破法（R2 finding 1）：連按三下 add→remove→add，第一個 add 失敗時，
   *   它的退回會把【第三下留下的紅心】刪掉；後面成功的 add 只改 DB 不改畫面
   *   ⇒ DB 有收藏、畫面沒有。而客人看不出來。
   * ```
   * 新做法(三個值,語意清楚):
   * - `desired`   客人**最後一次**的意思(每按一下就覆蓋,不排隊)
   * - `confirmed` **server 確認過**的狀態(只有成功回來才動)
   * - `running`   這個商品有沒有 worker 在跑(同一個商品同時只有一支在送)
   * worker 迴圈:只要 `desired !== confirmed` 就送一發;成功就更新 confirmed;
   * 失敗就**把畫面拉回 confirmed**(不是拉回某個差量)並報錯。
   * ⇒ 不論客人按幾下、哪幾發失敗,**畫面最後一定等於 confirmed 或等於 desired**,
   *   不會停在一個「兩邊都不是」的中間態。
   */
  const desiredRef = useRef(new Map<string, boolean>());
  const confirmedRef = useRef(new Set<string>());
  const runningRef = useRef(new Set<string>());

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
    userIdRef.current = userId;
    handlesRef.current = new Set();
    confirmedRef.current = new Set();
    desiredRef.current.clear();
    runningRef.current.clear();
    setHandles(new Set());
    setError(null);
    if (!userId) return;
    let active = true;
    actions()
      .then((m) => m.listFavoriteHandlesAction())
      .then((list) => {
        // 🔴 載入期間客人已經動過(desired 有東西)、或人已經換了 ⇒ 丟掉這份,它已經過期。
        //   套下去會蓋掉他剛按的那顆 ⇒ 畫面說沒收藏、DB 說有(codex R1 must-fix 2)。
        if (!active || userIdRef.current !== userId || desiredRef.current.size > 0) return;
        confirmedRef.current = new Set(list);
        handlesRef.current = new Set(list);
        setHandles(new Set(list));
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
      const owner = userId;
      // 🔴 讀 ref 不讀 state(見 `handlesRef`):同 tick 連按兩下才會真的一開一關。
      const want = !handlesRef.current.has(handle);
      desiredRef.current.set(handle, want);

      // 樂觀更新:先動畫面,ref 同步跟上。
      const optimistic = new Set(handlesRef.current);
      if (want) optimistic.add(handle);
      else optimistic.delete(handle);
      handlesRef.current = optimistic;
      setHandles(optimistic);
      setError(null);

      /** 把某一個商品的畫面拉回「server 確認過的樣子」(失敗時用;不是套差量)。 */
      const resyncFromConfirmed = () => {
        const fixed = new Set(handlesRef.current);
        if (confirmedRef.current.has(handle)) fixed.add(handle);
        else fixed.delete(handle);
        handlesRef.current = fixed;
        setHandles(fixed);
      };

      // 同一個商品同時只有一支 worker(codex R1 must-fix 3:add 與 remove 不得同時在路上)。
      if (runningRef.current.has(handle)) return;
      runningRef.current.add(handle);

      void (async () => {
        try {
          const m = await actions();
          // 只要還有落差就繼續送;客人中途再按,改的是 desired,這個迴圈自然會追上去。
          while (desiredRef.current.get(handle) !== confirmedRef.current.has(handle)) {
            // 🔴 **送出【之前】就要問是不是同一個人**(codex R2 must-fix 2):
            //   排進佇列但還沒送出的操作,若在換帳號之後才送,
            //   server action 會照**當下的 session** 寫進去 ⇒ **寫到 B 的收藏裡**。
            if (userIdRef.current !== owner) return;
            const next = desiredRef.current.get(handle)!;
            const res = await (next ? m.addFavoriteAction : m.removeFavoriteAction)(handle, owner);
            // 回來時人已經換了 ⇒ 什麼都不做(codex R1 must-fix 4):
            // 否則 A 的失敗會把 A 的紅心退回到 B 的畫面上。
            if (userIdRef.current !== owner) return;
            if ('ok' in res) {
              if (next) confirmedRef.current.add(handle);
              else confirmedRef.current.delete(handle);
              continue;
            }
            // 失敗:畫面拉回 confirmed(不是套差量)+ 講出來 + 放棄這個 desired。
            desiredRef.current.delete(handle);
            resyncFromConfirmed();
            setError(FAILED_MESSAGE);
            return;
          }
        } catch {
          // 動態 import / 網路層爆掉:同樣拉回 confirmed。
          // 🔴 **只顯示固定文案**(codex R1 must-fix 5):例外訊息裡可能帶 chunk 網址或模組路徑,
          //   那是講給工程師聽的,不該出現在客人畫面上。
          if (userIdRef.current !== owner) return;
          desiredRef.current.delete(handle);
          resyncFromConfirmed();
          setError(FAILED_MESSAGE);
        } finally {
          // 🔴 收掉,不留(codex R2 must-fix 3:舊版的 Map 只增不減、每碰一個新商品就多一條)。
          runningRef.current.delete(handle);
          desiredRef.current.delete(handle);
        }
      })();
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
