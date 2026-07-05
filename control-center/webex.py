"""Webex integration — posts to a real room when WEBEX_TOKEN + WEBEX_ROOM_ID
are set in .env; otherwise logs what it would send (demo still works)."""
import os

import httpx

TOKEN = os.getenv("WEBEX_TOKEN", "")
ROOM = os.getenv("WEBEX_ROOM_ID", "")


def safe_print(msg: str):
    try:
        print(msg)
    except UnicodeEncodeError:            # Windows cp1252 consoles/logs
        print(msg.encode("ascii", "replace").decode())


async def post_webex(markdown: str):
    if not (TOKEN and ROOM):
        safe_print(f"[webex-simulated] {markdown}")
        return
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            await c.post("https://webexapis.com/v1/messages",
                         headers={"Authorization": f"Bearer {TOKEN}"},
                         json={"roomId": ROOM, "markdown": markdown})
    except Exception as e:
        safe_print(f"[webex-error] {e}")
