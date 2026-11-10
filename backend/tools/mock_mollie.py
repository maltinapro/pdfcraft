#!/usr/bin/env python3
"""Local stand-in for the Mollie API (development and manual tests only).

    python3 backend/tools/mock_mollie.py [port]      # default 9200

Backend settings to use it:

    PAID_TOKENS_ENABLED=true MOLLIE_API_KEY=test_mock MOLLIE_API_URL=http://127.0.0.1:9200/v2 \\
    PUBLIC_URL=http://127.0.0.1:3000 MOLLIE_REDIRECT_URL=http://127.0.0.1:3000/app/ \\
    PAID_PRICES=starter:31=19.00

Create a payment with `POST /v1/checkout`, then "pay" it:

    curl -X POST http://127.0.0.1:9200/pay/<payment id>             # marks it paid, calls the webhook
    curl -X POST http://127.0.0.1:9200/renew/<subscription id>      # a recurring charge, calls the webhook

The mock follows the documented request/response shapes (payments, customers, subscriptions) and
keeps everything in memory. The webhook is called like Mollie does: `POST id=tr_…` (form), no signature.
"""
import json
import sys
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

payments, customers, subscriptions = {}, {}, {}
counter = {"n": 0}


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

    def do_GET(self):
        path = self.path.split("?")[0]
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
                "_links": {"checkout": {"href": f"https://www.mollie.com/checkout/mock/{pid}"}},
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
            return self.reply(200, {"payment": pid, "webhook": call_webhook(sub["webhookUrl"], pid)})
        self.reply(404, {"detail": "unknown id"})

    def log_message(self, fmt, *args):
        sys.stderr.write("mock-mollie: " + fmt % args + "\n")


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9200
    print(f"Mollie mock on http://127.0.0.1:{port}/v2")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
