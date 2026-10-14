"""Small localhost OCR service for Korean Melon text captchas.

Install: python -m pip install ddddocr
Run: python local-services/melon_captcha_service.py
"""

from __future__ import annotations

import base64
import json
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import ddddocr


MAX_BODY_BYTES = 2_000_000
recognizer = ddddocr.DdddOcr(beta=True, show_ad=False)
recognizer_lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/health":
            self.write_json({"ok": False, "error": "Not found"}, 404)
            return
        self.write_json({"ok": True, "engine": "ddddocr-beta"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/ocr":
            self.write_json({"ok": False, "error": "Not found"}, 404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_BODY_BYTES:
                raise ValueError("Invalid image size")
            payload = json.loads(self.rfile.read(length))
            image = payload.get("image", "")
            if not isinstance(image, str) or not image.startswith("data:image/png;base64,"):
                raise ValueError("Expected a PNG data URL")
            image_bytes = base64.b64decode(image.split(",", 1)[1], validate=True)
            with recognizer_lock:
                raw = recognizer.classification(image_bytes)
            code = re.sub(r"[^A-Z]", "", str(raw).upper())
            if len(code) != 6:
                self.write_json({"ok": False, "text": code, "error": "Expected six letters"})
                return
            self.write_json({"ok": True, "text": code})
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            self.write_json({"ok": False, "error": str(error)}, 400)
        except Exception as error:
            self.write_json({"ok": False, "error": str(error)}, 500)

    def write_json(self, payload: dict, status: int = 200) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    print("Korean Melon OCR ready at http://127.0.0.1:17861", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 17861), Handler).serve_forever()
