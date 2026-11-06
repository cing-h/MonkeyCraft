// The Chief's line to an outside Claude Code session: a mailbox, not a remote
// control. The Chief drops a request in the mailbox (a messenger toucan flies
// off with it); the session picks it up, does the work under its own
// permission prompts in its terminal, and replies.
//
//   claude.ask    send a request, and wait for the answer up to waitSeconds (0 = don't wait)
//   claude.check  collect answers to requests sent earlier, waiting a little if asked
//
// Asking changes nothing by itself, so it asks the user nothing here: Claude
// Code asks in its own terminal for anything it does. A request from a job that
// read web content is marked untrusted, and the session is told so.

const MAX_WAIT_S = 1500; // Claude Code gives a tool call 30 minutes; stay inside it
const DEFAULT_WAIT_S = 600;

const answerText = i => {
  if (!i) return 'There is no such request.';
  if (i.status === 'answered') return `${i.id}: Claude Code answered.\n--- answer ---\n${i.reply}`;
  return `${i.id}: no answer yet. Collect it later with claude.check, or carry on without it.`;
};

export function makeAskClaudeTools({ mailbox }) {
  return [
    {
      name: 'claude.ask', capability: 'link', scope: 'delegate', timeoutMs: (MAX_WAIT_S + 30) * 1000,
      description: 'Ask the Claude Code session the user has open in their terminal to do something or answer something, and wait for its reply. Use it for work your crew can\'t do, such as changes to the MonkeyCraft project itself. Write a complete, self-contained request. Claude Code asks the user before it does anything, and it may take a while or not answer at all (if no session is open), so set waitSeconds to 0 to carry on and collect the answer later with claude.check.',
      inputSchema: { type: 'object', properties: {
        request: { type: 'string', maxLength: 8000, description: 'What you need from Claude Code, with every detail it needs.' },
        waitSeconds: { type: 'integer', minimum: 0, maximum: MAX_WAIT_S, description: `How long to wait for the answer (default ${DEFAULT_WAIT_S}; 0 = don't wait)` }
      }, required: ['request'], additionalProperties: false },
      assess: async a => ({ summary: `ask Claude Code: ${String(a.request).slice(0, 200)}` }),
      async run(args, ctx) {
        const untrusted = !!ctx.tainted?.();
        const r = await mailbox.ask({ fromRunId: ctx.runId, agentId: ctx.agentId, request: args.request, untrusted });
        if (r.error) return { isError: true, content: r.error, summary: 'not sent' };
        ctx.emit('link.request', { requestId: r.item.id, request: r.item.request.slice(0, 500), untrusted });
        const wait = args.waitSeconds ?? DEFAULT_WAIT_S;
        const got = wait > 0 ? await mailbox.waitForAnswer(r.item.id, wait * 1000, ctx.signal) : null;
        const item = got || mailbox.get(r.item.id);
        return { content: `Request ${item.id} sent to Claude Code.\n${answerText(item)}`, summary: item.status === 'answered' ? 'answered' : 'sent; no answer yet' };
      }
    },
    {
      name: 'claude.check', capability: 'link', scope: 'read', timeoutMs: (MAX_WAIT_S + 30) * 1000,
      description: 'Collect Claude Code\'s answers to requests you sent with claude.ask.',
      inputSchema: { type: 'object', properties: {
        requests: { type: 'array', description: 'Request ids from claude.ask' },
        waitSeconds: { type: 'integer', minimum: 0, maximum: MAX_WAIT_S, description: 'Wait up to this long for answers still missing (default 0)' }
      }, required: ['requests'], additionalProperties: false },
      async run(args, ctx) {
        const ids = (Array.isArray(args.requests) ? args.requests : []).map(String).slice(0, 10);
        if (!ids.length) return { isError: true, content: 'Give the request ids to check.', summary: 'no requests' };
        const mine = id => { const i = mailbox.get(id); return i && i.fromRunId === ctx.runId ? i : null; };
        const wait = (args.waitSeconds ?? 0) * 1000;
        if (wait > 0) await Promise.all(ids.filter(mine).map(id => mailbox.waitForAnswer(id, wait, ctx.signal)));
        const out = ids.map(id => mine(id) ? answerText(mine(id)) : `${id}: not one of your requests.`);
        return { content: out.join('\n\n'), summary: `${ids.filter(id => mine(id)?.status === 'answered').length} of ${ids.length} answered` };
      }
    }
  ];
}
