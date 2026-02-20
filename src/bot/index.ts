import "dotenv/config";
import { Bot } from "grammy";
import {
  UserRepo,
  GroupRepo,
  ExpenseRepo,
  SettlementRepo,
} from "../storage/index.js";
import {
  GroupService,
  ExpenseService,
  BalanceService,
} from "../services/index.js";

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN || "");

// Initialize repositories
const userRepo = new UserRepo();
const groupRepo = new GroupRepo();
const expenseRepo = new ExpenseRepo();
const settlementRepo = new SettlementRepo();

// Initialize services
const groupService = new GroupService(groupRepo, userRepo);
const expenseService = new ExpenseService(expenseRepo, userRepo);
const balanceService = new BalanceService(expenseRepo, settlementRepo);

// Store user's active group in memory (in production, use session middleware)
const userActiveGroups = new Map<number, string>();

// /start - Welcome message
bot.command("start", (ctx) => {
  ctx.reply(
    "Welcome to Splitbot! 🤖\n\n" +
      "I help you split expenses with friends.\n\n" +
      "Commands:\n" +
      "/newgroup <name> - Create a new group\n" +
      "/join <group_id> - Join a group\n" +
      "/addexpense <amount> <description> - Add an expense\n" +
      "/balances - View current balances\n" +
      "/settle - See suggested settlements\n" +
      "/history - View expense history\n" +
      "/help - Show this message"
  );
});

// /help - Show help
bot.command("help", (ctx) => {
  ctx.reply(
    "Splitbot Commands:\n\n" +
      "/newgroup <name> - Create a new group\n" +
      "/join <group_id> - Set active group\n" +
      "/addexpense <amount> <description> - Add an expense (split equally)\n" +
      "/balances - View current balances\n" +
      "/settle - See suggested settlements\n" +
      "/history - View expense history\n\n" +
      "Example:\n" +
      "/newgroup Weekend Trip\n" +
      "/addexpense 50.00 Dinner at restaurant"
  );
});

// /newgroup - Create a new group
bot.command("newgroup", async (ctx) => {
  const groupName = ctx.match.trim();

  if (!groupName) {
    return ctx.reply("Usage: /newgroup <name>\nExample: /newgroup Weekend Trip");
  }

  const userId = ctx.from?.id.toString() || "";
  const userName = ctx.from?.first_name || "User";
  const groupId = `grp_${Date.now()}`;

  try {
    const group = await groupService.createGroup(groupId, groupName, userId, userName);
    userActiveGroups.set(ctx.from!.id, groupId);

    ctx.reply(
      `✅ Group "${group.name}" created!\n\n` +
        `Group ID: ${groupId}\n` +
        `Share this ID with friends so they can join with /join ${groupId}`
    );
  } catch (error) {
    ctx.reply("❌ Error creating group. Please try again.");
    console.error(error);
  }
});

// /join - Join/set active group
bot.command("join", async (ctx) => {
  const groupId = ctx.match.trim();

  if (!groupId) {
    return ctx.reply("Usage: /join <group_id>\nExample: /join grp_1234567890");
  }

  const userId = ctx.from?.id.toString() || "";
  const userName = ctx.from?.first_name || "User";

  try {
    const group = await groupService.getGroup(groupId);

    if (!group) {
      return ctx.reply("❌ Group not found. Check the group ID and try again.");
    }

    // Add member if not already in group
    if (!group.members.includes(userId)) {
      await groupService.addMember(groupId, userId, userName);
    }

    userActiveGroups.set(ctx.from!.id, groupId);
    ctx.reply(`✅ Joined group "${group.name}"!\n\nYou can now add expenses.`);
  } catch (error) {
    ctx.reply("❌ Error joining group. Please try again.");
    console.error(error);
  }
});

// /addexpense - Add an expense
bot.command("addexpense", async (ctx) => {
  const groupId = userActiveGroups.get(ctx.from!.id);

  if (!groupId) {
    return ctx.reply(
      "❌ You're not in a group. Use /newgroup or /join first."
    );
  }

  const parts = ctx.match.trim().split(" ");
  if (parts.length < 2) {
    return ctx.reply(
      "Usage: /addexpense <amount> <description>\n" +
        "Example: /addexpense 50.00 Dinner at restaurant"
    );
  }

  const amountStr = parts[0];
  const description = parts.slice(1).join(" ");
  const amountCents = Math.round(parseFloat(amountStr) * 100);

  if (isNaN(amountCents) || amountCents <= 0) {
    return ctx.reply("❌ Invalid amount. Please enter a valid positive number.");
  }

  const userId = ctx.from?.id.toString() || "";
  const userName = ctx.from?.first_name || "User";

  try {
    const group = await groupService.getGroup(groupId);
    if (!group) {
      return ctx.reply("❌ Group not found.");
    }

    // Get participant info
    const participants = await Promise.all(
      group.members.map(async (memberId) => {
        const user = await userRepo.findById(memberId);
        return { id: memberId, name: user?.name || "Unknown" };
      })
    );

    const expenseId = `exp_${Date.now()}`;
    await expenseService.createExpense({
      id: expenseId,
      groupId,
      description,
      amountCents,
      currency: "USD",
      paidBy: userId,
      paidByName: userName,
      participants,
      splitMethod: "equal",
    });

    const perPerson = (amountCents / participants.length / 100).toFixed(2);
    ctx.reply(
      `✅ Expense added!\n\n` +
        `💰 $${(amountCents / 100).toFixed(2)} - ${description}\n` +
        `Split equally among ${participants.length} people ($${perPerson} each)\n\n` +
        `Use /balances to see updated balances.`
    );
  } catch (error) {
    ctx.reply("❌ Error adding expense. Please try again.");
    console.error(error);
  }
});

// /balances - View balances
bot.command("balances", async (ctx) => {
  const groupId = userActiveGroups.get(ctx.from!.id);

  if (!groupId) {
    return ctx.reply("❌ You're not in a group. Use /newgroup or /join first.");
  }

  try {
    const balances = await balanceService.getGroupBalances(groupId);

    if (balances.length === 0) {
      return ctx.reply("No expenses yet! Use /addexpense to add one.");
    }

    // Get user names
    const balanceLines = await Promise.all(
      balances.map(async (b) => {
        const user = await userRepo.findById(b.userId);
        const name = user?.name || "Unknown";
        const amount = (Math.abs(b.balance) / 100).toFixed(2);

        if (b.balance > 0) {
          return `✅ ${name}: owed $${amount}`;
        } else if (b.balance < 0) {
          return `❌ ${name}: owes $${amount}`;
        } else {
          return `➖ ${name}: settled up`;
        }
      })
    );

    ctx.reply("💰 Group Balances:\n\n" + balanceLines.join("\n"));
  } catch (error) {
    ctx.reply("❌ Error fetching balances. Please try again.");
    console.error(error);
  }
});

// /settle - Show suggested settlements
bot.command("settle", async (ctx) => {
  const groupId = userActiveGroups.get(ctx.from!.id);

  if (!groupId) {
    return ctx.reply("❌ You're not in a group. Use /newgroup or /join first.");
  }

  try {
    const settlements = await balanceService.getSimplifiedDebts(groupId);

    if (settlements.length === 0) {
      return ctx.reply("✅ Everyone is settled up! No payments needed.");
    }

    const settlementLines = await Promise.all(
      settlements.map(async (s) => {
        const fromUser = await userRepo.findById(s.from);
        const toUser = await userRepo.findById(s.to);
        const amount = (s.amount / 100).toFixed(2);

        return `💸 ${fromUser?.name || "Unknown"} → ${toUser?.name || "Unknown"}: $${amount}`;
      })
    );

    ctx.reply(
      "💰 Suggested Settlements:\n\n" +
        settlementLines.join("\n") +
        "\n\nThese payments will settle all debts!"
    );
  } catch (error) {
    ctx.reply("❌ Error calculating settlements. Please try again.");
    console.error(error);
  }
});

// /history - View expense history
bot.command("history", async (ctx) => {
  const groupId = userActiveGroups.get(ctx.from!.id);

  if (!groupId) {
    return ctx.reply("❌ You're not in a group. Use /newgroup or /join first.");
  }

  try {
    const expenses = await expenseService.getGroupExpenses(groupId);

    if (expenses.length === 0) {
      return ctx.reply("No expenses yet! Use /addexpense to add one.");
    }

    const expenseLines = await Promise.all(
      expenses.slice(0, 10).map(async (e) => {
        const payer = await userRepo.findById(e.paidBy);
        const amount = (e.amount / 100).toFixed(2);
        const date = e.createdAt.toLocaleDateString();

        return `💰 $${amount} - ${e.description}\n   Paid by ${payer?.name || "Unknown"} on ${date}`;
      })
    );

    ctx.reply(
      "📝 Recent Expenses (last 10):\n\n" + expenseLines.join("\n\n")
    );
  } catch (error) {
    ctx.reply("❌ Error fetching history. Please try again.");
    console.error(error);
  }
});

// Start bot
bot.start();
console.log("🤖 Splitbot is running...");
