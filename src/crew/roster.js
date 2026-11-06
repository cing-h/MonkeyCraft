// The crew: the apes of the jungle village. Each member has its own model and its own tool grants.
// Edition 1, M1–M3: only the Smith is awake. The rest join in M4. The Sage and
// the Bell-ringer sleep until Edition 2.

const RULES = (workspace) => `
You work inside MonkeyCraft, a local app where a crew of creatures does jobs for the user on their own computer.
- Your home folder for work is the MonkeyCraft workspace: ${workspace}. Relative paths start there.
- You can only act through your MonkeyCraft tools. If a tool you'd need isn't available, say so plainly.
- Anything that changes something asks the user first. If they say no, don't retry the same action; ask what they'd prefer.
- If a safety rule blocks something, it can't be approved: explain and suggest another way.
- Be brief and concrete. The user isn't a programmer: explain results in plain language and show only the output that matters.`.trim();

export function makeRoster({ workspace }) {
  const crew = [
    {
      id: 'smith', name: 'The Smith', role: 'Builder: runs commands and code', awake: true,
      provider: 'claude-code', model: 'claude-sonnet-5-5',
      grants: ['fs.read', 'shell.exec'],
      persona: 'You are the Smith, the builder of the MonkeyCraft crew: a chimpanzee blacksmith with a leather apron and a hammer, who works in the smithy of a jungle village. You run commands and build things. Practical and steady; you check results before you say a job is done.'
    },
    { id: 'chief', name: 'The Chief', role: 'Manager: plans and hands out the work', awake: false, wakes: 'M4' },
    { id: 'scout', name: 'The Scout', role: 'Researcher: scouts the web', awake: false, wakes: 'M4' },
    { id: 'archivist', name: 'The Archivist', role: 'Archivist: reads and files documents', awake: false, wakes: 'M4' },
    { id: 'writer', name: 'The Writer', role: 'Writer: drafts and edits text', awake: false, wakes: 'M4' },
    { id: 'inspector', name: 'The Inspector', role: 'Tester: checks the work', awake: false, wakes: 'M4' },
    { id: 'sage', name: 'The Sage', role: 'Memory keeper: remembers and teaches skills', awake: false, wakes: 'Edition 2' },
    { id: 'ringer', name: 'The Bell-ringer', role: 'Timekeeper: runs scheduled jobs', awake: false, wakes: 'Edition 2' }
  ];
  for (const c of crew) if (c.awake) { c.systemPrompt = `${c.persona}\n\n${RULES(workspace)}`; c.grantSet = new Set(c.grants); }
  const byId = new Map(crew.map(c => [c.id, c]));
  return {
    get: id => byId.get(id),
    /** What the UI may show: no prompts, no internals. */
    public: () => crew.map(({ id, name, role, awake, wakes, model, grants }) => ({ id, name, role, awake, wakes: wakes || null, model: model || null, grants: grants || [] }))
  };
}
