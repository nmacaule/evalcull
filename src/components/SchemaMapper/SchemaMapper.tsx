/**
 * Schema mapping modal for WP 5.
 *
 * Allows user to:
 * - Select shape type
 * - Configure paths per shape
 * - Reassign role mappings for messages shape
 * - Preview resolved values before applying
 */

import { useState, useMemo, useCallback } from 'react';
import type { RecordFormat } from '../../types';
import { parsePath, getByPath } from '../../lib/path';
import { collectRoles } from '../../lib/schema';
import { displayValue } from '../../lib/display';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface SchemaMapperProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentFormat: RecordFormat;
  sampleRecords: unknown[];
  onApply: (format: RecordFormat) => void;
  /** Told when the user changes a field: from then the modal holds a draft (DR-001 rule 6, D-069) */
  onDraftChange?: () => void;
}

type ShapeKind = 'flat' | 'messages' | 'preference' | 'candidates' | 'unknown';

interface PathFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  preview: string | null;
  optional?: boolean;
}

function PathField({ label, value, onChange, error, preview, optional }: PathFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={label}>
        {label}
        {optional && <span className="text-muted-foreground ml-1">(optional)</span>}
      </Label>
      <Input
        id={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`e.g., ${label.toLowerCase().replace(' ', '_')}`}
        aria-invalid={!!error}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {preview !== null && !error && (
        <p className="text-sm text-muted-foreground truncate">
          Preview: {preview || '(empty)'}
        </p>
      )}
    </div>
  );
}

interface RoleAssignmentProps {
  roleValues: string[];
  assignments: Record<string, 'user' | 'assistant' | 'system'>;
  onChange: (role: string, category: 'user' | 'assistant' | 'system') => void;
}

function RoleAssignment({ roleValues, assignments, onChange }: RoleAssignmentProps) {
  return (
    <div className="space-y-2">
      <Label>Role Mappings</Label>
      <div className="space-y-1">
        {roleValues.map((role) => (
          <div key={role} className="flex items-center gap-2">
            <span className="text-sm font-mono min-w-20">{role}</span>
            <span className="text-muted-foreground">→</span>
            <select
              value={assignments[role] ?? 'user'}
              onChange={(e) =>
                onChange(role, e.target.value as 'user' | 'assistant' | 'system')
              }
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="user">user</option>
              <option value="assistant">assistant</option>
              <option value="system">system</option>
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SchemaMapper({
  open,
  onOpenChange,
  currentFormat,
  sampleRecords,
  onApply,
  onDraftChange,
}: SchemaMapperProps) {
  // Track selected shape
  const [selectedShape, setSelectedShape] = useState<ShapeKind>(currentFormat.kind);

  // Path values
  const [promptPath, setPromptPath] = useState(
    currentFormat.kind === 'flat'
      ? currentFormat.promptPath
      : currentFormat.kind === 'preference' && currentFormat.promptPath
        ? currentFormat.promptPath
        : currentFormat.kind === 'candidates'
          ? currentFormat.promptPath
          : ''
  );
  const [responsePath, setResponsePath] = useState(
    currentFormat.kind === 'flat' ? currentFormat.responsePath : ''
  );
  const [messagesPath, setMessagesPath] = useState(
    currentFormat.kind === 'messages' ? currentFormat.path : 'messages'
  );
  const [roleKey, setRoleKey] = useState(
    currentFormat.kind === 'messages' ? currentFormat.roleKey : 'role'
  );
  const [contentKey, setContentKey] = useState(
    currentFormat.kind === 'messages' ? currentFormat.contentKey : 'content'
  );
  const [chosenPath, setChosenPath] = useState(
    currentFormat.kind === 'preference' ? currentFormat.chosenPath : 'chosen'
  );
  const [rejectedPath, setRejectedPath] = useState(
    currentFormat.kind === 'preference' ? currentFormat.rejectedPath : 'rejected'
  );
  const [candidatesPath, setCandidatesPath] = useState(
    currentFormat.kind === 'candidates' ? currentFormat.candidatesPath : 'candidates'
  );

  // Detected roles from sample records
  const detectedRoles = useMemo(() => {
    if (selectedShape !== 'messages' || sampleRecords.length === 0) return [];
    return Array.from(collectRoles(sampleRecords, messagesPath, roleKey));
  }, [selectedShape, sampleRecords, messagesPath, roleKey]);

  // User overrides only - not the full mapping
  const [roleOverrides, setRoleOverrides] = useState<
    Record<string, 'user' | 'assistant' | 'system'>
  >(() => {
    // Initialize from currentFormat if it's messages
    const initial: Record<string, 'user' | 'assistant' | 'system'> = {};
    if (currentFormat.kind === 'messages') {
      for (const role of currentFormat.roles.user) initial[role] = 'user';
      for (const role of currentFormat.roles.assistant) initial[role] = 'assistant';
      for (const role of currentFormat.roles.system) initial[role] = 'system';
    }
    return initial;
  });

  // Derive effective role assignments: defaults + overrides (pure)
  const effectiveRoleAssignments = useMemo(() => {
    const assignments: Record<string, 'user' | 'assistant' | 'system'> = {};
    for (const role of detectedRoles) {
      // Check for user override first
      if (role in roleOverrides) {
        assignments[role] = roleOverrides[role];
      } else {
        // Apply default based on role name
        const lower = role.toLowerCase();
        if (['user', 'human'].includes(lower)) {
          assignments[role] = 'user';
        } else if (['assistant', 'gpt', 'model', 'bot'].includes(lower)) {
          assignments[role] = 'assistant';
        } else if (lower === 'system') {
          assignments[role] = 'system';
        } else {
          assignments[role] = 'user';
        }
      }
    }
    return assignments;
  }, [detectedRoles, roleOverrides]);

  // Validation
  const validatePath = useCallback(
    (path: string, allowEmpty: boolean = false): { error: string | null; preview: string | null } => {
      if (!path && allowEmpty) return { error: null, preview: null };
      if (!path) return { error: 'Path is required', preview: null };

      try {
        const segments = parsePath(path);
        if (sampleRecords.length === 0) return { error: null, preview: null };

        const value = getByPath(sampleRecords[0], segments);
        if (value === undefined) {
          return { error: null, preview: '(not found)' };
        }
        if (typeof value === 'string') {
          return { error: null, preview: value.slice(0, 100) };
        }
        if (Array.isArray(value)) {
          return { error: null, preview: `[${value.length} items]` };
        }
        // Samples are lossless-json values, so numbers preview as written (D-082)
        return { error: null, preview: displayValue(value).slice(0, 100) };
      } catch (e) {
        return { error: String(e), preview: null };
      }
    },
    [sampleRecords]
  );

  // Build validation results
  const promptPathValidation = validatePath(promptPath, selectedShape === 'preference');
  const responsePathValidation = validatePath(responsePath);
  const messagesPathValidation = validatePath(messagesPath);
  const chosenPathValidation = validatePath(chosenPath);
  const rejectedPathValidation = validatePath(rejectedPath);
  const candidatesPathValidation = validatePath(candidatesPath);

  // Check if form is valid
  const isValid = useMemo(() => {
    switch (selectedShape) {
      case 'flat':
        return !promptPathValidation.error && !responsePathValidation.error && promptPath && responsePath;
      case 'messages':
        return !messagesPathValidation.error && messagesPath && roleKey && contentKey;
      case 'preference':
        return (
          !promptPathValidation.error &&
          !chosenPathValidation.error &&
          !rejectedPathValidation.error &&
          chosenPath &&
          rejectedPath
        );
      case 'candidates':
        return (
          !promptPathValidation.error &&
          !candidatesPathValidation.error &&
          promptPath &&
          candidatesPath
        );
      case 'unknown':
        return false;
      default:
        return false;
    }
  }, [
    selectedShape,
    promptPath,
    responsePath,
    messagesPath,
    roleKey,
    contentKey,
    chosenPath,
    rejectedPath,
    candidatesPath,
    promptPathValidation.error,
    responsePathValidation.error,
    messagesPathValidation.error,
    chosenPathValidation.error,
    rejectedPathValidation.error,
    candidatesPathValidation.error,
  ]);

  // Build format and apply
  const handleApply = useCallback(() => {
    let format: RecordFormat;

    switch (selectedShape) {
      case 'flat':
        format = {
          kind: 'flat',
          promptPath,
          responsePath,
        };
        break;
      case 'messages': {
        const roles = { user: [] as string[], assistant: [] as string[], system: [] as string[] };
        for (const [role, category] of Object.entries(effectiveRoleAssignments)) {
          roles[category].push(role);
        }
        format = {
          kind: 'messages',
          path: messagesPath,
          roleKey,
          contentKey,
          roles,
        };
        break;
      }
      case 'preference':
        format = promptPath
          ? {
              kind: 'preference',
              promptPath,
              chosenPath,
              rejectedPath,
            }
          : {
              kind: 'preference',
              chosenPath,
              rejectedPath,
            };
        break;
      case 'candidates':
        format = {
          kind: 'candidates',
          promptPath,
          candidatesPath,
        };
        break;
      default:
        return;
    }

    onApply(format);
    onOpenChange(false);
  }, [
    selectedShape,
    promptPath,
    responsePath,
    messagesPath,
    roleKey,
    contentKey,
    effectiveRoleAssignments,
    chosenPath,
    rejectedPath,
    candidatesPath,
    onApply,
    onOpenChange,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Every field is a native input or select, so one capture handler sees any change (D-069) */}
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto" onChangeCapture={() => onDraftChange?.()}>
        <DialogHeader>
          <DialogTitle>Configure Record Format</DialogTitle>
          <DialogDescription>
            Select the shape of your data and configure the paths to extract prompts and responses.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Shape selector */}
          <div className="space-y-1.5">
            <Label htmlFor="shape">Data Shape</Label>
            <select
              id="shape"
              value={selectedShape}
              onChange={(e) => setSelectedShape(e.target.value as ShapeKind)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="flat">Flat (prompt/response)</option>
              <option value="messages">Messages (conversation)</option>
              <option value="preference">Preference (chosen/rejected)</option>
              <option value="candidates">Candidates (multiple responses)</option>
              <option value="unknown">Unknown</option>
            </select>
          </div>

          {/* Shape-specific fields */}
          {selectedShape === 'flat' && (
            <>
              <PathField
                label="Prompt Path"
                value={promptPath}
                onChange={setPromptPath}
                error={promptPathValidation.error}
                preview={promptPathValidation.preview}
              />
              <PathField
                label="Response Path"
                value={responsePath}
                onChange={setResponsePath}
                error={responsePathValidation.error}
                preview={responsePathValidation.preview}
              />
            </>
          )}

          {selectedShape === 'messages' && (
            <>
              <PathField
                label="Messages Path"
                value={messagesPath}
                onChange={setMessagesPath}
                error={messagesPathValidation.error}
                preview={messagesPathValidation.preview}
              />
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="roleKey">Role Key</Label>
                  <Input
                    id="roleKey"
                    value={roleKey}
                    onChange={(e) => setRoleKey(e.target.value)}
                    placeholder="role"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="contentKey">Content Key</Label>
                  <Input
                    id="contentKey"
                    value={contentKey}
                    onChange={(e) => setContentKey(e.target.value)}
                    placeholder="content"
                  />
                </div>
              </div>
              {detectedRoles.length > 0 && (
                <RoleAssignment
                  roleValues={detectedRoles}
                  assignments={effectiveRoleAssignments}
                  onChange={(role, category) =>
                    setRoleOverrides((prev) => ({ ...prev, [role]: category }))
                  }
                />
              )}
            </>
          )}

          {selectedShape === 'preference' && (
            <>
              <PathField
                label="Prompt Path"
                value={promptPath}
                onChange={setPromptPath}
                error={promptPathValidation.error}
                preview={promptPathValidation.preview}
                optional
              />
              <PathField
                label="Chosen Path"
                value={chosenPath}
                onChange={setChosenPath}
                error={chosenPathValidation.error}
                preview={chosenPathValidation.preview}
              />
              <PathField
                label="Rejected Path"
                value={rejectedPath}
                onChange={setRejectedPath}
                error={rejectedPathValidation.error}
                preview={rejectedPathValidation.preview}
              />
            </>
          )}

          {selectedShape === 'candidates' && (
            <>
              <PathField
                label="Prompt Path"
                value={promptPath}
                onChange={setPromptPath}
                error={promptPathValidation.error}
                preview={promptPathValidation.preview}
              />
              <PathField
                label="Candidates Path"
                value={candidatesPath}
                onChange={setCandidatesPath}
                error={candidatesPathValidation.error}
                preview={candidatesPathValidation.preview}
              />
            </>
          )}

          {selectedShape === 'unknown' && (
            <p className="text-sm text-muted-foreground">
              Select a data shape above to configure the format.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={!isValid}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
