// commands/vc-start.js — Virtual Contest: start, join, end
const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType } = require('discord.js');
const { getUser, getActiveVCForChannel, createVC, joinVC, getVCParticipants, endVC, updateVCSolved } = require('../database/db');
const { getCFProblems, checkCFSolved } = require('../utils/codeforces');
const { errorEmbed, successEmbed }     = require('../utils/embeds');
const crypto = require('crypto');

// Active VC timers (in-memory, lost on restart but DB is the source of truth)
const vcTimers = new Map();

/**
 * Build the VC embed showing problems + participants
 */
function buildVCEmbed(vc, problems, participants = [], ended = false) {
  const endsAt = vc.ends_at ?? (vc.started_at + vc.duration_sec);
  const embed  = new EmbedBuilder()
    .setColor(ended ? 0x95A5A6 : 0xE74C3C)
    .setTitle(`${ended ? '🏁' : '⚔️'} Virtual Contest${ended ? ' — Results' : ''}`)
    .setDescription(
      ended
        ? '**Contest Over!** Final results:'
        : `Contest is **live**! Solve as many problems as you can before time runs out.\n\nEnds: <t:${endsAt}:R>`
    );

  problems.forEach((p, i) => {
    embed.addFields({
      name:  `Problem ${i + 1} · ⭐ ${p.rating}`,
      value: `**[${p.name}](${p.url})**\n🏷️ ${p.tags.join(', ') || 'N/A'}`,
      inline: false
    });
  });

  if (participants.length > 0 && ended) {
    const medals = ['🥇', '🥈', '🥉'];
    const sorted = [...participants].sort((a, b) => {
      if (b.solved !== a.solved) return b.solved - a.solved;
      return (a.finish_time ?? Infinity) - (b.finish_time ?? Infinity);
    });
    const lines = sorted.map((p, i) =>
      `${medals[i] ?? `${i + 1}.`} <@${p.discord_id}> — **${p.solved}** solved`
    );
    embed.addFields({ name: '🏆 Leaderboard', value: lines.join('\n') || 'No solves recorded', inline: false });
  }

  embed.setFooter({ text: `VC ID: ${vc.id} · Difficulty: ~${vc.difficulty}` }).setTimestamp();
  return embed;
}

/**
 * End a VC: grade all participants and post results
 */
async function concludeVC(client, vcId, channelId, problems) {
  const participants = getVCParticipants(vcId);

  // Grade each participant
  for (const p of participants) {
    if (p.cf_handle) {
      const count = await checkCFSolved(p.cf_handle, problems);
      updateVCSolved(vcId, p.discord_id, count);
    }
    await new Promise(r => setTimeout(r, 300)); // be gentle with CF API
  }

  endVC(vcId);

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const updatedParts = getVCParticipants(vcId);
  const embed = buildVCEmbed({ id: vcId, ends_at: 0, started_at: 0, duration_sec: 0, difficulty: problems[0]?.rating ?? '?' }, problems, updatedParts, true);
  await channel.send({ content: '🏁 **Virtual Contest Ended!**', embeds: [embed] }).catch(() => {});
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vc-start')
    .setDescription('Start a Virtual Contest with random Codeforces problems')
    .addIntegerOption(opt =>
      opt.setName('difficulty')
        .setDescription('Target problem rating (e.g. 1500)')
        .setRequired(true)
        .setMinValue(800)
        .setMaxValue(3000))
    .addIntegerOption(opt =>
      opt.setName('duration')
        .setDescription('Duration in minutes (default: 90)')
        .setRequired(false)
        .setMinValue(15)
        .setMaxValue(240))
    .addIntegerOption(opt =>
      opt.setName('problems')
        .setDescription('Number of problems (default: 4)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(6)),

  async execute(interaction) {
    await interaction.deferReply();

    const channelId    = interaction.channelId;
    const guildId      = interaction.guildId;
    const userId       = interaction.user.id;
    const targetRating = interaction.options.getInteger('difficulty');
    const durationMin  = interaction.options.getInteger('duration') ?? 90;
    const problemCount = interaction.options.getInteger('problems') ?? 4;
    const durationSec  = durationMin * 60;

    // Check if a VC is already running
    const existing = getActiveVCForChannel(channelId);
    if (existing) {
      return interaction.editReply({
        embeds: [errorEmbed('Contest Already Running', `A virtual contest is already active in this channel! It ends <t:${existing.ends_at}:R>.`)]
      });
    }

    // Pick problems
    const minR = Math.max(800, targetRating - 100);
    const maxR = Math.min(3000, targetRating + 100);
    const problems = await getCFProblems(minR, maxR, null, problemCount);

    if (problems.length < 1) {
      return interaction.editReply({
        embeds: [errorEmbed('No Problems Found', 'Could not fetch CF problems. Try again.')]
      });
    }

    // Create VC in DB
    const vcId = crypto.randomBytes(4).toString('hex').toUpperCase();
    createVC(vcId, channelId, guildId, userId, String(targetRating), durationSec, problems);

    // Auto-join the creator if they have CF linked
    const user = getUser(userId);
    if (user?.cf_handle) joinVC(vcId, userId, user.cf_handle);

    // Build join button
    const joinBtn = new ButtonBuilder()
      .setCustomId(`vc_join_${vcId}`)
      .setLabel('✅ Join Contest')
      .setStyle(ButtonStyle.Success);
    const row = new ActionRowBuilder().addComponents(joinBtn);

    const embed = buildVCEmbed(
      { id: vcId, ends_at: Math.floor(Date.now() / 1000) + durationSec, started_at: Math.floor(Date.now() / 1000), duration_sec: durationSec, difficulty: targetRating },
      problems
    );

    await interaction.editReply({ embeds: [embed], components: [row] });

    // Collect join button clicks for the full duration
    const msg = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: durationSec * 1000
    });

    collector.on('collect', async btnInteraction => {
      if (!btnInteraction.customId.startsWith('vc_join_')) return;
      const clicker = getUser(btnInteraction.user.id);
      
      // 1. Verify Codeforces linkage
      if (!clicker || !clicker.cf_handle) {
        return btnInteraction.reply({
          content: `⚠️ You must link your Codeforces account first using \`/link\` before joining the virtual contest!`,
          ephemeral: true
        });
      }

      // 2. Check if already joined
      const participants = getVCParticipants(vcId);
      const alreadyJoined = participants.some(p => p.discord_id === btnInteraction.user.id);
      if (alreadyJoined) {
        return btnInteraction.reply({
          content: `⚠️ You've already joined this contest!`,
          ephemeral: true
        });
      }

      joinVC(vcId, btnInteraction.user.id, clicker.cf_handle);
      await btnInteraction.reply({
        content: `✅ You've joined the contest! Solve the problems on Codeforces and your score will be recorded automatically when time ends.`,
        ephemeral: true
      });
    });

    // Schedule VC end
    const timer = setTimeout(async () => {
      collector.stop();
      await concludeVC(interaction.client, vcId, channelId, problems);
      vcTimers.delete(vcId);
    }, durationSec * 1000);

    vcTimers.set(vcId, timer);
  },

  concludeVC,
  vcTimers
};
