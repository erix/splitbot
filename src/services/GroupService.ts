import { GroupRepo, UserRepo } from "../storage/index.js";
import type { Group } from "../types/index.js";

export class GroupService {
  private groupRepo: GroupRepo;
  private userRepo: UserRepo;

  constructor(groupRepo: GroupRepo, userRepo: UserRepo) {
    this.groupRepo = groupRepo;
    this.userRepo = userRepo;
  }

  async createGroup(
    id: string,
    name: string,
    creatorId: string,
    creatorName: string
  ): Promise<Group> {
    // Ensure creator exists
    let creator = await this.userRepo.findById(creatorId);
    if (!creator) {
      creator = await this.userRepo.create({
        id: creatorId,
        name: creatorName,
      });
    }

    const group = await this.groupRepo.create({
      id,
      name,
      members: [creatorId],
      createdBy: creatorId,
    });

    return group;
  }

  async getGroup(groupId: string): Promise<Group | null> {
    return this.groupRepo.findById(groupId);
  }

  async addMember(
    groupId: string,
    userId: string,
    userName: string
  ): Promise<void> {
    // Ensure user exists
    let user = await this.userRepo.findById(userId);
    if (!user) {
      user = await this.userRepo.create({
        id: userId,
        name: userName,
      });
    }

    await this.groupRepo.addMember(groupId, userId);
  }

  async removeMember(groupId: string, userId: string): Promise<void> {
    await this.groupRepo.removeMember(groupId, userId);
  }

  async updateGroupName(groupId: string, name: string): Promise<Group | null> {
    return this.groupRepo.update(groupId, { name });
  }
}
