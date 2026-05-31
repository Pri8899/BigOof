// commands/admin/edit-contest.js — Edit a custom contest
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { db } = require('../../database/db');
const { postContestSummary } = require('../../tasks/contestFetcher');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('edit-contest')
    .setDescription('Edit a manually added custom contest (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption(opt =>
      opt.setName('id')
        .setDescription('Select the custom contest to edit')
        .setRequired(true)
        .setAutocomplete(true))
    .addStringOption(opt =>
      opt.setName('new_name')
        .setDescription('New name for the contest (optional)')
        .setRequired(false))
    .addStringOption(opt =>
      opt.setName('link')
        .setDescription('New URL link (optional)')
        .setRequired(false))
    .addStringOption(opt =>
      opt.setName('date')
        .setDescription('New date (DD-MM-YYYY, YYYY-MM-DD or N/A) (optional)')
        .setRequired(false))
    .addStringOption(opt =>
      opt.setName('time')
        .setDescription('New start time (HH:MM 24h or N/A) (optional)')
        .setRequired(false))
    .addStringOption(opt =>
      opt.setName('duration')
        .setDescription('New duration (e.g. 2h, 120m or N/A) (optional)')
        .setRequired(false)),

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
    let target = db.prepare(`
      SELECT * FROM notified_contests 
      WHERE contest_id = ?
    `).get(id);

    if (!target) {
      // Fallback: search by name wildcard
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

      target = matches[0];
    }

    // 2. Extract existing date & time in Dhaka timezone
    let existingDateStr = 'N/A';
    let existingTimeStr = 'N/A';
    if (target.start_time) {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Dhaka',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      const formatted = formatter.format(new Date(target.start_time * 1000));
      // Format returned by Intl: "MM/DD/YYYY, HH:MM"
      const match = formatted.match(/^(\d{2})\/(\d{2})\/(\d{4}),\s*(\d{2}):(\d{2})$/);
      if (match) {
        existingDateStr = `${match[2]}-${match[1]}-${match[3]}`; // DD-MM-YYYY
        existingTimeStr = target.time_na === 1 ? 'N/A' : `${match[4]}:${match[5]}`;
      }
    }

    // 3. Resolve final values
    const finalName = interaction.options.getString('new_name') || target.name;
    let finalLink = interaction.options.getString('link') || target.url;
    if (finalLink && !finalLink.startsWith('http://') && !finalLink.startsWith('https://')) {
      finalLink = 'https://' + finalLink;
    }

    const dateStr = (interaction.options.getString('date') || existingDateStr).trim();
    const timeStr = (interaction.options.getString('time') || existingTimeStr).trim();
    const durationInput = interaction.options.getString('duration');

    const isDateNA = dateStr.toLowerCase() === 'n/a' || dateStr.toLowerCase() === 'na';
    const isTimeNA = timeStr.toLowerCase() === 'n/a' || timeStr.toLowerCase() === 'na';

    let startTimeSec = null;
    let durationSec = target.duration_sec; // default to existing

    // 4. Parse Date & Time if modified/present
    if (!isDateNA) {
      let year, month, day;
      const datePattern1 = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/; // DD-MM-YYYY
      const datePattern2 = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/; // YYYY-MM-DD

      let match = dateStr.match(datePattern1);
      if (match) {
        day = parseInt(match[1], 10);
        month = parseInt(match[2], 10) - 1;
        year = parseInt(match[3], 10);
      } else {
        match = dateStr.match(datePattern2);
        if (match) {
          year = parseInt(match[1], 10);
          month = parseInt(match[2], 10) - 1;
          day = parseInt(match[3], 10);
        } else {
          return interaction.reply({
            embeds: [errorEmbed(
              'Invalid Date Format',
              'Please use DD-MM-YYYY, YYYY-MM-DD or N/A format.'
            )],
            ephemeral: true
          });
        }
      }

      // If date is valid, parse time
      let hours = 0;
      let minutes = 0;
      if (!isTimeNA) {
        const timePattern = /^(\d{1,2}):(\d{2})$/;
        const timeMatch = timeStr.match(timePattern);
        if (!timeMatch) {
          return interaction.reply({
            embeds: [errorEmbed(
              'Invalid Time Format',
              'Please use HH:MM format or N/A.'
            )],
            ephemeral: true
          });
        }
        hours = parseInt(timeMatch[1], 10);
        minutes = parseInt(timeMatch[2], 10);

        if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
          return interaction.reply({
            embeds: [errorEmbed(
              'Invalid Time Values',
              'Hours must be 0-23 and minutes 0-59.'
            )],
            ephemeral: true
          });
        }
      }

      const utcDate = Date.UTC(year, month, day, hours, minutes, 0);
      if (isNaN(utcDate)) {
        return interaction.reply({
          embeds: [errorEmbed(
            'Invalid Date/Time Values',
            'The provided date or time values are invalid.'
          )],
          ephemeral: true
        });
      }
      startTimeSec = Math.floor((utcDate - 6 * 3600 * 1000) / 1000);
    }

    // 5. Parse Duration if modified
    if (durationInput) {
      const durationStr = durationInput.trim();
      const isDurationNA = durationStr.toLowerCase() === 'n/a' || durationStr.toLowerCase() === 'na';

      if (isDurationNA) {
        durationSec = null;
      } else {
        const hRegex = /(\d+)\s*h/i;
        const mRegex = /(\d+)\s*m/i;
        
        const hMatch = durationStr.match(hRegex);
        const mMatch = durationStr.match(mRegex);
        
        durationSec = 0;
        if (hMatch) {
          durationSec += parseInt(hMatch[1], 10) * 3600;
        }
        if (mMatch) {
          durationSec += parseInt(mMatch[1], 10) * 60;
        }
        
        if (!hMatch && !mMatch) {
          const plain = parseInt(durationStr, 10);
          if (!isNaN(plain) && plain > 0) {
            durationSec = plain * 60;
          } else {
            return interaction.reply({
              embeds: [errorEmbed(
                'Invalid Duration Format',
                'Please enter duration in a format like "2h", "120m" or N/A.'
              )],
              ephemeral: true
            });
          }
        }
      }
    }

    // 6. Update database
    try {
      db.prepare(`
        UPDATE notified_contests 
        SET name = ?, start_time = ?, duration_sec = ?, url = ?, time_na = ?
        WHERE contest_id = ?
      `).run(finalName, startTimeSec, durationSec, finalLink, isTimeNA ? 1 : 0, target.contest_id);

      // Refresh contest summary list in channel immediately!
      await postContestSummary(interaction.client);

      const formattedStart = startTimeSec 
        ? (isTimeNA ? `<t:${startTimeSec}:D> (Time: N/A)` : `<t:${startTimeSec}:F>`)
        : 'N/A';

      let durString = 'N/A';
      if (durationSec !== null && durationSec !== undefined) {
        const durHours = Math.floor(durationSec / 3600);
        const durMins = Math.floor((durationSec % 3600) / 60);
        durString = durMins > 0 ? `${durHours}h ${durMins}m` : `${durHours}h`;
      }

      return interaction.reply({
        embeds: [successEmbed(
          'Contest Updated Successfully',
          `**Name**: ${finalName}\n**Starts**: ${formattedStart}\n**Duration**: ${durString}\n**Link**: [Click here](${finalLink})\n\nThe radar channel overview has been updated! 🏆`
        )],
        ephemeral: true
      });
    } catch (err) {
      console.error('[Edit Contest Database Error]', err);
      return interaction.reply({
        embeds: [errorEmbed(
          'Database Error',
          `Failed to update contest: ${err.message}`
        )],
        ephemeral: true
      });
    }
  }
};
