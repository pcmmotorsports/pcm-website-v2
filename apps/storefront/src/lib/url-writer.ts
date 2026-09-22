// url-writer.ts — :901 列表頁 / 商品頁**唯一的送網址出口**與落地處理。
//
// plan `docs/plans/2026-09-22-catalog-url-writer-plan.md` §3-1、§3-3、§3-4;行為依原型實測
//   (`~/pcm-mailbox/901-原型-20260922/實測結果-20260922.md`,Next 16.3.0,dev 與 production build)。
// 為什麼要有它:今天 10 多個地方各自讀 `window.location` 再 `router.replace`,
//   導航還沒落地時讀到的是舊網址 ⇒ 把舊車款抄回去(客人連點時車款跳回上一台)。
//
// 三種「網址」(§3-1):
//   最新目標 = 自己送出、還沒結束的最後一發(沒有就是 `window.location`)⇒ 所有寫入者組網址的底。
//   網址列   = `window.location`;replace 會預寫成最新目標(push 不預寫,實測預寫會讓上一筆紀錄留著舊畫面)。
//   已落地   = `useSearchParams` / `usePathname`;伺服器內容對應的網址。
// 🔴 本設計依賴 Next 16.3.0 的實測行為,升級 Next 要重跑原型 runner.js(plan §8-5)。
'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useTransition } from 'react';
import { applyVehicleIntent, getVehicleIntent } from '@/lib/vehicle-intent';

export type RouterLike = {
  replace: (href: string, opts?: { scroll?: boolean }) => void;
  push: (href: string, opts?: { scroll?: boolean }) => void;
  refresh: () => void;
};

/** 已落地網址從哪裡來:外部導航(頁首連結、別處的網址)或瀏覽器上一頁 / 下一頁。 */
export type LandingSource = 'external' | 'history';
/** 頁面元件登記:外部導航或上一頁落地時,依網址改車款意圖與篩選狀態(需要車款字典,所以由頁面提供)。 */
export type LandingHandler = (params: URLSearchParams, source: LandingSource) => void;

/** `seq` 遞增:導航完成時只清掉「這次落地處理之前送出」的項目(片 2 Codex R1 必修 1)。 */
/**
 * `derived`:送出時清單裡還有沒落地的外部目標 ⇒ 這一發是以那個外部網址為底組的,落地時頁面的篩選狀態要跟它同步。
 */
type Sent = { href: string; external: boolean; seq: number; derived?: boolean; method: 'replace' | 'push' };

// ── 模組層狀態(跨元件卸載保留;實測 6)──
let sent: Sent[] = [];
let nextSeq = 0;
let lastLanded: string | null = null;
let startNav: ((f: () => void) => void) | null = null;
let landingHandler: LandingHandler | null = null;
/** 頁面還沒登記落地處理時(列表頁的 loading.tsx 還在顯示)先擱著,登記時補做(片 2 Codex R1 必修 2)。 */
let deferredLanding: { router: RouterLike; landed: string } | null = null;
/** 掛著的 `useUrlWriter` 的 router;沒有 = 目前不在列表頁 / 詳情頁。 */
let activeRouter: RouterLike | null = null;
/**
 * 不在列表頁 / 詳情頁時發生的上一頁 / 下一頁(例如首頁按上一頁回到列表頁):記下目的網址,
 * 回到那一頁落地時照「上一頁」處理(片 2 Codex R1 必修 3)。
 */
let historyLandingHref: string | null = null;
/**
 * 外層這一次 commit 看到的已落地網址(useLayoutEffect 設,早於頁面的 useEffect 登記落地處理)。
 * 擱著的落地只有等於它才補做 —— 同一個外框裡換了目的地(載入 MT-07 中改去 R7),舊的那筆作廢(片 2 Codex R3 必修 1)。
 */
let observedLanded: string | null = null;
/**
 * 外部目標落地時,後面還有以它為底的較新一發沒落地 ⇒ 先不同步頁面篩選(同步成外部網址會丟掉客人接著做的改動),
 * 等最新那一發落地、或這批導航結束時再同步(片 6:點「新品上架」後立刻改排序,dev 依序落地時排序被丟掉)。
 */
let syncPending = false;

const hasWindow = () => typeof window !== 'undefined';
const hrefOf = (path: string, params: URLSearchParams) => {
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
};
/**
 * 站內網址正規化成 `pathname?search`,search 一律經 `URLSearchParams` 重新編碼(去掉 hash、origin)。
 * 🔴 `yamaha:mt-07` 與 `yamaha%3Amt-07` 是同一個網址;不正規化就會被當成不同 ⇒ 多送一發導航、清單比對不到。
 * 與 `useSearchParams().toString()` 的編碼一致。
 */
function normalize(href: string): string {
  const u = new URL(href, window.location.href);
  return hrefOf(u.pathname, u.searchParams);
}
const currentHref = () => normalize(window.location.href);

/**
 * 較早一發落地後(Next 把網址列改回那一發),網址列要寫回「還沒落地、而且是預寫過的」最後一發 = 最後一個 replace。
 * 🔴 不寫成 push 的目的地:push 不預寫(實測:預寫會讓上一筆紀錄留著舊畫面),而且網址列已經等於目的地時,
 *    Next 落地 push 會改用 replace、不新增紀錄(app-router.js:59)⇒ 上一頁會少一步(片 8 T13 量到)。
 */
function reassertAddressBar(): void {
  const lastReplace = [...sent].reverse().find((s) => s.method === 'replace');
  if (lastReplace && currentHref() !== lastReplace.href) {
    window.history.replaceState(window.history.state, '', lastReplace.href);
  }
}

function latestTargetHref(): string {
  return sent.length ? sent[sent.length - 1]!.href : currentHref();
}

/** 最新目標的參數(給需要先讀再決定的寫入者)。伺服器端回空的。 */
export function latestTarget(): URLSearchParams {
  if (!hasWindow()) return new URLSearchParams();
  return new URL(latestTargetHref(), window.location.href).searchParams;
}

function run(go: () => void) {
  if (startNav) startNav(go);
  else go();
}

/**
 * 唯一的送網址出口(§3-3):以最新目標為底 ⇒ 呼叫端只改自己的參數 ⇒ 車款一律由意圖覆寫 ⇒
 * 與最新目標相同就不送。replace 先預寫網址列(保留 Next 的 history.state,`useSearchParams` 不變);push 不預寫。
 */
export function writeSearch(
  router: RouterLike,
  edit: (p: URLSearchParams) => void,
  opts: { method?: 'replace' | 'push'; scroll?: boolean } = {},
): void {
  if (!hasWindow()) return;
  const base = new URL(latestTargetHref(), window.location.href);
  const params = new URLSearchParams(base.search);
  edit(params);
  applyVehicleIntent(params, getVehicleIntent());
  const next = hrefOf(base.pathname, params);
  if (next === latestTargetHref()) return;
  const method = opts.method ?? 'replace';
  sent.push({ href: next, external: false, seq: nextSeq++, derived: sent.some((s) => s.external || s.derived), method });
  const scroll = opts.scroll ?? false;
  if (method === 'replace') window.history.replaceState(window.history.state, '', next);
  run(() => (method === 'push' ? router.push(next, { scroll }) : router.replace(next, { scroll })));
}

/**
 * 同頁連結(`CatalogLink`)點下去當下登記目的網址,之後的操作以它為底(第三輪實測 S5)。
 * 🔴 只由那些連結自己的 onClick 呼叫;分頁連結不登記(它自己 preventDefault 改走頁碼,R3 必修 1)。
 */
export function registerLinkTarget(href: string): void {
  if (!hasWindow()) return;
  sent.push({ href: normalize(href), external: true, seq: nextSeq++, method: 'push' });
}

/**
 * 站內導航由程式發起、目的網址是一整串新網址(`navigateToCatalog`、搜尋面板):加到清單尾端再 push。
 * `external: true` = 目的網址的車款不是意圖(落地後才依網址或意圖補寫);帶車款的呼叫端要先自己改意圖再傳 false。
 */
export function pushNavigation(router: Pick<RouterLike, 'push'>, href: string, opts: { external: boolean; scroll?: boolean }): void {
  if (!hasWindow()) {
    router.push(href);
    return;
  }
  const target = normalize(href);
  sent.push({ href: target, external: opts.external, seq: nextSeq++, method: 'push' });
  run(() => (opts.scroll === undefined ? router.push(target) : router.push(target, { scroll: opts.scroll })));
}

/**
 * 還有「外部目標」沒落地(頁首連結、搜尋面板交接、品牌轉址),或它落地了而頁面還沒同步篩選。
 * 此時頁面的分類 / 品牌 / 價格還是舊的 ⇒ 寫網址的地方要先不寫,否則會把舊條件寫進新網址(Fable 片 6 R1 必修)。
 */
export function hasPendingExternalTarget(): boolean {
  if (!hasWindow()) return false;
  return syncPending || sent.some((s) => s.external || s.derived);
}

/** 還沒處理的上一頁落地(在別頁按上一頁、或頁面還在載入時按)。給頁面在第一次 render 就照歷史網址決定車款。 */
export function pendingHistoryLanding(): string | null {
  return historyLandingHref;
}

/** 這個網址還沒被 writer 處理過(從別頁來、或第一次載入)。卸載再掛載時是 false。 */
export function isFreshLanding(href: string): boolean {
  if (!hasWindow()) return true;
  return normalize(href) !== lastLanded;
}

/** 頁面元件登記落地處理;回傳解除登記。 */
export function setLandingHandler(handler: LandingHandler): () => void {
  landingHandler = handler;
  if (deferredLanding) {
    const d = deferredLanding;
    deferredLanding = null;
    if (observedLanded === null || d.landed === observedLanded) processLanding(d.router, d.landed);
  }
  return () => {
    if (landingHandler === handler) landingHandler = null;
  };
}

/** 外部導航落地:先交給頁面改意圖 / 篩選,再把意圖的車款補寫回網址(網址沒車款而意圖有 ⇒ 補;一致 ⇒ 不送)。 */
function handleExternalLanding(router: RouterLike, landed: string) {
  const params = new URL(landed, window.location.href).searchParams;
  landingHandler?.(params, 'external');
  writeSearch(router, () => {});
}

/** 落地分類(§3-4 表前四列)。抽出來給單元測試直接驗。 */
export function processLanding(router: RouterLike, landedRaw: string): void {
  const landed = normalize(landedRaw);
  if (!landingHandler) {
    // 頁面還沒掛好(loading 畫面)⇒ 不能改意圖、也不能補寫車款;等頁面登記時再處理。
    // 上一頁的紀錄(`historyLandingHref`)也留著,不在這裡標成處理完(片 2 Codex R2 必修 1)。
    deferredLanding = { router, landed };
    return;
  }
  // 🔴 上一頁的判斷排在「同一個已落地不重做」之前:從別頁按上一頁回到剛處理過的同一個網址,
  //    字串相同但仍要照上一頁處理(片 2 Codex R2 必修 3)。
  if (historyLandingHref !== null) {
    const fromHistory = historyLandingHref === landed;
    historyLandingHref = null;
    if (fromHistory) {
      lastLanded = landed;
      sent = [];
      landingHandler(new URL(landed, window.location.href).searchParams, 'history');
      router.refresh();
      return;
    }
  }
  if (landed === lastLanded) return; // 卸載再掛載:同一個已落地不重做(實測 6)
  lastLanded = landed;
  const idx = sent.findIndex((s) => s.href === landed);
  if (idx >= 0) {
    const hit = sent[idx]!;
    sent.splice(0, idx + 1);
    if (hit.external || hit.derived || syncPending) {
      if (sent.length > 0) {
        // 還有以它為底的較新一發 ⇒ 等那一發(它帶著外部網址 + 客人後來的改動)
        syncPending = true;
        reassertAddressBar();
        return;
      }
      syncPending = false;
      handleExternalLanding(router, landed);
      return;
    }
    // 自己送的較早一發落地:Next 會把網址列改回那一發 ⇒ 還有沒落地的就寫回最新目標
    if (sent.length > 0) reassertAddressBar();
    return;
  }
  // 不在清單裡:沒被攔到的外部導航(或第一次載入、換路徑)⇒ 清單作廢
  sent = [];
  syncPending = false;
  handleExternalLanding(router, landed);
}

/**
 * 導航完成(`isPending` true ⇒ false):這批全部結束或被丟棄 ⇒ 清掉 `seq < before` 的項目(實測 S12)。
 * `before` = 這次落地處理開始前的 `nextSeq`;落地處理當下補送的那一發屬於下一批,不能清(片 2 Codex R1 必修 1)。
 * 沒有剩下的 ⇒ 網址列對齊已落地。
 */
export function processNavigationIdle(landedRaw: string, before: number = nextSeq, router?: RouterLike): void {
  const landed = normalize(landedRaw);
  sent = sent.filter((s) => s.seq >= before);
  if (sent.length === 0 && currentHref() !== landed) window.history.replaceState(window.history.state, '', landed);
  // 擱著的篩選同步:較新那一發被丟掉了(production 只落最後一發以外的情況)⇒ 以最後落地的網址同步
  if (syncPending && sent.length === 0 && router && landingHandler) {
    syncPending = false;
    handleExternalLanding(router, landed);
  }
}

/** 目前的序號(給 `useUrlWriter` 在落地處理前記下)。 */
export const currentSeq = (): number => nextSeq;

/** 上一頁 / 下一頁(§3-4):一律以歷史網址為準、一律重新載入;不看字串是否與前一筆相同(R3 必修 2)。 */
export function processPopState(router: RouterLike): void {
  sent = [];
  syncPending = false;
  deferredLanding = null;
  // 頁面還沒登記落地處理(loading 畫面)⇒ 記下來,等那個網址落地、頁面登記時再照上一頁處理(片 2 Codex R2 必修 1)
  historyLandingHref = currentHref();
  // 沒登記就擱著目的網址;頁面登記時照上一頁處理(若 Next 之後落地的網址不同,會蓋掉這筆)
  processLanding(router, historyLandingHref);
}

// 模組載入就聽(不是 useEffect 裡才聽):離開列表頁 / 詳情頁之後的上一頁也要記得(片 2 Codex R1 必修 3)。
// 這支模組只要在這個分頁載入過一次就會一直在(App Router 換頁不重新載入 JS)。
if (hasWindow()) {
  window.addEventListener('popstate', () => {
    if (activeRouter) processPopState(activeRouter);
    else {
      sent = [];
      deferredLanding = null;
      historyLandingHref = currentHref();
    }
  });
}

/**
 * 掛在 `app/products/(catalog)/layout.tsx` 與 `app/products/[slug]/layout.tsx`(不跟著頁面元件卸載):
 * 提供 startTransition、落地分類、導航完成、上一頁處理。
 * effect 順序:子元件(頁面)的 effect 先跑 ⇒ 頁面先登記 `setLandingHandler`,這裡才分類。
 */
export function useUrlWriter(): void {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const qs = sp.toString();
  const landed = qs ? `${pathname}?${qs}` : pathname;
  const [isPending, startTransition] = useTransition();
  const wasPending = useRef(false);

  useLayoutEffect(() => {
    observedLanded = normalize(landed);
  }, [landed]);

  useEffect(() => {
    startNav = (f) => startTransition(f);
    return () => {
      startNav = null;
    };
  }, [startTransition]);

  useEffect(() => {
    activeRouter = router;
    return () => {
      if (activeRouter === router) activeRouter = null;
      // 離開這一頁(§3-4「路徑換到別頁」):沒處理完的落地、還沒落地的清單、上次處理過的網址都屬於這一頁,
      // 不能帶到下一次進來(片 2 Codex R2 必修 2、R3 必修 2)。上一頁的紀錄 `historyLandingHref` 不清(跨頁要用)。
      deferredLanding = null;
      sent = [];
      lastLanded = null;
      observedLanded = null;
      syncPending = false;
    };
  }, [router]);

  // 先落地分類、再看導航完成(§3-4「處理順序」);完成只清落地處理之前送出的
  useEffect(() => {
    const before = currentSeq();
    processLanding(router, landed);
    if (isPending) {
      wasPending.current = true;
      return;
    }
    if (!wasPending.current) return;
    wasPending.current = false;
    processNavigationIdle(landed, before, router);
  }, [router, landed, isPending]);
}

/** 只給測試用:清掉模組層狀態(模擬重新整理)。 */
export function resetUrlWriterForTests(): void {
  sent = [];
  lastLanded = null;
  startNav = null;
  landingHandler = null;
  deferredLanding = null;
  activeRouter = null;
  historyLandingHref = null;
  observedLanded = null;
  syncPending = false;
}

/** 只給測試用:目前清單。 */
export function sentForTests(): readonly { href: string; external: boolean }[] {
  return sent.map(({ href, external }) => ({ href, external }));
}
