#!/usr/bin/env python3
"""
TapPay **sandbox** 3DS 探針:Record 已 `-1/5` 之後,舊 payment_url 還能不能完成 OTP?

真權威 = docs/specs/2026-08-10-l4-stale-3ds-url-probe-plan.md(動手前已落檔,含三分支先寫死)。
觸發 = codex 關卡2 F1 對 `ed57f67a`;主視窗 P-269-A 裁 B。

本腳本**只負責 API 側**(建 3DS 交易 / 查 Record / 退款);
「在 3DS 頁按取消」「回舊 URL 送 OTP」那兩步是瀏覽器行為,由呼叫者驅動,腳本提供:
    create  → 建一筆 3DS 交易,印 payment_url + rec_trade_id(給瀏覽器用)
    query   → 查某筆 rec_trade_id 當下的 record_status(唯一權威,不看頁面長相)
    refund  → 退掉某筆(收工清乾淨)

安全設計(逐條鏡像 tappay-sandbox-refund-probe2.py 的家規):
  · **只打 sandbox**:host 寫死 sandbox.tappaysdk.com,送出前再斷言一次。
  · **身分閘**:merchant_id 必須 pcmmoto_CTBC,否則拒跑。
  · **金鑰絕不輸出**:partner_key 只進 header,不入 stdout/log;env 由腳本內部讀、不經 shell。
  · **金額閘**:1-6 元,超出拒跑。
  · **每一發動作前後都 query**,不靠推測。
  · 不碰正式站、不碰 PCM DB —— 全程 TapPay sandbox + 本腳本。
"""
import json
import ssl
import sys
import urllib.error
import urllib.request

EXPECT_MERCHANT = "pcmmoto_CTBC"
HOST = "sandbox.tappaysdk.com"
QUERY_URL = f"https://{HOST}/tpc/transaction/query"
REFUND_URL = f"https://{HOST}/tpc/transaction/refund"
CHARGE_URL = f"https://{HOST}/tpc/payment/pay-by-prime"
ENV_PATH = "/Users/sean_1/pcm-website-v2/.env.tappay-sandbox"

# 官方 sandbox 固定測試 prime(同 refund probe v2 用的那把;⚠️ 打不通就換路,不猜)
TEST_PRIME = "test_3a2fb2b7e892b914a03c95dd4dd5dc7970c908df67a49527c0a648b2bc9"

RECORD_STATUS_NAMES = {-1: "ERROR", 0: "AUTH(已授權未請款)", 1: "OK(完成)",
                       2: "PARTIALREFUNDED", 3: "REFUNDED", 4: "PENDING", 5: "CANCEL"}


def load_env():
    """env 由腳本內部讀,絕不經 shell(memory:source .env 曾真的外洩一把 secret)。"""
    vals = {}
    with open(ENV_PATH, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            vals[k.strip()] = v.strip().strip('"').strip("'")
    key = vals.get("TAPPAY_SANDBOX_PARTNER_KEY")
    mid = vals.get("TAPPAY_SANDBOX_MERCHANT_ID")
    if not key or not mid:
        sys.exit("🔴 env 缺 TAPPAY_SANDBOX_PARTNER_KEY / TAPPAY_SANDBOX_MERCHANT_ID")
    if mid != EXPECT_MERCHANT:
        sys.exit(f"🔴 身分閘:merchant_id={mid},期望 {EXPECT_MERCHANT} —— 拒跑")
    return key, mid


def post(url, key, body):
    if urllib.parse.urlparse(url).hostname != HOST:  # noqa: F821 (見下方 import)
        sys.exit(f"🔴 sandbox 閘:目標 host 非 {HOST} —— 拒送")
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json", "x-api-key": key},
        method="POST",
    )
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return {"_http_error": e.code, "_body": e.read().decode()[:500]}


def redact(obj):
    """回應可能夾帶敏感欄;只印我們要看的那幾欄,其餘丟掉(不整包 dump)。"""
    keep = ("status", "msg", "rec_trade_id", "bank_transaction_id", "payment_url",
            "record_status", "amount", "original_amount", "refunded_amount",
            "is_captured", "auth_code", "number_of_transactions", "_http_error", "_body")
    if isinstance(obj, dict):
        return {k: obj[k] for k in keep if k in obj}
    return obj


def cmd_create(key, mid, amount):
    if not (1 <= amount <= 6):
        sys.exit("🔴 金額閘:只允許 1-6 元")
    body = {
        "prime": TEST_PRIME,
        "partner_key": key,
        "merchant_id": mid,
        "amount": amount,
        "currency": "TWD",
        "details": "L4 stale-3ds-url probe",
        "cardholder": {"phone_number": "+886900000000", "name": "L4 Probe",
                       "email": "l4probe@example.com"},
        # 🔴 3DS 啟動:回 payment_url 跳轉、不請款
        "three_domain_secret": True,
        "result_url": {
            "frontend_redirect_url": "https://example.com/l4-probe/front",
            "backend_notify_url": "https://example.com/l4-probe/back",
        },
    }
    res = post(CHARGE_URL, key, body)
    print(json.dumps(redact(res), ensure_ascii=False, indent=2))


def cmd_query(key, mid, rec):
    body = {"partner_key": key, "filters": {"rec_trade_id": rec},
            "records_per_page": 5, "page": 0, "order_by": {"attribute": "time", "is_descending": True}}
    res = post(QUERY_URL, key, body)
    out = {"status": res.get("status"), "msg": res.get("msg"),
           "number_of_transactions": res.get("number_of_transactions")}
    for tr in (res.get("trade_records") or [])[:3]:
        rs = tr.get("record_status")
        out.setdefault("records", []).append({
            "rec_trade_id": tr.get("rec_trade_id"),
            "record_status": rs,
            "record_status_name": RECORD_STATUS_NAMES.get(rs, "?"),
            "amount": tr.get("amount"),
            "original_amount": tr.get("original_amount"),
            "refunded_amount": tr.get("refunded_amount"),
            "auth_code": tr.get("auth_code"),
        })
    print(json.dumps(out, ensure_ascii=False, indent=2))


def cmd_refund(key, mid, rec, bank_refund_id):
    body = {"partner_key": key, "rec_trade_id": rec, "bank_refund_id": bank_refund_id}
    res = post(REFUND_URL, key, body)
    print(json.dumps(redact(res), ensure_ascii=False, indent=2))


def main():
    import urllib.parse as _up
    globals()["urllib"].parse = _up  # post() 用得到
    key, mid = load_env()
    if len(sys.argv) < 2:
        sys.exit("用法:create <amount> | query <rec_trade_id> | refund <rec_trade_id> <bank_refund_id>")
    cmd = sys.argv[1]
    if cmd == "create":
        cmd_create(key, mid, int(sys.argv[2]) if len(sys.argv) > 2 else 1)
    elif cmd == "query":
        cmd_query(key, mid, sys.argv[2])
    elif cmd == "refund":
        cmd_refund(key, mid, sys.argv[2], sys.argv[3])
    else:
        sys.exit(f"未知子命令:{cmd}")


if __name__ == "__main__":
    main()
