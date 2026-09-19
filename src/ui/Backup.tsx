import { useRef, useState } from 'react';
import { useStore } from '../state/store';
import { backupFilename } from '../state/backup';

// Backup / restore, at the foot of the Saved tab.
//
// This is the escape hatch for the one thing the app cannot rebuild. The
// pressing case is iOS: a home-screen web app has its own storage container,
// and re-adding the icon — the only way to refresh a stale home-screen logo —
// starts a new, empty one. So the route out has to work from INSIDE a
// standalone web app on a phone, which rules out assuming a download lands
// anywhere the user can find. Three routes, in order of how well they survive
// that: the share sheet (Files, Notes, AirDrop, another device), a plain
// download, and failing both, the text on screen to copy by hand.

type Status = { kind: 'ok' | 'error'; message: string } | null;

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

export function Backup() {
  const exportUserState = useStore((s) => s.exportUserState);
  const restoreUserState = useStore((s) => s.restoreUserState);
  const userLoaded = useStore((s) => s.userLoaded);
  const visited = useStore((s) => s.visited);
  const wishlist = useStore((s) => s.wishlist);
  const hidden = useStore((s) => s.hidden);

  const [status, setStatus] = useState<Status>(null);
  const [showText, setShowText] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const count = Object.keys(visited).length + wishlist.size + hidden.size;

  async function save() {
    const text = exportUserState();
    const name = backupFilename();
    setShowText(null);

    const file = new File([text], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        setStatus({ kind: 'ok', message: 'Backup sent.' });
        return;
      } catch (err) {
        // A cancelled share is a decision, not a failure — say nothing and
        // leave the other two routes a tap away.
        if (isAbort(err)) return;
      }
    }

    try {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoked late: Safari reads the blob after the click returns.
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setStatus({ kind: 'ok', message: `Saved as ${name}.` });
      return;
    } catch {
      // Fall through to the text.
    }

    setShowText(text);
    setStatus({ kind: 'error', message: 'No file could be saved. Copy the text below instead.' });
  }

  async function copy() {
    const text = exportUserState();
    try {
      await navigator.clipboard.writeText(text);
      setShowText(null);
      setStatus({ kind: 'ok', message: 'Backup copied.' });
    } catch {
      setShowText(text);
      setStatus({ kind: 'error', message: 'Copying was blocked. Copy the text below instead.' });
    }
  }

  async function restore(text: string) {
    setShowText(null);
    try {
      const added = await restoreUserState(text);
      const parts = [
        `${added.visited} ${added.visited === 1 ? 'visit' : 'visits'}`,
        `${added.wishlist} wishlist`,
        `${added.hidden} hidden`,
      ];
      setStatus({ kind: 'ok', message: `Restored ${parts.join(', ')}.` });
      setPasting(false);
      setPasted('');
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'That backup could not be read.' });
    }
  }

  return (
    <section className="backup">
      <h3 className="stats-heading">Backup</h3>

      <div className="card-actions">
        <button className="btn primary" onClick={save} disabled={!userLoaded || count === 0}>
          Save a backup
        </button>
        <button className="btn" onClick={copy} disabled={!userLoaded || count === 0}>
          Copy as text
        </button>
      </div>

      <div className="card-actions">
        <button className="btn" onClick={() => fileInput.current?.click()} disabled={!userLoaded}>
          Restore from a file
        </button>
        <button className="btn" onClick={() => setPasting((p) => !p)} disabled={!userLoaded}>
          {pasting ? 'Cancel paste' : 'Paste a backup'}
        </button>
      </div>

      <input
        ref={fileInput}
        className="backup-file"
        type="file"
        accept="application/json,.json,text/plain"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          // Cleared first: picking the same file twice must fire onChange twice.
          e.target.value = '';
          if (file) await restore(await file.text());
        }}
      />

      {pasting && (
        <>
          <textarea
            className="backup-text"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="Paste the backup text here"
            rows={4}
          />
          <div className="card-actions">
            <button className="btn primary" onClick={() => restore(pasted)} disabled={!pasted.trim()}>
              Restore from text
            </button>
          </div>
        </>
      )}

      {status && <p className={`hint backup-status ${status.kind}`}>{status.message}</p>}

      {showText && <textarea className="backup-text" readOnly value={showText} rows={6} onFocus={(e) => e.target.select()} />}
    </section>
  );
}
