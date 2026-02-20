import "dotenv/config";
import { Bot, InlineKeyboard, Keyboard, type Context } from "grammy";
import { eq } from "drizzle-orm";
import {
  UserRepo,
  GroupRepo,
  ExpenseRepo,
  SettlementRepo,
  db,
  groupMembers,
} from "../storage/index.js";
import {
  GroupService,
  ExpenseService,
  BalanceService,
} from "../services/index.js";
import {
  activeGroupByChat,
  conversationByChat,
  knownGroupsByUser,
  rememberGroupForUser,
  type GroupMemberOption,
} from "./state.js";

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN || "");

const userRepo = new UserRepo();
const groupRepo = new GroupRepo();
const expenseRepo = new ExpenseRepo();
const settlementRepo = new SettlementRepo();

const groupService = new GroupService(groupRepo, userRepo);
const expenseService = new ExpenseService(expenseRepo, userRepo);
const balanceService = new BalanceService(expenseRepo, settlementRepo);

const NO_ACTIVE_GROUP_MESSAGE =
  "❌ No active group. In private chat use /newgroup or /join first.";

function buildMainKeyboard(params: {
  includeGroupsButton: boolean;
  useCommandButtons: boolean;
}): Keyboard {
  const keyboard = new Keyboard();

  if (params.useCommandButtons) {
    keyboard
      .text("/addexpense 💸")
      .text("/balances 💰")
      .row()
      .text("/settle ✅")
      .text("/history 📋")
      .row()
      .text("/members 👥");
  } else {
    keyboard
      .text("💸 Add Expense")
      .text("💰 Balances")
      .row()
      .text("✅ Settle Up")
      .text("📋 History")
      .row()
      .text("👥 Members");
  }

  if (params.includeGroupsButton) {
    keyboard.row().text("⚙️ Groups");
  }

  return keyboard.resized().persistent();
}

const PRIVATE_MAIN_KEYBOARD = buildMainKeyboard({
  includeGroupsButton: true,
  useCommandButtons: false,
});
const GROUP_MAIN_KEYBOARD = buildMainKeyboard({
  includeGroupsButton: false,
  useCommandButtons: true,
});

let cachedBotUsername: string | null = null;

function getChatId(ctx: Context): number | null {
  return ctx.chat?.id ?? null;
}

function isTelegramGroupChat(ctx: Context): boolean {
  return ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
}

function getMainKeyboard(ctx: Context): Keyboard {
  return isTelegramGroupChat(ctx) ? GROUP_MAIN_KEYBOARD : PRIVATE_MAIN_KEYBOARD;
}

async function promptForConversationInput(
  ctx: Context,
  text: string,
  placeholder?: string
): Promise<void> {
  if (isTelegramGroupChat(ctx)) {
    const message = ctx.message;
    const forceReplyMarkup: {
      force_reply: true;
      input_field_placeholder?: string;
    } = {
      force_reply: true,
    };
    if (placeholder) {
      forceReplyMarkup.input_field_placeholder = placeholder;
    }

    if (message && "message_id" in message) {
      await ctx.reply(`${text}\n(Reply to this message.)`, {
        reply_to_message_id: message.message_id,
        reply_markup: forceReplyMarkup,
      });
      return;
    }

    await ctx.reply(`${text}\n(Reply to this message.)`, {
      reply_markup: forceReplyMarkup,
    });
    return;
  }

  await replyWithKeyboard(ctx, text);
}

function getTelegramChatGroupId(chatId: number): string {
  return `tgchat_${chatId}`;
}

function getTelegramChatTitle(ctx: Context): string {
  if (!ctx.chat) {
    return "Telegram Group";
  }

  if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
    return ctx.chat.title || "Telegram Group";
  }

  return "Telegram Group";
}

function clearConversation(ctx: Context): void {
  const chatId = getChatId(ctx);
  if (chatId !== null) {
    conversationByChat.delete(chatId);
  }
}

function formatEuro(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

function parseAmountToCents(input: string): number | null {
  const normalized = input.trim().replace(",", ".").replace(/[^\d.]/g, "");

  if (!normalized) {
    return null;
  }

  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Math.round(value * 100);
}

function normalizeUsername(value: string): string {
  return value.replace(/^@/, "").toLowerCase();
}

function makeExpenseId(): string {
  return `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeSettlementId(): string {
  return `stl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseStartJoinPayload(payload: string): string | null {
  const trimmed = payload.trim();
  if (!trimmed.startsWith("join_")) {
    return null;
  }

  const groupId = trimmed.slice("join_".length);
  return groupId || null;
}

async function getBotUsername(): Promise<string | null> {
  if (cachedBotUsername) {
    return cachedBotUsername;
  }

  try {
    const me = await bot.api.getMe();
    cachedBotUsername = me.username || null;
    return cachedBotUsername;
  } catch {
    return null;
  }
}

async function replyWithKeyboard(ctx: Context, text: string): Promise<void> {
  await ctx.reply(text, { reply_markup: getMainKeyboard(ctx) });
}

async function upsertTelegramUserFromData(user: {
  id: number;
  first_name: string;
  username?: string;
}): Promise<{ id: string; name: string }> {
  const userId = user.id.toString();
  const userName = user.first_name || user.username || "User";
  const current = await userRepo.findById(userId);

  if (!current) {
    await userRepo.create({
      id: userId,
      name: userName,
      username: user.username,
    });
  } else {
    await userRepo.update(userId, {
      name: userName,
      username: user.username,
    });
  }

  return { id: userId, name: userName };
}

async function upsertTelegramUser(
  ctx: Context
): Promise<{ id: string; name: string } | null> {
  if (!ctx.from) {
    return null;
  }

  return upsertTelegramUserFromData(ctx.from);
}

async function getGroupMemberUsers(
  groupId: string
): Promise<Array<GroupMemberOption & { username?: string }>> {
  const group = await groupService.getGroup(groupId);
  if (!group) {
    return [];
  }

  return Promise.all(
    group.members.map(async (memberId) => {
      const user = await userRepo.findById(memberId);
      return {
        id: memberId,
        name: user?.name || "Unknown",
        username: user?.username,
      };
    })
  );
}

async function getGroupMembers(groupId: string): Promise<GroupMemberOption[]> {
  const members = await getGroupMemberUsers(groupId);
  return members.map(({ id, name }) => ({ id, name }));
}

async function resolveTaggedGroupMemberIds(params: {
  ctx: Context;
  groupId: string;
  groupMembers: Array<GroupMemberOption & { username?: string }>;
}): Promise<{
  tagCount: number;
  resolvedIds: Set<string>;
  unresolvedMentions: string[];
}> {
  const { ctx, groupId, groupMembers } = params;
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text || !message.entities) {
    return {
      tagCount: 0,
      resolvedIds: new Set<string>(),
      unresolvedMentions: [],
    };
  }

  const memberIds = new Set(groupMembers.map((member) => member.id));
  const memberIdByUsername = new Map<string, string>();
  for (const member of groupMembers) {
    if (!member.username) {
      continue;
    }

    memberIdByUsername.set(normalizeUsername(member.username), member.id);
  }

  let tagCount = 0;
  const resolvedIds = new Set<string>();
  const unresolvedMentionKeys = new Set<string>();
  const unresolvedMentions: string[] = [];

  const markUnresolvedMention = (mentionText: string): void => {
    const normalizedMention = normalizeUsername(mentionText);
    if (!normalizedMention || unresolvedMentionKeys.has(normalizedMention)) {
      return;
    }

    unresolvedMentionKeys.add(normalizedMention);
    unresolvedMentions.push(`@${normalizedMention}`);
  };

  const ensureGroupMembership = async (userId: string, userName: string): Promise<void> => {
    if (memberIds.has(userId)) {
      return;
    }

    await groupService.addMember(groupId, userId, userName);
    memberIds.add(userId);
  };

  for (const entity of message.entities) {
    if (entity.type === "mention") {
      tagCount += 1;
      const mentionText = message.text.slice(entity.offset, entity.offset + entity.length);
      const normalizedMention = normalizeUsername(mentionText);
      const taggedUserId = memberIdByUsername.get(normalizedMention);
      if (taggedUserId) {
        resolvedIds.add(taggedUserId);
        continue;
      }

      const knownUser = await userRepo.findByUsername(normalizedMention);
      if (knownUser) {
        await ensureGroupMembership(knownUser.id, knownUser.name);
        resolvedIds.add(knownUser.id);
        if (knownUser.username) {
          memberIdByUsername.set(normalizeUsername(knownUser.username), knownUser.id);
        }
      } else {
        markUnresolvedMention(mentionText);
      }

      continue;
    }

    if (entity.type === "text_mention") {
      tagCount += 1;
      if (entity.user.is_bot) {
        continue;
      }

      const taggedUser = await upsertTelegramUserFromData(entity.user);
      await ensureGroupMembership(taggedUser.id, taggedUser.name);
      resolvedIds.add(taggedUser.id);

      if (entity.user.username) {
        memberIdByUsername.set(normalizeUsername(entity.user.username), taggedUser.id);
      }
    }
  }

  return { tagCount, resolvedIds, unresolvedMentions };
}

async function seedGroupMembersFromChatAdmins(
  chatId: number,
  groupId: string
): Promise<void> {
  try {
    const admins = await bot.api.getChatAdministrators(chatId);
    const group = await groupService.getGroup(groupId);
    if (!group) {
      return;
    }

    const existingMembers = new Set(group.members);
    for (const admin of admins) {
      if (admin.user.is_bot) {
        continue;
      }

      const adminUser = await upsertTelegramUserFromData(admin.user);
      if (!existingMembers.has(adminUser.id)) {
        await groupService.addMember(groupId, adminUser.id, adminUser.name);
        existingMembers.add(adminUser.id);
      }
      rememberGroupForUser(adminUser.id, groupId);
    }
  } catch (error) {
    console.error("Failed to sync group admins:", error);
  }
}

async function ensureTelegramChatGroup(
  ctx: Context,
  userOverride?: { id: string; name: string } | null
): Promise<{ groupId: string; groupName: string } | null> {
  if (!isTelegramGroupChat(ctx)) {
    return null;
  }

  const chatId = getChatId(ctx);
  if (chatId === null) {
    return null;
  }

  const groupId = getTelegramChatGroupId(chatId);
  const chatTitle = getTelegramChatTitle(ctx);
  const user = userOverride ?? (await upsertTelegramUser(ctx));
  let group = await groupService.getGroup(groupId);

  if (!group) {
    if (!user) {
      return null;
    }

    group = await groupService.createGroup(groupId, chatTitle, user.id, user.name);
    await seedGroupMembersFromChatAdmins(chatId, groupId);
  } else if (group.name !== chatTitle) {
    group = (await groupService.updateGroupName(groupId, chatTitle)) || group;
  }

  if (user && !group.members.includes(user.id)) {
    await groupService.addMember(groupId, user.id, user.name);
  }

  if (user) {
    rememberGroupForUser(user.id, groupId);
  }

  activeGroupByChat.set(chatId, groupId);
  return { groupId, groupName: group.name };
}

async function joinGroupAsUser(
  ctx: Context,
  groupId: string,
  user: { id: string; name: string }
): Promise<{ groupName: string; alreadyMember: boolean } | null> {
  const group = await groupService.getGroup(groupId);
  if (!group) {
    return null;
  }

  const alreadyMember = group.members.includes(user.id);
  if (!alreadyMember) {
    await groupService.addMember(groupId, user.id, user.name);
  }

  const chatId = getChatId(ctx);
  if (chatId !== null) {
    activeGroupByChat.set(chatId, groupId);
  }
  rememberGroupForUser(user.id, groupId);

  return { groupName: group.name, alreadyMember };
}

function buildPayerKeyboard(members: GroupMemberOption[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  members.forEach((member, index) => {
    keyboard.text(member.name, `expense:payer:${member.id}`);

    if (index < members.length - 1) {
      keyboard.row();
    }
  });

  return keyboard;
}

function buildSplitKeyboard(
  members: GroupMemberOption[],
  selectedIds: Set<string>
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const member of members) {
    const label = selectedIds.has(member.id) ? `✅ ${member.name}` : member.name;
    keyboard.text(label, `expense:split_toggle:${member.id}`).row();
  }

  keyboard.text("✅ Done", "expense:split_done");
  return keyboard;
}

async function requireActiveGroup(
  ctx: Context
): Promise<{ groupId: string; groupName: string } | null> {
  if (isTelegramGroupChat(ctx)) {
    const telegramGroup = await ensureTelegramChatGroup(ctx);
    if (telegramGroup) {
      return telegramGroup;
    }
  }

  const chatId = getChatId(ctx);
  if (chatId === null) {
    return null;
  }

  const groupId = activeGroupByChat.get(chatId);
  if (!groupId) {
    await replyWithKeyboard(ctx, NO_ACTIVE_GROUP_MESSAGE);
    return null;
  }

  const group = await groupService.getGroup(groupId);
  if (!group) {
    activeGroupByChat.delete(chatId);
    await replyWithKeyboard(ctx, NO_ACTIVE_GROUP_MESSAGE);
    return null;
  }

  return { groupId, groupName: group.name };
}

async function createEqualExpense(params: {
  groupId: string;
  amountCents: number;
  description: string;
  paidById: string;
  paidByName: string;
  participants: GroupMemberOption[];
}): Promise<void> {
  await expenseService.createExpense({
    id: makeExpenseId(),
    groupId: params.groupId,
    description: params.description,
    amountCents: params.amountCents,
    currency: "EUR",
    paidBy: params.paidById,
    paidByName: params.paidByName,
    participants: params.participants,
    splitMethod: "equal",
  });
}

async function startExpenseConversation(ctx: Context): Promise<void> {
  clearConversation(ctx);

  const activeGroup = await requireActiveGroup(ctx);
  if (!activeGroup) {
    return;
  }

  const chatId = getChatId(ctx);
  if (chatId === null) {
    return;
  }

  if (!ctx.from) {
    await replyWithKeyboard(ctx, "❌ Unable to start expense flow for this user.");
    return;
  }

  conversationByChat.set(chatId, {
    step: "awaiting_amount",
    ownerUserId: ctx.from.id.toString(),
  });
  await promptForConversationInput(ctx, "How much?", "e.g. 12.50");
}

async function showBalances(ctx: Context): Promise<void> {
  clearConversation(ctx);

  const activeGroup = await requireActiveGroup(ctx);
  if (!activeGroup) {
    return;
  }

  const settlements = await balanceService.getSimplifiedDebts(activeGroup.groupId);

  if (settlements.length === 0) {
    await replyWithKeyboard(
      ctx,
      `📊 ${activeGroup.groupName}\n\n🎉 All settled up!`
    );
    return;
  }

  const lines = await Promise.all(
    settlements.map(async (settlement) => {
      const fromUser = await userRepo.findById(settlement.from);
      const toUser = await userRepo.findById(settlement.to);

      return `  ${fromUser?.name || "Unknown"} → ${toUser?.name || "Unknown"}: ${formatEuro(settlement.amount)}`;
    })
  );

  await replyWithKeyboard(ctx, `📊 ${activeGroup.groupName}\n${lines.join("\n")}`);
}

async function showSettlements(
  ctx: Context,
  groupIdOverride?: string
): Promise<void> {
  clearConversation(ctx);

  let groupId = groupIdOverride;
  let groupName = "";

  if (!groupId) {
    const activeGroup = await requireActiveGroup(ctx);
    if (!activeGroup) {
      return;
    }

    groupId = activeGroup.groupId;
    groupName = activeGroup.groupName;
  } else {
    const group = await groupService.getGroup(groupId);
    if (!group) {
      await replyWithKeyboard(ctx, NO_ACTIVE_GROUP_MESSAGE);
      return;
    }
    groupName = group.name;
  }

  const settlements = await balanceService.getSimplifiedDebts(groupId);

  if (settlements.length === 0) {
    await replyWithKeyboard(ctx, `💰 ${groupName}\n\n🎉 All settled up!`);
    return;
  }

  await replyWithKeyboard(ctx, `💰 ${groupName}\nTap a debt to mark it paid.`);

  for (const settlement of settlements) {
    const fromUser = await userRepo.findById(settlement.from);
    const toUser = await userRepo.findById(settlement.to);

    await ctx.reply(
      `${fromUser?.name || "Unknown"} owes ${toUser?.name || "Unknown"} ${formatEuro(settlement.amount)}`,
      {
        reply_markup: new InlineKeyboard().text(
          "✅ Mark paid",
          `settle:${groupId}:${settlement.from}:${settlement.to}:${settlement.amount}`
        ),
      }
    );
  }
}

async function showHistory(ctx: Context): Promise<void> {
  clearConversation(ctx);

  const activeGroup = await requireActiveGroup(ctx);
  if (!activeGroup) {
    return;
  }

  const requesterId = ctx.from?.id.toString();

  const expenses = await expenseService.getGroupExpenses(activeGroup.groupId);
  if (expenses.length === 0) {
    await replyWithKeyboard(ctx, `📋 ${activeGroup.groupName}\n\nNo expenses yet.`);
    return;
  }

  const lastTen = expenses.slice(0, 10);
  await replyWithKeyboard(
    ctx,
    `📋 ${activeGroup.groupName}\nShowing ${lastTen.length} recent expenses.`
  );

  for (const expense of lastTen) {
    const payer = await userRepo.findById(expense.paidBy);
    const date = expense.createdAt.toLocaleDateString();
    const canDelete = requesterId !== undefined && requesterId === expense.createdBy;

    if (canDelete) {
      await ctx.reply(
        `${formatEuro(expense.amount)} • ${expense.description}\nPaid by ${payer?.name || "Unknown"} on ${date}`,
        {
          reply_markup: new InlineKeyboard().text(
            "🗑 Delete",
            `history:delete:${activeGroup.groupId}:${expense.id}`
          ),
        }
      );
      continue;
    }

    await ctx.reply(
      `${formatEuro(expense.amount)} • ${expense.description}\nPaid by ${payer?.name || "Unknown"} on ${date}`
    );
  }
}

async function showGroups(ctx: Context): Promise<void> {
  clearConversation(ctx);

  if (isTelegramGroupChat(ctx)) {
    await replyWithKeyboard(
      ctx,
      "⚙️ /groups is only available in private chat. This Telegram group chat is already one group."
    );
    return;
  }

  const user = await upsertTelegramUser(ctx);
  if (!user) {
    return;
  }

  const chatId = getChatId(ctx);
  const activeGroupId = chatId === null ? undefined : activeGroupByChat.get(chatId);

  const memberships = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.userId, user.id));

  const groupIds = new Set<string>(memberships.map((membership) => membership.groupId));
  for (const knownGroupId of knownGroupsByUser.get(user.id) || []) {
    groupIds.add(knownGroupId);
  }

  if (activeGroupId) {
    groupIds.add(activeGroupId);
  }

  if (groupIds.size === 0) {
    await replyWithKeyboard(
      ctx,
      "⚙️ You are not in any groups yet. Use /newgroup or /join."
    );
    return;
  }

  const lines: string[] = [];
  for (const groupId of groupIds) {
    const group = await groupService.getGroup(groupId);
    if (!group) {
      continue;
    }

    const suffix = groupId === activeGroupId ? " [active]" : "";
    lines.push(`• ${group.name}${suffix} (${group.id})`);
  }

  if (lines.length === 0) {
    await replyWithKeyboard(
      ctx,
      "⚙️ No available groups found. Use /newgroup or /join."
    );
    return;
  }

  await replyWithKeyboard(ctx, `⚙️ Your groups\n${lines.join("\n")}`);
}

async function showMembers(ctx: Context): Promise<void> {
  clearConversation(ctx);

  const activeGroup = await requireActiveGroup(ctx);
  if (!activeGroup) {
    return;
  }

  const chatId = getChatId(ctx);
  let telegramMemberCount: number | null = null;

  if (isTelegramGroupChat(ctx) && chatId !== null) {
    await seedGroupMembersFromChatAdmins(chatId, activeGroup.groupId);
    try {
      telegramMemberCount = await bot.api.getChatMemberCount(chatId);
    } catch (error) {
      console.error("Failed to fetch Telegram member count:", error);
    }
  }

  const members = await getGroupMemberUsers(activeGroup.groupId);
  if (members.length === 0) {
    await replyWithKeyboard(ctx, `👥 ${activeGroup.groupName}\n\nNo members known yet.`);
    return;
  }

  const sortedMembers = [...members].sort((a, b) => a.name.localeCompare(b.name));
  const lines = sortedMembers.map((member, index) => {
    const usernameSuffix = member.username ? ` (@${member.username})` : "";
    return `${index + 1}. ${member.name}${usernameSuffix}`;
  });

  const countLine =
    telegramMemberCount === null
      ? `Known members: ${sortedMembers.length}`
      : `Known members: ${sortedMembers.length} / Telegram members: ${telegramMemberCount}`;

  const hasCoverageGap =
    telegramMemberCount !== null && sortedMembers.length < telegramMemberCount;

  let hint = "";
  if (isTelegramGroupChat(ctx)) {
    hint = hasCoverageGap
      ? "\n\nTip: Telegram bots cannot fetch a full member list on demand. Ask missing people to open /invite once or send a message in this group."
      : "\n\nTip: To stay in sync, each member should interact with the bot at least once.";
  }

  await replyWithKeyboard(
    ctx,
    `👥 ${activeGroup.groupName}\n${countLine}\n\n${lines.join("\n")}${hint}`
  );
}

bot.use(async (ctx, next) => {
  const chatId = ctx.chat?.id ?? "n/a";
  const chatType = ctx.chat?.type ?? "n/a";
  const fromId = ctx.from?.id ?? "n/a";
  const updateId = ctx.update.update_id;
  const updateKind =
    Object.keys(ctx.update).find((key) => key !== "update_id") || "unknown";
  const callbackData = ctx.callbackQuery?.data;
  const messageText =
    ctx.message && "text" in ctx.message ? ctx.message.text : undefined;

  if (callbackData) {
    console.log(
      `[update] id=${updateId} kind=${updateKind} chat=${chatId} type=${chatType} from=${fromId} callback=${callbackData}`
    );
  } else if (messageText) {
    console.log(
      `[update] id=${updateId} kind=${updateKind} chat=${chatId} type=${chatType} from=${fromId} message=${messageText}`
    );
  } else {
    console.log(
      `[update] id=${updateId} kind=${updateKind} chat=${chatId} type=${chatType} from=${fromId}`
    );
  }

  if (isTelegramGroupChat(ctx)) {
    await ensureTelegramChatGroup(ctx);
  }

  await next();
});

bot.on("message:new_chat_members", async (ctx) => {
  if (!isTelegramGroupChat(ctx)) {
    return;
  }

  const activeGroup = await requireActiveGroup(ctx);
  if (!activeGroup) {
    return;
  }

  const currentGroup = await groupService.getGroup(activeGroup.groupId);
  if (!currentGroup) {
    return;
  }

  const memberIds = new Set(currentGroup.members);
  for (const member of ctx.message.new_chat_members) {
    if (member.is_bot) {
      continue;
    }

    const storedUser = await upsertTelegramUserFromData(member);
    if (!memberIds.has(storedUser.id)) {
      await groupService.addMember(activeGroup.groupId, storedUser.id, storedUser.name);
      memberIds.add(storedUser.id);
    }

    rememberGroupForUser(storedUser.id, activeGroup.groupId);
  }
});

bot.command("start", async (ctx) => {
  clearConversation(ctx);
  const user = await upsertTelegramUser(ctx);

  if (isTelegramGroupChat(ctx)) {
    const group = await ensureTelegramChatGroup(ctx, user);
    if (!group) {
      await replyWithKeyboard(ctx, "❌ Could not initialize this Telegram group.");
      return;
    }

    await replyWithKeyboard(
      ctx,
      `✅ This Telegram group is linked: "${group.groupName}".\nMembers are synced from admins, joins, and interactions.\nTo include everyone, ask members to open /invite once or send a message in this group.`
    );
    return;
  }

  const inviteGroupId = parseStartJoinPayload(ctx.match);

  if (user && inviteGroupId) {
    const joinedGroup = await joinGroupAsUser(ctx, inviteGroupId, user);

    if (joinedGroup) {
      const prefix = joinedGroup.alreadyMember ? "Active group set to" : "Joined";
      await replyWithKeyboard(
        ctx,
        `✅ ${prefix} "${joinedGroup.groupName}" via invite.\n\nUse the keyboard below or these commands:\n/newgroup <name>\n/invite\n/join <groupId>\n/add <amount> <description>\n/balances\n/settle\n/history\n/members\n/groups`
      );
      return;
    }

    await replyWithKeyboard(
      ctx,
      "❌ Invite link is invalid or group no longer exists."
    );
    return;
  }

  const helloName = user?.name || "there";
  await replyWithKeyboard(
    ctx,
    `Welcome ${helloName}!\n\nUse the keyboard below or these commands:\n/newgroup <name>\n/invite\n/join <groupId>\n/add <amount> <description>\n/balances\n/settle\n/history\n/members\n/groups\n\nTip: if you add me to a real Telegram group, that chat is auto-linked as one expense group.`
  );
});

bot.command("help", async (ctx) => {
  clearConversation(ctx);

  if (isTelegramGroupChat(ctx)) {
    await replyWithKeyboard(
      ctx,
      "Commands:\n/add <amount> <description>\n/balances\n/settle\n/history\n/members\n/invite\n\nUse /addexpense (or the add button) for guided flow.\nTelegram bots cannot fetch full group members on demand, so ask everyone to use /invite once if missing."
    );
    return;
  }

  await replyWithKeyboard(
    ctx,
    "Commands:\n/newgroup <name>\n/invite\n/join <groupId>\n/add <amount> <description>\n/balances\n/settle\n/history\n/members\n/groups\n\nUse /addexpense (or the add button) for guided flow.\nIn Telegram group chats, the chat itself is auto-linked."
  );
});

bot.command("cancel", async (ctx) => {
  clearConversation(ctx);
  await replyWithKeyboard(ctx, "Conversation canceled.");
});

bot.command("newgroup", async (ctx) => {
  clearConversation(ctx);

  if (isTelegramGroupChat(ctx)) {
    const group = await requireActiveGroup(ctx);
    if (!group) {
      return;
    }

    await replyWithKeyboard(
      ctx,
      `This Telegram chat is already linked as "${group.groupName}".\nUse /invite so each member can register once.`
    );
    return;
  }

  const groupName = ctx.match.trim();
  if (!groupName) {
    await replyWithKeyboard(ctx, "Usage: /newgroup <name>");
    return;
  }

  const user = await upsertTelegramUser(ctx);
  if (!user) {
    return;
  }

  const groupId = `grp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const group = await groupService.createGroup(groupId, groupName, user.id, user.name);

  const chatId = getChatId(ctx);
  if (chatId !== null) {
    activeGroupByChat.set(chatId, group.id);
  }
  rememberGroupForUser(user.id, group.id);

  const botUsername = await getBotUsername();
  const inviteLink = botUsername
    ? `https://t.me/${botUsername}?start=join_${group.id}`
    : null;

  const inviteLine = inviteLink
    ? `Invite link: ${inviteLink}\n`
    : "";

  await replyWithKeyboard(
    ctx,
    `✅ Group "${group.name}" created and set active.\nGroup ID: ${group.id}\n${inviteLine}Share: /join ${group.id}\nYou can also use /invite anytime.`
  );
});

bot.command("join", async (ctx) => {
  clearConversation(ctx);

  if (isTelegramGroupChat(ctx)) {
    const user = await upsertTelegramUser(ctx);
    const group = await requireActiveGroup(ctx);
    if (!group) {
      return;
    }

    if (user) {
      await groupService.addMember(group.groupId, user.id, user.name);
      rememberGroupForUser(user.id, group.groupId);
    }

    await replyWithKeyboard(
      ctx,
      `This Telegram chat is already linked as "${group.groupName}".\nYou are now synced as a member for this group.`
    );
    return;
  }

  const groupId = ctx.match.trim();
  if (!groupId) {
    await replyWithKeyboard(ctx, "Usage: /join <groupId>");
    return;
  }

  const user = await upsertTelegramUser(ctx);
  if (!user) {
    return;
  }

  const joinedGroup = await joinGroupAsUser(ctx, groupId, user);
  if (!joinedGroup) {
    await replyWithKeyboard(ctx, "❌ Group not found.");
    return;
  }

  const text = joinedGroup.alreadyMember
    ? `✅ "${joinedGroup.groupName}" set as active.`
    : `✅ Joined "${joinedGroup.groupName}" and set as active.`;
  await replyWithKeyboard(ctx, text);
});

bot.command("invite", async (ctx) => {
  clearConversation(ctx);

  const activeGroup = await requireActiveGroup(ctx);
  if (!activeGroup) {
    return;
  }

  const botUsername = await getBotUsername();
  if (isTelegramGroupChat(ctx)) {
    const baseMessage = `Invite for "${activeGroup.groupName}"\n\nTelegram bots cannot fetch full group members on demand.\nAsk everyone to open the private invite link once to register.`;

    if (!botUsername) {
      await replyWithKeyboard(ctx, baseMessage);
      return;
    }

    const inviteLink = `https://t.me/${botUsername}?start=join_${activeGroup.groupId}`;
    await replyWithKeyboard(
      ctx,
      `${baseMessage}\n\nInvite link:\n${inviteLink}`
    );
    return;
  }

  if (!botUsername) {
    await replyWithKeyboard(
      ctx,
      `Invite for "${activeGroup.groupName}"\n\nShare this command:\n/join ${activeGroup.groupId}`
    );
    return;
  }

  const inviteLink = `https://t.me/${botUsername}?start=join_${activeGroup.groupId}`;
  await replyWithKeyboard(
    ctx,
    `Invite for "${activeGroup.groupName}"\n\nSend this link:\n${inviteLink}\n\nFallback command:\n/join ${activeGroup.groupId}`
  );
});

bot.command("groups", async (ctx) => {
  await showGroups(ctx);
});

bot.command("members", async (ctx) => {
  await showMembers(ctx);
});

bot.command("add", async (ctx) => {
  clearConversation(ctx);

  const args = ctx.match.trim();
  const activeGroup = await requireActiveGroup(ctx);
  if (!activeGroup) {
    return;
  }

  const user = await upsertTelegramUser(ctx);
  if (!user) {
    return;
  }

  const [amountRaw, ...descriptionParts] = args.split(" ");

  if (!amountRaw || descriptionParts.length === 0) {
    await replyWithKeyboard(
      ctx,
      "Usage: /add <amount> <description> [@user ...]\nUse /addexpense for guided flow."
    );
    return;
  }

  const amountCents = parseAmountToCents(amountRaw);
  if (!amountCents) {
    await replyWithKeyboard(ctx, "❌ Invalid amount.");
    return;
  }

  const description = descriptionParts.join(" ").trim();
  let membersWithUsers = await getGroupMemberUsers(activeGroup.groupId);
  let members = membersWithUsers.map(({ id, name }) => ({ id, name }));

  if (members.length === 0) {
    await replyWithKeyboard(ctx, "❌ Group has no members.");
    return;
  }

  const tagResolution = await resolveTaggedGroupMemberIds({
    ctx,
    groupId: activeGroup.groupId,
    groupMembers: membersWithUsers,
  });
  let participants = members;

  if (tagResolution.unresolvedMentions.length > 0) {
    await replyWithKeyboard(
      ctx,
      `❌ Could not resolve: ${tagResolution.unresolvedMentions.join(", ")}.\nAsk them to open /invite once or send a message in this group.`
    );
    return;
  }

  if (tagResolution.tagCount > 0) {
    if (tagResolution.resolvedIds.size === 0) {
      await replyWithKeyboard(
        ctx,
        "❌ Tagged users must be resolvable members."
      );
      return;
    }

    membersWithUsers = await getGroupMemberUsers(activeGroup.groupId);
    members = membersWithUsers.map(({ id, name }) => ({ id, name }));

    const participantIds = new Set(tagResolution.resolvedIds);
    participantIds.add(user.id);

    participants = members.filter((member) => participantIds.has(member.id));
    if (!participants.some((member) => member.id === user.id)) {
      participants.push({ id: user.id, name: user.name });
    }
  }

  await createEqualExpense({
    groupId: activeGroup.groupId,
    amountCents,
    description,
    paidById: user.id,
    paidByName: user.name,
    participants,
  });

  const participantNames = participants.map((member) => member.name).join(", ");
  const perPerson = formatEuro(Math.round(amountCents / participants.length));

  await replyWithKeyboard(
    ctx,
    `✅ ${formatEuro(amountCents)} for ${description} | Paid by ${user.name} | Split: ${participantNames} (${perPerson} each)`
  );
});

bot.command("addexpense", async (ctx) => {
  await startExpenseConversation(ctx);
});

bot.command("balances", async (ctx) => {
  await showBalances(ctx);
});

bot.command("settle", async (ctx) => {
  await showSettlements(ctx);
});

bot.command("history", async (ctx) => {
  await showHistory(ctx);
});

bot.hears("💸 Add Expense", async (ctx) => {
  await startExpenseConversation(ctx);
});

bot.hears("💰 Balances", async (ctx) => {
  await showBalances(ctx);
});

bot.hears("✅ Settle Up", async (ctx) => {
  await showSettlements(ctx);
});

bot.hears("📋 History", async (ctx) => {
  await showHistory(ctx);
});

bot.hears("👥 Members", async (ctx) => {
  await showMembers(ctx);
});

bot.hears("⚙️ Groups", async (ctx) => {
  await showGroups(ctx);
});

bot.callbackQuery(/^expense:payer:/, async (ctx) => {
  const chatId = getChatId(ctx);
  if (chatId === null) {
    await ctx.answerCallbackQuery();
    return;
  }

  const state = conversationByChat.get(chatId);
  if (!state || state.step !== "awaiting_paid_by") {
    await ctx.answerCallbackQuery({ text: "No active expense flow." });
    return;
  }

  if (!ctx.from || ctx.from.id.toString() !== state.ownerUserId) {
    await ctx.answerCallbackQuery({ text: "This flow belongs to another user." });
    return;
  }

  const payerId = ctx.callbackQuery.data.slice("expense:payer:".length);
  const payer = state.members.find((member) => member.id === payerId);

  if (!payer) {
    await ctx.answerCallbackQuery({ text: "Invalid payer." });
    return;
  }

  const selectedIds = state.members.map((member) => member.id);
  conversationByChat.set(chatId, {
    step: "awaiting_split_with",
    ownerUserId: state.ownerUserId,
    amountCents: state.amountCents,
    description: state.description,
    paidBy: payerId,
    members: state.members,
    selectedParticipantIds: selectedIds,
  });

  await ctx.answerCallbackQuery();
  await ctx.editMessageText("Split with?", {
    reply_markup: buildSplitKeyboard(state.members, new Set(selectedIds)),
  });
});

bot.callbackQuery(/^expense:split_toggle:/, async (ctx) => {
  const chatId = getChatId(ctx);
  if (chatId === null) {
    await ctx.answerCallbackQuery();
    return;
  }

  const state = conversationByChat.get(chatId);
  if (!state || state.step !== "awaiting_split_with") {
    await ctx.answerCallbackQuery({ text: "No active expense flow." });
    return;
  }

  if (!ctx.from || ctx.from.id.toString() !== state.ownerUserId) {
    await ctx.answerCallbackQuery({ text: "This flow belongs to another user." });
    return;
  }

  const memberId = ctx.callbackQuery.data.slice("expense:split_toggle:".length);
  if (!state.members.some((member) => member.id === memberId)) {
    await ctx.answerCallbackQuery({ text: "Invalid member." });
    return;
  }

  const selected = new Set(state.selectedParticipantIds);
  if (selected.has(memberId)) {
    selected.delete(memberId);
  } else {
    selected.add(memberId);
  }

  conversationByChat.set(chatId, {
    ...state,
    selectedParticipantIds: Array.from(selected),
  });

  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup({
    reply_markup: buildSplitKeyboard(state.members, selected),
  });
});

bot.callbackQuery("expense:split_done", async (ctx) => {
  const chatId = getChatId(ctx);
  if (chatId === null) {
    await ctx.answerCallbackQuery();
    return;
  }

  const state = conversationByChat.get(chatId);
  if (!state || state.step !== "awaiting_split_with") {
    await ctx.answerCallbackQuery({ text: "No active expense flow." });
    return;
  }

  if (!ctx.from || ctx.from.id.toString() !== state.ownerUserId) {
    await ctx.answerCallbackQuery({ text: "This flow belongs to another user." });
    return;
  }

  const groupId = activeGroupByChat.get(chatId);
  if (!groupId) {
    conversationByChat.delete(chatId);
    await ctx.answerCallbackQuery({ text: "No active group." });
    await replyWithKeyboard(ctx, NO_ACTIVE_GROUP_MESSAGE);
    return;
  }

  if (state.selectedParticipantIds.length === 0) {
    await ctx.answerCallbackQuery({ text: "Pick at least one participant." });
    return;
  }

  const selectedParticipants = state.members.filter((member) =>
    state.selectedParticipantIds.includes(member.id)
  );

  const payer = state.members.find((member) => member.id === state.paidBy);
  if (!payer) {
    conversationByChat.delete(chatId);
    await ctx.answerCallbackQuery({ text: "Invalid payer." });
    return;
  }

  await createEqualExpense({
    groupId,
    amountCents: state.amountCents,
    description: state.description,
    paidById: payer.id,
    paidByName: payer.name,
    participants: selectedParticipants,
  });

  conversationByChat.delete(chatId);

  const names = selectedParticipants.map((participant) => participant.name).join(", ");
  const perPerson = formatEuro(
    Math.round(state.amountCents / selectedParticipants.length)
  );

  await ctx.answerCallbackQuery({ text: "Expense added." });
  await ctx.editMessageText("✅ Expense saved.");
  await replyWithKeyboard(
    ctx,
    `✅ ${formatEuro(state.amountCents)} for ${state.description} | Paid by ${payer.name} | Split: ${names} (${perPerson} each)`
  );
});

bot.callbackQuery(/^settle:/, async (ctx) => {
  const parts = ctx.callbackQuery.data.split(":");
  if (parts.length < 5) {
    await ctx.answerCallbackQuery({ text: "Invalid settlement." });
    return;
  }

  const groupId = parts[1];
  const from = parts[2];
  const to = parts[3];
  const amountCents = Number.parseInt(parts[4], 10);

  if (!Number.isFinite(amountCents) || amountCents <= 0 || !ctx.from) {
    await ctx.answerCallbackQuery({ text: "Invalid settlement." });
    return;
  }

  await upsertTelegramUser(ctx);
  await balanceService.recordSettlement(
    makeSettlementId(),
    groupId,
    from,
    to,
    amountCents,
    ctx.from.id.toString()
  );

  const fromUser = await userRepo.findById(from);
  const toUser = await userRepo.findById(to);

  await ctx.answerCallbackQuery({ text: "Settlement recorded." });
  await ctx.editMessageText(
    `✅ Marked paid: ${fromUser?.name || "Unknown"} → ${toUser?.name || "Unknown"} ${formatEuro(amountCents)}`
  );

  const chatId = getChatId(ctx);
  if (chatId !== null) {
    activeGroupByChat.set(chatId, groupId);
  }

  await showSettlements(ctx, groupId);
});

bot.callbackQuery(/^history:delete:/, async (ctx) => {
  const parts = ctx.callbackQuery.data.split(":");
  if (parts.length < 4) {
    await ctx.answerCallbackQuery({ text: "Invalid expense." });
    return;
  }

  const groupId = parts[2];
  const expenseId = parts[3];

  const expense = await expenseService.getExpense(expenseId);
  if (!expense || expense.groupId !== groupId) {
    await ctx.answerCallbackQuery({ text: "Expense not found." });
    return;
  }

  if (!ctx.from || expense.createdBy !== ctx.from.id.toString()) {
    await ctx.answerCallbackQuery({
      text: "Only the expense owner can delete it.",
      show_alert: true,
    });
    return;
  }

  await expenseService.deleteExpense(expenseId);

  await ctx.answerCallbackQuery({ text: "Expense deleted." });
  await ctx.editMessageText(
    `🗑 Deleted ${expense.description} (${formatEuro(expense.amount)})`
  );
});

bot.on("message:text", async (ctx) => {
  const chatId = getChatId(ctx);
  if (chatId === null) {
    return;
  }

  const state = conversationByChat.get(chatId);
  if (!state) {
    return;
  }

  if (!ctx.from || ctx.from.id.toString() !== state.ownerUserId) {
    return;
  }

  const input = ctx.message.text.trim();
  if (!input || input.startsWith("/")) {
    return;
  }

  if (state.step === "awaiting_amount") {
    const amountCents = parseAmountToCents(input);

    if (!amountCents) {
      await promptForConversationInput(
        ctx,
        "Please enter a valid amount, e.g. 42.00",
        "e.g. 42.00"
      );
      return;
    }

    conversationByChat.set(chatId, {
      step: "awaiting_description",
      ownerUserId: state.ownerUserId,
      amountCents,
    });

    await promptForConversationInput(ctx, "Description?", "e.g. Dinner");
    return;
  }

  if (state.step === "awaiting_description") {
    const description = input;
    const activeGroup = await requireActiveGroup(ctx);

    if (!activeGroup) {
      conversationByChat.delete(chatId);
      return;
    }

    const members = await getGroupMembers(activeGroup.groupId);
    if (members.length === 0) {
      conversationByChat.delete(chatId);
      await replyWithKeyboard(ctx, "❌ Group has no members.");
      return;
    }

    conversationByChat.set(chatId, {
      step: "awaiting_paid_by",
      ownerUserId: state.ownerUserId,
      amountCents: state.amountCents,
      description,
      members,
    });

    await ctx.reply("Who paid?", {
      reply_markup: buildPayerKeyboard(members),
    });
    return;
  }

  if (state.step === "awaiting_paid_by") {
    await replyWithKeyboard(ctx, "Pick the payer using the buttons above.");
    return;
  }

  if (state.step === "awaiting_split_with") {
    await replyWithKeyboard(ctx, "Use the split buttons and tap ✅ Done.");
  }
});

bot.catch((error) => {
  console.error("Bot error:", error.error);

  if (error.error instanceof Error && error.error.stack) {
    console.error("Bot error stack:", error.error.stack);
  }

  console.error("Bot error update:", JSON.stringify(error.ctx.update));
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});

async function startBot(): Promise<void> {
  try {
    const me = await bot.api.getMe();
    const botIdentity = me.username ? `@${me.username}` : me.id.toString();
    console.log(`🤖 Starting Splitbot as ${botIdentity}`);

    const webhookInfo = await bot.api.getWebhookInfo();
    if (webhookInfo.url) {
      console.warn(
        `Webhook is configured (${webhookInfo.url}). Deleting webhook for long polling.`
      );
      await bot.api.deleteWebhook({ drop_pending_updates: false });
    }

    await bot.start({
      onStart: () => {
        console.log("🤖 Splitbot is running...");
      },
    });
  } catch (error) {
    console.error("Failed to start bot:", error);
    process.exit(1);
  }
}

void startBot();
