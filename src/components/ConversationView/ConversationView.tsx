/**
 * Threaded conversation renderer for messages-format records.
 * WP 6a: Renders messages with role labels, supports turn selection for editing.
 * WP 7b (PRD §2.11 screen 5): turns 12 px apart, each role a text-label in
 * neutral-11 with no colour fill; a hovered editable turn keeps its surface and
 * shows the neutral-8 border (DR-021); the selected turn is accent-3 with all
 * its text in neutral-12 (O15); W's marks render through Revealed (DR-022).
 */

import { useMemo } from 'react';
import { Revealed } from '../RawView';

export interface ConversationViewProps {
  /** Each turn's content as display text, before any whitespace reveal */
  messages: Array<{ role: string; content: string }>;
  roles: { user: string[]; assistant: string[]; system: string[] };
  editingTurnIndex: number | null;
  onSelectTurn: (index: number) => void;
  showWhitespace: boolean;
}

type RoleCategory = 'user' | 'assistant' | 'system';

function getRoleCategory(
  role: string,
  roles: ConversationViewProps['roles']
): RoleCategory {
  if (roles.user.includes(role)) return 'user';
  if (roles.assistant.includes(role)) return 'assistant';
  if (roles.system.includes(role)) return 'system';
  // Default to user for unknown roles
  return 'user';
}

export function ConversationView({
  messages,
  roles,
  editingTurnIndex,
  onSelectTurn,
  showWhitespace,
}: ConversationViewProps) {
  const categorizedMessages = useMemo(() => {
    return messages.map((msg, index) => ({
      ...msg,
      index,
      category: getRoleCategory(msg.role, roles),
    }));
  }, [messages, roles]);

  return (
    <div className="flex flex-col gap-3">
      {categorizedMessages.map((msg) => {
        const isEditable = msg.category === 'assistant';
        const isSelected = editingTurnIndex === msg.index;
        const secondary = isSelected ? 'text-neutral-12' : 'text-neutral-11';

        return (
          <div
            key={msg.index}
            className={`flex flex-col gap-1 rounded-control border p-3 transition-state ${
              isSelected ? 'border-transparent bg-accent-3' : 'border-transparent'
            } ${isEditable ? 'cursor-pointer hover:border-neutral-8' : ''}`}
            onClick={isEditable ? () => onSelectTurn(msg.index) : undefined}
            role={isEditable ? 'button' : undefined}
            tabIndex={isEditable ? 0 : undefined}
            onKeyDown={
              isEditable
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectTurn(msg.index);
                    }
                  }
                : undefined
            }
          >
            <div className="flex items-center gap-2">
              <span className={`label ${secondary}`}>{msg.role}</span>
              {isEditable && <span className={`text-chrome ${secondary}`}>(click to edit)</span>}
            </div>
            <div className="whitespace-pre-wrap text-content text-neutral-12 max-w-content">
              <Revealed text={msg.content} show={showWhitespace} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
