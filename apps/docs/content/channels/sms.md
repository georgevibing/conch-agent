---
channel: sms
---

## Connect it

You need a phone number for your assistant. Conch uses **Twilio**, which rents numbers that can text, for about a dollar a month plus a cent or so per text. In Conch, open **Apps**, choose **Talk to me here**, then **SMS**.

1. **Get a number.** Sign up at Twilio (a trial comes with some credit). In the Twilio Console, open **Phone Numbers → Buy a number**, tick **SMS**, and buy one.
2. **Paste your keys.** On the Twilio Console's first page, under **Account Info**, copy the **Account SID** and the **Auth Token**, and paste them anywhere on Conch's page. Conch checks them with Twilio and finds your number. There is no Save button.
3. **Give it an address Twilio can reach.** Twilio delivers texts to a web address, so Conch opens one, with one press. Then Conch tells Twilio to send your number's texts there: there is nothing to paste in Twilio.
4. **Say hello.** Text the number anything from your own phone, then press **That's me** in Conch.

<!-- conch:channel-scene sms key -->

## Your first hello

Text the number "hi". In Conch your message shows with **That's me**. Press it, and your assistant texts back, by name.

<!-- conch:channel-scene sms hello -->

## Good to know

- **Plain text.** Texts have no bold or buttons. When your assistant asks before doing something, reply with the answer's number.
- **Long answers are cut at three texts**, since each one costs. The whole answer is in Conch.
- **Pictures** you send by MMS (where your carrier and number allow it) become attachments.
- **A trial account** only texts numbers you verified: the phone you signed up with is. Its texts start with "Sent from your Twilio trial account".
- **In the US**, carriers block texts from numbers that aren't registered. Register yours for A2P 10DLC in Twilio (**Messaging → Regulatory Compliance**), or use a toll-free number and verify it. If texts stop arriving for this reason, the channel's page says so.
- **Someone else** who texts the number gets one polite reply and shows up in Conch for you to let in or block.
- **Groups.** Group texts are never answered.
