// commands/admin/setup-roles.js — Create and configure CP, Rank, and Streak milestone roles cleanly
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getAllUsers, getRatings, getAllStreaks } = require('../../database/db');
const {
  ensureGuildRoles,
  syncMemberRolesInGuild,
  syncUserRecord,
  getUserBestStreak,
  STREAK_ROLES
} = require('../../tasks/ratingSync');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName('setup-roles')
    .setDescription('Create CP, Rank, and Streak roles (7d to 2+ yr) and assign them to all members (Admin only)')
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

    let roleSetup;
    try {
      roleSetup = await ensureGuildRoles(guild);
    } catch (err) {
      return interaction.editReply({
        embeds: [errorEmbed('Failed', `Could not create server roles: ${err.message}`)]
      });
    }

    const { createdCount, cpRole } = roleSetup;
    const hierarchyBlocked = cpRole.position >= me.roles.highest.position;
    const streakSummary = [...STREAK_ROLES].reverse().map(r => r.name).join(' • ');

    await interaction.editReply({
      embeds: [successEmbed(
        'Server Roles Configured! ✅',
        `Verified/created **CP**, **Codeforces Rank**, and all **${STREAK_ROLES.length} Streak Milestone** roles (${createdCount} created).\n\n` +
        `**Streak Tiers:**\n> ${streakSummary}\n\n` +
        'Now assigning **CP**, rank, and streak roles for all members...' +
        (hierarchyBlocked ? "\n\n⚠️ *Reminder: Move the bot's role above these roles in Server Settings → Roles so assignment succeeds.*" : '')
      )]
    });

    guild.members.fetch()
      .then(async members => {
        // 1. Grant base CP role to every non-bot member immediately
        for (const [, member] of members) {
          if (!member.user.bot) {
            await syncMemberRolesInGuild(guild, member, { assignCP: true, cpRole, autoCreate: false });
          }
        }

        const streaksByUser = {};
        for (const s of getAllStreaks()) {
          streaksByUser[s.discord_id] = Math.max(streaksByUser[s.discord_id] || 0, s.current_streak || 0);
        }

        // 2. Apply cached Rank & Streak roles immediately to all linked users
        const users = getAllUsers();
        const guildLinkedUsers = [];
        for (const user of users) {
          const member = members.get(user.discord_id);
          if (!member) continue;
          guildLinkedUsers.push({ user, member });

          const cf = getRatings(user.discord_id).find(r => r.platform === 'cf');
          const cfRating = (cf && cf.rating !== null && cf.rating !== undefined) ? cf.rating : null;
          const bestStreak = streaksByUser[user.discord_id] || 0;

          await syncMemberRolesInGuild(guild, member, {
            cfRating,
            bestStreak,
            autoCreate: false
          });
        }

        // 3. Refresh streaks & stats for all linked members in this guild, then re-sync their roles
        for (const { user, member } of guildLinkedUsers) {
          if (!user.cf_handle && !user.ac_handle && !user.toph_handle) continue;
          await syncUserRecord(interaction.client, user, { forceStreaks: true, alertOnChange: false }).catch(() => {});
          const refreshedCF = getRatings(user.discord_id).find(r => r.platform === 'cf');
          const cfRating = (refreshedCF && refreshedCF.rating !== null && refreshedCF.rating !== undefined)
            ? refreshedCF.rating
            : null;
          await syncMemberRolesInGuild(guild, member, {
            cfRating,
            bestStreak: getUserBestStreak(user.discord_id),
            autoCreate: false
          });
        }

        console.log(`[setup-roles] Role setup and member sync complete for ${guild.name}.`);
      })
      .catch(err => console.error('[setup-roles] Background sync error:', err.message));
  }
};
