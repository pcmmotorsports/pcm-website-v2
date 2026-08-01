#!/usr/bin/env python3
"""
TapPay **sandbox** 退款實測探針 —— 回答兩個 PCM 從未測過的問題:
  ① Refund API 支不支援「多次部分退款」(Portal 已實證,API 側全未測)
  ② 超額退款會不會被 **API** 拒絕
     🔴 Portal 按鈕消失只證明介面擋住、不證明 API 會拒,而 API 才是我們要走的路。

用法:
  python3 tappay-sandbox-probe.py query                 # 唯讀:查交易現況
  python3 tappay-sandbox-probe.py refund <金額>          # 送出一筆部分退款
  python3 tappay-sandbox-probe.py plan                  # 印出打算怎麼測,不呼叫任何 API

安全設計(逐條):
  · **只打 sandbox**:端點寫死 sandbox.tappaysdk.com,並在送出前再斷言一次 host。
  · **身分閘**:merchant_id 必須是 pcmmoto_CTBC,否則拒跑(交接檔指定)。
  · **金鑰絕不輸出**:partner_key 只進 request body,任何 print/錯誤訊息都不含它。
  · **退款要顯式給金額**:沒有「全額退款」捷徑(不帶 amount = TapPay 的全額退款語意),
    避免手滑把整筆退掉而失去後續測試對象。
  · 每次呼叫都印出 TapPay 回的 status / msg 原文,不做任何「應該成功」的推測。
"""
import json
import os
import ssl
import sys
import urllib.request
from urllib.parse import urlparse

REC_TRADE_ID = "D202607314b3cIL"          # 交接檔指定的 sandbox 交易
EXPECT_MERCHANT = "pcmmoto_CTBC"          # 身分閘
QUERY_URL = "https://sandbox.tappaysdk.com/tpc/transaction/query"
REFUND_URL = "https://sandbox.tappaysdk.com/tpc/transaction/refund"
ENV_PATH = ".env.tappay-sandbox"


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
    if host != "sandbox.tappaysdk.com":                 # 🔴 送出前最後一道:只准 sandbox
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
    with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:   # 官方建議 30s
        return json.loads(resp.read().decode("utf-8"))


def show_record(partner_key):
    out = post(QUERY_URL, {
        "filters": {"rec_trade_id": REC_TRADE_ID},
        "records_per_page": 1,
    }, partner_key)
    print(f"[Record API] status={out.get('status')} msg={out.get('msg')!r}")
    recs = out.get("trade_records") or []
    if not recs:
        print("🔴 查無此交易(status 0/2 都代表查詢成功,與交易狀態無關)")
        return None
    r = recs[0]
    # record_status:-1 ERROR / 0 AUTH(已授權未請款)/ 1 OK / 2 PARTIALREFUNDED
    #               / 3 REFUNDED / 4 PENDING / 5 CANCEL
    names = {-1: "ERROR", 0: "AUTH(已授權未請款)", 1: "OK(完成)",
             2: "PARTIALREFUNDED", 3: "REFUNDED", 4: "PENDING", 5: "CANCEL"}
    rs = r.get("record_status")
    print(f"  rec_trade_id     = {r.get('rec_trade_id')}")
    print(f"  record_status    = {rs} ({names.get(rs, '未知')})")
    print(f"  is_captured      = {r.get('is_captured')}   ← 未請款不能部分退款(10024)")
    print(f"  original_amount  = {r.get('original_amount')}   ← 本來收多少(不受退款影響)")
    print(f"  amount           = {r.get('amount')}   ← 會因退款而減少")
    print(f"  refunded_amount  = {r.get('refunded_amount')}   ← 已退多少")
    for k in ("cap_millis", "time", "bank_transaction_id"):
        if k in r:
            print(f"  {k:<16} = {r.get(k)}")
    return r


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    mode = sys.argv[1]

    if mode == "plan":
        print(__doc__)
        print("測試順序(每步都先 query 再動作,不靠推測):")
        print("  1. query          → 確認 is_captured=True。False 就停,部分退款必回 10024")
        print("  2. refund <小額>   → 第一次部分退款")
        print("  3. query          → 確認 record_status 轉 2(PARTIALREFUNDED)、refunded_amount 增加")
        print("  4. refund <小額>   → 第二次部分退款 ⇒ 這一步回答「API 支不支援多次部分退」")
        print("  5. query          → 確認累計")
        print("  6. refund <超額>   → 剩餘額 +1 ⇒ 這一步回答「超額退款 API 會不會拒」")
        return

    partner_key, merchant_id = load_env()
    print(f"✅ 身分閘通過(merchant_id={merchant_id};partner_key 不輸出)\n")

    if mode == "query":
        show_record(partner_key)
        return

    if mode == "refund":
        if len(sys.argv) < 3:
            sys.exit("🔴 refund 必須顯式給金額(不帶 amount = TapPay 的全額退款語意)")
        amount = int(sys.argv[2])
        if amount <= 0:
            sys.exit("🔴 金額必須 > 0")
        print(f"→ 送出部分退款 amount={amount} 到 {REC_TRADE_ID}")
        out = post(REFUND_URL, {"rec_trade_id": REC_TRADE_ID, "amount": amount}, partner_key)
        print(f"[Refund API] status={out.get('status')} msg={out.get('msg')!r}")
        for k in ("refund_id", "refund_amount", "is_captured",
                  "bank_result_code", "bank_result_msg"):
            if k in out:
                print(f"  {k:<18} = {out.get(k)}")
        print()
        print("退款後現況:")
        show_record(partner_key)
        return

    sys.exit(f"🔴 未知模式:{mode}")


if __name__ == "__main__":
    main()
