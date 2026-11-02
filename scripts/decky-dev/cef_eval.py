import asyncio, json, sys, urllib.request, websockets
async def main(js):
    pages = json.load(urllib.request.urlopen("http://127.0.0.1:8080/json", timeout=3))
    url = next(p for p in pages if p["title"] == "SharedJSContext")["webSocketDebuggerUrl"]
    async with websockets.connect(url, max_size=None) as ws:
        await ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {"expression": js, "returnByValue": True, "awaitPromise": True}}))
        while True:
            m = json.loads(await ws.recv())
            if m.get("id") == 1: print(json.dumps(m.get("result"))[:1500]); return
asyncio.run(main(sys.argv[1]))
