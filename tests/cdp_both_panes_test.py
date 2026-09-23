#!/usr/bin/env python3
"""CDP test: taps register on BOTH photo panes, and the hand-edited pair plays.

Photo Hunt draws the reference photo on the left and the modified photo on the
right. Players tap whichever pane they are looking at, so both must score.

This drives a real Chrome (devtools port 9222) through six rounds, ending on
vehicles__truck — the pair imported from the hand-edited PSD — alternating the
pane each tap, and asserts:

  * a tap on the LEFT pane finds a difference
  * a tap on the RIGHT pane finds a difference
  * every round is winnable and the truck pair really loads
  * zero JS exceptions

Run:  python3 tests/cdp_both_panes_test.py
"""

import asyncio
import json
import urllib.request

import websockets

CDP_PORT = 9222
PAGE_URL = "http://127.0.0.1:8091/index.html"

# logical 1920x1080 canvas coordinates
MENU_CARD = (960, 380)          # the single game card
PLAY_AGAIN = (750, 850)         # left results button
PANE_DX = 936                   # right pane origin minus left pane origin

EXPECTED_PAIRS = [
    "animals__dog", "food__burger", "purchased__sierra-mountains",
    "purchased__tennis-girls", "vehicles__classic-car", "vehicles__truck",
]

msg_id = 0
exceptions = []
console = []
FAILS = []


def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))
    if not cond:
        FAILS.append(name)


def handle_event(data):
    m = data.get("method", "")
    p = data.get("params", {})
    if m == "Runtime.consoleAPICalled":
        console.append(" ".join(str(a.get("value", a.get("description", "?"))) for a in p.get("args", [])))
    elif m == "Runtime.exceptionThrown":
        d = p.get("exceptionDetails", {})
        exceptions.append(f"{d.get('text','')} {d.get('exception',{}).get('description','')}")


async def send(ws, method, params=None):
    global msg_id
    msg_id += 1
    payload = {"id": msg_id, "method": method}
    if params:
        payload["params"] = params
    await ws.send(json.dumps(payload))
    while True:
        data = json.loads(await asyncio.wait_for(ws.recv(), timeout=30))
        if data.get("id") == msg_id:
            return data.get("result", {})
        handle_event(data)


async def drain(ws, seconds):
    try:
        while True:
            handle_event(json.loads(await asyncio.wait_for(ws.recv(), timeout=seconds)))
    except (asyncio.TimeoutError, Exception):
        pass


async def ev(ws, expr):
    r = (await send(ws, "Runtime.evaluate",
                    {"expression": expr, "returnByValue": True, "awaitPromise": True})).get("result", {})
    return r.get("value", r.get("description"))


async def tap(ws, lx, ly):
    coords = json.loads(await ev(ws, f"""(() => {{
        const r = document.getElementById('gameCanvas').getBoundingClientRect();
        return JSON.stringify({{x: r.left + {lx} * r.width / 1920,
                                y: r.top  + {ly} * r.height / 1080}});
    }})()"""))
    for t in ("mousePressed", "mouseReleased"):
        await send(ws, "Input.dispatchMouseEvent",
                   {"type": t, "x": coords["x"], "y": coords["y"], "button": "left", "clickCount": 1})
    await asyncio.sleep(0.16)     # game debounces input at 100ms


async def game(ws):
    return json.loads(await ev(ws, "JSON.stringify(window.__bartopDebug.gameData)"))


async def diffs(ws):
    return json.loads(await ev(ws, "JSON.stringify(window.__photoHuntDebug() || [])"))


async def loaded_photos(ws):
    return json.loads(await ev(ws, """JSON.stringify(
        performance.getEntriesByType('resource').map(r => r.name)
            .filter(n => n.includes('/assets/photos/')).map(n => n.split('/').pop()))"""))


async def main():
    with urllib.request.urlopen(
            urllib.request.Request(f"http://127.0.0.1:{CDP_PORT}/json/new?about:blank", method="PUT")) as r:
        target = json.load(r)

    async with websockets.connect(target["webSocketDebuggerUrl"], max_size=20 * 1024 * 1024) as ws:
        await send(ws, "Runtime.enable")
        await send(ws, "Page.enable")
        await send(ws, "Network.enable")
        await send(ws, "Emulation.setDeviceMetricsOverride",
                   {"width": 1920, "height": 1080, "deviceScaleFactor": 1, "mobile": False})

        print("Load page and start Photo Hunt")
        await send(ws, "Page.navigate", {"url": PAGE_URL})
        await asyncio.gather(drain(ws, 3))
        check("page loaded with no exceptions", not exceptions, str(exceptions[:2]))
        await tap(ws, *MENU_CARD)
        await drain(ws, 1)
        screen = await ev(ws, "window.__bartopDebug.screen")
        check("game started", screen == "playing", f"screen={screen}")

        for round_no in range(1, 7):
            await asyncio.sleep(2.4)          # splash
            ds = await diffs(ws)
            gd = await game(ws)
            if round_no == 6:
                photos = await loaded_photos(ws)
                check("round 6 loaded the hand-edited truck pair",
                      any("vehicles__truck__edited" in p for p in photos)
                      and any(p.startswith("vehicles__truck.jpg") for p in photos),
                      ", ".join(sorted({p for p in photos if "truck" in p})))
            check(f"round {round_no} has 5 diffs", len(ds) == 5, f"{len(ds)} diffs")

            before = await game(ws)
            if round_no == 1:
                # Prove each pane scores independently, one tap at a time.
                await tap(ws, ds[0]["x"], ds[0]["y"])                      # LEFT pane
                gd = await game(ws)
                check("tap on the LEFT (reference) pane scores",
                      gd.get("found") == 1 and gd.get("wrongTaps") == 0,
                      f"found={gd.get('found')} wrong={gd.get('wrongTaps')}")
                await tap(ws, ds[1]["x"] + PANE_DX, ds[1]["y"])            # RIGHT pane
                gd = await game(ws)
                check("tap on the RIGHT (find changes) pane scores",
                      gd.get("found") == 2 and gd.get("wrongTaps") == 0,
                      f"found={gd.get('found')} wrong={gd.get('wrongTaps')}")
                check("a hit on either pane counts the same",
                      gd.get("score") == 200, f"score={gd.get('score')}")
                rest = ds[2:]
            else:
                rest = ds
            for i, d in enumerate(rest):
                # alternate panes: even taps on the LEFT (reference) photo, odd on the RIGHT
                pane_dx = 0 if i % 2 == 0 else PANE_DX
                await tap(ws, d["x"] + pane_dx, d["y"])
            gd = await game(ws)
            check(f"round {round_no} all 5 found and won",
                  gd.get("found") == 5 and gd.get("won") is True,
                  f"found={gd.get('found')} won={gd.get('won')} wrong={gd.get('wrongTaps')}")
            check(f"round {round_no} no wrong taps", gd.get("wrongTaps") == 0, f"{gd.get('wrongTaps')}")

            if round_no < 6:
                await tap(ws, *PLAY_AGAIN)
                await drain(ws, 0.8)

        check("no exceptions after six rounds", not exceptions, str(exceptions[:3]))

    print()
    if FAILS:
        print(f"RESULT: {len(FAILS)} FAILURE(S): {FAILS}")
        return 1
    print("RESULT: ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))