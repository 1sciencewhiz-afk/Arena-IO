import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(headless=True); pg=await b.new_page(viewport={"width":1280,"height":1800})
        errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
        await pg.goto("http://localhost:8080/room/TESTX?c=b1-blocks-small-p1-first10",wait_until="networkidle"); await pg.wait_for_timeout(5000)
        print(errs[:3]); await pg.screenshot(path="r.png"); await b.close()
asyncio.run(main())
