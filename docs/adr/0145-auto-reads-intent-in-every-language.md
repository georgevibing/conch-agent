# 0145 — Auto reads intent in every language

- Status: accepted
- Date: 2026-10-26
- Builds on: [ADR 0128](./0128-auto-reads-what-you-asked-for.md) (wishes, `asked` and `held`),
  [ADR 0117](./0117-auto-asks-about-what-matters.md) (a push the person asked for;
  `isHighStakes` in the shops' own languages), [ADR 0137](./0137-auto-evidence-and-wait-destinations.md)
  (authorization lasts across follow-ups), [ADR 0100](./0100-permission-modes-every-provider.md)
  (the score)
- Amends: ADR 0117's "doesn't hold it back ("don't push yet", "before pushing")": "before
  pushing" is no longer a hold on its own

## Context

An audit of Auto (2026-10-26, at cc21608d) found that it misread the person's own words.
`heldBack` in `risk.ts` called a step held when any "not" came up to 40 characters before
the act's verb, whatever that "not" was about. Each of these came out `held` for `git push`:

- "fix the bug, and don't forget to push when done"
- "no need to ask me, just commit and push"
- "make sure you don't break anything and push"
- "run the tests before pushing to main"
- "push it, don't wait for me"

A held step scores one more (ADR 0128), so a push the person plainly asked for asked them
anyway, before reading too. In Auto the manager went further and refused held steps outright.
That contradicts AGENTS.md security rule 11, where a held step asks. ADR 0146 changes how a
held step is handled. This ADR is about reading the words.

The words were English only, too. "Commit et pousse sur main", "sube los cambios", "lösche
die alte Datei" and "não faça push ainda" asked for nothing and held nothing. People write
to Conch in their own language. `isHighStakes` already knows a shop's words in German, French,
Spanish, Portuguese, Italian and Dutch (ADR 0117). Asking for a step should work the same way.

## Decision

### A "not" holds only the act it governs

`wanted` still reads the latest message that names the act, and the names a step needs are
unchanged: the branch, the host, the package, _production_ (`PROD_WORDS`). How a message is
read is new (`intent`):

1. **Folded.** The message is lower case with its accents off and one kind of apostrophe
   (`fold`). "Lösche", "Loesche" and "LÖSCHE" read alike. French elisions are split, so
   "n'oublie" reads "ne oublie". Every word list is written for the folded form.
2. **By sentence and by clause.** A "not" reaches back at most seven words. It stops at a
   comma, a semicolon, a dash, or "but", "then" or "so" in any of the seven languages. An
   "and" starts a new act. The exception is one negated verb right before it: "don't commit
   and push" holds both. "Don't break anything and push" holds only the breaking.
3. **Idioms whose "not" governs something else are blanked first** (`NOT_A_HOLD`): "don't
   forget", "don't hesitate", "don't worry", "don't wait for me", "no need to ask", "without
   asking", "not only", "never mind", "no reason not to", "can't you just …", "why not",
   in every language. A state isn't a boundary either: "I haven't pushed yet".
4. **What holds:** a "not" in the act's own clause ("don't push", "no pushing", "without
   pushing", "never send", "nicht pushen", "ne pousse pas", "no subas", "não faça push",
   "non pushare", "niet pushen"). A "not" just after the act, as German, Dutch and French say
   it ("push es nicht", "push nog niet", "pousse pas"). A "wait" word over it ("wait before
   deploying", "hold off on the deploy", "avoid", "skip", "leave the push to me", "warte",
   "attends", "espera", "aspetta", "wacht"). The act waiting on the person's say anywhere in
   the sentence (`ON_THEIR_SAY`: "until I say", "once I've reviewed it", "my OK", "ask me
   first", "wait for me", "bis ich", "avant que je", "hasta que lo revise"). A bare "not yet"
   (`NOT_YET`: "push it, but not yet", "noch nicht", "pas encore", "todavía no"). A short
   sentence after it that takes it back (`TAKEN_BACK`: "Push it. No, wait.", "Never mind.",
   "Laisse tomber."). If any mention of the act in the message is held, the message holds it.

### "X before pushing" asks for the push after X

"Run the tests before pushing", "check CI before you push" and "before pushing, update the
changelog" name the push and put it after something. They are `asked`. That is what the
person means, and it matches how Claude Code reads an approval stated in conversation: by the
action it names. Conch can't prove that X was done, and this is no different from "push when
done". Whether the push is right is the agent's job; the risk policy decides only whether a
push to the repository's own remote needs a question. "Before" holds only when what comes
first is the person: "ask me before pushing", "check with me before you push", "before I've
looked", "wait before deploying". ADR 0117 listed "before pushing" as a hold. This amends it,
because as a bare word it held the most common way people ask for a push after the tests.

### Every language people write in

`WISHES` and every rule's own `wish` verbs gain the act in German, French, Spanish, Portuguese,
Italian and Dutch. They are grouped by act in `ABROAD`, one line per language, as
`isHighStakes` groups a shop's words: push (pushen, pousser, subir, enviar, empujar,
pushare), force-push and overwrite, deploy (bereitstellen, déployer, desplegar, implantar,
rilasciare, uitrollen, "mets en prod"), install, delete (löschen, supprimer, borrar,
eliminar, apagar, cancellare, verwijderen), clean, discard, send and reply (schicken,
envoyer, enviar, mandar, inviare, versturen), copy, publish, update, run, destroy, restart,
schedule, safety, access and sharing, merge, mirror, public, secrets. Spanish, Portuguese and
Italian verbs take their pronoun on the end ("súbelo", "invialo"). `PROD_WORDS` gains
produktion, production, producción, produção, produzione and productie. Negations and the
"not" idioms come in the same seven languages.

A word that is English for something else is left out or narrowed, so an English message reads
as it did. Examples: French "accessible", Portuguese "agenda", French "programme", "ignore",
"exponent", and the Spanish and Portuguese forms "quite" and "redefine". "Sube" and "envía" also mean more than publishing a package, so
they don't ask for `npm publish`.

### What stays the same

`NEVER` and `critical` are unliftable in every language: keys, a stranger's code from a blob,
money, a push anywhere but the repository's own remote, an assistant's permission files, the
circuit breaker. Names are still required: "pousse-le" doesn't push `gh-pages`, and "despliega
con terraform" doesn't apply to production. A later message about the act still replaces an
earlier one. A follow-up that doesn't name it still revokes nothing.

## Threat model

`said` holds only the owner's own messages. It is empty when anyone else's words are in the
chat, in a routine, or with nobody there (ADR 0117, ADR 0128). A page, a file, a tool result or
another agent can't put words in it, so a looser reading of the person's words gives an attacker
nothing. The risk runs the other way: a misread could let a step go that the person meant to
hold. So where a sentence is ambiguous, the reading holds. Examples: "don't touch the
migrations when you push", "not sure we should push", "push it to my branch but don't push to
main". A held step asks rather than goes (ADR 0146), so a wrong hold costs one question, and a
wrong ask costs a step the person didn't want. Names keep the second case narrow. A loosely
read "push" lifts only a plain push to the repository's own remote, never a publishing branch,
a force-push or another remote.

The patterns are bounded: no unbounded gaps, at most seven words of reach, and owner text
only. A 60,000-character adversarial message reads in under 150 ms.

## Consequences

- The five messages above, "can't you just push?", "don't hesitate to push" and "no reason
  not to push" go ahead in Auto. "Don't push yet", "do not push", "no pushing until I say",
  "without pushing", "wait before deploying", "hold off on the deploy" and "never send
  anything" still hold.
- "Commit et pousse sur main", "Committe und push nach main", "Haz commit y sube los cambios",
  "Faz commit e envia para a main", "Fai commit e pusha su main" and "Commit en push naar main"
  ask for the push. "Noch nicht pushen", "ne pousse pas encore", "no subas todavía", "não faça
  push ainda", "non pushare ancora" and "push nog niet" hold it.
- Slightly stricter in two places: "push it, but not yet" and "Push it. No, wait." now hold.
  Before, the "not" came after the verb, so they were read as asking. Both are a person saying
  not yet.
- Not covered: German and Dutch separable verbs split around their object ("stell es bereit",
  "rol het uit") unless the verb is also said whole. Languages beyond these seven. A message
  of its own that only takes back ("Wait.") without naming the act: as before, it revokes
  nothing it doesn't name.
- The corpus (`test/riskCorpus.ts`) gains these cases in `ASKED`, `NAMED`, `HELD` and
  `UNLIFTABLE`, in English and the six other languages. The routine and adversarial corpora
  are unchanged and still pass.
- No stored data changes.

## Sources

Read 2026-10-26:

- [Claude Code permission modes](https://code.claude.com/docs/en/permission-modes):
  approvals and boundaries stated in conversation, and the action named with its specifics.
- [Configure auto mode](https://code.claude.com/docs/en/auto-mode-config): explicit user intent
  as its own tier.
- ADR 0117 § "Shopping with Claude Haiku": `isHighStakes` in the shops' own languages, the
  precedent for word lists grouped by language.
- Negation scope in English, German, French, Spanish, Portuguese, Italian and Dutch: German
  and Dutch put "nicht"/"niet" after a finite verb, French brackets the verb with "ne … pas",
  and the Romance languages put clitic pronouns on the end of an imperative.
