// commands/admin/setup-roles.js — Create and configure CP, Rank, and Streak roles
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
  { name: '💫 30+ Day Streak', color: 0xE0115F },
  { name: '👑 15+ Day Streak', color: 0xF1C40F },
  { name: '🔥 7+ Day Streak',  color: 0xE67E22 }
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-roles')
    .setDescription('Create the CP, Rank, and Streak roles and assign them to members (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });
    const guild = interaction.guild;

    let createdCount = 0;

    // 1. Find or create base CP role
    let cpRole = guild.roles.cache.find(r => r.name === 'CP');
    if (!cpRole) {
      try {
        cpRole = await guild.roles.create({
          name: 'CP',
          color: 0x5865F2,
          reason: 'Created by CP Bot (Base Member Role)',
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

    // 2. Create Rank Roles (if not existing)
    for (const rDef of CF_ROLES) {
      const existing = guild.roles.cache.find(r => r.name === rDef.name);
      if (!existing) {
        try {
          await guild.roles.create({
            name: rDef.name,
            color: rDef.color,
            reason: 'Created by CP Bot (Rank Tier)'
          });
          createdCount++;
        } catch (_) {}
      }
    }

    // 3. Create Streak Roles (if not existing)
    for (const sDef of STREAK_ROLES) {
      const existing = guild.roles.cache.find(r => r.name === sDef.name);
      if (!existing) {
        try {
          await guild.roles.create({
            name: sDef.name,
            color: sDef.color,
            reason: 'Created by CP Bot (Streak Milestone)'
          });
          createdCount++;
        } catch (_) {}
      }
    }

    // Reply immediately
    await interaction.editReply({
      embeds: [successEmbed(
        'Server Roles Configured! ✅',
        `Successfully verified/created **CP Member**, **Codeforces Rank**, and **Streak** roles in this server (${createdCount} new role(s) created).\n\n` +
        `Now bulk-assigning the **CP** role to server members and syncing rank roles in the background...`
      )]
    });

    // 4. Background member assignment
    guild.members.fetch()
      .then(async members => {
        // Bulk assign CP role
        for (const [, member] of members) {
          if (!member.user.bot && !member.roles.cache.has(cpRole.id)) {
            await member.roles.add(cpRole).catch(() => {});
          }
        }

        // Sync ranks for linked users in this server
        const users = getAllUsers();
        for (const user of users) {
          const member = members.get(user.discord_id);
          if (!member) continue;

          // Rank sync
          const ratings = getRatings(user.discord_id);
          const cf = ratings.find(r => r.platform === 'cf');
          if (cf && cf.rating !== null) {
            const roleName = cf.rank_title || 'Newbie';
            const role = guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
            if (role && !member.roles.cache.has(role.id)) {
              await member.roles.add(role).catch(() => {});
            }
          }
        }
        console.log(`[setup-roles] Role setup and background sync complete for ${guild.name}.`);
      })
      .catch(err => console.error('[setup-roles] Background sync error:', err.message));
  }
};
