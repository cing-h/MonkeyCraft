// Google Drive basics for the Clerk: find, read, make folders, rename, move
// and bin. There is deliberately NO way to change who a file is shared with,
// and no outright delete: mistakes go to the Drive bin, where the user can
// get them back for 30 days.
//
// revertChange() undoes one recorded change for "Revert this job".

const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const FIELDS = 'id,name,mimeType,modifiedTime,webViewLink,parents,trashed';
export const MIME = {
  doc: 'application/vnd.google-apps.document',
  sheet: 'application/vnd.google-apps.spreadsheet',
  slides: 'application/vnd.google-apps.presentation',
  folder: 'application/vnd.google-apps.folder'
};
const KIND = Object.fromEntries(Object.entries(MIME).map(([k, v]) => [v, k]));
const KIND_LABEL = { doc: 'Google Doc', sheet: 'Google Sheet', slides: 'Google Slides deck', folder: 'folder' };
export const kindOf = mime => KIND[mime] || 'file';
export const describe = f => `${KIND_LABEL[kindOf(f.mimeType)] || 'file'} "${f.name}"`;
export const FILE_ID = /^[A-Za-z0-9_-]{10,200}$/;
const q = s => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;   // Drive query string literal

// what each Google type is read as
const EXPORT = { doc: 'text/plain', sheet: 'text/csv', slides: 'text/plain' };

export function makeDrive({ api }) {
  const get = (id, signal) => api.call('GET', `${DRIVE}/${encodeURIComponent(id)}`, { query: { fields: FIELDS }, signal });
  const patch = (id, body, query = {}, signal) => api.call('PATCH', `${DRIVE}/${encodeURIComponent(id)}`, { query: { fields: FIELDS, ...query }, body, signal });

  const drive = {
    get,
    async find({ name, kind = 'any', folderId, limit = 25 } = {}, signal) {
      const parts = ['trashed = false'];
      if (name) parts.push(`name contains ${q(name)}`);
      if (kind !== 'any' && MIME[kind]) parts.push(`mimeType = ${q(MIME[kind])}`);
      if (folderId) parts.push(`${q(folderId)} in parents`);
      const d = await api.call('GET', DRIVE, { query: { q: parts.join(' and '), pageSize: Math.min(limit, 100), orderBy: 'modifiedTime desc', fields: `files(${FIELDS})`, spaces: 'drive' }, signal });
      return d.files || [];
    },
    /** The file's text: Docs as plain text, Sheets as CSV (first tab), Slides as plain text. */
    async readText(file, signal) {
      const fmt = EXPORT[kindOf(file.mimeType)];
      if (!fmt) return null;
      return api.call('GET', `${DRIVE}/${encodeURIComponent(file.id)}/export`, { query: { mimeType: fmt }, raw: true, signal });
    },
    createFolder: (name, parentId, signal) => api.call('POST', DRIVE, { query: { fields: FIELDS }, body: { name, mimeType: MIME.folder, ...(parentId ? { parents: [parentId] } : {}) }, signal }),
    rename: (id, name, signal) => patch(id, { name }, {}, signal),
    async move(id, toFolderId, signal) {
      const f = await get(id, signal);
      return patch(id, {}, { addParents: toFolderId, removeParents: (f.parents || []).join(',') || undefined }, signal);
    },
    bin: (id, signal) => patch(id, { trashed: true }, {}, signal),
    unbin: (id, signal) => patch(id, { trashed: false }, {}, signal),
    copy: (id, name, signal) => api.call('POST', `${DRIVE}/${encodeURIComponent(id)}/copy`, { query: { fields: FIELDS }, body: { name }, signal }),

    /**
     * Undo one recorded Google change. `r.remote` is what the tool saved:
     *   { kind: 'create', fileId } → bin it
     *   { kind: 'rename', fileId, from, to } → name it back, if it still has the new name
     *   { kind: 'move', fileId, fromParents, toParent } → move it back, if it's still there
     *   { kind: 'bin', fileId } → take it out of the bin
     * Returns a result string, like the file undo store does.
     */
    async revertChange(r) {
      const x = r.remote || {};
      let f;
      try { f = await get(x.fileId); } catch (e) { return e.status === 404 ? 'skipped: it is gone from Google Drive' : `skipped: ${e.message}`; }
      switch (x.kind) {
        case 'create':
          if (f.trashed) return 'skipped: already in the bin';
          await drive.bin(x.fileId); return 'binned';
        case 'rename':
          if (f.name !== x.to) return 'skipped: it was renamed again afterwards';
          await drive.rename(x.fileId, x.from); return 'restored';
        case 'move': {
          const now = f.parents || [];
          if (!now.includes(x.toParent)) return 'skipped: it was moved again afterwards';
          await patch(x.fileId, {}, { addParents: (x.fromParents || []).join(','), removeParents: x.toParent });
          return 'moved back';
        }
        case 'bin':
          if (!f.trashed) return 'skipped: it is no longer in the bin';
          await drive.unbin(x.fileId); return 'restored';
        default: return 'skipped: unknown change';
      }
    }
  };
  return drive;
}
