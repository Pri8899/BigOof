// commands/admin/custom-contest.js — Add, edit, list, or delete custom contests cleanly
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { db } = require('../../database/db');
const { postContestSummary, deleteContestRemindersFromDiscord } = require('../../tasks/contestFetcher');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { chunkLines } = require('../../utils/envHelper');
const { getTimeZone, getLocalParts, zonedDateTimeToUnix, isValidCalendarDate } = require('../../utils/time');

function parseDuration(str) {
  if (!str) return null;
  const s = str.trim().toLowerCase();
  if (s === 'n/a' || s === 'na') return null;

  let totalSec = 0;
  const hMatch = s.match(/(\d+)\s*h/);
  const mMatch = s.match(/(\d+)\s*m/);

  if (hMatch) totalSec += parseInt(hMatch[1], 10) * 3600;
  if (mMatch) totalSec += parseInt(mMatch[1], 10) * 60;
  if (!hMatch && !mMatch && /^\d+$/.test(s)) {
    totalSec = parseInt(s, 10) * 60;
  }

  return totalSec > 0 ? totalSec : null;
}

function parseDateTime(dateStr, timeStr) {
  const TZ = getTimeZone();
  const isDateNA = !dateStr || ['n/a', 'na'].includes(dateStr.toLowerCase().trim());
  const isTimeNA = !timeStr || ['n/a', 'na'].includes(timeStr.toLowerCase().trim());

  if (isDateNA) return { startTimeSec: null, timeNA: 1 };

  let year, month, day;
  const match1 = dateStr.trim().match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/); // DD-MM-YYYY
  const match2 = dateStr.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/); // YYYY-MM-DD

  if (match1) {
    day = parseInt(match1[1], 10);
    month = parseInt(match1[2], 10);
    year = parseInt(match1[3], 10);
  } else if (match2) {
    year = parseInt(match2[1], 10);
    month = parseInt(match2[2], 10);
    day = parseInt(match2[3], 10);
  } else {
    return { error: 'Invalid date format. Use DD-MM-YYYY or YYYY-MM-DD.' };
  }

  if (!isValidCalendarDate(year, month, day)) {
    return { error: `Invalid calendar date (${dateStr}). Please enter a valid day/month.` };
  }

  let hours = 0;
  let minutes = 0;
  const timeNA = isTimeNA ? 1 : 0;

  if (!isTimeNA) {
    const timeMatch = timeStr.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!timeMatch) {
      return { error: 'Invalid time format. Use HH:MM in 24h format.' };
    }
    hours = parseInt(timeMatch[1], 10);
    minutes = parseInt(timeMatch[2], 10);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      return { error: 'Invalid time values. Hours must be 0–23, minutes 0–59.' };
    }
  }

  try {
    const startTimeSec = zonedDateTimeToUnix(year, month, day, hours, minutes, 0, TZ);
    return { startTimeSec, timeNA };
  } catch (err) {
    return { error: `Failed to parse date/time: ${err.message}` };
  }
}

module.exports = {
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName('custom-contest')
    .setDescription('Manage manually added custom contests (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Add a new custom contest to the radar')
        .addStringOption(opt => opt.setName('name').setDescription('Contest name').setRequired(true))
        .addStringOption(opt => opt.setName('link').setDescription('Contest URL').setRequired(true))
        .addStringOption(opt => opt.setName('date').setDescription('Date (DD-MM-YYYY, YYYY-MM-DD, or N/A)').setRequired(true))
        .addStringOption(opt => opt.setName('time').setDescription('Start time (HH:MM in 24h or N/A)').setRequired(true))
        .addStringOption(opt => opt.setName('duration').setDescription('Duration (e.g. 2h, 120m, 2h 30m, or N/A)').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('edit')
        .setDescription('Edit an existing custom contest')
        .addStringOption(opt => opt.setName('contest').setDescription('Select custom contest to edit').setRequired(true).setAutocomplete(true))
        .addStringOption(opt => opt.setName('new_name').setDescription('New name for contest').setRequired(false))
        .addStringOption(opt => opt.setName('link').setDescription('New URL link').setRequired(false))
        .addStringOption(opt => opt.setName('date').setDescription('New date (DD-MM-YYYY, YYYY-MM-DD, or N/A)').setRequired(false))
        .addStringOption(opt => opt.setName('time').setDescription('New time (HH:MM 24h or N/A)').setRequired(false))
        .addStringOption(opt => opt.setName('duration').setDescription('New duration (e.g. 2h, 120m, or N/A)').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('delete')
        .setDescription('Delete a custom contest from the radar')
        .addStringOption(opt => opt.setName('contest').setDescription('Select custom contest to delete').setRequired(true).setAutocomplete(true))
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List all custom contests currently scheduled')
    ),

  async autocomplete(interaction) {
    const TZ = getTimeZone();
    const focusedValue = interaction.options.getFocused().toLowerCase();
    const contests = db.prepare("SELECT contest_id, name, start_time, time_na FROM notified_contests WHERE platform = 'Custom'").all();

    const choices = contests.map(c => {
      let dateLabel = 'Date: N/A';
      if (c.start_time) {
        const p = getLocalParts(new Date(c.start_time * 1000), TZ);
        dateLabel = p.dateStr;
        if (c.time_na === 1) {
          dateLabel += ' (Time: N/A)';
        } else {
          dateLabel += ` @ ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
        }
      }
      return {
        name: `${c.name} (${dateLabel})`.slice(0, 100),
        value: c.contest_id
      };
    });

    const filtered = choices.filter(c => c.name.toLowerCase().includes(focusedValue)).slice(0, 25);
    await interaction.respond(filtered).catch(() => {});
  },

  async execute(interaction) {
    const TZ = getTimeZone();
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'add') {
      const name = interaction.options.getString('name').trim();
      let link = interaction.options.getString('link').trim();
      const dateStr = interaction.options.getString('date');
      const timeStr = interaction.options.getString('time');
      const durationStr = interaction.options.getString('duration');

      if (!link.startsWith('http://') && !link.startsWith('https://')) {
        link = 'https://' + link;
      }
      try {
        new URL(link);
      } catch {
        return interaction.reply({ embeds: [errorEmbed('Invalid URL', 'Please enter a valid contest link URL.')], flags: 64 });
      }

      const parsed = parseDateTime(dateStr, timeStr);
      if (parsed.error) {
        return interaction.reply({ embeds: [errorEmbed('Invalid Date/Time', parsed.error)], flags: 64 });
      }

      const durationSec = parseDuration(durationStr);
      const isDurationNA = ['n/a', 'na'].includes(durationStr.trim().toLowerCase());
      if (!isDurationNA && durationSec === null) {
        return interaction.reply({
          embeds: [errorEmbed('Invalid Duration', 'Use a format like `2h`, `120m`, `2h 30m`, or `N/A`.')],
          flags: 64
        });
      }
      const contestId = `custom_${Date.now()}`;

      db.prepare(`
        INSERT INTO notified_contests (contest_id, platform, name, start_time, duration_sec, url, time_na)
        VALUES (?, 'Custom', ?, ?, ?, ?, ?)
      `).run(contestId, name, parsed.startTimeSec, durationSec, link, parsed.timeNA);

      postContestSummary(interaction.client, interaction.guildId).catch(() => {});

      return interaction.reply({
        embeds: [successEmbed('Custom Contest Added', `**[${name}](${link})** has been added to the contest radar.`)],
        flags: 64
      });
    }

    if (subcommand === 'edit') {
      const contestId = interaction.options.getString('contest');
      const contest = db.prepare("SELECT * FROM notified_contests WHERE contest_id = ? AND platform = 'Custom'").get(contestId);

      if (!contest) {
        return interaction.reply({ embeds: [errorEmbed('Not Found', 'Custom contest not found.')], flags: 64 });
      }

      const newName = interaction.options.getString('new_name')?.trim() || contest.name;
      let newLink = interaction.options.getString('link')?.trim() || contest.url;
      if (newLink && !newLink.startsWith('http://') && !newLink.startsWith('https://')) {
        newLink = 'https://' + newLink;
      }
      if (newLink) {
        try {
          new URL(newLink);
        } catch {
          return interaction.reply({ embeds: [errorEmbed('Invalid URL', 'Please enter a valid contest link URL.')], flags: 64 });
        }
      }

      let newStartTime = contest.start_time;
      let newTimeNA = contest.time_na;

      const dateOpt = interaction.options.getString('date');
      const timeOpt = interaction.options.getString('time');

      if (dateOpt !== null || timeOpt !== null) {
        let effectiveDate = dateOpt;
        let effectiveTime = timeOpt;

        // Preserve untouched date or time component when only one option is edited
        if (effectiveDate === null && contest.start_time) {
          const existingParts = getLocalParts(new Date(contest.start_time * 1000), TZ);
          effectiveDate = existingParts.isoDate;
        }
        if (effectiveDate === null && effectiveTime !== null && !['n/a', 'na'].includes(effectiveTime.trim().toLowerCase())) {
          return interaction.reply({
            embeds: [errorEmbed('Date Required', 'This contest currently has `Date: N/A`. Please also pass `date` when setting a specific `time`.')],
            flags: 64
          });
        }
        if (effectiveTime === null) {
          if (contest.time_na === 1 || !contest.start_time) {
            effectiveTime = 'N/A';
          } else {
            const existingParts = getLocalParts(new Date(contest.start_time * 1000), TZ);
            effectiveTime = `${String(existingParts.hour).padStart(2, '0')}:${String(existingParts.minute).padStart(2, '0')}`;
          }
        }

        const parsed = parseDateTime(effectiveDate || 'N/A', effectiveTime || 'N/A');
        if (parsed.error) {
          return interaction.reply({ embeds: [errorEmbed('Invalid Date/Time', parsed.error)], flags: 64 });
        }
        newStartTime = parsed.startTimeSec;
        newTimeNA = parsed.timeNA;
      }

      const durationStr = interaction.options.getString('duration');
      let newDuration = contest.duration_sec;
      if (durationStr !== null) {
        const isDurationNA = ['n/a', 'na'].includes(durationStr.trim().toLowerCase());
        newDuration = parseDuration(durationStr);
        if (!isDurationNA && newDuration === null) {
          return interaction.reply({
            embeds: [errorEmbed('Invalid Duration', 'Use a format like `2h`, `120m`, `2h 30m`, or `N/A`.')],
            flags: 64
          });
        }
      }

      db.prepare(`
        UPDATE notified_contests
        SET name = ?, url = ?, start_time = ?, duration_sec = ?, time_na = ?,
            notified_24h = CASE WHEN start_time IS NOT ? THEN 0 ELSE notified_24h END,
            notified_1h  = CASE WHEN start_time IS NOT ? THEN 0 ELSE notified_1h END
        WHERE contest_id = ?
      `).run(newName, newLink, newStartTime, newDuration, newTimeNA, newStartTime, newStartTime, contestId);

      if (newStartTime !== contest.start_time) {
        deleteContestRemindersFromDiscord(interaction.client, contestId).catch(() => {});
      } else if (newStartTime && newDuration !== contest.duration_sec) {
        const dur = Number(newDuration) > 0 ? Number(newDuration) : 3600;
        db.prepare('UPDATE contest_reminder_messages SET expires_at = ? WHERE contest_id = ?')
          .run(Number(newStartTime) + dur, contestId);
      }

      postContestSummary(interaction.client, interaction.guildId).catch(() => {});

      return interaction.reply({
        embeds: [successEmbed('Custom Contest Updated', `Updated **[${newName}](${newLink})** successfully.`)],
        flags: 64
      });
    }

    if (subcommand === 'delete') {
      const contestId = interaction.options.getString('contest');
      const contest = db.prepare("SELECT name FROM notified_contests WHERE contest_id = ? AND platform = 'Custom'").get(contestId);

      if (!contest) {
        return interaction.reply({ embeds: [errorEmbed('Not Found', 'Custom contest not found.')], flags: 64 });
      }

      await deleteContestRemindersFromDiscord(interaction.client, contestId).catch(() => {});
      db.prepare('DELETE FROM notified_contests WHERE contest_id = ?').run(contestId);
      postContestSummary(interaction.client, interaction.guildId).catch(() => {});

      return interaction.reply({
        embeds: [successEmbed('Custom Contest Deleted', `Removed **${contest.name}** from the contest radar.`)],
        flags: 64
      });
    }

    if (subcommand === 'list') {
      const contests = db.prepare(`
        SELECT * FROM notified_contests WHERE platform = 'Custom' ORDER BY COALESCE(start_time, 9999999999) ASC
      `).all();

      if (contests.length === 0) {
        return interaction.reply({ content: '⏰ No custom contests are currently scheduled.', flags: 64 });
      }

      const lines = contests.map((c, i) => {
        const timeLabel = c.start_time ? `<t:${c.start_time}:F>` : 'Date: N/A';
        return `\`${i + 1}.\` **[${c.name}](${c.url})**\n     🕒 ${timeLabel}`;
      });

      const embed = successEmbed('Custom Contests', 'Scheduled custom contests in this radar:');
      chunkLines(lines, 1000, '\n\n').forEach((chunk, idx) => {
        embed.addFields({ name: idx === 0 ? '📋 Schedule' : '📋 Schedule (cont.)', value: chunk, inline: false });
      });

      return interaction.reply({ embeds: [embed], flags: 64 });
    }
  }
};
