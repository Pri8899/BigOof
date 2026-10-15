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
      .setTitle(`👋 Welcome to ${member.guild.name}!`)
      .setDescription([
        `Hey **${member.user.username}**! Welcome to the server.`,
        '',
        'You\'ve been assigned the **CP** role! 🎉',
        '',
        '**🚀 Get Started:**',
        '> Link your competitive programming accounts so you appear on the server leaderboard!',
        '',
        '```',
        '/link codeforces <your-handle>',
        '/link atcoder    <your-handle>',
        '```',
        '',
        '**📋 Other Useful Commands:**',
        '• `/profile` — View your stats',
        '• `/contests` — See upcoming contests',
        '• `/leaderboard` — Server rankings',
        '',
        'Good luck and happy coding! 💻'
      ].join('\n'))
      .setThumbnail(member.guild.iconURL({ dynamic: true }))
      .setFooter({ text: member.guild.name })
      .setTimestamp();

    try {
      await member.user.send({ embeds: [welcomeEmbed] });
    } catch {
      // User has DMs disabled — that's fine
    }
  }
};
