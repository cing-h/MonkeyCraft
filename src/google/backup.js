// The Clerk's backup rule, shared by Docs, Sheets and Slides: before the first
// edit in a job of a Google file that job didn't make, copy the file in Drive.
// Google's APIs can't restore an old version, so "Revert this job" points to
// this copy instead (it never bins it).

const stamp = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

export function makeBackups({ drive, undo, clock }) {
  /** True if this job made the file, or has already backed it up. */
  const covered = async (runId, fileId) => (await undo.list(runId)).some(r => r.op === 'remote' && r.done && r.remote?.fileId === fileId && (r.remote.kind === 'create' || r.remote.kind === 'edit'));
  return {
    covered,
    /** A line for the permission preview. */
    async note(runId, fileId) { return (await covered(runId, fileId)) ? '' : '\n  (a backup copy is saved in Drive first)'; },
    /** Copy the file if needed. Returns the backup's name, or null if none was needed. */
    async first(ctx, file) {
      if (await covered(ctx.runId, file.id)) return null;
      const backupName = `${file.name} (backup before MonkeyCraft, ${stamp(clock.now())})`;
      const label = `Google Drive: edited "${file.name}"`;
      const s = await undo.saveRemote({ runId: ctx.runId, label, remote: { kind: 'edit', fileId: file.id } });
      ctx.emit('undo.saved', { undoId: s.undoId, path: label, op: 'write' });
      const copy = await drive.copy(file.id, backupName, ctx.signal);
      await undo.settleRemote(ctx.runId, s.undoId, { kind: 'edit', fileId: file.id, backupId: copy.id, backupName });
      return backupName;
    },
    /** Record a file this job is about to make; call done(fileId) once Google has made it. */
    async creating(ctx, label) {
      const s = await undo.saveRemote({ runId: ctx.runId, label: `Google Drive: ${label}`, remote: { kind: 'create' } });
      ctx.emit('undo.saved', { undoId: s.undoId, path: `Google Drive: ${label}`, op: 'write' });
      return fileId => undo.settleRemote(ctx.runId, s.undoId, { kind: 'create', fileId });
    }
  };
}
