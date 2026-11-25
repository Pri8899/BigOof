// commands/admin/setup-roles.js — Create and configure CP, Rank, and Streak roles safely
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { setConfig, getAllUsers, getRatings, getAllStreaks } = require('../../database/db');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

const CF_ROLES = [
  { name: 'Legendary Grandmaster', color: 0xFF0000 },
  { name: 'International Grandmaster', color: 0xFF0000 },
  { name: 'Grandmaster', color: 0xFF0000 },
  { name: 'International Master', color: 0xFF8C00 },
  { name: 'Master', color: 0xFF8C00 },
  { name: 'Candidate Master', color: 0xAA00AA },
  { name: 'Expert', color: 0x0000FF },
  { name: 'Specialist', color: 0x03A89E },
  { name: 'Pupil', color: 0x008000 },
  { name: 'Newbie', color: 0x808080 }
];

const STREAK_ROLES = [
  { name: '💫 30+ Day Streak', min: 30, color: 0xE0115F },
  { name: '👑 15+ Day Streak', min: 15, color: 0xF1C40F },
  { name: '🔥 7+ Day Streak',  min: 7,  color: 0xE67E22 }
];

module.exports = {
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName('setup-roles')
    .setDescription('Create CP, Rank, and Streak roles and sync them across members (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });
    const guild = interaction.guild;
    const me = guild.members.me;

    if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.editReply({
        embeds: [errorEmbed('Missing Permission', 'I need the **Manage Roles** permission to create and assign roles.')]
      });
    }

    let createdCount = 0;

    let cpRole = guild.roles.cache.find(r => r.name === 'CP');
    if (!cpRole) {
      try {
        cpRole = await guild.roles.create({
          name: 'CP',
          color: 0x5865F2,
          reason: 'Created by BigOof (Base Member Role)',
          mentionable: true
        });
        createdCount++;
      } catch (err) {
        return interaction.editReply({
          embeds: [errorEmbed('Failed', `Could not create the base CP role: ${err.message}`)]
        });
      }
    }
    setConfig('cp_role_id', cpRole.id, guild.id);

    for (const rDef of CF_ROLES) {
      if (!guild.roles.cache.find(r => r.name === rDef.name)) {
        try {
          await guild.roles.create({ name: rDef.name, color: rDef.color, reason: 'Created by BigOof (Rank Tier)' });
          createdCount++;
        } catch (_) {}
      }
    }

    for (const sDef of STREAK_ROLES) {
      if (!guild.roles.cache.find(r => r.name === sDef.name)) {
        try {
          await guild.roles.create({ name: sDef.name, color: sDef.color, reason: 'Created by BigOof (Streak Milestone)' });
          createdCount++;
        } catch (_) {}
      }
    }

    const hierarchyBlocked = cpRole.position >= me.roles.highest.position;
    await interaction.editReply({
      embeds: [successEmbed(
        'Server Roles Configured! ✅',
        `Verified/created **CP**, **Codeforces Rank**, and **Streak** roles (${createdCount} created).\n` +
        `Now assigning **CP**, rank, and streak roles in the background...` +
        (hierarchyBlocked ? '\n\n⚠️ *Reminder: Move the bot\'s role above these roles in Server Settings → Roles so assignment succeeds.*' : '')
      )]
    });

    guild.members.fetch()
      .then(async members => {
        for (const [, member] of members) {
          if (!member.user.bot && cpRole.editable && cpRole.position < me.roles.highest.position && !member.roles.cache.has(cpRole.id)) {
            await member.roles.add(cpRole).catch(() => {});
          }
        }

        const streaksByUser = {};
        for (const s of getAllStreaks()) {
          streaksByUser[s.discord_id] = Math.max(streaksByUser[s.discord_id] || 0, s.current_streak || 0);
        }

        const users = getAllUsers();
        for (const user of users) {
          const member = members.get(user.discord_id);
          if (!member) continue;

          // Sync CF Rank role
          const cf = getRatings(user.discord_id).find(r => r.platform === 'cf');
          if (cf && cf.rating !== null) {
            const roleName = (cf.rank_title || 'Newbie').toLowerCase();
            const targetRole = guild.roles.cache.find(r => r.name.toLowerCase() === roleName);
            if (targetRole && targetRole.editable && targetRole.position < me.roles.highest.position && !member.roles.cache.has(targetRole.id)) {
              await member.roles.add(targetRole).catch(() => {});
            }
          }

          // Sync Streak Milestone role
          const bestStreak = streaksByUser[user.discord_id] || 0;
          const targetStreakDef = STREAK_ROLES.find(s => bestStreak >= s.min);
          if (targetStreakDef) {
            const streakRole = guild.roles.cache.find(r => r.name === targetStreakDef.name);
            if (streakRole && streakRole.editable && streakRole.position < me.roles.highest.position && !member.roles.cache.has(streakRole.id)) {
              await member.roles.add(streakRole).catch(() => {});
            }
          }
        }

        console.log(`[setup-roles] Role setup and background sync complete for ${guild.name}.`);
      })
      .catch(err => console.error('[setup-roles] Background sync error:', err.message));
  }
};
