#!/usr/bin/env python3
"""
TapPay **sandbox** 退款實測探針 v2(2026-08-03,Sean Q3=A 核准的硬閘 probe)。
v1(tappay-sandbox-refund-probe.py)保持原樣不動 —— 它的行號被審查紀錄引用。

v2 新增回答的問題(v1 從未送過 bank_refund_id):
  ① bank_refund_id:格式接受度 / 同鍵重複送(官方寫「不可重複」但行為從未實測)
  ② 同單「併發」重複退款(v1 只測過序列)
  ③ refund_amount 語意(本次退款額 vs 累計已退額;v1 未保存其值)
  ④ 10024(未請款)是否消耗 bank_refund_id(請款後同鍵重試 = 今晚 20:00 後的殘項)

安全設計(逐條、鏡像 v1):
  · **只打 sandbox**:host 寫死 sandbox.tappaysdk.com,送出前再斷言一次。
  · **身分閘**:merchant_id 必須 pcmmoto_CTBC,否則拒跑。
  · **金鑰絕不輸出**:partner_key 只進 request body/header;env 檔由腳本內部讀、不經 shell。
  · **金額閘**:charge 與 refund 金額一律 1-6 元(Sean 核准範圍),超出拒跑。
  · **每一發動作前後都 query**,不靠推測;被拒的呼叫逐欄比對零副作用。
  · race 模式用 threading.Barrier 對齊送出時點(沒有 barrier 的競賽測試不算數)。
"""
import json
import os
import ssl
import sys
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse

EXPECT_MERCHANT = "pcmmoto_CTBC"
HOST = "sandbox.tappaysdk.com"
QUERY_URL = f"https://{HOST}/tpc/transaction/query"
REFUND_URL = f"https://{HOST}/tpc/transaction/refund"
CHARGE_URL = f"https://{HOST}/tpc/payment/pay-by-prime"
ENV_PATH = "/Users/sean_1/pcm-website-v2/.env.tappay-sandbox"

# TapPay 官方 FAQ 提供的 sandbox 固定測試 prime(⚠️ 字面「未確認」—— 以第一次實打回應為準;
# 打不通就換路,不猜)。只在 sandbox 有效,無任何真卡意義。
TEST_PRIME = "test_3a2fb2b7e892b914a03c95dd4dd5dc7970c908df67a49527c0a648b2bc9"

RECORD_STATUS_NAMES = {-1: "ERROR", 0: "AUTH(已授權未請款)", 1: "OK(完成)",
                       2: "PARTIALREFUNDED", 3: "REFUNDED", 4: "PENDING", 5: "CANCEL"}


def load_env():
    if not os.path.exists(ENV_PATH):
        sys.exit(f"🔴 找不到 {ENV_PATH}")
    env = {}
    with open(ENV_PATH, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    key = env.get("TAPPAY_SANDBOX_PARTNER_KEY")
    mid = env.get("TAPPAY_SANDBOX_MERCHANT_ID")
    if not key or not mid:
        sys.exit("🔴 .env.tappay-sandbox 缺 PARTNER_KEY 或 MERCHANT_ID")
    if mid != EXPECT_MERCHANT:
        sys.exit(f"🔴 身分閘擋下 —— merchant_id 不是 {EXPECT_MERCHANT};拒跑")
    return key, mid


def post(url, payload, partner_key):
    host = urlparse(url).hostname or ""
    if host != HOST:                                    # 🔴 送出前最後一道:只准 sandbox
        sys.exit(f"🔴 端點不是 sandbox({host});拒跑")
    body = dict(payload)
    body["partner_key"] = partner_key                   # 只在這裡出現,不進任何輸出
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-api-key": partner_key},
        method="POST",
    )
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:                 # HTTP 非 2xx:讀 body 原文(不含金鑰)
        return {"_http_error": e.code, "_body": e.read().decode("utf-8", "replace")[:500]}


def guard_amount(n):
    if not (1 <= n <= 6):
        sys.exit(f"🔴 金額閘:{n} 不在 1-6 元核准範圍;拒跑")
    return n


def fmt_record(r):
    rs = r.get("record_status")
    return (f"  rec_trade_id={r.get('rec_trade_id')}  record_status={rs}"
            f"({RECORD_STATUS_NAMES.get(rs, '未知')})  is_captured={r.get('is_captured')}\n"
            f"  original_amount={r.get('original_amount')}  amount={r.get('amount')}"
            f"  refunded_amount={r.get('refunded_amount')}")


def show_record(partner_key, rec_id):
    out = post(QUERY_URL, {"filters": {"rec_trade_id": rec_id}, "records_per_page": 1}, partner_key)
    print(f"[Record] status={out.get('status')} msg={out.get('msg')!r}")
    recs = out.get("trade_records") or []
    if not recs:
        print(f"  🔴 查無 {rec_id}")
        return None
    print(fmt_record(recs[0]))
    return recs[0]


def show_refund_result(tag, out):
    print(f"[Refund{tag}] status={out.get('status')} msg={out.get('msg')!r}")
    for k in ("refund_id", "refund_amount", "is_captured", "bank_result_code", "bank_result_msg",
              "_http_error", "_body"):
        if k in out:
            print(f"  {k:<18} = {out.get(k)}")


def refund_payload(rec_id, brid, amount=None):
    p = {"rec_trade_id": rec_id, "bank_refund_id": brid}
    if amount is not None:
        p["amount"] = guard_amount(amount)
    return p


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__ + "\n用法: query <rec> | list | charge <amt> | "
                 "refund <rec> <amt> <brid> | refund-full <rec> <brid> | "
                 "race <rec> full-distinct|full-same <brid1> [brid2]")
    mode = sys.argv[1]
    partner_key, merchant_id = load_env()
    print(f"✅ 身分閘通過(merchant_id={merchant_id};partner_key 不輸出)\n")

    if mode == "query":
        show_record(partner_key, sys.argv[2])
        return

    if mode == "list":                                  # 唯讀:本 sandbox 商戶近 45 天 10 筆
        now_ms = int(time.time() * 1000)
        out = post(QUERY_URL, {"records_per_page": 10, "page": 0,
                               "filters": {"time": {"start_time": now_ms - 45 * 86400_000,
                                                    "end_time": now_ms}},
                               "order_by": {"attribute": "time", "is_descending": True}}, partner_key)
        print(f"[Record] status={out.get('status')} msg={out.get('msg')!r} "
              f"count={out.get('number_of_transactions')}")
        for r in out.get("trade_records") or []:
            print(fmt_record(r) + f"  time={r.get('time')}")
            print()
        return

    if mode == "charge":                                # 建新 sandbox 交易(測試用本金)
        amt = guard_amount(int(sys.argv[2]))
        out = post(CHARGE_URL, {
            "prime": TEST_PRIME,
            "merchant_id": merchant_id,
            "details": "PCM refund probe 2026-08-03",
            "amount": amt,
            "currency": "TWD",
            "cardholder": {"phone_number": "+886900000000", "name": "PCM Probe",
                           "email": "probe@pcmmotorsports.com"},
            "remember": False,
        }, partner_key)
        print(f"[Charge] status={out.get('status')} msg={out.get('msg')!r}")
        for k in ("rec_trade_id", "bank_transaction_id", "amount", "_http_error", "_body"):
            if k in out:
                print(f"  {k:<20} = {out.get(k)}")
        return

    if mode == "refund":
        rec_id, amt, brid = sys.argv[2], int(sys.argv[3]), sys.argv[4]
        print("動作前現況:"); before = show_record(partner_key, rec_id); print()
        out = post(REFUND_URL, refund_payload(rec_id, brid, amt), partner_key)
        show_refund_result("", out)
        print("\n動作後現況:"); show_record(partner_key, rec_id)
        return

    if mode == "refund-full":
        rec_id, brid = sys.argv[2], sys.argv[3]
        print("動作前現況:"); show_record(partner_key, rec_id); print()
        out = post(REFUND_URL, refund_payload(rec_id, brid), partner_key)   # 不帶 amount = 全額退
        show_refund_result("", out)
        print("\n動作後現況:"); show_record(partner_key, rec_id)
        return

    if mode == "race":                                  # 兩發併發(barrier 對齊送出時點)
        rec_id, submode, brid1 = sys.argv[2], sys.argv[3], sys.argv[4]
        brid2 = sys.argv[5] if len(sys.argv) > 5 else brid1
        if submode not in ("full-distinct", "full-same"):
            sys.exit(f"🔴 未知 race 模式:{submode}")
        if submode == "full-same":
            brid2 = brid1
        elif brid1 == brid2:
            sys.exit("🔴 full-distinct 需要兩把不同的 brid")
        print("動作前現況:"); show_record(partner_key, rec_id); print()
        barrier = threading.Barrier(2)
        results = [None, None]

        def fire(i, brid):
            payload = refund_payload(rec_id, brid)      # 全額退(不帶 amount)
            barrier.wait()                              # 兩執行緒到齊才同時送
            t0 = time.monotonic()
            out = post(REFUND_URL, payload, partner_key)
            results[i] = (brid, (time.monotonic() - t0) * 1000, out)

        ts = [threading.Thread(target=fire, args=(i, b)) for i, b in enumerate((brid1, brid2))]
        [t.start() for t in ts]; [t.join() for t in ts]
        for i, (brid, ms, out) in enumerate(results):
            print(f"\n── 執行緒 {i}(brid={brid}, {ms:.0f}ms)──")
            show_refund_result(f"#{i}", out)
        print("\n動作後現況:"); show_record(partner_key, rec_id)
        return

    sys.exit(f"🔴 未知模式:{mode}")


if __name__ == "__main__":
    main()
