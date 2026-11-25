// commands/profile.js — Show a member's CP profile card with ratings, solves, and streaks
const { SlashCommandBuilder } = require('discord.js');
const { getUser, getRatings, getAllStreaks, upsertUser } = require('../database/db');
const { buildProfileEmbed, errorEmbed, resolveTargetMeta } = require('../utils/embeds');
const { getPlatformEmojis } = require('../utils/emojis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription("View your or another member's CP profile")
    .addUserOption(opt =>
      opt.setName('member')
        .setDescription('Member to view (leave blank for yourself)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const target = interaction.options.getMember('member')
      || interaction.options.getUser('member')
      || interaction.member
      || interaction.user;

    const { id: userId, displayName } = resolveTargetMeta(target);

    if (target.id === interaction.user.id) {
      upsertUser(userId, interaction.user.username);
    }

    const user = getUser(userId);
    const ratings = getRatings(userId);
    const streaks = getAllStreaks().filter(s => s.discord_id === userId);

    if (!user) {
      return interaction.editReply({
        embeds: [errorEmbed('No Profile Found', `${displayName} hasn't linked any accounts yet.`)]
      });
    }

    const emojis = await getPlatformEmojis(interaction.guild);
    const embed = buildProfileEmbed(target, user, ratings, emojis, streaks);
    return interaction.editReply({ embeds: [embed] });
  }
};
