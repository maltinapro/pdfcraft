#!/usr/bin/env python3
"""Local stand-in for the Deutsche Post Internetmarke APIs (development and manual tests only).

    python3 backend/tools/mock_internetmarke.py [port]      # default 9100

Backend settings to use it:

    INTERNETMARKE_ENABLED=true INTERNETMARKE_CLIENT_ID=id INTERNETMARKE_CLIENT_SECRET=secret \\
    INTERNETMARKE_SHIPPING_URL=http://127.0.0.1:9100/im/v1 \\
    INTERNETMARKE_PRODUCTS_URL=http://127.0.0.1:9100/products

Portokasse login: any e-mail with password `secret` (other passwords are rejected with 401);
`poor@example.com` has a balance of 1,00 EUR, everybody else 50,00 EUR. The mock answers the way the
OpenAPI spec describes it (the real service was not available for development) and keeps its
balances in memory only. Stamps are checkerboard placeholders, not valid franking marks.
"""
import json
import struct
import sys
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from urllib.parse import parse_qs, urlparse
from zipfile import ZIP_STORED, ZipFile

PRODUCTS = [
    {"extProductid": 1, "extProductname": "Standardbrief", "grossprice": 0.95, "transport": "national"},
    {"extProductid": 11, "extProductname": "Kompaktbrief", "grossprice": 1.10, "transport": "national"},
    {"extProductid": 21, "extProductname": "Großbrief", "grossprice": 1.80, "transport": "national"},
    {"extProductid": 31, "extProductname": "Maxibrief", "grossprice": 2.90, "transport": "national"},
    {"extProductid": 5, "extProductname": "Einschreiben Einwurf", "grossprice": 3.35, "transport": "national"},
    {"extProductid": 9, "extProductname": "Standardbrief International", "grossprice": 1.25, "transport": "international"},
]
wallets, files = {}, {}
counter = {"order": 4700, "voucher": 0}
PASSWORD = "secret"


def png(seed, width=472, height=283, dpi=300):
    """A placeholder stamp: border plus a pseudo-random block pattern, 300 dpi (40 x 24 mm)."""
    rows = []
    for y in range(height):
        row = bytearray([0])
        for x in range(width):
            border = x < 6 or y < 6 or x >= width - 6 or y >= height - 6
            block = (x // 12 * 31 + y // 12 * 17 + seed * 7) % 5 < 2 and 40 < x < 240 and 40 < y < 240
            row.append(0 if border or block else 255)
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows))
    ppm = round(dpi / 0.0254)

    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0))
        + chunk(b"pHYs", struct.pack(">IIB", ppm, ppm, 1))
        + chunk(b"IDAT", raw)
        + chunk(b"IEND", b"")
    )


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("mock-dp: " + (fmt % args) + "\n")

    def send(self, status, body, kind="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", kind)
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        return self.rfile.read(int(self.headers.get("content-length", 0)))

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/products":
            return self.send(200, {"shortSalesProducts": PRODUCTS})
        if path.startswith("/download/") and path[10:] in files:
            return self.send(200, files[path[10:]], "application/zip")
        self.send(404, {"title": "not found"})

    def do_POST(self):
        path = urlparse(self.path).path.removeprefix("/im/v1")
        if path == "/user":
            form = {k: v[0] for k, v in parse_qs(self.body().decode()).items()}
            if form.get("password") != PASSWORD:
                return self.send(401, {"error": "invalid_grant", "error_description": "wrong login"})
            user = form["username"]
            wallets.setdefault(user, 100 if user.startswith("poor@") else 5000)
            return self.send(200, {"access_token": "token-" + user, "walletBalance": wallets[user]})
        auth = self.headers.get("authorization", "")
        if not auth.startswith("Bearer token-"):
            return self.send(401, {"title": "unauthorized"})
        user = auth.removeprefix("Bearer token-")
        if path == "/app/shoppingcart":
            counter["order"] += 1
            return self.send(200, {"shopOrderId": str(counter["order"])})
        if path == "/app/shoppingcart/png":
            req = json.loads(self.body())
            if req["total"] > wallets[user]:
                return self.send(400, {"title": "walletBalanceNotEnough"})
            wallets[user] -= req["total"]
            vouchers, images = [], BytesIO()
            with ZipFile(images, "w", ZIP_STORED) as zf:
                for i, _ in enumerate(req["positions"]):
                    counter["voucher"] += 1
                    vouchers.append({"voucherId": "MOCK%06d" % counter["voucher"]})
                    zf.writestr("%d.png" % i, png(counter["voucher"]))
            name = req["shopOrderId"] + ".zip"
            files[name] = images.getvalue()
            return self.send(
                200,
                {
                    "link": f"http://{self.headers['host']}/download/{name}",
                    "shoppingCart": {"voucherList": vouchers},
                    "walletBallance": wallets[user],
                },
            )
        self.send(404, {"title": "not found"})


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9100
    print(f"mock Internetmarke on http://127.0.0.1:{port}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
