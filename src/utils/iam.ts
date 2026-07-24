import { MessageFlags, ModalSubmitInteraction } from 'discord.js';
import { InfoLog, ErrorLog } from '../utils/logger.ts';
import { isVerified, isValidId, userExistsInDB } from '../utils/verify.ts';
import { db } from './db.ts';
import type { UserCode } from './types.ts';
import { brevo } from './brevo.ts';
import { CHECK_EMAIL } from '../definitions/strings.ts';

function getCode(n: number) {
  let code = '';
  for (let i = 0; i < n; ++i) {
    code += String(Math.floor(Math.random() * 10));
  }
  return code;
}

// Store usercode in database and send email
async function storeAndEmail(watiam: string, interaction: ModalSubmitInteraction) {
  let code = getCode(6);
  const msg = {
    to: [{ email: `${watiam}@uwaterloo.ca` }],
    replyTo: { email: 'tech@mathsoc.uwaterloo.ca' },
    templateId: Number(process.env.TEMPLATE_ID ?? 0),
    params: {
      userid: interaction.user.tag,
      code: code,
    },
  };

  try {
    db.prepare(`DELETE FROM usercodes WHERE expires_at <= DATETIME('now', '-15 minutes')`).run();
    let existing = db
      .prepare('SELECT * FROM usercodes WHERE userid = ?;')
      .get(interaction.user.id) as UserCode | undefined;
    if (existing) {
      code = existing.code;
    }
    await brevo.transactionalEmails.sendTransacEmail(msg);
    InfoLog(
      `Sent verification email for ${interaction.user.id} (${interaction.user.tag}) to ${watiam}@uwaterloo.ca.`
    );
    db.prepare(`
        INSERT INTO
            usercodes(userid, watiam, code)
        VALUES 
            (?, ?, ?)
            ON CONFLICT(userid) DO
            UPDATE
            SET
                watiam = ?,
                code = ?,
                expires_at = DATETIME('now', '+15 minutes');`).run(
      interaction.user.id,
      watiam,
      code,
      watiam,
      code
    );
  } catch (e) {
    ErrorLog(
      `Trouble in storeAndEmail for ${watiam} submitted by ${interaction.user.id} (${interaction.user.tag})!`
    );
    ErrorLog(e);
    await interaction.reply({
      content: 'Something went wrong with your command. Please contact an administrator.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }
  await interaction.reply({
    content: CHECK_EMAIL,
    flags: [MessageFlags.Ephemeral],
  });
}

export async function iam(interaction: ModalSubmitInteraction, watiam: string) {
  // Has the requestor already been verified under some WatIAM ID, or do they have an outstanding code?
  const row = await (async () => {
    try {
      return userExistsInDB(interaction.user.id);
    } catch (e) {
      await interaction.reply({
        content:
          (typeof e === 'object' &&
            !!e &&
            'message' in e &&
            typeof e.message === 'string' &&
            e.message) ||
          '',
        flags: [MessageFlags.Ephemeral],
      });
    }
  })();

  if (!row) {
    return;
  }

  // If verified under a WatIAM ID, make sure they have the Verified role and quit.
  if (row[0]) {
    InfoLog(
      `In ${interaction.guild?.name}, user ${interaction.user.id} (${interaction.user.tag}) already verified as ${row[0].watiam}. Giving role...`
    );
    const server = interaction.guild;
    if (!server) {
      throw new Error('Command must be run from a guild');
    }
    const role = server.roles.cache.find((role) => role.name === 'Verified');
    const member = server.members.cache.get(interaction.user.id);
    if (!role || !member) {
      throw new Error('Verified role/member does not exist?');
    }
    if (!member.roles.cache.find((role) => role.name === 'Verified')) {
      try {
        await member.roles.add(role);
      } catch {
        ErrorLog(
          '!!WARNING!! Verified role has higher priority than bot role. Role endowment will fail.'
        );
        await interaction.reply({
          content: 'Something went wrong with your command. Please contact an administrator',
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }
    }
    await interaction.reply({
      content: `You're already verified as ${row[0].watiam}. If this is a mistake, please contact an administrator.`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  } else if (row[1]) {
    // If they have an outstanding code, quit.
    InfoLog(
      `In ${interaction.guild?.name}, user ${interaction.user.id} (${interaction.user.tag}) already has an outstanding verification code ${row[1].code}. Quitting...`
    );
    // Message is DELIBERATELY ambiguous
    // This is to prevent non-UW students from querying WatIAM IDs
    await interaction.reply({
      content: CHECK_EMAIL,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // If not, continue
  // De-alias the given WatIAM
  let res: string;
  try {
    res = isValidId(watiam, interaction);
  } catch (e) {
    await interaction.reply({
      content:
        (typeof e === 'object' &&
          !!e &&
          'message' in e &&
          typeof e.message === 'string' &&
          e.message) ||
        '',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }
  // Is someone else already registered with WatIAM ID res?
  let watiamExists;
  try {
    watiamExists = isVerified(res);
  } catch (e) {
    await interaction.reply({
      content:
        (typeof e === 'object' &&
          !!e &&
          'message' in e &&
          typeof e.message === 'string' &&
          e.message) ||
        '',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }
  // If yes, block them from claiming it
  if (watiamExists) {
    InfoLog(
      `In ${interaction.guild?.name}, user ${interaction.user.id} (${interaction.user.tag}) tried to claim ${res} which is already verified in database. Quitting...`
    );
    // Message is DELIBERATELY ambiguous
    // This is to prevent non-UW students from querying WatIAM IDs
    await interaction.reply({
      content: CHECK_EMAIL,
      flags: [MessageFlags.Ephemeral],
    });
  }
  // If not, register in usercodes and send email.
  else {
    InfoLog(
      `In ${interaction.guild?.name}, validated ${watiam} -> ${res} given by ${interaction.user.id} (${interaction.user.tag}).`
    );
    await storeAndEmail(res, interaction);
  }
}
