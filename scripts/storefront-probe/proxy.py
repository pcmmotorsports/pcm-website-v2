# G3 前綴代理:剝掉 /rest/v1 轉給 PostgREST(3969),並替身 /auth/v1 三條路由。
# 🔴 效度限定(runbook §8-f):替身【不驗密碼】,任何字串都登得進去。
#    ⇒ 不要拿這條鏈驗任何「擋不擋得住」的題目,它在那些題目上恆綠。
import http.server, urllib.request, urllib.error, json, os, base64, hmac, hashlib, subprocess
# 🔴 2026-08-19:原本這兩個 JWT 路徑寫死成 `/tmp/pcm-g3-probe/...`。
#    `up.sh` 會把本檔【複製進】那個資料目錄再跑(`cp "$SP/proxy.py" $S/proxy.py`)
#    ⇒ 用「本檔自己的所在目錄」就永遠對得上,而路徑可覆寫時也不用另外傳參數。
#    (寫死的話,`STOREFRONT_PROBE_DIR` 一換,這支會 FileNotFoundError 而整條鏈掛在啟動處。)
S = os.path.dirname(os.path.abspath(__file__))
# 🔴🔴 **2026-08-19:上游埠與監聽埠改成 argv,原本兩個都寫死。**
#    埠參數化那一片實測撞到:`STOREFRONT_PROBE_PROXY=3978 STOREFRONT_PROBE_PREST=3979` 起了鑽機之後,
#    這支仍然**聽在 3968、轉給 3969** ⇒ 覆寫的那組裡代理根本不在,而它轉去的是一個空的埠。
#    🔴 而 `up.sh` 的自檢那時印的是 `web: 200` —— **頁面確實回 200,只是資料路徑是斷的**
#      ⇒ 「200」在這裡分不出兩個世界。(同族:`admin-probe` 的 proxy.py 早就吃 argv,所以它沒事。)
#    ⚠️ 沒帶參數時仍用舊值,讓舊的呼叫方式不會當場壞掉。
#    🔴🔴 **沒帶參數 ⇒ 直接報錯,不落回預設**(W6 `W6-06x` Q1 裁,主視窗同向)。
#    理由不是偏好,是**兩種失敗的形狀**:
#      預設值錯   ⇒ 代理轉去空的上游 ⇒ 頁面回 200 ⇒ **靜默,而且看起來是綠的**(上面 A 那格)
#      沒帶就報錯 ⇒ 起不來、當場說原因 ⇒ **吵,而且在第一秒**
#    ⇒ **沉默的預設值正是這一格的病因本身。**
#    (量過:`git grep 'proxy\.py'` 的呼叫端全部都帶參數,那個預設值不服務任何人。)
import sys
if len(sys.argv) < 5:
    sys.exit("proxy.py 需要四個參數:<上游 PostgREST 埠> <本身監聽埠> <JWT secret> <PG 埠>。"
             "不帶參數【不會】落回預設 —— 靜靜落回預設會讓代理轉去一個空的上游,"
             "而頁面照樣回 200。用法見 scripts/storefront-probe/env.sh。")
UP_PORT = sys.argv[1]
LISTEN_PORT = int(sys.argv[2])
# 🔴 後兩個是「任意 email 註冊」那片要的(2026-08-21 B 窗加,見下方 _mint_user 那段):
#    secret 用來【當場簽】一顆 sub 是新使用者的 JWT;PG 埠用來把那個人真的寫進 DB。
#    照本檔既有教義:沒帶就報錯 —— 落回預設會讓「註冊」看起來成功而那個人不存在,
#    那正是本片要修掉的病(改之前:任何 email 都回同一個種子帳號)。
JWT_SECRET = sys.argv[3].encode()
PG_PORT = sys.argv[4]
UP = "http://127.0.0.1:" + str(UP_PORT)
USER = {"id": "11111111-1111-1111-1111-111111111111", "aud": "authenticated",
        "role": "authenticated", "email": "probe@example.com",
        "email_confirmed_at": "2026-01-01T00:00:00Z", "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z", "app_metadata": {"provider": "email"},
        "user_metadata": {}}
AUTH_JWT = open(os.path.join(S, "authjwt.txt")).read().strip()
SESSION = {"access_token": AUTH_JWT, "token_type": "bearer", "expires_in": 3600,
           "expires_at": 4102444800, "refresh_token": "probe-refresh", "user": USER}

# 🔴 第二個客人(2026-08-18 加):**為了「換帳號」那一類題目**。
#    沒有第二個帳號時，「A 的收藏會不會漏給 B」「A 的東西會不會被 B 的動作刪掉」
#    這一族【構造不出來】—— 而構造不出來與「沒有這個 bug」在報告上長得一樣。
#    ⚠️ 仍然【不驗密碼】(見檔頭);它只是讓你【選得到】要當哪一個人:
#       登入時 email 填 probe2@example.com ⇒ 拿到乙的 session，其餘任何字串 ⇒ 甲。
USER2 = dict(USER, id="22222222-2222-2222-2222-222222222222", email="probe2@example.com")
AUTH_JWT2 = open(os.path.join(S, "authjwt2.txt")).read().strip()
SESSION2 = {"access_token": AUTH_JWT2, "token_type": "bearer", "expires_in": 3600,
            "expires_at": 4102444800, "refresh_token": "probe-refresh2", "user": USER2}
# 這條鏈沒有真的 session store ⇒ 用一個「最後一次登入的是誰」的旗標，
# 讓 /auth/v1/user（Next server 端會打的那支）跟著切。
CURRENT = {"user": USER}

# ─────────────────────────────────────────────────────────────────────────────
# 🔴 任意 email ⇒ 自己的帳號(2026-08-21 B 窗;主視窗派工「甲」)
#
# 改之前的行為(實測,不是推的):`probe2@example.com` 以外的**任何** email 都回甲。
#     alice-b7@example.com ⇒ user.id 1111…1111 / email probe@example.com
#     bob-b7@example.com   ⇒ user.id 1111…1111 / email probe@example.com
# ⇒ 「註冊成功並落地 /account」這件事,**證明的是導向沒斷,不證明帳號被建立**
#    —— 而這兩件事在畫面上長得一模一樣。整族「註冊 / 換帳號 / 我的資料是不是我的」
#    在這條鏈上【構造不出來】,而構造不出來與「沒有這個 bug」在報告上也長得一樣。
#
# ⚠️ 這【不是】把替身變成真的 GoTrue:
#    · 仍然**不驗密碼**(檔頭那條限定原封不動)⇒ 不要拿這條鏈驗任何「擋不擋得住」的題目。
#    · 沒有 email 驗證、沒有 rate limit、沒有重複註冊擋。
#    · 它只保證一件事:**不同的 email 是不同的人,而那個人在 DB 裡真的存在。**
# ─────────────────────────────────────────────────────────────────────────────
def _uuid_for(email):
    """email → 穩定 uuid(同一個 email 每次都同一個人,重開鑽機也一樣)。
    md5 只是拿來當**確定性雜湊**,不是安全用途 —— 這是拋棄式探針。"""
    h = hashlib.md5(email.strip().lower().encode()).hexdigest()
    return "%s-%s-%s-%s-%s" % (h[0:8], h[8:12], h[12:16], h[16:20], h[20:32])

def _sign(sub):
    b64 = lambda d: base64.urlsafe_b64encode(d).rstrip(b"=")
    h = b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    p = b64(json.dumps({"iss": "pcm-g3", "exp": 4102444800, "role": "authenticated",
                        "aud": "authenticated", "sub": sub}, separators=(",", ":")).encode())
    return (h + b"." + p + b"." + b64(hmac.new(JWT_SECRET, h + b"." + p, hashlib.sha256).digest())).decode()

def _sql(stmt):
    """走 psql 而不是 PostgREST:要寫的是 `auth.users`,那個 schema 沒有被 REST 暴露。
    回 True/False —— 🔴 失敗要讓呼叫端看得見,不能吞:吞掉的話「註冊成功但 DB 沒有這個人」
    會回到本片一開始要修的那個形狀(畫面成功、事實沒有)。"""
    r = subprocess.run(["psql", "-h", "127.0.0.1", "-p", PG_PORT, "-U", "postgres",
                        "-v", "ON_ERROR_STOP=1", "-q", "-c", stmt],
                       capture_output=True, text=True)
    if r.returncode != 0:
        print("[proxy] psql 失敗 rc=%s: %s" % (r.returncode, (r.stderr or "").strip()[:400]), flush=True)
    return r.returncode == 0

def _q(v):
    return "'" + str(v).replace("'", "''") + "'"

def _user_exists(email):
    """這個 email 在 DB 裡有沒有人。**登入路徑專用** —— 註冊路徑不呼叫它(註冊本來就是要建人)。
    🔴 查不到與查詢失敗要分得開:psql 失敗回 rc!=0 ⇒ 這裡回 False 會把「DB 壞了」說成「沒這個人」,
       而那會讓登入在 DB 壞掉時回 400(看起來像帳密錯) ⇒ 所以失敗時明白地拋,由呼叫端回 500。"""
    r = subprocess.run(["psql", "-h", "127.0.0.1", "-p", PG_PORT, "-U", "postgres",
                        "-t", "-A", "-c",
                        "SELECT count(*) FROM auth.users WHERE lower(email) = lower(%s);" % _q(email)],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError("probe proxy: 存在性查詢失敗: " + (r.stderr or "").strip()[:200])
    return (r.stdout or "").strip() not in ("", "0")

def _mint_user(email, name, phone):
    """把這個 email 變成一個【真的存在於 DB】的人,回 (user, session) 或 None。"""
    uid = _uuid_for(email)
    nm = name or email.split("@")[0]
    ok = _sql(
        "INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES "
        "(%s, %s, jsonb_build_object('name', %s)) ON CONFLICT (id) DO NOTHING; "
        "INSERT INTO customers (user_id, email, name, phone, tier) VALUES "
        "(%s, %s, %s, %s, 'general') ON CONFLICT (user_id) DO NOTHING;"
        % (_q(uid), _q(email), _q(nm), _q(uid), _q(email), _q(nm), _q(phone or "0900000000")))
    if not ok:
        return None
    u = dict(USER, id=uid, email=email, user_metadata={"name": nm})
    sess = {"access_token": _sign(uid), "token_type": "bearer", "expires_in": 3600,
            "expires_at": 4102444800, "refresh_token": "probe-refresh-" + uid[:8], "user": u}
    return u, sess

class H(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *a): pass
    def _json(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def _auth(self, body):
        p = self.path.split("?")[0]
        if p == "/auth/v1/user": return self._json(200, CURRENT["user"])
        # 🔴🔴 **登入與註冊【分家】**(2026-08-21 `-04` SP-2 must-fix)。
        #   原本兩條路共用一個分支 ⇒ 拿一個【不存在的 email 登入】會靜靜把那個人建出來。
        #   ⚠️ 檔頭那條限定蓋不住它:`:2` 說的是「不驗**密碼**」,不是「不驗**存在性**」
        #   ⇒ 整族「不存在的帳號不該登得進去」「別人的 email 我不該登得進去」在這條鏈上
        #     **構造不出來**,而構造不出來與「沒有這個 bug」在報告上長得一樣。
        if p in ("/auth/v1/token", "/auth/v1/signup"):
            is_signup = (p == "/auth/v1/signup")
            email = ""
            if body:
                try: email = (json.loads(body) or {}).get("email", "") or ""
                except Exception: email = ""
            e = email.strip().lower()
            if e == "probe2@example.com":
                CURRENT["user"] = USER2
                return self._json(200, SESSION2)
            # 🔴 空 email(或 body 壞掉)才落回甲 —— 那是「呼叫端沒給我 email」,
            #    不是「這是一個新客人」。兩者分開,否則壞掉的 body 會安靜地變成一個新帳號。
            if e and e != "probe@example.com" and not is_signup:
                # 登入:**只認已經存在的人**。不存在 ⇒ 400,不建立。
                if not _user_exists(e):
                    return self._json(400, {"error": "invalid_grant",
                                            "error_description": "probe proxy: 這個 email 沒有帳號(登入不會建立帳號)"})
                minted = _mint_user(e, None, None)   # 已存在 ⇒ ON CONFLICT DO NOTHING,只是取回他的 session
                if minted is None:
                    return self._json(500, {"message": "probe proxy: 無法取得 " + e + " 的 session"})
                CURRENT["user"] = minted[0]
                return self._json(200, minted[1])
            if e and e != "probe@example.com":
                meta = {}
                if body:
                    try:
                        d = json.loads(body) or {}
                        meta = (d.get("data") or d.get("options", {}).get("data") or {}) or {}
                    except Exception:
                        meta = {}
                minted = _mint_user(e, meta.get("name"), meta.get("phone"))
                if minted is None:
                    # DB 寫不進去 ⇒ **回錯,不要退回甲**。退回甲就是把失敗偽裝成成功。
                    return self._json(500, {"message": "probe proxy: 無法在 DB 建立 " + e})
                CURRENT["user"] = minted[0]
                return self._json(200, minted[1])
            CURRENT["user"] = USER
            return self._json(200, SESSION)
        if p == "/auth/v1/logout":
            self.send_response(204); self.send_header("Content-Length", "0"); self.end_headers(); return
        return self._json(404, {"message": "probe proxy: no route " + p})
    def _rest(self, method, body):
        path = self.path
        if path.startswith("/rest/v1"): path = path[len("/rest/v1"):] or "/"
        req = urllib.request.Request(UP + path, data=body, method=method)
        for k, v in self.headers.items():
            if k.lower() in ("host", "content-length", "connection"): continue
            req.add_header(k, v)
        try:
            with urllib.request.urlopen(req) as r:
                data = r.read(); self.send_response(r.status)
                for k, v in r.headers.items():
                    if k.lower() in ("transfer-encoding", "connection", "content-length"): continue
                    self.send_header(k, v)
                self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
        except urllib.error.HTTPError as e:
            data = e.read(); self.send_response(e.code)
            self.send_header("Content-Type", e.headers.get("Content-Type", "application/json"))
            self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
    def _go(self, method):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n else None
        if self.path.startswith("/auth/v1"): return self._auth(body)
        return self._rest(method, body)
    def do_GET(self): self._go("GET")
    def do_POST(self): self._go("POST")
    def do_PATCH(self): self._go("PATCH")
    def do_DELETE(self): self._go("DELETE")
    def do_HEAD(self): self._go("HEAD")

http.server.ThreadingHTTPServer(("127.0.0.1", LISTEN_PORT), H).serve_forever()
