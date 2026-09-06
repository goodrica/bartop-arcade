#!/usr/bin/env python3
"""CDP test harness for bartop-arcade: loads the page, captures console
messages + exceptions, inspects game state, and simulates clicks."""
import asyncio
import json
import sys
import urllib.request

import websockets

CDP_PORT = 9222
PAGE_URL = "http://127.0.0.1:8091/index.html"

msg_id = 0
console_logs = []
exceptions = []


async def send(ws, method, params=None, session_id=None):
    global msg_id
    msg_id += 1
    payload = {"id": msg_id, "method": method}
    if params:
        payload["params"] = params
    if session_id:
        payload["sessionId"] = session_id
    await ws.send(json.dumps(payload))
    this_id = msg_id
    while True:
        raw = await asyncio.wait_for(ws.recv(), timeout=15)
        data = json.loads(raw)
        if data.get("id") == this_id:
            return data.get("result", {})
        handle_event(data)


def handle_event(data):
    m = data.get("method", "")
    p = data.get("params", {})
    if m == "Runtime.consoleAPICalled":
        args = [a.get("value", a.get("description", "?")) for a in p.get("args", [])]
        console_logs.append(f"[{p.get('type')}] {' '.join(str(a) for a in args)}")
    elif m == "Runtime.exceptionThrown":
        d = p.get("exceptionDetails", {})
        text = d.get("text", "")
        exc = d.get("exception", {})
        desc = exc.get("description", exc.get("value", ""))
        url = d.get("url", "")
        line = d.get("lineNumber", "?")
        exceptions.append(f"{text} {desc} at {url}:{line}")


async def drain_events(ws, seconds):
    try:
        while True:
            raw = await asyncio.wait_for(ws.recv(), timeout=seconds)
            handle_event(json.loads(raw))
    except asyncio.TimeoutError:
        pass


async def evaluate(ws, session_id, expr):
    res = await send(ws, "Runtime.evaluate", {
        "expression": expr,
        "returnByValue": True,
        "awaitPromise": True,
    }, session_id)
    r = res.get("result", {})
    if "value" in r:
        return r["value"]
    return r.get("description", str(r))


async def click(ws, session_id, x, y):
    for t in ("mousePressed", "mouseReleased"):
        await send(ws, "Input.dispatchMouseEvent", {
            "type": t, "x": x, "y": y, "button": "left", "clickCount": 1,
        }, session_id)


async def main():
    # Find/create a target
    req = urllib.request.Request(
        f"http://127.0.0.1:{CDP_PORT}/json/new?about:blank", method="PUT")
    with urllib.request.urlopen(req) as r:
        target = json.load(r)
    ws_url = target["webSocketDebuggerUrl"]

    async with websockets.connect(ws_url, max_size=10 * 1024 * 1024) as ws:
        await send(ws, "Runtime.enable")
        await send(ws, "Page.enable")
        await send(ws, "Network.enable")
        await send(ws, "Network.setCacheDisabled", {"cacheDisabled": True})

        # Navigate
        await send(ws, "Page.navigate", {"url": PAGE_URL})
        await drain_events(ws, 3)

        print("=== CONSOLE LOGS ===")
        for l in console_logs:
            print(" ", l)
        print("=== EXCEPTIONS ===")
        for e in exceptions:
            print(" ", e)

        # Inspect page state
        print("\n=== PAGE STATE ===")
        print("title:", await evaluate(ws, None, "document.title"))
        print("canvas exists:", await evaluate(ws, None, "!!document.getElementById('gameCanvas')"))
        print("canvas size:", await evaluate(ws, None,
            "JSON.stringify({w: document.getElementById('gameCanvas').width, h: document.getElementById('gameCanvas').height, cssW: document.getElementById('gameCanvas').style.width, cssH: document.getElementById('gameCanvas').style.height})"))
        print("viewport:", await evaluate(ws, None,
            "JSON.stringify({w: window.innerWidth, h: window.innerHeight})"))

        # Import modules to check state
        print("\n=== MODULE STATE ===")
        eng = await evaluate(ws, None, """
            import('/js/engine.js')
              .then(m => JSON.stringify({ok: true, exports: Object.keys(m)}))
              .catch(e => JSON.stringify({ok: false, err: String(e)}))
        """)
        print("engine:", eng)
        game = await evaluate(ws, None, """
            import('/js/games/spot-the-difference.js')
              .then(m => JSON.stringify({ok: true, name: m.default?.name}))
              .catch(e => JSON.stringify({ok: false, err: String(e)}))
        """)
        print("game:", game)

        # Simulate a click in the middle of where the first game card should be
        # Canvas is 1080x1920 logical, scaled to fit viewport. Card 1: y 400-660, x 90-990.
        # Compute actual screen coords of card center (540, 530 logical).
        coords = await evaluate(ws, None, """
            (() => {
              const c = document.getElementById('gameCanvas');
              const r = c.getBoundingClientRect();
              const sx = r.width / 1080, sy = r.height / 1920;
              return JSON.stringify({
                cardX: r.left + 540 * sx,
                cardY: r.top + 530 * sy,
                rect: {left: r.left, top: r.top, w: r.width, h: r.height}
              });
            })()
        """)
        print("\n=== CLICK TARGET ===")
        print(coords)
        c = json.loads(coords)

        # Click the card
        await click(ws, None, c["cardX"], c["cardY"])
        await drain_events(ws, 2)

        print("\n=== POST-CLICK CONSOLE ===")
        for l in console_logs:
            print(" ", l)
        print("=== POST-CLICK EXCEPTIONS ===")
        for e in exceptions:
            print(" ", e)


asyncio.run(main())
