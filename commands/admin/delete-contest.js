// commands/admin/delete-contest.js — Delete a custom contest
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { db } = require('../../database/db');
const { postContestSummary } = require('../../tasks/contestFetcher');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('delete-contest')
    .setDescription('Delete a manually added custom contest (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption(opt =>
      opt.setName('name')
        .setDescription('Name (or part of the name) of the contest to delete')
        .setRequired(true)),

  async execute(interaction) {
    const queryName = interaction.options.getString('name').trim();

    // Find matches in the DB
    const matches = db.prepare(`
      SELECT * FROM notified_contests 
      WHERE platform = 'Custom' AND name LIKE ?
    `).all(`%${queryName}%`);

    if (matches.length === 0) {
      return interaction.reply({
        embeds: [errorEmbed(
          'No Contests Found',
          `Could not find any manual custom contests matching "${queryName}".`
        )],
        ephemeral: true
      });
    }

    if (matches.length > 1) {
      const listStr = matches.map((c, idx) => `**${idx + 1}.** ${c.name} (${c.start_time ? `<t:${c.start_time}:d>` : 'Date: N/A'})`).join('\n');
      return interaction.reply({
        embeds: [errorEmbed(
          'Multiple Contests Found',
          `Multiple contests matched "${queryName}". Please be more specific:\n\n${listStr}`
        )],
        ephemeral: true
      });
    }

    // Single match found -> delete it
    const target = matches[0];
    try {
      db.prepare(`
        DELETE FROM notified_contests 
        WHERE contest_id = ?
      `).run(target.contest_id);

      // Refresh contest summary list in channel immediately!
      await postContestSummary(interaction.client);

      return interaction.reply({
        embeds: [successEmbed(
          'Contest Deleted',
          `Successfully deleted the custom contest:\n**Name**: ${target.name}\n**Starts**: ${target.start_time ? `<t:${target.start_time}:F>` : 'N/A'}`
        )],
        ephemeral: true
      });
    } catch (err) {
      console.error('[Delete Contest DB Error]', err);
      return interaction.reply({
        embeds: [errorEmbed(
          'Database Error',
          `Failed to delete contest: ${err.message}`
        )],
        ephemeral: true
      });
    }
  }
};
