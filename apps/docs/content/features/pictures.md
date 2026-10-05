---
title: Make and edit pictures
description: Create a picture or edit one you attach, with a preview and a download in the chat.
order: 19
---

Describe the picture you want. To edit a picture, attach it and say what should
change. Conch creates one picture at a time and puts it in the chat with a
preview and **Download**. The original stays as it was.

Image creation works from any chat model that can use tools. It uses an
OpenRouter API key and is billed separately from the model answering you. If
you have not connected one, Conch offers a card in the chat. Press **Connect**,
finish connecting, and the request carries on. Your chat model stays the same.

Before sending a source picture or making a paid request, Conch asks unless
you chose **Full trust**. The approval names the image model. The prompt and
any source picture are sent to OpenRouter and its image provider.

Ask which image models are available if you want to choose one. Support for
transparent backgrounds, shape and reference pictures depends on the model.
The assistant checks the available settings before sending the request.

Generated pictures are kept with their chat and included in backups. OpenRouter’s
reported cost counts toward your monthly spending; when the monthly budget is
reached, image creation stops until you review it.

A failed request is never retried automatically. If the connection ends before
the result arrives, check OpenRouter’s activity before requesting another.
