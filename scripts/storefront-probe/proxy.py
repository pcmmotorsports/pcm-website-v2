# G3 前綴代理:剝掉 /rest/v1 轉給 PostgREST(3969),並替身 /auth/v1 三條路由。
# 🔴 效度限定(runbook §8-f):替身【不驗密碼】,任何字串都登得進去。
#    ⇒ 不要拿這條鏈驗任何「擋不擋得住」的題目,它在那些題目上恆綠。
import http.server, urllib.request, urllib.error, json
UP = "http://127.0.0.1:3969"
USER = {"id": "11111111-1111-1111-1111-111111111111", "aud": "authenticated",
        "role": "authenticated", "email": "probe@example.com",
        "email_confirmed_at": "2026-01-01T00:00:00Z", "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z", "app_metadata": {"provider": "email"},
        "user_metadata": {}}
AUTH_JWT = open("/tmp/pcm-g3-probe/authjwt.txt").read().strip()
SESSION = {"access_token": AUTH_JWT, "token_type": "bearer", "expires_in": 3600,
           "expires_at": 4102444800, "refresh_token": "probe-refresh", "user": USER}

# 🔴 第二個客人(2026-08-18 加):**為了「換帳號」那一類題目**。
#    沒有第二個帳號時，「A 的收藏會不會漏給 B」「A 的東西會不會被 B 的動作刪掉」
#    這一族【構造不出來】—— 而構造不出來與「沒有這個 bug」在報告上長得一樣。
#    ⚠️ 仍然【不驗密碼】(見檔頭);它只是讓你【選得到】要當哪一個人:
#       登入時 email 填 probe2@example.com ⇒ 拿到乙的 session，其餘任何字串 ⇒ 甲。
USER2 = dict(USER, id="22222222-2222-2222-2222-222222222222", email="probe2@example.com")
AUTH_JWT2 = open("/tmp/pcm-g3-probe/authjwt2.txt").read().strip()
SESSION2 = {"access_token": AUTH_JWT2, "token_type": "bearer", "expires_in": 3600,
            "expires_at": 4102444800, "refresh_token": "probe-refresh2", "user": USER2}
# 這條鏈沒有真的 session store ⇒ 用一個「最後一次登入的是誰」的旗標，
# 讓 /auth/v1/user（Next server 端會打的那支）跟著切。
CURRENT = {"user": USER}

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
        if p in ("/auth/v1/token", "/auth/v1/signup"):
            email = ""
            if body:
                try: email = (json.loads(body) or {}).get("email", "") or ""
                except Exception: email = ""
            if email.strip().lower() == "probe2@example.com":
                CURRENT["user"] = USER2
                return self._json(200, SESSION2)
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

http.server.ThreadingHTTPServer(("127.0.0.1", 3968), H).serve_forever()
