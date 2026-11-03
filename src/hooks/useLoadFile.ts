/**
 * Temporary: Minimal file-input hook for WP 6a.
 * 6b replaces this with Dropzone and deletes this file.
 */

import { useCallback, useState } from 'react';
import { readJsonl } from '../readers/jsonl';
import { useReviewStore } from '../store/useReviewStore';

export interface UseLoadFileReturn {
  /** Whether a file is currently being loaded */
  isLoading: boolean;
  /** Error message if loading failed */
  error: string | null;
  /** Progress (bytes loaded / total bytes) */
  progress: { loaded: number; total: number } | null;
  /** Handle file input change */
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function useLoadFile(): UseLoadFileReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    loaded: number;
    total: number;
  } | null>(null);

  const load = useReviewStore((s) => s.load);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsLoading(true);
      setError(null);
      setProgress({ loaded: 0, total: file.size });

      try {
        const result = await readJsonl(
          file,
          file.name,
          file.size,
          file.lastModified,
          {
            onProgress: (bytes, total) => {
              setProgress({ loaded: bytes, total });
            },
          }
        );

        await load(
          result.source,
          {
            sourceName: file.name,
            fingerprint: result.source.index.fingerprint,
            format: result.format,
          },
          {
            regroup: result.regroup,
            dispose: result.dispose,
          }
        );

        setIsLoading(false);
        setProgress(null);
      } catch (err) {
        setIsLoading(false);
        setProgress(null);
        setError(err instanceof Error ? err.message : String(err));
      }

      // Reset input so the same file can be selected again
      e.target.value = '';
    },
    [load]
  );

  return {
    isLoading,
    error,
    progress,
    handleFileChange,
  };
}
