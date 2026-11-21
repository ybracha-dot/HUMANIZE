"""Browser regression. Requires Python Playwright and a local Chromium binary."""
import asyncio
import functools
import os
from pathlib import Path
import shutil
import tempfile
from threading import Thread
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.async_api import async_playwright

async def until(page, expression, timeout=10.0):
    """Poll with page.evaluate (CDP). wait_for_function needs eval, which extension pages' CSP blocks."""
    loop = asyncio.get_running_loop()
    end = loop.time() + timeout
    while loop.time() < end:
        if await page.evaluate(f"() => !!({expression})"):
            return
        await asyncio.sleep(0.1)
    raise TimeoutError(expression)

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

async def main():
    ext = Path(__file__).resolve().parents[1]
    executable = os.getenv("CHROMIUM_PATH") or shutil.which("chromium") or shutil.which("google-chrome")
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        (base / "editor.html").write_text("""<textarea id="doc" autofocus></textarea><script>
        const ed = document.querySelector('textarea'); ed.value = localStorage.getItem('draft') || '';
        ed.oninput = () => localStorage.setItem('draft', ed.value);
        </script>""")
        server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=tmp))
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            async with async_playwright() as pw:
                args = [f"--disable-extensions-except={ext}", f"--load-extension={ext}", "--no-sandbox"]
                async def launch():
                    return await pw.chromium.launch_persistent_context(str(base / "profile"),
                        executable_path=executable, channel="chromium", args=args, headless=True)
                async def surfaces(ctx):
                    worker = ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event("serviceworker")
                    eid = worker.url.split("/")[2]
                    doc = await ctx.new_page()
                    await doc.goto(f"http://127.0.0.1:{server.server_port}/editor.html")
                    tab_id = await worker.evaluate("(async () => (await chrome.tabs.query({})).find(t => t.url?.endsWith('/editor.html')).id)()")
                    panel = await ctx.new_page()
                    await panel.goto(f"chrome-extension://{eid}/sidepanel.html?tab={tab_id}")
                    await until(panel, "window.autoType?.state?.ready && !!window.autoType.state.tab")
                    return doc, panel
                c = await launch()
                doc, panel = await surfaces(c)
                original = "A short sample has letters already in the editor."
                goal = original.replace("short", "longer").replace("letters", "some saved sentences").replace("editor.", "first document.")
                await doc.locator("#doc").fill(original)
                await doc.locator("#doc").focus()
                settings = {"wpm": 100, "variation":0, "roughness":0, "typoRate":0, "secondThoughts":0,
                            "countdown":0, **{k+e:0 for k in ["editTime","reviewPause","sentencePause","paragraphPause","commaPause","citationPause"] for e in ["Min","Max"]}}
                res = await panel.evaluate("""async ([current,updated,settings])=>chrome.runtime.sendMessage({
                    type:'autotype-start',kind:'edit',tabId:window.autoType.state.tab.id,current,updated,settings})""",[original,goal,settings])
                assert res.get("ok"), res
                await doc.wait_for_function("orig=>document.querySelector('textarea').value!==orig", arg=original)
                await panel.close()
                await asyncio.sleep(0.27)
                partial = await doc.locator("#doc").input_value()
                assert partial not in (original,goal), partial
                await c.close()
                c = await launch()
                doc, panel = await surfaces(c)
                await panel.locator("#recovery:not([hidden])").wait_for(state="attached")
                await panel.locator("#recovery summary").click()
                await doc.locator("#doc").focus()
                await panel.locator("#recovery-preview").click()
                await panel.locator("#recovery-start").wait_for(state="visible")
                captured = await panel.locator("#recovery-current").input_value()
                assert captured != goal and captured != original, captured
                assert await panel.locator("#recovery-target").input_value() == goal
                await doc.locator("#doc").fill(captured + " independently edited")
                await panel.locator("#recovery-start").click()
                await until(panel, "document.querySelector('#recovery-note').textContent.includes('Refresh')")
                assert await doc.locator("#doc").input_value() == captured + " independently edited"
                await doc.locator("#doc").fill(captured)
                await doc.locator("#doc").focus()
                await panel.locator("#recovery-preview").click()
                await panel.locator("#recovery-start").click()
                await doc.wait_for_function("goal=>document.querySelector('textarea').value===goal",arg=goal,timeout=35000)
                await until(panel, "window.autoType.state.run.mode==='done'", 10)
                assert await panel.evaluate("window.autoType.state.run.result.check") == "match"
                await until(panel, "document.querySelector('#recovery').hidden")
                await c.close()
                print("PASS: partial work after panel close, full browser restart, stale-preview rejection, exact verified recovery, checkpoint removal.")
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
if __name__ == "__main__":
    asyncio.run(main())
