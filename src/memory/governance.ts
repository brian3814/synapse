import type { CommandContext } from '../commands/types';

export async function markSuperseded(
  ctx: CommandContext,
  oldFilename: string,
  newFilename: string,
): Promise<void> {
  const raw = await ctx.files.read(`memory/${oldFilename}`);
  if (!raw) return;

  const updated = raw.replace(
    /^superseded_by:.*$/m,
    `superseded_by: ${newFilename}`,
  ).replace(
    /^valid:.*$/m,
    'valid: false',
  );

  await ctx.files.write(`memory/${oldFilename}`, updated);
}

export async function updateAccessStats(
  ctx: CommandContext,
  filename: string,
): Promise<void> {
  const raw = await ctx.files.read(`memory/${filename}`);
  if (!raw) return;

  const now = new Date().toISOString();
  let updated = raw.replace(
    /^access_count: (\d+)$/m,
    (_, count) => `access_count: ${parseInt(count, 10) + 1}`,
  );
  updated = updated.replace(
    /^last_accessed:.*$/m,
    `last_accessed: ${now}`,
  );

  await ctx.files.write(`memory/${filename}`, updated);
}
