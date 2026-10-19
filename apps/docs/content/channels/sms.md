---
channel: sms
---

## Connect it

Your assistant gets a phone number from **Twilio**, for about a dollar a month plus a cent or so per text. Open **Apps → Talk to me here → SMS**.

1. **Get a number.** Sign up at Twilio (a trial comes with some credit). In the Twilio Console, open **Phone Numbers → Buy a number**, tick **SMS**, and buy one.
2. **Paste your keys.** On the Console's first page, under **Account Info**, copy the **Account SID** and the **Auth Token** (press **Show**). Paste them anywhere in Conch. Conch checks them and finds your number.
3. **Give it an address Twilio can reach.** Press the button in Conch. Conch points your number at it, with nothing to paste in Twilio.
4. **Say hello.** Text the number "hi" from your phone, then press **That's me** in Conch. Your assistant texts back, by name.

<!-- conch:channel-scene sms key -->

## Your first hello

<!-- conch:channel-scene sms hello -->

## Good to know

- **Plain text.** To approve, reply with the answer's number.
- **Long answers stop at three texts**, since each costs. The whole answer is in Conch.
- **Pictures you send** by MMS (where your carrier and number allow it) become attachments.
- **Pictures and files from Conch stay in Conch**, since MMS needs a public web address. The text says so.
- **A trial account** texts only numbers you verified, and its texts start with "Sent from your Twilio trial account".
- **In the US**, carriers block unregistered numbers. Register yours for A2P 10DLC (**Messaging → Regulatory Compliance**), or verify a toll-free number. The channel's page says if that's why texts stop.
- **Anyone else** gets one polite reply and waits for you to **Let them in** or **Block**.
- **Group texts** are never answered.

## Phone calls

The same number can take your calls, and ring you when your assistant needs an OK. Both are off until you turn them on under **Phone calls** on the number's page.

**Call your assistant.** Turn on **Answer your calls**, then call the number from your phone. Talk as you would to a person: what you say goes into your chat, and the answer is said back. Start talking to stop it mid-sentence. A question with buttons still comes by text.

**Get a call when an OK waits.** Turn on **Call me when an OK waits**. If a question has waited the minutes you chose, your assistant rings you:

- for an everyday step, it says what it would do. Press **1** or say "yes" to allow it, **2** or "no" to deny it;
- for anything bigger, it only says that something needs you in Conch. Nothing is allowed by phone;
- an answering machine only hears that something needs you, never what.

It never rings in your **Quiet hours**, nor more than your **Calls a day**. Every call ends by itself after the **Longest call** you chose.

- **Only your number gets through.** Anyone else hears one sentence and the call ends.
- **Heard on this computer** when Conch has private dictation and a natural voice (**Settings → Voice**). Until then, Twilio hears and speaks for the call.
- **Calls cost** a cent or two a minute in the US. The page shows today's calls.
- **A number can be faked.** Conch hangs up when the carrier says a call failed its caller-ID check, and nothing said on a call allows a step by itself.
