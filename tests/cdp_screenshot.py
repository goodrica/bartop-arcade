#!/usr/bin/env python3
"""Capture screenshots of menu + gameplay."""
import asyncio, json, base64, urllib.request
import websockets

CDP_PORT = 9222
PAGE_URL = "http://127.0.0.1:8091/index.html"
msg_id = 0

async def send(ws, method, params=None):
    global msg_id
    msg_id += 1
    payload = {"id": msg_id, "method": method}
    if params: payload["params"] = params
    await ws.send(json.dumps(payload))
    this_id = msg_id
    while True:
        data = json.loads(await asyncio.wait_for(ws.recv(), timeout=30))
        if data.get("id") == this_id:
            return data.get("result", {})

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

async def shot(ws, path):
    res = await send(ws, "Page.captureScreenshot", {"format": "png"})
    with open(path, "wb") as f:
        f.write(base64.b64decode(res["data"]))
    print("saved", path)

async def main():
    req = urllib.request.Request(f"http://127.0.0.1:{CDP_PORT}/json/new?about:blank", method="PUT")
    with urllib.request.urlopen(req) as r:
        target = json.load(r)
    async with websockets.connect(target["webSocketDebuggerUrl"], max_size=50*1024*1024) as ws:
        await send(ws, "Runtime.enable"); await send(ws, "Page.enable")
        await send(ws, "Network.enable")
        await send(ws, "Network.setCacheDisabled", {"cacheDisabled": True})
        # Portrait viewport like a touchscreen
        await send(ws, "Emulation.setDeviceMetricsOverride", {
            "width": 540, "height": 960, "deviceScaleFactor": 1, "mobile": True})
        await send(ws, "Page.navigate", {"url": PAGE_URL})
        await asyncio.sleep(3)
        await shot(ws, "/tmp/arcade_menu.png")
        await click_logical(ws, 540, 530)
        await asyncio.sleep(1)
        await shot(ws, "/tmp/arcade_splash.png")
        await asyncio.sleep(2)
        await shot(ws, "/tmp/arcade_gameplay.png")

asyncio.run(main())
