const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Request help in the debug help lobby')
  .addStringOption(opt =>
    opt.setName('reason')
      .setDescription('Reason or description of the problem')
      .setRequired(true)
  );

for (let i = 1; i <= 10; i++) {
  data.addAttachmentOption(opt => 
    opt.setName(`image${i}`)
      .setDescription(`Attach image ${i}`)
      .setRequired(false)
  );
}

module.exports = {
  data,
  async execute(interaction) {
    const channelName = interaction.channel?.name?.toLowerCase() || '';
    
    // Check if the command is run in a channel containing "debug" or "help"
    if (!channelName.includes('debug') && !channelName.includes('help')) {
      return interaction.reply({ 
        content: 'This command can only be used in the **debug help lobby**.', 
        ephemeral: true 
      });
    }

    const reason = interaction.options.getString('reason');
    const user = interaction.user;

    const attachments = [];
    for (let i = 1; i <= 10; i++) {
      const attachment = interaction.options.getAttachment(`image${i}`);
      if (attachment) {
        attachments.push(attachment.url);
      }
    }

    const embed = new EmbedBuilder()
      .setColor('#ff9900')
      .setTitle('🚨 Help Required!')
      .setDescription(`**${user.username}** is facing an issue and needs some assistance.`)
      .addFields({ name: 'Problem Reason', value: reason })
      .setThumbnail(user.displayAvatarURL({ dynamic: true }))
      .setFooter({ text: 'Debug Help Lobby' })
      .setTimestamp();

    await interaction.reply({ 
      content: `@everyone, ${user} needs your help!`, 
      embeds: [embed],
      files: attachments
    });
  }
};
