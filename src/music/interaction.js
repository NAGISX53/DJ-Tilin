// A callback can reach Discord even when its HTTP response is lost. Retrying
// that callback then yields 10062/40060, despite an existing deferred reply.
export async function acknowledge(interaction, { ephemeral = false } = {}) {
  if (interaction.deferred || interaction.replied) return true;
  try {
    await interaction.deferReply(ephemeral ? { flags: 64 } : undefined);
    return true;
  } catch (error) {
    let original;
    try { original = await interaction.webhook.fetchMessage('@original'); }
    catch { throw error; }
    const flags = Number(original.flags?.bitfield ?? original.flags ?? 0);
    if (!(flags & 128)) return false; // Another handler already finished it.
    interaction.deferred = true;
    console.warn(`[Música] Confirmación recuperada después de ${error.code || error.name}.`);
    return true;
  }
}
