// The crew's doorway into the Brain: brain.search, brain.read and brain.note.
//   - An ape that can reach the web never sees the user's profile (You/).
//   - Proposals waiting for the council aren't memory yet, so they stay hidden.
//   - brain.note saves a shared note without asking (the fast speed of
//     learning): every change is journaled and the user can undo it. A job that
//     read the web can't write to the Brain at all, so a web page can't plant
//     false memories. Nothing that looks like a password or key is saved.

import { safeTitle, LINE_LOCK } from '../brain/notes.js';
import { excerpt } from '../brain/recall.js';

const SECRET = /(sk-ant-[\w-]{10,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|AIza[\w-]{30,}|xox[abprs]-[\w-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bpassword\s*[:=]\s*\S+)/i;

export function makeBrainTools({ brain, roster }) {
  const isNetwork = ctx => !!roster.get(ctx.agentId)?.network;
  const hidden = ctx => ['Proposals', ...(isNetwork(ctx) ? ['You'] : [])];
  const unavailable = () => ({ isError: true, content: 'The Brain isn\'t available right now, so carry on without it.', summary: 'Brain unavailable' });

  return [
    {
      name: 'brain.search', capability: 'brain', scope: 'read',
      description: 'Search the Brain, the village\'s shared memory: lessons from earlier jobs, notes about the user\'s projects and computer, and (for most of the crew) what the user is like. Returns the best matches with a short excerpt; read one in full with brain.read.',
      inputSchema: { type: 'object', properties: { query: { type: 'string', maxLength: 500, description: 'What to look for, in plain words' }, limit: { type: 'integer', minimum: 1, maximum: 20, description: 'How many matches (default 8)' } }, required: ['query'], additionalProperties: false },
      async run(args, ctx) {
        if (!brain.status().ready) return unavailable();
        const r = await brain.search({ q: args.query, limit: args.limit || 8, skipAreas: hidden(ctx) });
        if (r.error) return { isError: true, content: r.error, summary: 'search failed' };
        if (!r.hits.length) return { content: 'Nothing in the Brain matches that.', summary: 'no matches' };
        return { content: r.hits.map(h => `- ${h.title} (path: ${h.rel})\n  ${h.snippet}`).join('\n'), summary: `${r.hits.length} match${r.hits.length > 1 ? 'es' : ''}` };
      }
    },
    {
      name: 'brain.read', capability: 'brain', scope: 'read',
      description: 'Read one note from the Brain in full, by the path brain.search gave you.',
      inputSchema: { type: 'object', properties: { path: { type: 'string', maxLength: 400, description: 'The note\'s path inside the Brain, e.g. "Notes/Ports.md"' } }, required: ['path'], additionalProperties: false },
      async run(args, ctx) {
        if (!brain.status().ready) return unavailable();
        const top = String(args.path).split('/')[0];
        if (hidden(ctx).includes(top)) return { isError: true, content: top === 'You' ? 'You can reach the web, so for the user\'s safety you can\'t read their profile.' : 'Proposals wait for the user at the council; they aren\'t memory yet.', summary: 'not for you' };
        const n = await brain.read({ rel: args.path });
        if (n.error) return { isError: true, content: n.error, summary: n.error };
        const body = n.body.split('\n').map(l => l.replace(new RegExp(`\\s*${LINE_LOCK}\\s*$`), '')).join('\n');
        return { content: `# ${n.title}\n(${n.kind}${n.meta.updated ? `, updated ${String(n.meta.updated).slice(0, 10)}` : ''})\n\n${body}`, summary: `read ${n.title}` };
      }
    },
    {
      name: 'brain.note', capability: 'brain', scope: 'memory',
      description: 'Save a lasting fact to the Brain\'s shared notes, for future jobs: something about the user\'s projects, files or computer that the crew will need again (where something lives, how it is set up, a fixed preference). Don\'t save progress on this job, guesses, dates, or anything secret. Most jobs save nothing. mode "new" (default) makes a new note, "append" adds to one, "replace" rewrites one you have read.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', maxLength: 100, description: 'A short title that says what the note is about, e.g. "Where the photo backups live"' },
          text: { type: 'string', maxLength: 4000, description: 'The note, in plain Markdown' },
          mode: { type: 'string', enum: ['new', 'append', 'replace'], description: 'new (default), append or replace' }
        },
        required: ['title', 'text'], additionalProperties: false
      },
      assess(args, ctx) {
        if (ctx.tainted?.()) return { deny: 'this job read the web, so it can\'t write to the Brain (a web page could plant false memories)' };
        if (SECRET.test(args.text) || SECRET.test(args.title)) return { deny: 'that looks like a password or key, and those never go in the Brain' };
        const t = safeTitle(args.title);
        if (!t) return { error: 'That title can\'t be used as a note name. Use a few plain words.' };
        if (!args.text.trim()) return { error: 'The note is empty.' };
        return { summary: `save "${t}" to the Brain`, facts: { rel: `Notes/${t}.md` } };
      },
      async run(args, ctx, { rel }) {
        if (!brain.status().ready) return unavailable();
        const mode = args.mode || 'new', cur = await brain.read({ rel }), exists = !cur.error;
        if (mode === 'new' && exists) return { isError: true, content: `A note called "${cur.title}" already exists. Read it with brain.read (path: ${rel}), then use mode "append" or "replace".`, summary: 'already exists' };
        if (mode !== 'new' && !exists) return { isError: true, content: `There's no note at ${rel} yet. Use mode "new".`, summary: 'no such note' };
        const body = mode === 'append' ? `${cur.body.replace(/\n*$/, '')}\n\n${args.text.trim()}\n` : `${args.text.trim()}\n`;
        const r = await brain.write({ rel, body, by: ctx.agentId, sourceJob: ctx.runId });
        if (r.error) return { isError: true, content: `Not saved: ${r.error}.`, summary: `not saved: ${r.error}` };
        if (r.unchanged) return { content: 'The Brain already says exactly that.', summary: 'unchanged' };
        ctx.emit('brain.write', { path: rel, op: exists ? 'replace' : 'create', changeId: r.changeId });
        return { content: `Saved to the Brain: ${rel}. The user can see and undo it in the Brain panel.\n\n${excerpt(body, 300)}`, summary: `saved ${rel}` };
      }
    }
  ];
}
