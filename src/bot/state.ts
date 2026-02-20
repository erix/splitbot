export interface GroupMemberOption {
  id: string;
  name: string;
}

export type ConversationState =
  | {
      step: "awaiting_amount";
      ownerUserId: string;
    }
  | {
      step: "awaiting_description";
      ownerUserId: string;
      amountCents: number;
    }
  | {
      step: "awaiting_paid_by";
      ownerUserId: string;
      amountCents: number;
      description: string;
      members: GroupMemberOption[];
    }
  | {
      step: "awaiting_split_with";
      ownerUserId: string;
      amountCents: number;
      description: string;
      paidBy: string;
      members: GroupMemberOption[];
      selectedParticipantIds: string[];
    };

export const activeGroupByChat = new Map<number, string>();
export const conversationByChat = new Map<number, ConversationState>();
export const knownGroupsByUser = new Map<string, Set<string>>();

export function rememberGroupForUser(userId: string, groupId: string): void {
  const existing = knownGroupsByUser.get(userId);

  if (existing) {
    existing.add(groupId);
    return;
  }

  knownGroupsByUser.set(userId, new Set([groupId]));
}
