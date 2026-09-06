#!/usr/bin/env python3
"""Verify TOUCH events work (touchscreen simulation via CDP)."""
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

async def touch_logical(ws, lx, ly):
    coords = json.loads(await ev(ws, f"""
        (() => {{
          const r = document.getElementById('gameCanvas').getBoundingClientRect();
          return JSON.stringify({{x: r.left + {lx} * r.width / 1080, y: r.top + {ly} * r.height / 1920}});
        }})()"""))
    await send(ws, "Input.dispatchTouchEvent", {
        "type": "touchStart",
        "touchPoints": [{"x": coords["x"], "y": coords["y"]}]})
    await send(ws, "Input.dispatchTouchEvent", {
        "type": "touchEnd", "touchPoints": []})

async def main():
    req = urllib.request.Request(f"http://127.0.0.1:{CDP_PORT}/json/new?about:blank", method="PUT")
    with urllib.request.urlopen(req) as r:
        target = json.load(r)
    async with websockets.connect(target["webSocketDebuggerUrl"], max_size=10*1024*1024) as ws:
        await send(ws, "Runtime.enable"); await send(ws, "Page.enable")
        await send(ws, "Network.enable")
        await send(ws, "Network.setCacheDisabled", {"cacheDisabled": True})
        # Enable touch emulation
        await send(ws, "Emulation.setTouchEmulationEnabled", {"enabled": True})
        await send(ws, "Emulation.setEmitTouchEventsForMouse", {"enabled": False})
        await send(ws, "Page.navigate", {"url": PAGE_URL})
        await drain(ws, 3)

        screen0 = await ev(ws, "window.__bartopDebug.screen")
        print("initial screen:", screen0)

        # TOUCH the game card
        await touch_logical(ws, 540, 530)
        await drain(ws, 1)
        screen1 = await ev(ws, "window.__bartopDebug.screen")
        print("after TOUCH on card:", screen1, "-> PASS" if screen1 == "playing" else "-> FAIL")

        # Wait splash, touch inside scene
        await asyncio.sleep(2.5)
        before = json.loads(await ev(ws, "JSON.stringify(window.__bartopDebug.gameData)"))
        await touch_logical(ws, 200, 400)
        await drain(ws, 1)
        after = json.loads(await ev(ws, "JSON.stringify(window.__bartopDebug.gameData)"))
        registered = (after.get("wrongTaps",0) > before.get("wrongTaps",0)) or (after.get("found",0) > before.get("found",0))
        print(f"touch in scene registered: {registered} -> {'PASS' if registered else 'FAIL'}",
              f"(wrong {before.get('wrongTaps')}->{after.get('wrongTaps')}, found {before.get('found')}->{after.get('found')})")

        print("exceptions:", exceptions[:3] if exceptions else "none")

asyncio.run(main())
