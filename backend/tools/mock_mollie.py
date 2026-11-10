#!/usr/bin/env python3
"""Local stand-in for the Mollie API (development and manual tests only).

    python3 backend/tools/mock_mollie.py [port]      # default 9200

Environment: `MOCK_MOLLIE_HOST` (bind address, default 127.0.0.1) and `MOCK_MOLLIE_PUBLIC_URL` (base URL the
*browser* uses for the checkout page, default http://127.0.0.1:<port>).

Backend settings to use it:

    PAID_TOKENS_ENABLED=true MOLLIE_API_KEY=test_mock MOLLIE_API_URL=http://127.0.0.1:9200/v2 \\
    PUBLIC_URL=http://127.0.0.1:3000 MOLLIE_REDIRECT_URL=http://127.0.0.1:3000/app/ \\
    PAID_PRICES=starter:31=2.90

Browser: the `checkoutUrl` of `POST /v1/checkout` points to a fake checkout page of this mock (buttons "Pay"
and "Cancel", then it redirects back like Mollie); `GET /` lists payments and subscriptions with a "renew"
button. Or by hand, after `POST /v1/checkout`:

    curl -X POST http://127.0.0.1:9200/pay/<payment id>             # marks it paid, calls the webhook
    curl -X POST http://127.0.0.1:9200/renew/<subscription id>      # a recurring charge, calls the webhook

The mock follows the documented request/response shapes (payments, customers, subscriptions) and
keeps everything in memory. The webhook is called like Mollie does: `POST id=tr_…` (form), no signature.
"""
import html
import json
import os
import sys
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

payments, customers, subscriptions = {}, {}, {}
counter = {"n": 0}
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9200
PUBLIC = os.environ.get("MOCK_MOLLIE_PUBLIC_URL", f"http://127.0.0.1:{PORT}").rstrip("/")
PAGE = "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>Mollie mock</title><body style='font:16px system-ui;max-width:640px;margin:2rem auto;padding:0 1rem'>"


def new_id(prefix):
    counter["n"] += 1
    return f"{prefix}_mock{counter['n']:06d}"


def call_webhook(url, payment_id):
    data = f"id={payment_id}".encode()
    request = urllib.request.Request(url, data, {"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status
    except urllib.error.HTTPError as e:
        return e.code


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, body=None):
        raw = json.dumps(body if body is not None else {}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def body(self):
        length = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(length) or b"{}") if length else {}

    def authorized(self):
        if self.headers.get("Authorization", "").startswith("Bearer "):
            return True
        self.reply(401, {"status": 401, "title": "Unauthorized Request", "detail": "Missing authentication"})
        return False

    def page(self, body, status=200):
        raw = (PAGE + body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def redirect(self, url):
        self.send_response(303)
        self.send_header("Location", url)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def checkout_page(self, payment):
        e = html.escape
        amount = payment["amount"]
        pid = payment["id"]
        if payment["status"] != "open":
            return self.page(f"<h1>Mollie mock</h1><p>Payment {e(pid)} is {e(payment['status'])}.</p>")
        self.page(
            f"<h1>Mollie mock checkout</h1><p>{e(payment.get('description') or '')}</p>"
            f"<p><strong>{e(amount['value'])} {e(amount['currency'])}</strong>"
            f"{' (subscription: first payment)' if payment['sequenceType'] == 'first' else ''}</p>"
            f"<form method=post action='{PUBLIC}/checkout/{e(pid)}/pay' style='display:inline'><button>Pay</button></form> "
            f"<form method=post action='{PUBLIC}/checkout/{e(pid)}/cancel' style='display:inline'><button>Cancel</button></form>"
            "<p style='color:#666'>Local test stand-in, no real payment.</p>"
        )

    def index_page(self):
        e = html.escape
        rows = "".join(
            f"<li>{e(p['id'])}: {e(p['status'])}, {e(p['sequenceType'])}, {e(p['amount']['value'])} {e(p['amount']['currency'])}</li>"
            for p in payments.values()
        ) or "<li>none yet</li>"
        subs = "".join(
            f"<li>{e(s['id'])}: {e(s['status'])}, {e(s['amount']['value'])} every {e(s['interval'])} "
            + (f"<form method=post action='{PUBLIC}/renew/{e(s['id'])}?back=1' style='display:inline'><button>Simulate renewal</button></form>" if s["status"] == "active" else "")
            + "</li>"
            for s in subscriptions.values()
        ) or "<li>none yet</li>"
        self.page(f"<h1>Mollie mock</h1><h2>Payments</h2><ul>{rows}</ul><h2>Subscriptions</h2><ul>{subs}</ul>")

    def do_GET(self):
        path = self.path.split("?")[0]
        parts = path.strip("/").split("/")
        if path == "/":
            return self.index_page()
        if parts[0] == "checkout" and len(parts) == 2:
            if parts[1] in payments:
                return self.checkout_page(payments[parts[1]])
            return self.page("<p>Unknown payment.</p>", 404)
        if not self.authorized():
            return
        parts = path.strip("/").split("/")
        if parts[:2] == ["v2", "payments"] and len(parts) == 3 and parts[2] in payments:
            return self.reply(200, payments[parts[2]])
        if parts[:2] == ["v2", "customers"] and len(parts) == 5 and parts[3] == "subscriptions":
            sub = subscriptions.get(parts[4])
            if sub and sub["customerId"] == parts[2]:
                return self.reply(200, sub)
        self.reply(404, {"status": 404, "title": "Not Found", "detail": "No such resource"})

    def do_DELETE(self):
        if not self.authorized():
            return
        parts = self.path.split("?")[0].strip("/").split("/")
        if parts[:2] == ["v2", "customers"] and len(parts) == 5 and parts[3] == "subscriptions":
            sub = subscriptions.get(parts[4])
            if sub and sub["customerId"] == parts[2] and sub["status"] == "active":
                sub["status"] = "canceled"
                return self.reply(200, sub)
        self.reply(404, {"status": 404, "title": "Not Found", "detail": "No such subscription"})

    def do_POST(self):
        path = self.path.split("?")[0]
        parts = path.strip("/").split("/")
        if parts[0] == "checkout" and len(parts) == 3 and parts[1] in payments and parts[2] in ("pay", "cancel"):
            payment = payments[parts[1]]
            if payment["status"] == "open":
                payment["status"] = "paid" if parts[2] == "pay" else "canceled"
                if parts[2] == "pay":
                    call_webhook(payment["webhookUrl"], payment["id"])
            return self.redirect(payment["redirectUrl"])
        if parts[0] in ("pay", "renew"):
            return self.local(parts)
        if not self.authorized():
            return
        body = self.body()
        if path == "/v2/customers":
            cid = new_id("cst")
            customers[cid] = {"id": cid, "resource": "customer"}
            return self.reply(201, customers[cid])
        if path == "/v2/payments":
            pid = new_id("tr")
            payments[pid] = {
                "resource": "payment", "id": pid, "status": "open", "mode": "test",
                "amount": body["amount"], "description": body.get("description"),
                "metadata": body.get("metadata"), "sequenceType": body.get("sequenceType", "oneoff"),
                "customerId": body.get("customerId"), "webhookUrl": body["webhookUrl"],
                "redirectUrl": body["redirectUrl"],
                "_links": {"checkout": {"href": f"{PUBLIC}/checkout/{pid}"}},
            }
            return self.reply(201, payments[pid])
        if len(parts) == 4 and parts[1] == "customers" and parts[3] == "subscriptions":
            if parts[2] not in customers:
                return self.reply(404, {"status": 404, "detail": "No such customer"})
            sid = new_id("sub")
            subscriptions[sid] = {
                "resource": "subscription", "id": sid, "customerId": parts[2], "status": "active",
                "interval": body["interval"], "startDate": body["startDate"], "amount": body["amount"],
                "metadata": body.get("metadata"), "webhookUrl": body["webhookUrl"],
            }
            return self.reply(201, subscriptions[sid])
        self.reply(404, {"status": 404, "detail": "No such resource"})

    def local(self, parts):
        if parts[0] == "pay" and parts[1] in payments:
            payment = payments[parts[1]]
            payment["status"] = "paid"
            return self.reply(200, {"webhook": call_webhook(payment["webhookUrl"], payment["id"])})
        if parts[0] == "renew" and parts[1] in subscriptions:
            sub = subscriptions[parts[1]]
            if sub["status"] != "active":
                return self.reply(409, {"detail": "subscription is canceled"})
            pid = new_id("tr")
            payments[pid] = {
                "resource": "payment", "id": pid, "status": "paid", "mode": "test", "sequenceType": "recurring",
                "customerId": sub["customerId"], "subscriptionId": sub["id"], "amount": sub["amount"],
            }
            result = {"payment": pid, "webhook": call_webhook(sub["webhookUrl"], pid)}
            if "back=1" in self.path:
                return self.redirect(PUBLIC + "/")
            return self.reply(200, result)
        self.reply(404, {"detail": "unknown id"})

    def log_message(self, fmt, *args):
        sys.stderr.write("mock-mollie: " + fmt % args + "\n")


if __name__ == "__main__":
    host = os.environ.get("MOCK_MOLLIE_HOST", "127.0.0.1")
    print(f"Mollie mock on http://{host}:{PORT}/v2 (checkout pages: {PUBLIC})")
    ThreadingHTTPServer((host, PORT), Handler).serve_forever()
