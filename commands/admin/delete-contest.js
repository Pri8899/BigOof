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
      opt.setName('id')
        .setDescription('Select the custom contest to delete')
        .setRequired(true)
        .setAutocomplete(true)),

  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused().toLowerCase();
    
    // Fetch all custom contests
    const contests = db.prepare(`
      SELECT contest_id, name, start_time, time_na FROM notified_contests 
      WHERE platform = 'Custom'
    `).all();

    // Map to choices
    const choices = contests.map(c => {
      let dateLabel = 'Date: N/A';
      if (c.start_time) {
        const d = new Date(c.start_time * 1000);
        // Format to Dhaka time string manually for autocomplete
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Dhaka',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        });
        dateLabel = formatter.format(d);
        if (c.time_na === 1) {
          dateLabel += ' (Time: N/A)';
        } else {
          const timeFormatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Dhaka',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          });
          dateLabel += ` @ ${timeFormatter.format(d)}`;
        }
      }
      return {
        name: `${c.name} (${dateLabel})`,
        value: c.contest_id
      };
    });

    const filtered = choices.filter(choice => 
      choice.name.toLowerCase().includes(focusedValue)
    );

    await interaction.respond(filtered.slice(0, 25));
  },

  async execute(interaction) {
    const id = interaction.options.getString('id');

    // Find the contest by ID
    const target = db.prepare(`
      SELECT * FROM notified_contests 
      WHERE contest_id = ?
    `).get(id);

    if (!target) {
      // Fallback: if they typed a name instead of selecting from autocomplete, try finding by name
      const matches = db.prepare(`
        SELECT * FROM notified_contests 
        WHERE platform = 'Custom' AND name LIKE ?
      `).all(`%${id}%`);

      if (matches.length === 0) {
        return interaction.reply({
          embeds: [errorEmbed(
            'Contest Not Found',
            'Could not find the selected contest. Please make sure to choose an option from the auto-complete dropdown.'
          )],
          ephemeral: true
        });
      }

      if (matches.length > 1) {
        const listStr = matches.map((c, idx) => `**${idx + 1}.** ${c.name} (${c.start_time ? `<t:${c.start_time}:d>` : 'Date: N/A'})`).join('\n');
        return interaction.reply({
          embeds: [errorEmbed(
            'Multiple Contests Found',
            `Multiple contests matched your search. Please use the autocomplete menu to select the exact contest:\n\n${listStr}`
          )],
          ephemeral: true
        });
      }

      // Single match found -> delete it
      return deleteContest(interaction, matches[0]);
    }

    return deleteContest(interaction, target);
  }
};

async function deleteContest(interaction, target) {
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
