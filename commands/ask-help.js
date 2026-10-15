// commands/ask-help.js — Request assistance on an algorithmic problem or bug
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const data = new SlashCommandBuilder()
  .setName('ask-help')
  .setDescription('Ask community members for assistance on a problem or code bug')
  .addStringOption(opt =>
    opt.setName('problem')
      .setDescription('Description of the issue or what you are trying to solve')
      .setRequired(true)
  );

for (let i = 1; i <= 5; i++) {
  data.addAttachmentOption(opt =>
    opt.setName(`image${i}`)
      .setDescription(`Attach image ${i} (screenshot/code snippet)`)
      .setRequired(false)
  );
}

module.exports = {
  data,
  async execute(interaction) {
    const problem = interaction.options.getString('problem');
    const user = interaction.user;

    const attachments = [];
    for (let i = 1; i <= 5; i++) {
      const attachment = interaction.options.getAttachment(`image${i}`);
      if (attachment) {
        attachments.push(attachment.url);
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0xFF9800)
      .setAuthor({
        name: 'Community Problem Solving Support',
        iconURL: user.displayAvatarURL({ dynamic: true })
      })
      .setDescription([
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `> 👤 **Author:** <@${user.id}>`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        ``,
        `**Problem & Context:**`,
        `> ${problem.replace(/\n/g, '\n> ')}`,
        ``,
        `💡 *Got an idea, edge case, or complexity hint? Jump in to discuss!*`
      ].join('\n'))
      .setThumbnail(user.displayAvatarURL({ dynamic: true }))
      .setFooter({ text: 'BigOof Peer Support · /ask-help', iconURL: 'https://cdn-icons-png.flaticon.com/512/3112/3112946.png' })
      .setTimestamp();

    await interaction.reply({
      content: `🔔 Community notification: ${user} asked for help!`,
      embeds: [embed],
      files: attachments
    });
  }
};
