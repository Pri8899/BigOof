// events/messageReactionAdd.js — Handle 🔔 reactions for contest reminders
const { addReminder, getUpcomingContests } = require('../database/db');

module.exports = {
  name: 'messageReactionAdd',

  async execute(reaction, user) {
    if (user.bot) return;
    if (reaction.emoji.name !== '🔔') return;

    // Fetch partial if needed
    if (reaction.partial) {
      try { await reaction.fetch(); } catch { return; }
    }
    if (reaction.message.partial) {
      try { await reaction.message.fetch(); } catch { return; }
    }

    // Find the contest this message is about by matching the message ID to stored embeds
    // We store the discord message ID in the contest table
    const msg = reaction.message;
    const contests = getUpcomingContests();

    // Check if this message is a contest notification
    const contest = contests.find(c => c.discord_msg_id === msg.id);
    if (!contest) return;

    addReminder(user.id, contest.contest_id);

    try {
      await user.send(`✅ You'll receive a DM reminder **15 minutes before** **${contest.name}** starts!`);
    } catch {
      // DMs disabled
    }
  }
};
