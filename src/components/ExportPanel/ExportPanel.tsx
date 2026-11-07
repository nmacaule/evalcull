/**
 * Export panel (PRD §2.10, §2.4; owner Q3 and Q6, 4 Nov 2026). One row per
 * export in the §3.7 allowlist but pairs.vertex.jsonl (WP 12): the preview
 * from computeExportStats until a download replaces it with buildExport's
 * exact stats. The download stays in the browser (PRD §2.9); the launcher's
 * POST /api/export is WP 9. The Session section downloads and loads the
 * session and says what browser storage keeps (PRD §2.7, §3.9).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useReviewStore } from '../../store/useReviewStore';
import { buildExport, computeExportStats } from '../../export';
import type { ExportName, ExportStats } from '../../export';
import { countPhrase } from '../../lib/plural';
import { downloadBlob } from '../../lib/download';
import { downloadSession } from '../../lib/sessionDownload';
import { AlertText, StatusMark } from '../StatusMark';

export interface ExportPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const EXPORTS: ExportName[] = [
  'pairs.jsonl',
  'pairs.edits.jsonl',
  'kept.jsonl',
  'rejected.jsonl',
  'skipped.jsonl',
  'all.decisions.jsonl',
];

const PAIRS_CAVEAT =
  'a DPO row needs one chosen and one rejected completion for the same prompt. Strength is carried in all.decisions.jsonl only.';
const EDITS_CAVEAT =
  'Edit pairs are off-policy: the chosen side was written by a person, not sampled from the model. DPO is sensitive to that distribution shift, and human-written chosen text can teach a length or style bias. Use them knowingly.';
const STORAGE_NOTE =
  'Browser storage is best-effort: Safari deletes it after seven days without a visit. Download the session to keep it.';

type Bom = 'keep' | 'strip' | 'add';

function exportTexts(name: ExportName, st: ExportStats, jsonl: boolean): string[] {
  switch (name) {
    case 'pairs.jsonl': {
      const texts = [
        `${countPhrase(st.pairsCount, 'pair', 'pairs')}. ${countPhrase(st.tiesExcluded, 'tie', 'ties')} and ${countPhrase(
          st.bothBadExcluded,
          'both-unacceptable pair',
          'both-unacceptable pairs'
        )} were left out: ${PAIRS_CAVEAT}`,
      ];
      if (st.implicitPromptCount > 0) {
        texts.push(
          `${countPhrase(
            st.implicitPromptCount,
            'row has no prompt field and uses',
            'rows have no prompt field and use'
          )} TRL's implicit-prompt format.`
        );
      }
      texts.push('Keep and Reject decisions alone never produce a preference pair.');
      return texts;
    }
    case 'pairs.edits.jsonl':
      return [`${countPhrase(st.editPairsCount, 'pair', 'pairs')} from edits.`, EDITS_CAVEAT];
    case 'all.decisions.jsonl':
      return [
        `${countPhrase(st.lineCount, 'line', 'lines')}.`,
        'Every record with its edits applied and its _triage decisions. Re-serialised; the original stays in the source file.',
      ];
    default:
      return [
        `${countPhrase(st.lineCount, 'line', 'lines')}.`,
        jsonl
          ? 'Unedited lines are copied byte for byte, including line endings. Only the lines you edited are re-serialised.'
          : 'Rows are re-serialised as JSONL.',
      ];
  }
}

// A fresh copy per file: its choices, exact stats and refused session belong to that file (D-049, DR-001 rule 5)
export function ExportPanel(props: ExportPanelProps) {
  const fingerprint = useReviewStore((s) => s.fingerprint);
  return <ExportPanelForFile key={fingerprint} {...props} />;
}

function ExportPanelForFile({ open, onOpenChange }: ExportPanelProps) {
  const source = useReviewStore((s) => s.source);
  const decisions = useReviewStore((s) => s.decisions);
  const format = useReviewStore((s) => s.format);
  const session = useReviewStore((s) => s.session);
  const newerLocalCopy = useReviewStore((s) => s.newerLocalCopy);
  // Nothing that replaces the session starts while a switch is opening (DR-001 rule 6)
  const switching = useReviewStore((s) => s.switching.kind === 'opening');

  const [bom, setBom] = useState<Bom>('keep');
  const [excludeUnparseable, setExcludeUnparseable] = useState(false);
  const [exact, setExact] = useState<Partial<Record<ExportName, ExportStats>>>({});
  const [busy, setBusy] = useState<ExportName | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The session file this panel is loading, recorded before its import starts: its
  // text for Load anyway and its name, which Load anyway's switch reports (D-077).
  // A fresh object per load, passed as the import's request (D-088)
  const [loading, setLoading] = useState<{ text: string; name: string } | null>(null);
  // Load anyway is decided from the store's state alone: a fingerprint refusal of
  // this panel's current load, so the refusal and its offer render in one commit
  // (D-078, D-081, D-087, D-088); a refusal at load carries no request
  const offerLoadAnyway =
    loading !== null &&
    session.kind === 'refused' &&
    session.reason === 'fingerprint-mismatch' &&
    session.request === loading;
  const sessionInput = useRef<HTMLInputElement>(null);

  const jsonl = source?.kind === 'jsonl';
  const hasBom = source?.kind === 'jsonl' && source.index.hasBom;
  const unparseable = source?.kind === 'jsonl' ? source.index.unparseable.length : 0;

  // Previews are computed only while the panel is open: kept, rejected and
  // skipped walk every line, which no key press should pay for
  const previews = useMemo(() => {
    if (!open || !source) return null;
    const out = {} as Record<ExportName, ExportStats>;
    for (const name of EXPORTS) {
      out[name] = computeExportStats(name, source, decisions, format, { excludeUnparseable });
    }
    return out;
  }, [open, source, decisions, format, excludeUnparseable]);

  // A change to the decisions or options makes earlier exact stats stale
  useEffect(() => {
    setExact({});
  }, [decisions, format, bom, excludeUnparseable]);

  const download = async (name: ExportName) => {
    const state = useReviewStore.getState();
    if (!state.source) return;
    setBusy(name);
    setError(null);
    try {
      const result = await buildExport(name, {
        source: state.source,
        decisions: state.decisions,
        format: state.format,
        record: state.record,
        opts: { bom, excludeUnparseable },
      });
      downloadBlob(result.blob, name);
      setExact((prev) => ({ ...prev, [name]: result.stats }));
    } catch (err) {
      setError(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };


  const loadSession = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    // Committed before the import, so its refusal renders with the offer (D-087)
    const request = { text, name: file.name };
    flushSync(() => setLoading(request));
    await useReviewStore.getState().importSession(text, { name: file.name, request });
  };

  const loadAnyway = async () => {
    if (loading === null) return;
    await useReviewStore.getState().importSession(loading.text, { force: true, name: loading.name });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-dialog-wide dialog-max overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Export</DialogTitle>
          <DialogDescription>Downloads are written by your browser; nothing is uploaded.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-4 text-chrome">
          {hasBom && (
            // A warning: a word and dot in neutral-11 (DR-017)
            <StatusMark tone="quiet" word="BOM present" />
          )}
          <fieldset className="flex items-center gap-2">
            <legend className="sr-only">Byte order mark</legend>
            <span className="text-neutral-11">BOM:</span>
            {(['keep', 'strip', 'add'] as Bom[]).map((b) => (
              <label key={b} className="flex items-center gap-1">
                <input type="radio" name="bom" value={b} checked={bom === b} onChange={() => setBom(b)} />
                {b}
              </label>
            ))}
          </fieldset>
          {unparseable > 0 && (
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={excludeUnparseable}
                onChange={(e) => setExcludeUnparseable(e.target.checked)}
              />
              Exclude {countPhrase(unparseable, 'unparseable line', 'unparseable lines')}
            </label>
          )}
        </div>

        {error && (
          <AlertText>{error}</AlertText>
        )}

        <div className="flex flex-col gap-3">
          {previews &&
            EXPORTS.map((name) => {
              const st = exact[name] ?? previews[name];
              return (
                <section key={name} aria-label={name} className="rounded-panel border border-neutral-6 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-mono text-mono font-semibold">{name}</h3>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy !== null}
                      onClick={() => download(name)}
                      aria-label={`Download ${name}`}
                    >
                      {busy === name ? 'Exporting…' : 'Download'}
                    </Button>
                  </div>
                  {exportTexts(name, st, jsonl).map((t) => (
                    <p key={t} className="text-chrome text-neutral-11 mt-1">
                      {t}
                    </p>
                  ))}
                </section>
              );
            })}
        </div>

        <section aria-label="Session" className="rounded-panel border border-neutral-6 p-3 flex flex-col gap-2">
          <h3 className="label text-neutral-11">Session</h3>
          <p className="text-chrome text-neutral-11">{STORAGE_NOTE}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={downloadSession}>
              Download session
            </Button>
            <Button size="sm" variant="secondary" disabled={switching} onClick={() => sessionInput.current?.click()}>
              Load session
            </Button>
            <input
              ref={sessionInput}
              type="file"
              accept=".json"
              className="hidden"
              aria-label="Session file"
              onChange={(e) => {
                loadSession(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
          {session.kind === 'refused' && (
            <div className="flex items-center gap-2">
              <AlertText>{session.message}</AlertText>
              {offerLoadAnyway && (
                <Button size="sm" variant="secondary" disabled={switching} onClick={loadAnyway}>
                  Load anyway
                </Button>
              )}
            </div>
          )}
          {newerLocalCopy && (
            <div className="text-chrome text-neutral-12 flex items-center gap-2">
              <span>
                A newer copy saved in this browser at {new Date(newerLocalCopy.savedAt).toLocaleString('en-US')}{' '}
                differs from the session file.
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={switching}
                onClick={() => useReviewStore.getState().applyNewerLocalCopy()}
              >
                Use the newer copy
              </Button>
            </div>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
