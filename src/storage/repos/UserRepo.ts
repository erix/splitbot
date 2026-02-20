import { eq, sql } from "drizzle-orm";
import { db } from "../db.js";
import { users } from "../schema.js";
import type { User } from "../../types/index.js";

export class UserRepo {
  async create(user: Omit<User, "username"> & { username?: string }): Promise<User> {
    const now = new Date();
    const normalizedUsername = user.username?.toLowerCase();

    await db.insert(users).values({
      id: user.id,
      name: user.name,
      username: normalizedUsername,
      createdAt: now,
    });

    return {
      id: user.id,
      name: user.name,
      username: normalizedUsername,
    };
  }

  async findById(id: string): Promise<User | null> {
    const result = await db.select().from(users).where(eq(users.id, id)).get();

    if (!result) return null;

    return {
      id: result.id,
      name: result.name,
      username: result.username || undefined,
    };
  }

  async update(id: string, data: Partial<Omit<User, "id">>): Promise<User | null> {
    const updateData: Partial<Omit<User, "id">> = {
      ...data,
      username: data.username?.toLowerCase(),
    };

    await db.update(users).set(updateData).where(eq(users.id, id));
    return this.findById(id);
  }

  async findByUsername(username: string): Promise<User | null> {
    const normalized = username.replace(/^@/, "").toLowerCase();
    if (!normalized) {
      return null;
    }

    const result = await db
      .select()
      .from(users)
      .where(sql`lower(${users.username}) = ${normalized}`)
      .get();

    if (!result) {
      return null;
    }

    return {
      id: result.id,
      name: result.name,
      username: result.username || undefined,
    };
  }

  async delete(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }
}
