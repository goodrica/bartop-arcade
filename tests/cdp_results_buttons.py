#!/usr/bin/env python3
"""Verify results-screen buttons: Play Again and Menu."""
import asyncio, json, urllib.request
import websockets

CDP_PORT = 9222
PAGE_URL = "http://127.0.0.1:8091/index.html"
msg_id = 0
exceptions = []

async def send(ws, method, params=None):
    global msg_id
    msg_id += 1
    payload = {"id": msg_id, "method": method}
    if params: payload["params"] = params
    await ws.send(json.dumps(payload))
    this_id = msg_id
    while True:
        data = json.loads(await asyncio.wait_for(ws.recv(), timeout=20))
        if data.get("id") == this_id:
            return data.get("result", {})
        if data.get("method") == "Runtime.exceptionThrown":
            d = data["params"].get("exceptionDetails", {})
            exceptions.append(d.get("exception", {}).get("description", d.get("text", "")))

async def drain(ws, s):
    try:
        while True:
            data = json.loads(await asyncio.wait_for(ws.recv(), timeout=s))
            if data.get("method") == "Runtime.exceptionThrown":
                d = data["params"].get("exceptionDetails", {})
                exceptions.append(d.get("exception", {}).get("description", d.get("text", "")))
    except asyncio.TimeoutError:
        pass

async def ev(ws, expr):
    res = await send(ws, "Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True})
    return res.get("result", {}).get("value")

async def click_logical(ws, lx, ly):
    coords = json.loads(await ev(ws, f"""
        (() => {{
          const r = document.getElementById('gameCanvas').getBoundingClientRect();
          return JSON.stringify({{x: r.left + {lx} * r.width / 1080, y: r.top + {ly} * r.height / 1920}});
        }})()"""))
    for t in ("mousePressed", "mouseReleased"):
        await send(ws, "Input.dispatchMouseEvent", {"type": t, "x": coords["x"], "y": coords["y"], "button": "left", "clickCount": 1})

async def main():
    req = urllib.request.Request(f"http://127.0.0.1:{CDP_PORT}/json/new?about:blank", method="PUT")
    with urllib.request.urlopen(req) as r:
        target = json.load(r)
    async with websockets.connect(target["webSocketDebuggerUrl"], max_size=10*1024*1024) as ws:
        await send(ws, "Runtime.enable"); await send(ws, "Page.enable")
        await send(ws, "Network.enable")
        await send(ws, "Network.setCacheDisabled", {"cacheDisabled": True})
        await send(ws, "Page.navigate", {"url": PAGE_URL})
        await drain(ws, 3)

        # Start game, force game-over via time manipulation is not exposed;
        # instead simulate: start, wait splash, then spam wrong taps to drain 60s fast.
        await click_logical(ws, 540, 530)          # click card
        await asyncio.sleep(2.5)                    # splash
        # 12 wrong taps x 5s = 60s drained
        for i in range(13):
            await click_logical(ws, 60, 1000)      # bottom-left, rarely a diff
            await asyncio.sleep(0.12)
        await drain(ws, 1)
        screen = await ev(ws, "window.__bartopDebug.screen")
        print("after drain-taps screen:", screen)

        if screen == "results":
            # Test PLAY AGAIN (540, 1460)
            await click_logical(ws, 540, 1460)
            await drain(ws, 1)
            s2 = await ev(ws, "window.__bartopDebug.screen")
            print("after Play Again:", s2, "-> PASS" if s2 == "playing" else "-> FAIL")

            # Wait splash, drain again to results
            await asyncio.sleep(2.5)
            for i in range(13):
                await click_logical(ws, 60, 1000)
                await asyncio.sleep(0.12)
            await drain(ws, 1)
            s3 = await ev(ws, "window.__bartopDebug.screen")
            print("second results screen:", s3)

            # Test MENU button (540, 1620)
            await click_logical(ws, 540, 1620)
            await drain(ws, 1)
            s4 = await ev(ws, "window.__bartopDebug.screen")
            print("after Menu:", s4, "-> PASS" if s4 == "menu" else "-> FAIL")

            # And menu still clickable? Start game once more
            await click_logical(ws, 540, 530)
            await drain(ws, 1)
            s5 = await ev(ws, "window.__bartopDebug.screen")
            print("menu -> play again:", s5, "-> PASS" if s5 == "playing" else "-> FAIL")

        print("exceptions:", exceptions[:3] if exceptions else "none")

asyncio.run(main())
