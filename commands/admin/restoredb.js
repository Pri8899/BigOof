const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const https = require('https');
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('restoredb')
    .setDescription('Upload your cpbot.db to restore the database.')
    .addAttachmentOption(option => 
      option.setName('database_file')
        .setDescription('Upload your cpbot.db file here')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const attachment = interaction.options.getAttachment('database_file');

    if (!attachment.name.endsWith('.db') && !attachment.name.endsWith('.sqlite')) {
      return interaction.reply({ content: '❌ Invalid file type. Please upload your `cpbot.db` file.', ephemeral: true });
    }

    await interaction.reply({ content: '📥 Downloading and restoring database... please wait.', ephemeral: true });

    // Path to the database in the root folder
    const dbPath = path.join(__dirname, '..', '..', 'cpbot.db');
    
    // Download and overwrite
    const file = fs.createWriteStream(dbPath);
    https.get(attachment.url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        interaction.editReply({ content: '✅ Database successfully restored! All your streaks and leaderboard stats are back! Please restart your bot on Railway to apply the changes.' });
      });
    }).on('error', (err) => {
      fs.unlink(dbPath, () => {}); // delete the file on error
      console.error(err);
      interaction.editReply({ content: '❌ Failed to download the database: ' + err.message });
    });
  },
};
