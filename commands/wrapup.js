// commands/wrapup.js — On-demand Contest Wrap-up & Upsolve Radar (reuses shared analyzer)
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getAllUsers } = require('../database/db');
const { cfGet } = require('../utils/codeforces');
const {
  analyzeContestForUsers,
  buildContestWrapupEmbed,
  getWrapupChannel
} = require('../tasks/contestWrapup');
const { getCalendarEmoji } = require('../utils/calendarEmoji');
const { getTimeZone } = require('../utils/time');

let cachedFinishedContests = [];
let lastFinishedFetch = 0;

module.exports = {
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName('wrapup')
    .setDescription('View finished Codeforces contest standings and personalized upsolve roadblock')
    .addIntegerOption(opt =>
      opt.setName('contest')
        .setDescription('Optional Codeforces contest ID (defaults to latest finished round)')
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addBooleanOption(opt =>
      opt.setName('broadcast')
        .setDescription('Broadcast this recap to the wrapup/general channel (Admin only)')
        .setRequired(false)
    ),

  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused().toString().toLowerCase();
    const now = Date.now();

    if (now - lastFinishedFetch > 60000 || cachedFinishedContests.length === 0) {
      try {
        const res = await cfGet('/contest.list?gym=false', 10000, 1);
        if (res.data?.status === 'OK') {
          cachedFinishedContests = res.data.result.filter(c => c.phase === 'FINISHED').slice(0, 25);
          lastFinishedFetch = now;
        }
      } catch (_) {}
    }

    const filtered = cachedFinishedContests
      .filter(c => String(c.id).includes(focusedValue) || c.name.toLowerCase().includes(focusedValue))
      .slice(0, 25)
      .map(c => ({
        name: `${c.id} — ${c.name.length > 80 ? `${c.name.slice(0, 77)}...` : c.name}`,
        value: c.id
      }));

    await interaction.respond(filtered).catch(() => {});
  },

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    const contestIdInput = interaction.options.getInteger('contest');
    const shouldBroadcast = interaction.options.getBoolean('broadcast') || false;
    const guild = interaction.guild;

    if (shouldBroadcast && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.editReply({
        content: '⚠️ Only server administrators can use `broadcast` to post publicly.'
      });
    }

    let targetContest = null;
    try {
      const listRes = await cfGet('/contest.list?gym=false', 15000);
      if (listRes.data?.status === 'OK') {
        const finished = listRes.data.result.filter(c => c.phase === 'FINISHED');
        targetContest = contestIdInput ? finished.find(c => c.id === contestIdInput) : finished[0];
      }
    } catch (err) {
      return interaction.editReply({ content: `❌ Failed to fetch contest list from Codeforces: ${err.message}` });
    }

    if (!targetContest) {
      return interaction.editReply({
        content: `❌ Could not find a finished contest matching ID \`${contestIdInput || 'latest'}\`.`
      });
    }

    const members = await guild.members.fetch().catch(() => guild.members.cache);
    const serverUsers = getAllUsers().filter(u => u.cf_handle && members.has(u.discord_id));

    if (serverUsers.length === 0) {
      return interaction.editReply({ content: 'ℹ️ No members in this server have linked a Codeforces account yet.' });
    }

    let memberResults = [];
    try {
      memberResults = await analyzeContestForUsers(targetContest.id, serverUsers);
    } catch (err) {
      return interaction.editReply({ content: `❌ Failed to fetch contest standings from Codeforces: ${err.message}` });
    }

    if (memberResults.length === 0) {
      return interaction.editReply({
        content: `ℹ️ None of the linked members in this server participated in **${targetContest.name}** (ID \`${targetContest.id}\`).`
      });
    }

    const calEmoji = targetContest.startTimeSeconds
      ? await getCalendarEmoji(interaction.client, targetContest.startTimeSeconds, getTimeZone())
      : null;
    const embed = buildContestWrapupEmbed(targetContest, memberResults, { calEmoji });

    if (shouldBroadcast) {
      const channel = getWrapupChannel(guild);
      if (!channel) {
        return interaction.editReply({
          content: '⚠️ Could not broadcast: no writable wrapup/general channel found. Previewing privately below:',
          embeds: [embed]
        });
      }
      await channel.send({ embeds: [embed] });
      return interaction.editReply({
        content: `✅ Contest recap for **${targetContest.name}** broadcast to ${channel}!`
      });
    }

    return interaction.editReply({ embeds: [embed] });
  }
};
