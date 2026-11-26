// tasks/studyTodo.js — Continuous Study To-Do board with unlimited tasks, per-user ticks, & instant reset at 100%
const crypto = require('crypto');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits
} = require('discord.js');
const {
  createStudyForm,
  getStudyForm,
  getActiveStudyForms,
  updateStudyFormMessage,
  completeAndClearStudyForm,
  addStudyItem,
  getStudyItem,
  getStudyItems,
  updateStudyItem,
  deleteStudyItem,
  addStudyTicks,
  getStudyTicksForForm
} = require('../database/db');
const { getTargetChannel, chunkLines } = require('../utils/envHelper');
const { errorEmbed } = require('../utils/embeds');
const { getTimeZone, getLocalParts } = require('../utils/time');

const formLocks = new Map();
const guildCreateLocks = new Map();

async function withKeyLock(map, key, fn) {
  const prev = map.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  map.set(key, next);
  try {
    return await next;
  } finally {
    if (map.get(key) === next) map.delete(key);
  }
}

async function getStudyChannelForGuild(client, guildId) {
  return getTargetChannel(client, 'study_channel_id', 'STUDY_CHANNEL_ID', guildId, null, { strictKey: true });
}

async function getChannelStudyMembers(guild, channel) {
  if (!guild || !channel) return [];
  const members = await guild.members.fetch().catch(() => guild.members.cache);
  return [...members.values()]
    .filter(m => !m.user?.bot && channel.permissionsFor(m)?.has(PermissionFlagsBits.ViewChannel))
    .sort((a, b) => (a.displayName || a.user.username).localeCompare(b.displayName || b.user.username));
}

function buildTickMap(ticks) {
  const map = new Map();
  for (const t of ticks) {
    if (!map.has(t.item_id)) map.set(t.item_id, new Set());
    map.get(t.item_id).add(t.discord_id);
  }
  return map;
}

function isStudyFormFullyCompleted(items, ticks, trackedMembers) {
  if (!items || items.length === 0) return false;
  if (!trackedMembers || trackedMembers.length === 0) return false;
  const tickMap = buildTickMap(ticks);
  return items.every(item => {
    const doneSet = tickMap.get(item.id);
    if (!doneSet) return false;
    return trackedMembers.every(m => doneSet.has(m.id));
  });
}

function formatStudyDateLabel(dateStr) {
  const parts = String(dateStr || '').split('/');
  if (parts.length !== 3) return dateStr;
  const [mm, dd, yyyy] = parts.map(Number);
  const utc = new Date(Date.UTC(yyyy, mm - 1, dd, 12, 0, 0));
  return utc.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC'
  });
}

function formatItemBlock(item, idx, tickMap, trackedMembers) {
  const doneSet = tickMap.get(item.id) || new Set();
  const safeSubject = item.subject.replace(/\r?\n/g, ' ').trim();
  const safeDetails = item.details.replace(/\r?\n/g, '\n>    ').trim();
  const authorNote = item.updated_by
    ? ` *(edited by <@${item.updated_by}>)*`
    : ` *(by <@${item.added_by}>)*`;

  let statusLine;
  if (trackedMembers.length > 0 && trackedMembers.length <= 12) {
    const badges = trackedMembers.map(m => `${doneSet.has(m.id) ? '✅' : '⬜'} <@${m.id}>`).join(' · ');
    statusLine = `> 📌 ${badges}`;
  } else if (trackedMembers.length > 12) {
    const doneCount = trackedMembers.filter(m => doneSet.has(m.id)).length;
    statusLine = `> 📌 **${doneCount}/${trackedMembers.length}** completed`;
  } else {
    statusLine = `> 📌 **${doneSet.size}** completed`;
  }

  return [
    `**\`#${idx + 1}\` 📚 ${safeSubject}**${authorNote}`,
    `> 🎯 **Study Goal:** ${safeDetails}`,
    statusLine
  ].join('\n');
}

function buildStudyFormEmbed(form, items, ticks, trackedMembers) {
  const tickMap = buildTickMap(ticks);
  const dateLabel = formatStudyDateLabel(form.date_str);

  const embed = new EmbedBuilder()
    .setColor(0x00E676)
    .setAuthor({
      name: 'BigOof · Active Study To-Do Board',
      iconURL: 'https://cdn-icons-png.flaticon.com/512/2232/2232688.png'
    })
    .setTitle(`✅ Study Checklist · Started ${dateLabel}`.slice(0, 256))
    .setDescription([
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '> ➕ Add **Subject + How Much to Study** *(unlimited tasks)*',
      '> ✅ Tick off what **you** finish *(locked once completed for you)*',
      '> ✏️ Anyone can edit items · Clears at **100%** & posts a **new form instantly**!',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    ].join('\n'))
    .setTimestamp();

  let overflowed = false;

  if (items.length === 0) {
    embed.addFields({
      name: '📝 Study Plan (0 items)',
      value: '_No study goals added yet. Click **➕ Add Study** below to add a subject & how much to study!_',
      inline: false
    });
  } else {
    const blocks = items.map((item, idx) => formatItemBlock(item, idx, tickMap, trackedMembers));
    const allChunks = chunkLines(blocks, 1000, '\n\n');

    // Reserve ~1400 chars for title/description/member-summary/footer inside Discord's 6000-char embed limit
    const MAX_ITEM_CHARS = 4200;
    const MAX_ITEM_FIELDS = 20;
    let usedChars = 0;
    let includedChunks = 0;

    for (let i = 0; i < allChunks.length && i < MAX_ITEM_FIELDS; i++) {
      if (usedChars + allChunks[i].length > MAX_ITEM_CHARS && i > 0) break;
      embed.addFields({
        name: i === 0 ? `📚 Study Tasks (${items.length})` : '📚 Study Tasks (cont.)',
        value: allChunks[i],
        inline: false
      });
      usedChars += allChunks[i].length;
      includedChunks++;
    }

    if (includedChunks < allChunks.length) {
      overflowed = true;
    }

    if (trackedMembers.length > 0) {
      const progressLines = trackedMembers.map(m => {
        let done = 0;
        for (const it of items) {
          if (tickMap.get(it.id)?.has(m.id)) done++;
        }
        const badge = done === items.length ? '🎉 Done' : `⏳ ${done}/${items.length}`;
        return `<@${m.id}>: \`${badge}\``;
      });
      const progressChunks = chunkLines(progressLines, 1000, ' · ');
      embed.addFields({
        name: `👥 Server Progress (${trackedMembers.length} member${trackedMembers.length === 1 ? '' : 's'})`,
        value: progressChunks[0] + (progressChunks.length > 1 ? ' …' : ''),
        inline: false
      });
    }
  }

  embed.setFooter({
    text: overflowed
      ? `Form ID: ${form.id} · Large list truncated — click 📋 View All (${items.length}) to see all`
      : `Form ID: ${form.id} · Stays active until everyone hits 100%, then instantly resets`
  });

  return { embed, overflowed };
}

function buildStudyFormComponents(formId, items, overflowed = false) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`study-add_${formId}`)
      .setLabel('➕ Add Study')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`study-tick_${formId}`)
      .setLabel('✅ Tick Done')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(items.length === 0),
    new ButtonBuilder()
      .setCustomId(`study-edit_${formId}`)
      .setLabel('✏️ Edit Study')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(items.length === 0),
    new ButtonBuilder()
      .setCustomId(`study-remove_${formId}`)
      .setLabel('🗑️ Remove')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(items.length === 0)
  );

  if (overflowed) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`study-view_${formId}`)
        .setLabel(`📋 View All (${items.length})`.slice(0, 80))
        .setStyle(ButtonStyle.Secondary)
    );
  }

  return [row];
}

async function fetchFormMessage(client, form) {
  if (!form?.channel_id) return { channel: null, msg: null };
  const channel = await client.channels.fetch(form.channel_id).catch(() => null);
  if (!channel || !channel.isTextBased()) return { channel: null, msg: null };
  if (!form.message_id) return { channel, msg: null };
  const msg = await channel.messages.fetch(form.message_id).catch(() => null);
  return { channel, msg };
}

/**
 * Ensures the guild has an active Study To-Do form when `study_channel_id` is configured.
 * If an active form already exists, returns null without posting a duplicate.
 */
async function ensureActiveStudyFormForGuild(client, guildId) {
  return withKeyLock(guildCreateLocks, guildId, async () => {
    const existingActive = getActiveStudyForms(guildId);
    if (existingActive.length > 0) return null;

    const channel = await getStudyChannelForGuild(client, guildId);
    if (!channel) return null;

    const TZ = getTimeZone();
    const dateStr = getLocalParts(new Date(), TZ).dateStr;
    const formId = crypto.randomBytes(4).toString('hex');
    const trackedMembers = await getChannelStudyMembers(channel.guild, channel);
    const stubForm = { id: formId, guild_id: guildId, channel_id: channel.id, date_str: dateStr };
    const { embed, overflowed } = buildStudyFormEmbed(stubForm, [], [], trackedMembers);
    const components = buildStudyFormComponents(formId, [], overflowed);

    const sent = await channel.send({ embeds: [embed], components }).catch(err => {
      console.warn(`[StudyTodo] Failed posting form in #${channel.name}:`, err.message);
      return null;
    });
    if (!sent) return null;

    createStudyForm(formId, guildId, channel.id, sent.id, dateStr);
    console.log(`[StudyTodo] Posted fresh Study To-Do form (${formId}) in ${channel.guild.name} -> #${channel.name}`);
    return formId;
  });
}

/**
 * Refreshes an active study form message, OR deletes it immediately if 100% of users ticked every item
 * and spawns a brand-new Study To-Do form right away.
 * Returns { completed: boolean, formRemoved: boolean, newFormId: string|null }.
 */
async function refreshOrCompleteStudyForm(client, formId) {
  let completedGuildId = null;
  let result = await withKeyLock(formLocks, formId, async () => {
    const form = getStudyForm(formId);
    if (!form || form.completed === 1) return { completed: true, formRemoved: false, newFormId: null };

    const { channel, msg } = await fetchFormMessage(client, form);
    if (!channel) return { completed: false, formRemoved: false, newFormId: null };

    const items = getStudyItems(formId);
    const ticks = getStudyTicksForForm(formId);
    const trackedMembers = await getChannelStudyMembers(channel.guild, channel);

    if (isStudyFormFullyCompleted(items, ticks, trackedMembers)) {
      if (!completeAndClearStudyForm(formId)) {
        return { completed: true, formRemoved: false, newFormId: null };
      }
      if (msg) {
        await msg.delete().catch(() => {});
      }
      completedGuildId = form.guild_id;
      console.log(`[StudyTodo] Form ${formId} reached 100% completion across ${trackedMembers.length} member(s) and was removed.`);
      return { completed: true, formRemoved: true, newFormId: null };
    }

    const { embed, overflowed } = buildStudyFormEmbed(form, items, ticks, trackedMembers);
    const components = buildStudyFormComponents(formId, items, overflowed);

    if (msg) {
      await msg.edit({ embeds: [embed], components }).catch(async err => {
        if (err.code === 10008) {
          const repost = await channel.send({ embeds: [embed], components }).catch(() => null);
          if (repost) updateStudyFormMessage(formId, repost.id);
        }
      });
    } else {
      const repost = await channel.send({ embeds: [embed], components }).catch(() => null);
      if (repost) updateStudyFormMessage(formId, repost.id);
    }

    return { completed: false, formRemoved: false, newFormId: null };
  });

  if (result.formRemoved && completedGuildId) {
    const newFormId = await ensureActiveStudyFormForGuild(client, completedGuildId).catch(err => {
      console.error(`[StudyTodo] Failed spawning replacement form in guild ${completedGuildId}:`, err.message);
      return null;
    });
    result = { ...result, newFormId };
  }

  return result;
}

async function ensureActiveStudyFormsAllGuilds(client) {
  for (const guild of client.guilds.cache.values()) {
    await ensureActiveStudyFormForGuild(client, guild.id).catch(err =>
      console.error(`[StudyTodo] Error ensuring form for ${guild.name}:`, err.message)
    );
  }
}

async function recheckActiveStudyForms(client, guildId = null) {
  const forms = getActiveStudyForms(guildId);
  for (const f of forms) {
    await refreshOrCompleteStudyForm(client, f.id).catch(err =>
      console.warn(`[StudyTodo] Recheck failed for ${f.id}:`, err.message)
    );
  }
}

// ─── Paginated Select & Viewer Helpers ────────────────────────

function buildPaginatedItemSelectPayload({
  mode,
  formId,
  items,
  page = 0,
  title,
  placeholder,
  multi = false,
  headerText = null
}) {
  const PAGE_SIZE = 25;
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const slice = items.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const select = new StringSelectMenuBuilder()
    .setCustomId(`study-${mode}-select_${formId}_${safePage}`)
    .setPlaceholder(placeholder)
    .setMinValues(1)
    .setMaxValues(multi ? slice.length : 1)
    .addOptions(
      slice.map(item => ({
        label: item.subject.slice(0, 100),
        description: item.details.replace(/\r?\n/g, ' ').slice(0, 100),
        value: String(item.id)
      }))
    );

  const rows = [new ActionRowBuilder().addComponents(select)];

  if (totalPages > 1) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`study-${mode}-page_${formId}_${safePage - 1}`)
          .setLabel('◀ Prev')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(safePage === 0),
        new ButtonBuilder()
          .setCustomId(`study-noop_${formId}`)
          .setLabel(`Page ${safePage + 1} / ${totalPages}`)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(`study-${mode}-page_${formId}_${safePage + 1}`)
          .setLabel('Next ▶')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(safePage >= totalPages - 1)
      )
    );
  }

  return {
    content: [headerText, `**${title}** *(Page ${safePage + 1}/${totalPages})*`].filter(Boolean).join('\n\n'),
    components: rows
  };
}

function buildViewAllPayload(form, items, ticks, trackedMembers, page = 0) {
  const PAGE_SIZE = 8;
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const slice = items.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const tickMap = buildTickMap(ticks);
  const startIdx = safePage * PAGE_SIZE;

  const blocks = slice.map((item, idx) => formatItemBlock(item, startIdx + idx, tickMap, trackedMembers));
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`📋 All Study Tasks (${items.length}) — Page ${safePage + 1}/${totalPages}`)
    .setDescription(blocks.join('\n\n').slice(0, 4096) || '_No tasks._')
    .setFooter({ text: `Form ID: ${form.id}` });

  const components = [];
  if (totalPages > 1) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`study-view-page_${form.id}_${safePage - 1}`)
          .setLabel('◀ Prev')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(safePage === 0),
        new ButtonBuilder()
          .setCustomId(`study-view-page_${form.id}_${safePage + 1}`)
          .setLabel('Next ▶')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(safePage >= totalPages - 1)
      )
    );
  }

  return { embeds: [embed], components };
}

function openStudyItemModal(interaction, { customId, title, subjectValue = '', detailsValue = '' }) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title);

  const subjectInput = new TextInputBuilder()
    .setCustomId('studySubject')
    .setLabel('Subject / Topic')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(100)
    .setPlaceholder('e.g. Algorithms, Numerical Methods, Comp Arch')
    .setRequired(true);
  if (subjectValue) subjectInput.setValue(subjectValue.slice(0, 100));

  const detailsInput = new TextInputBuilder()
    .setCustomId('studyDetails')
    .setLabel('How Much / Study Details')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(400)
    .setPlaceholder('e.g. DP Slides 1-15 + 4 problems, Ch-2 full, 2 hrs practice')
    .setRequired(true);
  if (detailsValue) detailsInput.setValue(detailsValue.slice(0, 400));

  modal.addComponents(
    new ActionRowBuilder().addComponents(subjectInput),
    new ActionRowBuilder().addComponents(detailsInput)
  );

  return interaction.showModal(modal);
}

// ─── Central Interaction Router ───────────────────────────────

async function handleStudyInteraction(interaction, client = interaction.client) {
  const parts = interaction.customId.split('_');
  const action = parts[0];
  const formId = parts[1];
  const extra = parts[2];

  const form = getStudyForm(formId);
  if (!form || form.completed === 1) {
    const expired = {
      embeds: [errorEmbed('Form Already Replaced', 'Everyone finished that study form — use the newly posted form in the channel!')],
      components: [],
      flags: 64
    };
    if (interaction.isModalSubmit() || interaction.isButton() || interaction.isStringSelectMenu()) {
      return interaction.reply(expired).catch(() => {});
    }
    return;
  }

  if (interaction.isButton() && action === 'study-add') {
    return openStudyItemModal(interaction, {
      customId: `study-add-modal_${formId}`,
      title: 'Add Study Goal'
    });
  }

  if (interaction.isButton() && (action === 'study-tick' || action === 'study-tick-page')) {
    const page = action === 'study-tick-page' ? (parseInt(extra, 10) || 0) : 0;
    const items = getStudyItems(formId);
    const ticks = getStudyTicksForForm(formId);
    const tickMap = buildTickMap(ticks);
    const completedItems = items.filter(it => tickMap.get(it.id)?.has(interaction.user.id));
    const pendingItems = items.filter(it => !tickMap.get(it.id)?.has(interaction.user.id));

    if (items.length === 0) {
      const payload = { content: '⚠️ No study items added yet. Click **➕ Add Study** first!', components: [], flags: 64 };
      return action === 'study-tick-page' ? interaction.update(payload) : interaction.reply(payload);
    }

    if (pendingItems.length === 0) {
      const payload = {
        content: `🎉 You have already completed & ticked **all ${items.length}/${items.length}** study items! Completed subjects are locked for you.`,
        components: [],
        flags: 64
      };
      return action === 'study-tick-page' ? interaction.update(payload) : interaction.reply(payload);
    }

    const doneSummary = completedItems.length > 0
      ? `🔒 **Already Completed & Disabled for You (${completedItems.length}):** ${completedItems.map(i => `~~${i.subject}~~`).join(', ').slice(0, 500)}`
      : null;

    const payload = buildPaginatedItemSelectPayload({
      mode: 'tick',
      formId,
      items: pendingItems,
      page,
      title: `Select study item(s) you finished (${pendingItems.length} pending)`,
      placeholder: 'Tick completed study items...',
      multi: true,
      headerText: doneSummary
    });

    return action === 'study-tick-page'
      ? interaction.update(payload)
      : interaction.reply({ ...payload, flags: 64 });
  }

  if (interaction.isButton() && (action === 'study-edit' || action === 'study-edit-page')) {
    const page = action === 'study-edit-page' ? (parseInt(extra, 10) || 0) : 0;
    const items = getStudyItems(formId);
    if (items.length === 0) {
      const payload = { content: '⚠️ No study items to edit yet.', components: [], flags: 64 };
      return action === 'study-edit-page' ? interaction.update(payload) : interaction.reply(payload);
    }

    const payload = buildPaginatedItemSelectPayload({
      mode: 'edit',
      formId,
      items,
      page,
      title: 'Choose a study item to edit',
      placeholder: 'Pick an item to edit Subject / Details...',
      multi: false
    });

    return action === 'study-edit-page'
      ? interaction.update(payload)
      : interaction.reply({ ...payload, flags: 64 });
  }

  if (interaction.isButton() && (action === 'study-remove' || action === 'study-remove-page')) {
    const page = action === 'study-remove-page' ? (parseInt(extra, 10) || 0) : 0;
    const items = getStudyItems(formId);
    if (items.length === 0) {
      const payload = { content: '⚠️ No study items to remove.', components: [], flags: 64 };
      return action === 'study-remove-page' ? interaction.update(payload) : interaction.reply(payload);
    }

    const payload = buildPaginatedItemSelectPayload({
      mode: 'remove',
      formId,
      items,
      page,
      title: 'Select study item(s) to remove from the form',
      placeholder: 'Pick item(s) to delete...',
      multi: true
    });

    return action === 'study-remove-page'
      ? interaction.update(payload)
      : interaction.reply({ ...payload, flags: 64 });
  }

  if (interaction.isButton() && (action === 'study-view' || action === 'study-view-page')) {
    const page = action === 'study-view-page' ? (parseInt(extra, 10) || 0) : 0;
    const items = getStudyItems(formId);
    const ticks = getStudyTicksForForm(formId);
    const trackedMembers = await getChannelStudyMembers(interaction.guild, interaction.channel);
    const payload = buildViewAllPayload(form, items, ticks, trackedMembers, page);
    return action === 'study-view-page'
      ? interaction.update(payload)
      : interaction.reply({ ...payload, flags: 64 });
  }

  if (interaction.isStringSelectMenu() && action === 'study-edit-select') {
    const itemId = interaction.values[0];
    const item = getStudyItem(itemId);
    if (!item || item.form_id !== formId) {
      return interaction.reply({ content: '⚠️ That study item was already removed.', flags: 64 });
    }
    return openStudyItemModal(interaction, {
      customId: `study-edit-modal_${formId}_${item.id}`,
      title: 'Edit Study Goal',
      subjectValue: item.subject,
      detailsValue: item.details
    });
  }

  if (interaction.isStringSelectMenu() && action === 'study-tick-select') {
    await interaction.deferUpdate();
    const selectedIds = interaction.values.map(Number).filter(Number.isFinite);
    const validIds = getStudyItems(formId).filter(i => selectedIds.includes(i.id)).map(i => i.id);
    if (validIds.length === 0) {
      return interaction.editReply({ content: '⚠️ Selected item(s) no longer exist on this form.', components: [] });
    }

    addStudyTicks(validIds, interaction.user.id);
    const status = await refreshOrCompleteStudyForm(client, formId);

    if (status.formRemoved) {
      return interaction.editReply({
        content: '🎉 **100% Complete!** Every member finished this study form — removed it and posted a **brand-new form** immediately!',
        components: []
      });
    }

    const items = getStudyItems(formId);
    const ticks = getStudyTicksForForm(formId);
    const tickMap = buildTickMap(ticks);
    const pendingItems = items.filter(it => !tickMap.get(it.id)?.has(interaction.user.id));

    if (pendingItems.length === 0) {
      return interaction.editReply({
        content: `✅ Marked **${validIds.length}** item(s) complete!\n🎉 You have finished **all ${items.length}/${items.length}** items on this form (all locked for you). Waiting on remaining server members!`,
        components: []
      });
    }

    const nextPayload = buildPaginatedItemSelectPayload({
      mode: 'tick',
      formId,
      items: pendingItems,
      page: 0,
      title: `Remaining items (${pendingItems.length} left)`,
      placeholder: 'Tick more completed items...',
      multi: true,
      headerText: `✅ Marked **${validIds.length}** item(s) done and locked for you!`
    });
    return interaction.editReply(nextPayload);
  }

  if (interaction.isStringSelectMenu() && action === 'study-remove-select') {
    await interaction.deferUpdate();
    const selectedIds = interaction.values.map(Number).filter(Number.isFinite);
    let removed = 0;
    for (const id of selectedIds) {
      const item = getStudyItem(id);
      if (item && item.form_id === formId && deleteStudyItem(id)) removed++;
    }

    const status = await refreshOrCompleteStudyForm(client, formId);
    if (status.formRemoved) {
      return interaction.editReply({
        content: `🗑️ Removed **${removed}** item(s). Remaining items hit 100% — form cleared & a **brand-new form** was posted!`,
        components: []
      });
    }

    return interaction.editReply({
      content: `🗑️ Removed **${removed}** study item(s) from the form.`,
      components: []
    });
  }

  if (interaction.isModalSubmit() && action === 'study-add-modal') {
    await interaction.deferReply({ flags: 64 });
    const subject = interaction.fields.getTextInputValue('studySubject').trim();
    const details = interaction.fields.getTextInputValue('studyDetails').trim();

    addStudyItem(formId, subject, details, interaction.user.id);
    await refreshOrCompleteStudyForm(client, formId);

    return interaction.editReply({
      content: `✅ Added **${subject}** (*${details}*) to the Study To-Do form!`
    });
  }

  if (interaction.isModalSubmit() && action === 'study-edit-modal') {
    await interaction.deferReply({ flags: 64 });
    const itemId = Number(extra);
    const existing = getStudyItem(itemId);
    if (!existing || existing.form_id !== formId) {
      return interaction.editReply({ content: '⚠️ That study item was already removed.' });
    }

    const subject = interaction.fields.getTextInputValue('studySubject').trim();
    const details = interaction.fields.getTextInputValue('studyDetails').trim();

    updateStudyItem(itemId, subject, details, interaction.user.id);
    await refreshOrCompleteStudyForm(client, formId);

    return interaction.editReply({
      content: `✏️ Updated item to **${subject}** (*${details}*)!`
    });
  }
}

// ─── Startup Bootstrap ────────────────────────────────────────

function startStudyTodo(client) {
  setTimeout(async () => {
    try {
      await recheckActiveStudyForms(client);
      await ensureActiveStudyFormsAllGuilds(client);
    } catch (err) {
      console.error('[StudyTodo] Startup sync error:', err.message);
    }
  }, 8000);

  console.log('[StudyTodo] Instant-reset Study To-Do manager initialized.');
}

module.exports = {
  startStudyTodo,
  ensureActiveStudyFormForGuild,
  ensureActiveStudyFormsAllGuilds,
  recheckActiveStudyForms,
  refreshOrCompleteStudyForm,
  handleStudyInteraction,
  buildStudyFormEmbed,
  isStudyFormFullyCompleted
};
