---
title: Make and edit pictures
description: Create a picture or edit one you attach, with a preview and a download in the chat.
order: 19
---

Describe the picture you want. To edit a picture, attach it and say what should
change. Conch creates one picture at a time and puts it in the chat with a
preview and **Download**. The original stays as it was. While it works, the chat
shows how far along the picture is, and a rough version when the service sends one.

Under a finished picture are **Look closer**, **Download**, **Copy picture** and
**Change it**, which puts the picture's name in the message box so you can say
what to change. **Details** shows what was asked for, the model, and who made it.
If the picture wasn't made, because you said no or the service couldn't, the chat
says so in a line.

Image creation works from any chat model that can use tools. Conch makes the
picture with what you already have, in this order:

1. **Your ChatGPT plan**, when you signed in with ChatGPT (Codex). There is no
   extra charge; it counts toward your plan's limits.
2. **Your own API key**: OpenAI, then Gemini. Each picture is billed by that
   service.
3. **OpenRouter**, when none of the above can. Each picture is billed by
   OpenRouter, about $0.04.

If none of your providers can make pictures, Conch offers a card in the chat to
connect OpenRouter. Press **Connect**, finish connecting, and the request
carries on. Your chat model stays the same.

A picture on your ChatGPT plan goes without asking, unless the chat read
something from outside. Before a paid picture, Conch asks unless you chose
**Full trust**. The approval names the service and the model, and about what
it costs. The prompt and any source picture are sent to that service.

If your ChatGPT plan has made all the pictures it can for now, Conch makes it
the next way instead, and notes it under Settings → Health → "Fixed on its own".

Ask which image models are available if you want to choose one. Support for
transparent backgrounds, shape and reference pictures depends on the model.
The assistant checks the available settings before sending the request.

Generated pictures are kept with their chat and included in backups. OpenRouter’s
reported cost counts toward your monthly spending; when the monthly budget is
reached, paid image creation stops until you review it.

A failed request is never retried automatically. If the connection ends before
the result arrives, check the service’s activity before requesting another.
