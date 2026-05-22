// events/messageReactionAdd.js — Handle reactions for contest reminders
const { addReminder, getUpcomingContests, getReminderByMsgId, acknowledgeReminder } = require('../database/db');

module.exports = {
  name: 'messageReactionAdd',

  async execute(reaction, user) {
    if (user.bot) return;

    // Fetch partial if needed
    if (reaction.partial) {
      try { await reaction.fetch(); } catch { return; }
    }
    if (reaction.message.partial) {
      try { await reaction.message.fetch(); } catch { return; }
    }

    const msg = reaction.message;

    // ── Handle DM Acknowledgment (✅) ──
    if (!msg.guildId && reaction.emoji.name === '✅') {
      const reminder = getReminderByMsgId(msg.id);
      if (reminder) {
        acknowledgeReminder(user.id, reminder.contest_id);
        try {
          await user.send(`✅ Reminders muted! (You will still receive the final 10-minute alerts)`);
        } catch {}
      }
      return;
    }

    // ── Handle Channel Subscribe (🔔) ──
    if (reaction.emoji.name === '🔔') {
      const contests = getUpcomingContests();
      
      // Check if this message is a contest notification
      const contest = contests.find(c => c.discord_msg_id === msg.id);
      if (!contest) return;

      addReminder(user.id, contest.contest_id);

      try {
        await user.send(`✅ You'll receive frequent DM reminders for **${contest.name}** starting 2 hours before it begins!\n\n⚠️ **Warning:** If you react with ✅ to any of those DMs, the bot will **STOP** sending you the 30-minute reminders.`);
      } catch {
        // DMs disabled
      }
    }
  }
};
