// events/guildMemberAdd.js — Auto-assign CP role and send welcome DM
const { EmbedBuilder } = require('discord.js');
const { upsertUser, getConfig } = require('../database/db');

module.exports = {
  name: 'guildMemberAdd',

  async execute(member) {
    // Register user in database
    upsertUser(member.id, member.user.username);

    // Assign CP role
    const cpRoleId = getConfig('cp_role_id', member.guild.id);
    if (cpRoleId) {
      const role = member.guild.roles.cache.get(cpRoleId);
      if (role) {
        await member.roles.add(role).catch(err =>
          console.error(`[guildMemberAdd] Could not assign CP role to ${member.user.tag}:`, err.message)
        );
      }
    } else {
      // Try to find by name
      const role = member.guild.roles.cache.find(r => r.name === 'CP');
      if (role) {
        await member.roles.add(role).catch(() => {});
      }
    }

    // Send welcome DM
    const welcomeEmbed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setAuthor({
        name: `${member.guild.name} · Competitive Programming Hub`,
        iconURL: member.guild.iconURL({ dynamic: true }) || undefined
      })
      .setTitle(`👋 Welcome to ${member.guild.name}, ${member.user.username}!`)
      .setDescription(
        `╭─ 🚀 **Welcome to the competitive programming circle!**\n` +
        `├─ 🏷️ **Role**: You have been granted the **CP** role!\n` +
        `╰─ 💡 **First Step**: Link your handles to appear on the server leaderboard!\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
      )
      .addFields(
        {
          name: '⚡ Link Your Profiles',
          value: '```sh\n/link codeforces <your-handle>\n/link atcoder    <your-handle>\n/link github     <your-handle>\n```',
          inline: false
        },
        {
          name: '🎯 Features to Try',
          value:
            '• `/profile` — View your ratings, badges, and streaks\n' +
            '• `/compare` — Head-to-head clash with server rivals\n' +
            '• `/contests` — Upcoming contest radar\n' +
            '• `/vs` — Challenge friends to 1v1 lockout duels\n' +
            '• `/solved` — Division breakdown of solved problems',
          inline: false
        }
      )
      .setThumbnail(member.guild.iconURL({ dynamic: true }))
      .setFooter({ text: `BigOof Companion · Happy Coding in ${member.guild.name}!`, iconURL: 'https://cdn-icons-png.flaticon.com/512/3112/3112946.png' })
      .setTimestamp();

    try {
      await member.user.send({ embeds: [welcomeEmbed] });
    } catch {
      // User has DMs disabled — that's fine
    }
  }
};
