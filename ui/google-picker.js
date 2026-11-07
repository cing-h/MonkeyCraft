// The "let the Clerk open a file" page: Google's own file picker. Each file the
// user picks is shared with MonkeyCraft (drive.file), so the Clerk can find it.
/* global gapi, google */
const $ = id => document.getElementById(id);
const say = t => { $('msg').textContent = t; };

async function session() {
  const r = await fetch('/api/google/picker-session', { method: 'POST', headers: { 'X-MonkeyCraft': '1', 'content-type': 'application/json' }, body: '{}' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'MonkeyCraft could not start the picker.');
  return d;
}

async function open() {
  $('again').hidden = true;
  let s;
  try { s = await session(); } catch (e) { say(e.message); return; }
  if (typeof gapi === 'undefined') { say("Google's picker didn't load. Check your internet connection and reload this page."); return; }
  gapi.load('picker', () => {
    const P = google.picker;
    const view = new P.DocsView(P.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(true).setMode(P.DocsViewMode.LIST);
    new P.PickerBuilder()
      .setAppId(s.appId).setOAuthToken(s.token).setDeveloperKey(s.apiKey)
      .addView(view).enableFeature(P.Feature.MULTISELECT_ENABLED)
      .setOrigin(location.origin).setTitle('Pick files for the Clerk')
      .setCallback(data => {
        if (data[P.Response.ACTION] === P.Action.PICKED) {
          for (const d of data[P.Response.DOCUMENTS]) { const li = document.createElement('li'); li.textContent = d[P.Document.NAME]; $('picked').append(li); }
          say('Done. The Clerk can now find and open these files:');
          $('again').hidden = false;
        } else if (data[P.Response.ACTION] === P.Action.CANCEL) { say('Nothing was picked.'); $('again').hidden = false; }
      })
      .build().setVisible(true);
  });
}
$('again').onclick = open;
open();
