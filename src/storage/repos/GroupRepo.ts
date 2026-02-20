import { eq, and } from "drizzle-orm";
import { db } from "../db.js";
import { groups, groupMembers, users } from "../schema.js";
import type { Group } from "../../types/index.js";

export class GroupRepo {
  async create(group: Omit<Group, "createdAt">): Promise<Group> {
    const now = new Date();

    await db.insert(groups).values({
      id: group.id,
      name: group.name,
      createdBy: group.createdBy,
      createdAt: now,
    });

    // Add members
    if (group.members.length > 0) {
      await db.insert(groupMembers).values(
        group.members.map((userId) => ({
          id: `${group.id}_${userId}_${Date.now()}`,
          groupId: group.id,
          userId,
          joinedAt: now,
        }))
      );
    }

    return {
      ...group,
      createdAt: now,
    };
  }

  async findById(id: string): Promise<Group | null> {
    const group = await db.select().from(groups).where(eq(groups.id, id)).get();

    if (!group) return null;

    const members = await db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, id));

    return {
      id: group.id,
      name: group.name,
      members: members.map((m) => m.userId),
      createdAt: group.createdAt,
      createdBy: group.createdBy,
    };
  }

  async addMember(groupId: string, userId: string): Promise<void> {
    await db.insert(groupMembers).values({
      id: `${groupId}_${userId}_${Date.now()}`,
      groupId,
      userId,
      joinedAt: new Date(),
    });
  }

  async removeMember(groupId: string, userId: string): Promise<void> {
    await db
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
  }

  async update(id: string, data: Partial<Pick<Group, "name">>): Promise<Group | null> {
    await db.update(groups).set(data).where(eq(groups.id, id));
    return this.findById(id);
  }

  async delete(id: string): Promise<void> {
    await db.delete(groups).where(eq(groups.id, id));
  }
}
