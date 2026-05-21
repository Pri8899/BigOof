// commands/admin/setup-roles.js — Create and configure CP role
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { setConfig }            = require('../../database/db');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-roles')
    .setDescription('Create the CP role and assign it to all current members (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    // Reply IMMEDIATELY — don't wait for member assignment
    await interaction.deferReply({ flags: 64 });

    const guild = interaction.guild;

    // Find or create CP role
    let cpRole = guild.roles.cache.find(r => r.name === 'CP');
    if (!cpRole) {
      try {
        cpRole = await guild.roles.create({
          name:        'CP',
          color:       0x5865F2,
          reason:      'Created by CP Bot',
          mentionable: true
        });
      } catch (err) {
        return interaction.editReply({
          embeds: [errorEmbed('Failed', `Could not create the CP role: ${err.message}`)]
        });
      }
    }

    setConfig('cp_role_id', cpRole.id);

    // Reply immediately — bulk assign runs in background
    await interaction.editReply({
      embeds: [successEmbed(
        'CP Role Ready! ✅',
        `The **CP** role has been created/found.\n\nNow assigning it to all members in the background... this may take a minute.\nNew members will get it automatically when they join. 🎉`
      )]
    });

    // Background bulk assign — no await, runs after reply is sent
    guild.members.fetch()
      .then(members => {
        const tasks = [];
        for (const [, member] of members) {
          if (!member.user.bot && !member.roles.cache.has(cpRole.id)) {
            tasks.push(
              member.roles.add(cpRole).catch(() => {})
            );
          }
        }
        return Promise.all(tasks);
      })
      .then(results => {
        console.log(`[setup-roles] Assigned CP role to ${results.length} members.`);
      })
      .catch(err => console.error('[setup-roles] Bulk assign error:', err.message));
  }
};
