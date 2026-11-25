// events/guildMemberAdd.js — Auto-assign CP role safely and send accurate welcome DM
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { upsertUser, getConfig } = require('../database/db');

module.exports = {
  name: 'guildMemberAdd',

  async execute(member) {
    if (member.user?.bot) return;

    upsertUser(member.id, member.user.username);

    // Assign CP role safely if bot has permissions & role hierarchy
    const me = member.guild.members.me;
    if (me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      const cpRoleId = getConfig('cp_role_id', member.guild.id);
      const role = (cpRoleId && member.guild.roles.cache.get(cpRoleId))
        || member.guild.roles.cache.find(r => r.name === 'CP');

      if (role && role.editable && role.position < me.roles.highest.position) {
        await member.roles.add(role).catch(err =>
          console.error(`[guildMemberAdd] Could not assign CP role to ${member.user.tag}:`, err.message)
        );
      }
    }

    const welcomeEmbed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setAuthor({
        name: `${member.guild.name} · Competitive Programming Hub`,
        iconURL: member.guild.iconURL({ dynamic: true }) || undefined
      })
      .setTitle(`👋 Welcome to ${member.guild.name}, ${member.user.username}!`)
      .setDescription([
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '> 🚀 **Welcome to the competitive programming circle!**',
        '> 🏷️ **Role:** You have been granted the **CP** role (when configured)!',
        '> 💡 **First Step:** Link your handles to appear on the server leaderboard!',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
      ].join('\n'))
      .addFields(
        {
          name: '⚡ Link Your Profiles',
          value: [
            '```',
            '/link platform:🏆 Codeforces handle:<your-handle>',
            '/link platform:🎯 AtCoder    handle:<your-handle>',
            '/link platform:⚡ Toph       handle:<your-handle>',
            '/link platform:🐙 GitHub     handle:<your-handle>',
            '```'
          ].join('\n'),
          inline: false
        },
        {
          name: '🎯 Features to Try',
          value:
            '• `/profile` — View your ratings, badges, and streaks\n' +
            '• `/compare` — Head-to-head clash with server rivals\n' +
            '• `/contests` — Upcoming contest radar\n' +
            '• `/vs` — Challenge friends to 3x3 Battle Grids & races\n' +
            '• `/solved` — Division breakdown of solved problems',
          inline: false
        }
      )
      .setThumbnail(member.guild.iconURL({ dynamic: true }))
      .setFooter({ text: `BigOof Companion · Happy Coding in ${member.guild.name}!`, iconURL: 'https://cdn-icons-png.flaticon.com/512/3112/3112946.png' })
      .setTimestamp();

    await member.user.send({ embeds: [welcomeEmbed] }).catch(() => {});
  }
};
