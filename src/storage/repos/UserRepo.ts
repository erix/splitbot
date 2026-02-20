import { eq } from "drizzle-orm";
import { db } from "../db.js";
import { users } from "../schema.js";
import type { User } from "../../types/index.js";

export class UserRepo {
  async create(user: Omit<User, "username"> & { username?: string }): Promise<User> {
    const now = new Date();

    await db.insert(users).values({
      id: user.id,
      name: user.name,
      username: user.username,
      createdAt: now,
    });

    return {
      id: user.id,
      name: user.name,
      username: user.username,
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
    await db.update(users).set(data).where(eq(users.id, id));
    return this.findById(id);
  }

  async delete(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }
}
