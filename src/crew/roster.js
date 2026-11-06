// The crew. Each member has its own model and its own tool grants.
// Edition 1, M1: only the Cinder Smith is awake. The rest join in M4. The
// Tide Seer and Clockwork Bat sleep until Edition 2.

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
      id: 'smith', name: 'Cinder Smith', role: 'Builder: runs commands and code', awake: true,
      provider: 'claude-code', model: 'claude-sonnet-5-5',
      grants: ['fs.read', 'shell.exec'],
      persona: 'You are the Cinder Smith, the builder of the MonkeyCraft crew: a humanoid blacksmith with burning hair. You run commands and build things. Practical and steady; you check results before you say a job is done.'
    },
    { id: 'voidwyrm', name: 'The Voidwyrm', role: 'Manager: plans and hands out work', awake: false, wakes: 'M4' },
    { id: 'armor', name: 'Hollow Plate', role: 'Researcher: scouts the web', awake: false, wakes: 'M4' },
    { id: 'scribe', name: 'Bone Scribe', role: 'Archivist: reads and files documents', awake: false, wakes: 'M4' },
    { id: 'spider', name: 'Silkscript Spider', role: 'Writer: drafts and edits text', awake: false, wakes: 'M4' },
    { id: 'gargoyle', name: 'Prism Gargoyle', role: 'Tester: checks the work', awake: false, wakes: 'M4' },
    { id: 'seer', name: 'Tide Seer', role: 'Memory keeper', awake: false, wakes: 'Edition 2' },
    { id: 'bat', name: 'Clockwork Bat', role: 'Timekeeper: scheduled jobs', awake: false, wakes: 'Edition 2' }
  ];
  for (const c of crew) if (c.awake) { c.systemPrompt = `${c.persona}\n\n${RULES(workspace)}`; c.grantSet = new Set(c.grants); }
  const byId = new Map(crew.map(c => [c.id, c]));
  return {
    get: id => byId.get(id),
    /** What the UI may show: no prompts, no internals. */
    public: () => crew.map(({ id, name, role, awake, wakes, model, grants }) => ({ id, name, role, awake, wakes: wakes || null, model: model || null, grants: grants || [] }))
  };
}
