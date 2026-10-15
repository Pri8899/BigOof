// events/guildMemberRemove.js — Automatically log out and purge users when they leave or get kicked/banned
const { getUser, purgeUser } = require('../database/db');
const { updateDashboard } = require('../tasks/ratingSync');

module.exports = {
  name: 'guildMemberRemove',

  async execute(member, client) {
    const discordClient = client || member.client;
    const userId = member.id;
    const user = getUser(userId);

    const displayName = member.user?.tag || member.user?.username || member.displayName || `User (${userId})`;
    const guildName = member.guild?.name || 'the server';

    if (!user) {
      console.log(`[guildMemberRemove] 🚪 ${displayName} left ${guildName} (No linked accounts found in DB).`);
      return;
    }

    const linkedHandles = [];
    if (user.cf_handle) linkedHandles.push(`CF: ${user.cf_handle}`);
    if (user.ac_handle) linkedHandles.push(`AtCoder: ${user.ac_handle}`);
    if (user.toph_handle) linkedHandles.push(`Toph: ${user.toph_handle}`);
    if (user.github_handle) linkedHandles.push(`GitHub: ${user.github_handle}`);
    if (user.lc_handle) linkedHandles.push(`LeetCode: ${user.lc_handle}`);

    const handlesStr = linkedHandles.length > 0 ? linkedHandles.join(', ') : 'None';

    console.log(`[guildMemberRemove] 🚪 ${displayName} left or was removed from ${guildName}.`);

    // Update the dashboard for this guild to reflect current member roster
    if (discordClient) {
      updateDashboard(discordClient, member.guild.id).catch(err =>
        console.error('[guildMemberRemove] Error updating dashboard after member leave:', err.message)
      );
    }
  }
};
