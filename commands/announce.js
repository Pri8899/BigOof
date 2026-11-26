// commands/announce.js — Announcement & Useful Links publisher (Members: configured Announcements/Useful Links; Admins: any channel)
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ComponentType,
  EmbedBuilder
} = require('discord.js');
const { getConfig } = require('../database/db');
const { getValidId, isBotOwner } = require('../utils/envHelper');
const { successEmbed, errorEmbed } = require('../utils/embeds');

function isAnnounceAdmin(interaction) {
  return Boolean(
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
    isBotOwner(interaction)
  );
}

function isPostableTextChannel(ch) {
  return Boolean(ch && (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement || (ch.isTextBased?.() && !ch.isVoiceBased?.())));
}

async function fetchConfiguredChannel(guild, configKey, envVarName) {
  if (!guild) return null;
  const id = getConfig(configKey, guild.id)
    || getConfig(configKey, 'global')
    || getValidId(process.env[envVarName], null);
  if (!id) return null;

  const ch = guild.channels.cache.get(id) || await guild.channels.fetch(id).catch(() => null);
  if (!isPostableTextChannel(ch) || (ch.guildId && ch.guildId !== guild.id)) return null;
  return ch;
}

/**
 * Returns the configured Announcements and Useful Links channels accessible to `member`.
 */
async function getMemberAllowedChannels(guild, member = null) {
  const [annCh, linksCh] = await Promise.all([
    fetchConfiguredChannel(guild, 'announcement_channel_id', 'ANNOUNCEMENT_CHANNEL_ID'),
    fetchConfiguredChannel(guild, 'useful_links_channel_id', 'USEFUL_LINKS_CHANNEL_ID')
  ]);

  const entries = [];
  const seen = new Set();

  const tryPush = (ch, roleKey, prefixEmoji, roleLabel) => {
    if (!ch || seen.has(ch.id)) return;
    if (member && ch.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel) === false) return;
    seen.add(ch.id);
    entries.push({ channel: ch, roleKey, prefixEmoji, roleLabel });
  };

  tryPush(annCh, 'announcement', '📢', 'Announcements');
  tryPush(linksCh, 'useful_links', '🔗', 'Useful Links');
  return entries;
}

function resolveAnyGuildChannel(guild, rawInput) {
  if (!guild || !rawInput) return null;
  const trimmed = rawInput.trim();
  const idMatch = trimmed.match(/^<#(\d+)>$/) || trimmed.match(/^(\d{15,25})$/);
  if (idMatch) {
    const ch = guild.channels.cache.get(idMatch[1]);
    return isPostableTextChannel(ch) ? ch : null;
  }

  const normalized = trimmed.replace(/^#/, '').toLowerCase();
  const candidates = [...guild.channels.cache.values()].filter(ch => isPostableTextChannel(ch));
  return candidates.find(ch => ch.name.toLowerCase() === normalized)
    || candidates.find(ch => ch.name.toLowerCase().includes(normalized))
    || null;
}

async function openAnnounceModalAndPost(triggerInteraction, targetChannel, { isAdmin, usefulLinksChannelId }) {
  const guild = triggerInteraction.guild;
  const me = guild.members.me;
  const perms = me && targetChannel?.permissionsFor(me);

  if (!perms || !perms.has(PermissionFlagsBits.ViewChannel) || !perms.has(PermissionFlagsBits.SendMessages) || !perms.has(PermissionFlagsBits.EmbedLinks)) {
    const errPayload = {
      embeds: [errorEmbed(
        'Missing Channel Permissions',
        `I need **View Channel**, **Send Messages**, and **Embed Links** permissions in ${targetChannel || 'that channel'}.`
      )],
      flags: 64
    };
    if (triggerInteraction.replied || triggerInteraction.deferred) {
      return triggerInteraction.editReply({ content: null, components: [], ...errPayload });
    }
    return triggerInteraction.reply(errPayload);
  }

  const isUsefulLinks = Boolean(usefulLinksChannelId && targetChannel.id === usefulLinksChannelId);
  const modalId = `announcementModal_${triggerInteraction.id}`;
  const modal = new ModalBuilder()
    .setCustomId(modalId)
    .setTitle(isUsefulLinks ? 'Post Useful Link / Resource' : 'Post Announcement');

  const titleInput = new TextInputBuilder()
    .setCustomId('announcementTitle')
    .setLabel('Card Title (Optional)')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(150)
    .setPlaceholder(isUsefulLinks ? 'e.g. Semester 2.2 Archive (#Quanta-52_2.2_.zip)' : 'e.g. Community Announcement')
    .setRequired(false);

  const messageInput = new TextInputBuilder()
    .setCustomId('announcementMessage')
    .setLabel('Content / Description')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(3900)
    .setPlaceholder('Type your message or resource details here... (Markdown & links supported)')
    .setRequired(true);

  const btnLabelInput = new TextInputBuilder()
    .setCustomId('buttonLabel')
    .setLabel('Clickable Button Label (Optional)')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(80)
    .setPlaceholder('e.g. 📦 Download Archive ↗️')
    .setRequired(false);

  const btnUrlInput = new TextInputBuilder()
    .setCustomId('buttonUrl')
    .setLabel('Hidden Link URL for Button (Optional)')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(500)
    .setPlaceholder('https://drive.google.com/...')
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(titleInput),
    new ActionRowBuilder().addComponents(messageInput),
    new ActionRowBuilder().addComponents(btnLabelInput),
    new ActionRowBuilder().addComponents(btnUrlInput)
  );

  await triggerInteraction.showModal(modal);

  const submitted = await triggerInteraction.awaitModalSubmit({
    time: 300000,
    filter: i => i.user.id === triggerInteraction.user.id && i.customId === modalId
  }).catch(() => null);

  if (!submitted) return;
  await submitted.deferReply({ flags: 64 });

  const customTitle = submitted.fields.getTextInputValue('announcementTitle').trim();
  const messageContent = submitted.fields.getTextInputValue('announcementMessage').trim();
  let buttonLabel = submitted.fields.getTextInputValue('buttonLabel').trim();
  const rawButtonUrl = submitted.fields.getTextInputValue('buttonUrl').trim();

  if (buttonLabel && !rawButtonUrl) {
    return submitted.editReply({
      embeds: [errorEmbed('Missing URL', 'You entered a **Button Label**, so please also provide its **Hidden Link URL** (`https://...`).')]
    });
  }

  let validatedUrl = null;
  if (rawButtonUrl) {
    try {
      const parsed = new URL(rawButtonUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Protocol must be http or https');
      }
      validatedUrl = parsed.toString();
    } catch {
      return submitted.editReply({
        embeds: [errorEmbed('Invalid URL', 'The optional button URL must start with `https://` or `http://`.')]
      });
    }
    if (!buttonLabel) buttonLabel = 'Open Link ↗️';
  }

  try {
    const embedTitle = customTitle
      ? `${isUsefulLinks ? '🔗' : '📢'} ${customTitle}`.slice(0, 256)
      : (isUsefulLinks ? '🔗 Useful Resource' : '📢 Community Announcement');

    const announcementEmbed = new EmbedBuilder()
      .setColor(isUsefulLinks ? 0x00BCD4 : 0x5865F2)
      .setAuthor({
        name: `${guild.name} · ${isUsefulLinks ? 'Useful Links' : (isAdmin ? 'Official Announcement' : 'Community Announcement')}`,
        iconURL: guild.iconURL({ dynamic: true }) || triggerInteraction.client.user.displayAvatarURL()
      })
      .setTitle(embedTitle)
      .setDescription(
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `${messageContent}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
      )
      .setFooter({
        text: `Posted by ${triggerInteraction.user.tag}`,
        iconURL: triggerInteraction.user.displayAvatarURL({ dynamic: true })
      })
      .setTimestamp();

    const components = [];
    if (validatedUrl) {
      components.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel(buttonLabel.slice(0, 80))
            .setStyle(ButtonStyle.Link)
            .setURL(validatedUrl)
        )
      );
    }

    const canPingEveryone = isAdmin && perms.has(PermissionFlagsBits.MentionEveryone);
    const sendPayload = {
      content: canPingEveryone ? '@everyone' : undefined,
      embeds: [announcementEmbed],
      components
    };
    if (!isAdmin) {
      sendPayload.allowedMentions = { parse: [] };
    }

    await targetChannel.send(sendPayload);

    return submitted.editReply({
      embeds: [successEmbed(
        isUsefulLinks ? 'Resource Posted!' : 'Announcement Sent!',
        `Posted cleanly to ${targetChannel}` +
        (validatedUrl ? ` with clickable button **${buttonLabel}**` : '') +
        (isAdmin ? (canPingEveryone ? ' (`@everyone` pinged).' : ' (without `@everyone` — bot lacks Mention Everyone permission).') : '.')
      )]
    });
  } catch (err) {
    console.error('[announce] Failed to send message:', err.message);
    return submitted.editReply({
      embeds: [errorEmbed(
        'Failed to Send',
        `Could not post to ${targetChannel}: ${err.message}`
      )]
    });
  }
}

module.exports = {
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Post an announcement or link card (Admins: any channel; Members: 2 set channels)')
    .addStringOption(opt =>
      opt.setName('channel')
        .setDescription('Target channel (Admins: any; Members: Announcements & Useful Links only)')
        .setRequired(false)
        .setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const guild = interaction.guild;
    if (!guild) return interaction.respond([]).catch(() => {});

    const focused = interaction.options.getFocused().toLowerCase().trim();
    const isAdmin = isAnnounceAdmin(interaction);

    if (!isAdmin) {
      const allowed = await getMemberAllowedChannels(guild, interaction.member);
      const choices = allowed
        .filter(e =>
          !focused ||
          e.roleLabel.toLowerCase().includes(focused) ||
          e.channel.name.toLowerCase().includes(focused)
        )
        .map(e => ({
          name: `${e.prefixEmoji} ${e.roleLabel} (#${e.channel.name})`.slice(0, 100),
          value: e.channel.id
        }));
      return interaction.respond(choices).catch(() => {});
    }

    // Admins see configured presets first + every text/announcement channel in the guild
    await guild.channels.fetch().catch(() => {});
    const allowed = await getMemberAllowedChannels(guild, null);
    const seenIds = new Set();
    const allOptions = [];

    for (const e of allowed) {
      seenIds.add(e.channel.id);
      allOptions.push({
        name: `${e.prefixEmoji} ${e.roleLabel} (#${e.channel.name})`.slice(0, 100),
        value: e.channel.id
      });
    }

    const otherChannels = [...guild.channels.cache.values()]
      .filter(ch => isPostableTextChannel(ch) && !seenIds.has(ch.id))
      .sort((a, b) => a.position - b.position);

    for (const ch of otherChannels) {
      allOptions.push({
        name: `#${ch.name}`.slice(0, 100),
        value: ch.id
      });
    }

    const filtered = (focused
      ? allOptions.filter(o => o.name.toLowerCase().includes(focused))
      : allOptions
    ).slice(0, 25);

    return interaction.respond(filtered).catch(() => {});
  },

  async execute(interaction) {
    const guild = interaction.guild;
    const isAdmin = isAnnounceAdmin(interaction);
    const rawChannelOpt = interaction.options.getString('channel')?.trim() || null;

    const usefulLinksCh = await fetchConfiguredChannel(guild, 'useful_links_channel_id', 'USEFUL_LINKS_CHANNEL_ID');
    const usefulLinksChannelId = usefulLinksCh?.id || null;

    if (!isAdmin) {
      const allowed = await getMemberAllowedChannels(guild, interaction.member);
      if (allowed.length === 0) {
        return interaction.reply({
          embeds: [errorEmbed(
            'No Channels Configured',
            'An admin must first configure **📢 Announcements** and/or **🔗 Useful Links** using `/set-channel` before members can use `/announce`.'
          )],
          flags: 64
        });
      }

      if (rawChannelOpt) {
        const normalized = rawChannelOpt.replace(/^#/, '').toLowerCase();
        const match = allowed.find(e =>
          e.channel.id === rawChannelOpt ||
          `<#${e.channel.id}>` === rawChannelOpt ||
          e.channel.name.toLowerCase() === normalized ||
          e.roleLabel.toLowerCase() === normalized
        );

        if (!match) {
          return interaction.reply({
            embeds: [errorEmbed(
              'Channel Restricted',
              'Members can only use `/announce` in the configured **📢 Announcements** or **🔗 Useful Links** channel(s):\n' +
              allowed.map(e => `• ${e.prefixEmoji} ${e.channel}`).join('\n')
            )],
            flags: 64
          });
        }

        return openAnnounceModalAndPost(interaction, match.channel, { isAdmin: false, usefulLinksChannelId });
      }

      if (allowed.length === 1) {
        return openAnnounceModalAndPost(interaction, allowed[0].channel, { isAdmin: false, usefulLinksChannelId });
      }

      // If both channels exist and member didn't specify one, show ONLY the 2 allowed channels cleanly
      const select = new StringSelectMenuBuilder()
        .setCustomId(`announce_pick_${interaction.id}`)
        .setPlaceholder('Choose where to post (Announcements or Useful Links)...')
        .addOptions(
          allowed.map(e => ({
            label: `${e.prefixEmoji} ${e.roleLabel}`,
            description: `Post inside #${e.channel.name}`.slice(0, 100),
            value: e.channel.id
          }))
        );

      const promptReply = await interaction.reply({
        content: 'Choose which channel to post to (**Members** can post only in these 2 channels):',
        components: [new ActionRowBuilder().addComponents(select)],
        flags: 64,
        withResponse: true
      });
      const promptMsg = promptReply.resource?.message || await interaction.fetchReply();

      const picked = await promptMsg.awaitMessageComponent({
        componentType: ComponentType.StringSelect,
        time: 60000,
        filter: i => i.user.id === interaction.user.id
      }).catch(() => null);

      if (!picked) {
        return interaction.editReply({ content: '⏳ Timed out — run `/announce` again anytime.', components: [] }).catch(() => {});
      }

      const selectedEntry = allowed.find(e => e.channel.id === picked.values[0]);
      if (!selectedEntry) {
        return picked.update({ content: '❌ Selected channel is no longer available.', components: [] }).catch(() => {});
      }

      return openAnnounceModalAndPost(picked, selectedEntry.channel, { isAdmin: false, usefulLinksChannelId });
    }

    // ── Admin Path: Can announce in ANY channel in the server ──
    let targetChannel = null;
    if (rawChannelOpt) {
      targetChannel = resolveAnyGuildChannel(guild, rawChannelOpt);
      if (!targetChannel) {
        return interaction.reply({
          embeds: [errorEmbed('Channel Not Found', `Could not find a text/announcement channel matching \`${rawChannelOpt}\`.`)],
          flags: 64
        });
      }
    } else {
      targetChannel = await fetchConfiguredChannel(guild, 'announcement_channel_id', 'ANNOUNCEMENT_CHANNEL_ID')
        || interaction.channel;
    }

    return openAnnounceModalAndPost(interaction, targetChannel, { isAdmin: true, usefulLinksChannelId });
  }
};
