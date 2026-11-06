// web.fetch: read one web page as plain text, for the Scout.
//
// Reading the web is a read, so it needs no permission, but it is a taint
// source: the job that read the page is locked out of commands and file
// changes afterwards (see safety/taint.js).
//
// It never reaches this computer or the local network. Every address the host
// name resolves to, at every redirect, must be a public one. Otherwise a page
// could point it at MonkeyCraft's own controls on localhost, or at a router.
// Injected IO: fetchImpl (the WHATWG fetch), lookup(host) -> [{ address, family }].

import net from 'node:net';

const MAX_BYTES = 2 * 1024 * 1024, DEFAULT_CHARS = 20_000, MAX_CHARS = 60_000, MAX_REDIRECTS = 5;

/** Is this IP address private, loopback, link-local or otherwise not on the public internet? */
export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    if (x === '::' || x === '::1') return true;
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); if (mapped) return isPrivateAddress(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(x) || x.startsWith('64:ff9b:') || x.startsWith('2001:db8');
  }
  return true; // not an IP at all: refuse
}

/** HTML → readable text: drop scripts and styles, keep line breaks at block tags, decode common entities. */
export function htmlToText(html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  let t = html.replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  t = t.replace(/<(br|hr)\b[^>]*>/gi, '\n').replace(/<\/?(p|div|section|article|li|ul|ol|h[1-6]|tr|table|blockquote|pre|header|footer|nav|main)\b[^>]*>/gi, '\n');
  t = t.replace(/<[^>]+>/g, ' ');
  const ent = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
  t = t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ent[e.toLowerCase()] ?? m));
  t = t.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  return (title ? `Title: ${htmlToText(title).replace(/\n/g, ' ')}\n\n` : '') + t;
}

export function makeWebFetch({ fetchImpl, lookup, timeoutMs = 20_000 }) {
  async function checkUrl(raw) {
    let u; try { u = new URL(raw); } catch { return { error: 'that is not a valid web address' }; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: `only http and https pages can be read (not ${u.protocol})` };
    if (u.username || u.password) return { error: 'addresses with a user name or password are not allowed' };
    const host = u.hostname.replace(/^\[|\]$/g, '');
    let addrs;
    if (net.isIP(host)) addrs = [{ address: host }];
    else { try { addrs = await lookup(host); } catch (e) { return { error: `couldn't find ${host} (${e.code || e.message})` }; } }
    if (!addrs.length) return { error: `couldn't find ${host}` };
    const bad = addrs.find(a => isPrivateAddress(a.address));
    if (bad) return { deny: `${host} is on this computer or the local network (${bad.address}); only public web pages can be read` };
    return { url: u };
  }
  return {
    name: 'web.fetch',
    capability: 'network',
    scope: 'read',
    taints: true,
    timeoutMs: timeoutMs + 5000,
    description: 'Read a public web page and get its text. Reading web content locks you out of commands and file changes for the rest of this job.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', maxLength: 2048, description: 'The http(s) address to read' },
        maxChars: { type: 'integer', minimum: 200, maximum: MAX_CHARS, description: `Return at most this many characters (default ${DEFAULT_CHARS})` }
      },
      required: ['url'],
      additionalProperties: false
    },
    async assess(args) {
      const c = await checkUrl(args.url);
      if (c.deny) return { deny: c.deny };
      if (c.error) return { error: `Can't read that page: ${c.error}.` };
      return { summary: `read ${c.url.href}`, facts: { url: c.url } };
    },
    async run(args, ctx, { url }) {
      let cur = url, res;
      for (let hop = 0; ; hop++) {
        if (hop) { const c = await checkUrl(cur.href); if (c.deny || c.error) return { isError: true, content: `The page redirected somewhere that can't be read: ${c.deny || c.error}.`, summary: 'blocked redirect' }; }
        res = await fetchImpl(cur.href, { redirect: 'manual', signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(timeoutMs)].filter(Boolean)), headers: { 'user-agent': 'MonkeyCraft/0.1 (personal research assistant)', accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.1' } });
        if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
          if (hop >= MAX_REDIRECTS) return { isError: true, content: 'Too many redirects.', summary: 'too many redirects' };
          cur = new URL(res.headers.get('location'), cur); continue;
        }
        break;
      }
      const type = (res.headers.get('content-type') || '').toLowerCase();
      if (!/^(text\/|application\/(json|xml|xhtml\+xml|rss\+xml|atom\+xml))/.test(type) && type) return { isError: true, content: `That page is ${type}, not text, so it wasn't read.`, summary: 'not text' };
      const reader = res.body?.getReader(); let got = 0; const parts = [];
      if (reader) for (;;) { const { done, value } = await reader.read(); if (done) break; got += value.length; if (got > MAX_BYTES) { reader.cancel(); break; } parts.push(value); }
      const raw = Buffer.concat(parts).toString('utf8');
      const text = /html|xml/.test(type) || /^\s*</.test(raw) ? htmlToText(raw) : raw;
      const max = args.maxChars || DEFAULT_CHARS, clipped = text.length > max ? text.slice(0, max) + `\n…[page continues: ${text.length - max} more characters]` : text;
      return { isError: res.status >= 400, content: `${res.status} ${cur.href}\n\n${clipped || '(no text)'}`, summary: `${res.status} · ${Math.min(text.length, max)} characters` };
    }
  };
}
