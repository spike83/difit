import { createContext, useContext, type ReactNode } from 'react';

// Thread actions beyond resolve/reply/edit, so they need not be passed through every viewer.
export interface CommentActions {
  reopenThread?: (threadId: string) => void;
  deleteThread?: (threadId: string) => void;
  toggleTodo?: (threadId: string) => void;
  markRead?: (threadId: string, messageIds: string[]) => void;
}

const CommentActionsContext = createContext<CommentActions>({});

export function CommentActionsProvider({
  value,
  children,
}: {
  value: CommentActions;
  children: ReactNode;
}) {
  return <CommentActionsContext.Provider value={value}>{children}</CommentActionsContext.Provider>;
}

export function useCommentActions(): CommentActions {
  return useContext(CommentActionsContext);
}
