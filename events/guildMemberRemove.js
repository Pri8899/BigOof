// events/guildMemberRemove.js — Refresh leaving server's dashboard and purge user data when no mutual guilds remain
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
      console.log(`[guildMemberRemove] ${displayName} left ${guildName} (no linked accounts).`);
      return;
    }

    // Check if the user still shares any other guild with the bot before purging globally
    let sharesAnotherGuild = false;
    if (discordClient) {
      for (const otherGuild of discordClient.guilds.cache.values()) {
        if (otherGuild.id === member.guild?.id) continue;
        const stillInGuild = otherGuild.members.cache.has(userId)
          || await otherGuild.members.fetch(userId).catch(() => null);
        if (stillInGuild) {
          sharesAnotherGuild = true;
          break;
        }
      }
    }

    const linkedHandles = [];
    if (user.cf_handle) linkedHandles.push(`CF: ${user.cf_handle}`);
    if (user.ac_handle) linkedHandles.push(`AtCoder: ${user.ac_handle}`);
    if (user.toph_handle) linkedHandles.push(`Toph: ${user.toph_handle}`);
    if (user.github_handle) linkedHandles.push(`GitHub: ${user.github_handle}`);
    const handlesStr = linkedHandles.length > 0 ? linkedHandles.join(', ') : 'None';

    if (!sharesAnotherGuild) {
      purgeUser(userId);
      console.log(`[guildMemberRemove] Purged ${displayName} (${handlesStr}) after leaving ${guildName}.`);
    } else {
      console.log(`[guildMemberRemove] ${displayName} left ${guildName} (kept data — still active in another shared server).`);
    }

    if (discordClient && member.guild?.id) {
      updateDashboard(discordClient, member.guild.id).catch(err =>
        console.error('[guildMemberRemove] Dashboard update error:', err.message)
      );
    }
  }
};
