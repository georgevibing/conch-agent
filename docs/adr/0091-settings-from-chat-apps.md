# 0091 — Settings from chat apps

- Status: accepted
- Date: 2026-10-05

## Decision

The channel owner can inspect and configure Conch from a private conversation with
`/settings`, with shortcuts for model, effort, mode and status. The gateway owns
these commands; they never become instructions for a model. All adapters use the
same controller and their existing buttons or numbered text replies.

Model lists come from the provider catalog. Effort, fast mode and permission
choices reflect the selected model's capabilities. Changes apply to the current
conversation and subsequent new conversations in this channel; a separate menu
sets defaults across Conch, including existing chats without overrides on their next turn. Current conversation choices made in the web app are
read back before displaying or changing settings. Changing a running conversation
waits until it finishes, so a displayed choice cannot misrepresent its live turn.

Menus use opaque, single-use tokens bound to channel, private chat, owner and
conversation, expire after ten minutes, and are bounded in memory. Every press
rechecks the current owner and channel state. Forwarded messages cannot configure
Conch. Changes are confirmed with their scope and effect before being persisted.
No settings tool is given to the assistant. Restarting loses open menus, not saved
choices. Existing channel storage and backup rules keep the new choices.

Everyday preferences, persona, profile, turn limits and channel notifications can
be changed in chat. Security controls requiring fresh authentication, credentials,
file pickers and device-local presentation settings link to the existing Conch
settings pages, using its configured address without a sign-in token. If Conch has
no address, the menu explains where to open the page on the computer. The channel
never lowers a web route's authentication requirement.

## Security and verification

Threats include another admitted person pressing the owner's menu, replay,
forwarded instructions, stale choices after `/new`, revoked access, arbitrary
provider/model values and privilege changes hidden in ordinary chat. Tests cover
these at the controller and adapter/service boundaries, including text-only
channels. Permission changes use the existing conversation configuration path;
Full trust has an explicit warning and confirmation. Backup previews disclose
saved channel choices that allow actions without asking.

Followed the OWASP Authorization Cheat Sheet (retrieved 2026-10-05): deny by
default, validate permissions on every request, and test horizontal and vertical
access boundaries:
https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
