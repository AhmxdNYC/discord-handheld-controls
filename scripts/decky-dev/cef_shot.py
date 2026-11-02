import asyncio, base64, json, sys, urllib.request, websockets
async def main(title, out):
    pages = json.load(urllib.request.urlopen("http://127.0.0.1:8080/json", timeout=3))
    url = next(p for p in pages if p["title"] == title)["webSocketDebuggerUrl"]
    async with websockets.connect(url, max_size=None) as ws:
        await ws.send(json.dumps({"id": 1, "method": "Page.captureScreenshot", "params": {"format": "png"}}))
        while True:
            m = json.loads(await ws.recv())
            if m.get("id") == 1: open(out, "wb").write(base64.b64decode(m["result"]["data"])); print(out); return
asyncio.run(main(sys.argv[1], sys.argv[2]))
