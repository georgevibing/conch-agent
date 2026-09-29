/** Ideas to start a skill from. Only the instructions: Conch names and describes it, live. */
export const skillIdeas: { id: string; label: string; instructions: string }[] = [
  {
    id: 'weekly-review',
    label: 'Weekly review',
    instructions:
      'Every Friday, look at my calendar and notes from the week and write a short review: what went well, what slipped, and my three priorities for next week. Keep it under 200 words, in plain bullet points.',
  },
  {
    id: 'write-like-me',
    label: 'Write like me',
    instructions:
      'When I ask you to polish something I wrote, keep my voice: short sentences, plain words, no corporate jargon, no exclamation marks. Keep my meaning and structure and only fix what reads badly. Show the result, then the three biggest changes.',
  },
  {
    id: 'meeting-notes',
    label: 'Meeting notes',
    instructions:
      'Turn a meeting transcript or my rough notes into a two-line summary, the decisions made, action items with owners and dates, and open questions. Use the names people actually used and leave out small talk.',
  },
  {
    id: 'release-notes',
    label: 'Release notes',
    instructions:
      'Write release notes from the merged pull requests or commits I give you. Group them into New, Improved and Fixed. One line each, written for users rather than developers, starting with a verb. Leave out internal chores.',
  },
];
