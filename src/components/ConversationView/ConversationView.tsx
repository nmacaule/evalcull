/**
 * Threaded conversation renderer for messages-format records.
 * WP 6a: Renders messages with role badges, supports turn selection for editing.
 */

import { useMemo } from 'react';

export interface ConversationViewProps {
  messages: Array<{ role: string; content: string }>;
  roles: { user: string[]; assistant: string[]; system: string[] };
  editingTurnIndex: number | null;
  onSelectTurn: (index: number) => void;
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

function getRoleBadgeStyles(category: RoleCategory): string {
  switch (category) {
    case 'user':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
    case 'assistant':
      return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    case 'system':
      return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
  }
}

export function ConversationView({
  messages,
  roles,
  editingTurnIndex,
  onSelectTurn,
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

        return (
          <div
            key={msg.index}
            className={`flex flex-col gap-1 rounded-md p-3 ${
              isSelected ? 'ring-2 ring-primary' : ''
            } ${isEditable ? 'cursor-pointer hover:bg-muted/50' : ''}`}
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
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded ${getRoleBadgeStyles(msg.category)}`}
              >
                {msg.role}
              </span>
              {isEditable && (
                <span className="text-xs text-muted-foreground">
                  (click to edit)
                </span>
              )}
            </div>
            <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
          </div>
        );
      })}
    </div>
  );
}
