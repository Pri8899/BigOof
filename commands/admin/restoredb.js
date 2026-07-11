const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const https = require('https');
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('restoredb')
    .setDescription('Admin only: Upload a cpbot.db file to restore the database.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addAttachmentOption(option =>
      option.setName('database')
        .setDescription('The cpbot.db file to upload')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const attachment = interaction.options.getAttachment('database');

    if (!attachment.name.endsWith('.db') && !attachment.name.endsWith('.sqlite')) {
      return interaction.editReply('❌ Please upload a valid .db or .sqlite file!');
    }

    const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../../cpbot.db');
    
    // Backup the current empty one just in case
    if (fs.existsSync(dbPath)) {
      fs.copyFileSync(dbPath, dbPath + '.backup');
    }

    const file = fs.createWriteStream(dbPath);
    
    https.get(attachment.url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        interaction.editReply('✅ Database successfully restored! The bot will now restart to load the new data. Please wait 10 seconds.');
        
        // Exit process to allow Railway/PM2 to auto-restart the bot and load the new DB
        setTimeout(() => {
          process.exit(0);
        }, 2000);
      });
    }).on('error', (err) => {
      fs.unlink(dbPath, () => {});
      console.error(err);
      interaction.editReply('❌ Failed to download the database file.');
    });
  },
};
