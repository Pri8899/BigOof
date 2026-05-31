// commands/profile.js — Show a member's CP profile
const { SlashCommandBuilder } = require('discord.js');
const { getUser, getRatings, upsertUser } = require('../database/db');
const { buildProfileEmbed, errorEmbed }   = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('View your or another member\'s CP profile')
    .addUserOption(opt =>
      opt.setName('member')
        .setDescription('Member to view (leave blank for yourself)')
        .setRequired(false)),

  async execute(interaction) {
    const target = interaction.options.getMember('member') ?? interaction.member;
    const userId = target.id;

    // Auto-create row if viewing own profile
    if (target.id === interaction.user.id) {
      upsertUser(userId, interaction.user.username);
    }

    const user    = getUser(userId);
    const ratings = getRatings(userId);

    if (!user) {
      return interaction.reply({
        embeds: [errorEmbed('No Profile Found', `${target.displayName} hasn't linked any accounts yet.`)],
        ephemeral: true
      });
    }

    const { getPlatformEmojis } = require('../utils/emojis');
    const emojis = await getPlatformEmojis(interaction.guild);
    const embed = buildProfileEmbed(target, user, ratings, emojis);
    return interaction.reply({ embeds: [embed] });
  }
};
