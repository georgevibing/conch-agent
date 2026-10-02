-- Sends one iMessage for Conch (ADR 0044).
-- Everything comes in as arguments, never as part of this script, so no text
-- can become a command: item 1 is the words, item 2 who or which chat, item 3
-- "chat" (a chat id from Messages) or "to" (a phone number or Apple ID).
on run argv
	set theText to item 1 of argv
	set theTarget to item 2 of argv
	set theKind to item 3 of argv
	tell application "Messages"
		if theKind is "chat" then
			send theText to chat id theTarget
		else
			set theAccount to 1st account whose service type = iMessage
			send theText to participant theTarget of theAccount
		end if
	end tell
end run
