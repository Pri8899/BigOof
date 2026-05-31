// commands/admin/add-contest.js — Add a custom contest
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { db } = require('../../database/db');
const { postContestSummary } = require('../../tasks/contestFetcher');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('add-contest')
    .setDescription('Add a custom contest (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption(opt =>
      opt.setName('name')
        .setDescription('Name of the contest')
        .setRequired(true))
    .addStringOption(opt =>
      opt.setName('link')
        .setDescription('URL link to the contest')
        .setRequired(true))
    .addStringOption(opt =>
      opt.setName('date')
        .setDescription('Date of the contest (DD-MM-YYYY or YYYY-MM-DD)')
        .setRequired(true))
    .addStringOption(opt =>
      opt.setName('time')
        .setDescription('Start time of the contest (HH:MM in 24h Dhaka time)')
        .setRequired(true))
    .addStringOption(opt =>
      opt.setName('duration')
        .setDescription('Duration (e.g., 2h, 120m, 2h 30m)')
        .setRequired(true)),

  async execute(interaction) {
    const name = interaction.options.getString('name');
    let link = interaction.options.getString('link');
    const dateStr = interaction.options.getString('date').trim();
    const timeStr = interaction.options.getString('time').trim();
    const durationStr = interaction.options.getString('duration').trim();

    // 1. Validate and format Link
    if (!link.startsWith('http://') && !link.startsWith('https://')) {
      link = 'https://' + link;
    }

    const isDateNA = dateStr.toLowerCase() === 'n/a' || dateStr.toLowerCase() === 'na';
    const isTimeNA = timeStr.toLowerCase() === 'n/a' || timeStr.toLowerCase() === 'na';
    const isDurationNA = durationStr.toLowerCase() === 'n/a' || durationStr.toLowerCase() === 'na';

    let startTimeSec = null;
    let durationSec = null;

    let year, month, day;
    let hours, minutes;

    // 2. Parse Date
    if (!isDateNA) {
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
              'Please use DD-MM-YYYY, YYYY-MM-DD or N/A format (e.g., 31-05-2026 or N/A).'
            )],
            ephemeral: true
          });
        }
      }
    }

    // 3. Parse Time
    if (!isTimeNA) {
      const timePattern = /^(\d{1,2}):(\d{2})$/;
      const timeMatch = timeStr.match(timePattern);
      if (!timeMatch) {
        return interaction.reply({
          embeds: [errorEmbed(
            'Invalid Time Format',
            'Please use HH:MM 24h format or N/A (e.g., 20:30 or N/A).'
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

    // 4. Construct Epoch if both are not N/A
    if (!isDateNA && !isTimeNA) {
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

    // 3. Parse Duration
    if (!isDurationNA) {
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
              'Please enter duration in a format like "2h", "120m", "2h 30m" or N/A.'
            )],
            ephemeral: true
          });
        }
      }
    }

    // 4. Insert into database
    const contestId = `custom_${Date.now()}`;
    try {
      db.prepare(`
        INSERT INTO notified_contests (contest_id, platform, name, start_time, duration_sec, url)
        VALUES (?, 'Custom', ?, ?, ?, ?)
      `).run(contestId, name, startTimeSec, durationSec, link);

      // Refresh contest summary list in channel immediately!
      await postContestSummary(interaction.client);

      const formattedStart = startTimeSec ? `<t:${startTimeSec}:F>` : 'N/A';
      let durString = 'N/A';
      if (durationSec !== null) {
        const durHours = Math.floor(durationSec / 3600);
        const durMins = Math.floor((durationSec % 3600) / 60);
        durString = durMins > 0 ? `${durHours}h ${durMins}m` : `${durHours}h`;
      }

      return interaction.reply({
        embeds: [successEmbed(
          'Contest Added Successfully',
          `**Name**: ${name}\n**Starts**: ${formattedStart}\n**Duration**: ${durString}\n**Link**: [Click here](${link})\n\nThe upcoming contests list in the radar channel has been updated! 🏆`
        )],
        ephemeral: true
      });
    } catch (err) {
      console.error('[Add Contest Database Error]', err);
      return interaction.reply({
        embeds: [errorEmbed(
          'Database Error',
          `Failed to save custom contest: ${err.message}`
        )],
        ephemeral: true
      });
    }
  }
};
