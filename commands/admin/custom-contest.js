// commands/admin/custom-contest.js — Add, edit, or delete custom contests
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { db } = require('../../database/db');
const { postContestSummary } = require('../../tasks/contestFetcher');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

const TZ = process.env.TIMEZONE || 'UTC';

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
    totalSec = parseInt(s, 10) * 60; // default minutes
  }

  return totalSec > 0 ? totalSec : null;
}

function parseDateTime(dateStr, timeStr) {
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

  let hours = 0, minutes = 0;
  let timeNA = isTimeNA ? 1 : 0;

  if (!isTimeNA) {
    const timeMatch = timeStr.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!timeMatch) {
      return { error: 'Invalid time format. Use HH:MM in 24h format.' };
    }
    hours = parseInt(timeMatch[1], 10);
    minutes = parseInt(timeMatch[2], 10);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      return { error: 'Invalid time values. Hours must be 0-23, minutes 0-59.' };
    }
  }

  try {
    const approx = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0));
    const getLocalHour = (d) => {
      const f = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: 'numeric', hour12: false });
      const pList = f.formatToParts(d);
      const h = parseInt(pList.find(p => p.type === 'hour').value, 10);
      const m = parseInt(pList.find(p => p.type === 'minute').value, 10);
      return h * 60 + m;
    };
    const diffMinutes = (hours * 60 + minutes) - getLocalHour(approx);
    const startTimeSec = Math.floor((approx.getTime() + diffMinutes * 60 * 1000) / 1000);
    return { startTimeSec, timeNA };
  } catch (err) {
    return { error: `Failed to parse date/time: ${err.message}` };
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('custom-contest')
    .setDescription('Manage manually added custom contests (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Add a new custom contest to the radar')
        .addStringOption(opt => opt.setName('name').setDescription('Contest name').setRequired(true))
        .addStringOption(opt => opt.setName('link').setDescription('Contest URL').setRequired(true))
        .addStringOption(opt => opt.setName('date').setDescription('Date (DD-MM-YYYY, YYYY-MM-DD or N/A)').setRequired(true))
        .addStringOption(opt => opt.setName('time').setDescription('Start time (HH:MM in 24h or N/A)').setRequired(true))
        .addStringOption(opt => opt.setName('duration').setDescription('Duration (e.g. 2h, 120m, 2h 30m or N/A)').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('edit')
        .setDescription('Edit an existing custom contest')
        .addStringOption(opt => opt.setName('contest').setDescription('Select custom contest to edit').setRequired(true).setAutocomplete(true))
        .addStringOption(opt => opt.setName('new_name').setDescription('New name for contest').setRequired(false))
        .addStringOption(opt => opt.setName('link').setDescription('New URL link').setRequired(false))
        .addStringOption(opt => opt.setName('date').setDescription('New date (DD-MM-YYYY, YYYY-MM-DD or N/A)').setRequired(false))
        .addStringOption(opt => opt.setName('time').setDescription('New time (HH:MM 24h or N/A)').setRequired(false))
        .addStringOption(opt => opt.setName('duration').setDescription('New duration (e.g. 2h, 120m or N/A)').setRequired(false))
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
    const focusedValue = interaction.options.getFocused().toLowerCase();
    const contests = db.prepare(`
      SELECT contest_id, name, start_time, time_na FROM notified_contests
      WHERE platform = 'Custom'
    `).all();

    const choices = contests.map(c => {
      let dateLabel = 'Date: N/A';
      if (c.start_time) {
        const d = new Date(c.start_time * 1000);
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
        });
        dateLabel = formatter.format(d);
        if (c.time_na === 1) {
          dateLabel += ' (Time: N/A)';
        } else {
          const timeFormatter = new Intl.DateTimeFormat('en-US', {
            timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false
          });
          dateLabel += ` @ ${timeFormatter.format(d)}`;
        }
      }
      return {
        name: `${c.name} (${dateLabel})`.slice(0, 100),
        value: c.contest_id
      };
    });

    const filtered = choices.filter(c => c.name.toLowerCase().includes(focusedValue)).slice(0, 25);
    await interaction.respond(filtered);
  },

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    // ─── ADD ─────────────────────────────────────────────────────────
    if (subcommand === 'add') {
      const name = interaction.options.getString('name');
      let link = interaction.options.getString('link').trim();
      const dateStr = interaction.options.getString('date');
      const timeStr = interaction.options.getString('time');
      const durationStr = interaction.options.getString('duration');

      if (!link.startsWith('http://') && !link.startsWith('https://')) {
        link = 'https://' + link;
      }

      const parsed = parseDateTime(dateStr, timeStr);
      if (parsed.error) {
        return interaction.reply({ embeds: [errorEmbed('Invalid Date/Time', parsed.error)], ephemeral: true });
      }

      const durationSec = parseDuration(durationStr);
      const contestId = `custom_${Date.now()}`;

      db.prepare(`
        INSERT INTO notified_contests (contest_id, platform, name, start_time, duration_sec, url, time_na)
        VALUES (?, 'Custom', ?, ?, ?, ?, ?)
      `).run(contestId, name, parsed.startTimeSec, durationSec, link, parsed.timeNA);

      postContestSummary(interaction.client).catch(() => {});

      return interaction.reply({
        embeds: [successEmbed('Custom Contest Added', `**[${name}](${link})** has been added to the contest radar.`)],
        ephemeral: true
      });
    }

    // ─── EDIT ────────────────────────────────────────────────────────
    if (subcommand === 'edit') {
      const contestId = interaction.options.getString('contest');
      const contest = db.prepare('SELECT * FROM notified_contests WHERE contest_id = ? AND platform = "Custom"').get(contestId);

      if (!contest) {
        return interaction.reply({ embeds: [errorEmbed('Not Found', 'Custom contest not found.')], ephemeral: true });
      }

      const newName = interaction.options.getString('new_name') || contest.name;
      let newLink = interaction.options.getString('link') || contest.url;
      if (newLink && !newLink.startsWith('http://') && !newLink.startsWith('https://')) {
        newLink = 'https://' + newLink;
      }

      let newStartTime = contest.start_time;
      let newTimeNA = contest.time_na;

      const dateStr = interaction.options.getString('date');
      const timeStr = interaction.options.getString('time');
      if (dateStr !== null || timeStr !== null) {
        const parsed = parseDateTime(dateStr || 'N/A', timeStr || 'N/A');
        if (parsed.error) {
          return interaction.reply({ embeds: [errorEmbed('Invalid Date/Time', parsed.error)], ephemeral: true });
        }
        newStartTime = parsed.startTimeSec;
        newTimeNA = parsed.timeNA;
      }

      const durationStr = interaction.options.getString('duration');
      const newDuration = durationStr !== null ? parseDuration(durationStr) : contest.duration_sec;

      db.prepare(`
        UPDATE notified_contests
        SET name = ?, url = ?, start_time = ?, duration_sec = ?, time_na = ?
        WHERE contest_id = ?
      `).run(newName, newLink, newStartTime, newDuration, newTimeNA, contestId);

      postContestSummary(interaction.client).catch(() => {});

      return interaction.reply({
        embeds: [successEmbed('Custom Contest Updated', `Updated **[${newName}](${newLink})** successfully.`)],
        ephemeral: true
      });
    }

    // ─── DELETE ──────────────────────────────────────────────────────
    if (subcommand === 'delete') {
      const contestId = interaction.options.getString('contest');
      const contest = db.prepare('SELECT name FROM notified_contests WHERE contest_id = ? AND platform = "Custom"').get(contestId);

      if (!contest) {
        return interaction.reply({ embeds: [errorEmbed('Not Found', 'Custom contest not found.')], ephemeral: true });
      }

      db.prepare('DELETE FROM notified_contests WHERE contest_id = ?').run(contestId);
      postContestSummary(interaction.client).catch(() => {});

      return interaction.reply({
        embeds: [successEmbed('Custom Contest Deleted', `Removed **${contest.name}** from the contest radar.`)],
        ephemeral: true
      });
    }

    // ─── LIST ────────────────────────────────────────────────────────
    if (subcommand === 'list') {
      const contests = db.prepare(`
        SELECT * FROM notified_contests WHERE platform = 'Custom' ORDER BY COALESCE(start_time, 9999999999) ASC
      `).all();

      if (contests.length === 0) {
        return interaction.reply({ content: '📅 No custom contests are currently scheduled.', ephemeral: true });
      }

      const lines = contests.map((c, i) => {
        const timeLabel = c.start_time ? `<t:${c.start_time}:F>` : 'Date: N/A';
        return `\`${i + 1}.\` **[${c.name}](${c.url})**\n     🗓️ ${timeLabel}`;
      });

      return interaction.reply({
        embeds: [successEmbed('Custom Contests', lines.join('\n\n'))],
        ephemeral: true
      });
    }
  }
};
