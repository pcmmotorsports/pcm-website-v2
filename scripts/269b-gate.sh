#!/usr/bin/env bash
# #269-b 段二解鎖閘 — 真 PostgREST anon 六格量測
# ============================================================
# 用法:bash scripts/269b-gate.sh     (apply 後跑;T+20min 再跑一次至少格②)
#       bash scripts/269b-gate.sh 2  (只跑第 2 格)
#
# 基準線(apply 前實打)= docs/reviews/2026-08-11-269b-baseline.md —— 判讀前先讀它,
# 尤其「單一樣本不能當基準線」與「格③今天沒有可比前值」兩條。
#
# 🔴 絕不 source .env.local(非 ASCII 變數名會讓 zsh 把整行內容印進終端 = 外洩)。
#    只用 grep 取單顆值,且**全程不 echo 金鑰**。
# 🔴 判讀不是「有沒有回 200」而已,三種失敗要分開處置:
#      57014  = statement timeout            → 真的慢,照分格表
#      PGRST202 = schema cache 找不到函式/參數 → 重送 NOTIFY pgrst,**不是 rollback**
#      其他非 200                              → 停下人工看
# 分格表(Fable R4 F2):
#      格①② 爆 = 既有型錄路徑(今天有人在用)      → rollback
#      格③④⑤⑥ 爆 = 段二未接線路徑(今天沒人用)   → 開索引片、不接段二、不 rollback
set -uo pipefail

# .env.local 不在 git 裡、且各 worktree 各有一份 ⇒ 依序找,不寫死單一絕對路徑。
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo .)
ENV_FILE=""
for cand in "$REPO_ROOT/apps/storefront/.env.local" \
            "/Users/sean_1/pcm-website-v2/apps/storefront/.env.local"; do
  [ -r "$cand" ] && { ENV_FILE="$cand"; break; }
done
[ -n "$ENV_FILE" ] || { echo "找不到 apps/storefront/.env.local(試過 repo 內與主樹)"; exit 1; }
echo "env: $ENV_FILE"

URL=$(grep -m1 '^NEXT_PUBLIC_SUPABASE_URL=' "$ENV_FILE" | cut -d= -f2- | tr -d '"'"'"' \r')
KEY=$(grep -m1 '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' "$ENV_FILE" | cut -d= -f2- | tr -d '"'"'"' \r')
[ -n "$URL" ] && [ -n "$KEY" ] || { echo "URL 或 ANON KEY 取不到(只回報有無,不印值)"; exit 1; }
echo "target: $URL  (anon key 已載入、長度 ${#KEY},不印值)"

BUDGET=3.0          # anon statement_timeout = 3s(不是 8s;8s 是 authenticated/authenticator)
EARLY='2000-01-01T00:00:00Z'
SINCE=$(date -u -v-7d '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -d '7 days ago' '+%Y-%m-%dT%H:%M:%SZ')

# 格號|說明|哪一類(existing=①②/new=③④⑤⑥)|JSON body
CELLS=(
"1|不帶 p_new_since + recommend(現行主要型錄路徑)|existing|{\"p_sort\":\"recommend\",\"p_limit\":50,\"p_offset\":0}"
"2|不帶 p_new_since + recommend + 車輛分支(facet 一次 fan-out 108 次)|existing|{\"p_sort\":\"recommend\",\"p_limit\":1,\"p_offset\":0,\"p_brand\":\"Ducati\"}"
"3|不帶 p_new_since + sort=new(全目錄依 created_at 排序、無索引)|new|{\"p_sort\":\"new\",\"p_limit\":50,\"p_offset\":0}"
"4|帶 p_new_since=now()-7d(新品頁本身)|new|{\"p_sort\":\"new\",\"p_limit\":50,\"p_offset\":0,\"p_new_since\":\"__SINCE__\"}"
"5|帶 p_new_since + 車輛(新品 × 車輛,麵包屑 withVehicle 會產生)|new|{\"p_sort\":\"new\",\"p_limit\":50,\"p_offset\":0,\"p_new_since\":\"__SINCE__\",\"p_brand\":\"Ducati\"}"
"6|退回查詢:p_new_since=很早的時戳(批次日 CTE 掃全歷史 20k 列)|new|{\"p_sort\":\"new\",\"p_limit\":50,\"p_offset\":0,\"p_new_since\":\"__EARLY__\"}"
)

ONLY="${1:-}"
fail_existing=0; fail_new=0; schema_cache=0

for c in "${CELLS[@]}"; do
  IFS='|' read -r num desc kind body <<< "$c"
  [ -n "$ONLY" ] && [ "$ONLY" != "$num" ] && continue
  body="${body//__SINCE__/$SINCE}"; body="${body//__EARLY__/$EARLY}"

  out=$(curl -s -o /tmp/269b-cell.json -w '%{http_code} %{time_total}' \
        -X POST "$URL/rest/v1/rpc/search_catalog_by_vehicle" \
        -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
        -H 'Content-Type: application/json' -H 'Accept: application/json' \
        --data "$body" 2>/dev/null)
  code=${out%% *}; secs=${out##* }

  # 🔴 判讀只看**回應內容**,不看本腳本自己的字串(偵測器不得命中自己的輸入)
  err=""
  grep -q '57014' /tmp/269b-cell.json 2>/dev/null && err="57014"
  grep -q 'PGRST202' /tmp/269b-cell.json 2>/dev/null && err="PGRST202"

  slow=$(awk -v s="$secs" -v b="$BUDGET" 'BEGIN{print (s+0>b+0)?"SLOW":"ok"}')
  if [ "$code" = "200" ] && [ "$slow" = "ok" ]; then
    verdict="PASS"
  else
    verdict="FAIL"
    case "$err" in
      PGRST202) schema_cache=1 ;;
      *) [ "$kind" = existing ] && fail_existing=1 || fail_new=1 ;;
    esac
  fi
  printf '格%s [%s] http=%s %ss %s%s\n    %s\n' \
    "$num" "$verdict" "$code" "$secs" "$slow" "${err:+  err=$err}" "$desc"
done

echo "------------------------------------------------------------"
if [ "$schema_cache" = 1 ]; then
  echo "⚠️ 有格子回 PGRST202 = PostgREST schema cache 沒更新。"
  echo "   動作:重送 NOTIFY pgrst, 'reload schema' 再跑一次。**這不是 rollback 條件。**"
  echo "   (apply 前跑本腳本時,帶 p_new_since 的格子本來就會是這個 → 屬預期)"
fi
[ "$fail_existing" = 1 ] && { echo "🔴 格①或②失敗 = 既有型錄路徑壞了 ⇒ **rollback**"; \
  echo "   docs/reviews/2026-08-11-269b-rollback.sql 複製成新時戳 migration 後 db push"; }
[ "$fail_new" = 1 ] && { echo "🟠 格③④⑤⑥失敗 = 新品路徑不夠快,但今天沒人在用"; \
  echo "   ⇒ 開索引片(普通 CREATE INDEX、**不可 CONCURRENTLY**)、不接段二、**不 rollback**"; }
[ "$fail_existing" = 0 ] && [ "$fail_new" = 0 ] && [ "$schema_cache" = 0 ] && \
  echo "✅ 全格通過 ⇒ 段二解鎖(記得 T+20min 再跑一次格② — revalidate 900s)"
exit 0
