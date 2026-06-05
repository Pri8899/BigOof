const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getAllUsers, db, getConfig } = require('../../database/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('debug-db')
    .setDescription('[Admin] Print diagnostic database information')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    try {
      const users = getAllUsers();
      const lastSubmissions = db.prepare('SELECT * FROM last_submissions').all();
      const feedChannelId = getConfig('feed_channel_id') || process.env.FEED_CHANNEL_ID || process.env.GENERAL_CHANNEL_ID;

      let response = `📊 **Bot Diagnostic Report**\n`;
      response += `• **Feed Channel ID**: \`${feedChannelId}\`\n\n`;

      response += `👥 **Registered Users (${users.length})**:\n`;
      if (users.length === 0) {
        response += `_No users registered in the database._\n`;
      } else {
        users.forEach(u => {
          response += `- <@${u.discord_id}> | Username: \`${u.username}\` | CF: \`${u.cf_handle || 'None'}\` | AC: \`${u.ac_handle || 'None'}\`\n`;
        });
      }

      response += `\n📥 **Last Submission Baselines (${lastSubmissions.length})**:\n`;
      if (lastSubmissions.length === 0) {
        response += `_No baselines recorded._\n`;
      } else {
        lastSubmissions.forEach(ls => {
          response += `- User ID: \`${ls.discord_id}\` | Platform: \`${ls.platform}\` | Last ID: \`${ls.last_id}\`\n`;
        });
      }

      return interaction.reply({ content: response.substring(0, 2000), ephemeral: true });
    } catch (err) {
      return interaction.reply({ content: `❌ Error running diagnostics: ${err.message}`, ephemeral: true });
    }
  }
};
