// import ldap from 'ldapjs';
import { InfoLog, ErrorLog } from './logger.ts';
import { MessageFlags, ModalSubmitInteraction, type Interaction } from 'discord.js';
import { db } from './db.ts';
import type { User, UserCode } from './types.ts';

// const ldapClient = ldap.createClient({
//   url: 'ldaps://uwldap.uwaterloo.ca',
//   timeout: 7000,
//   reconnect: true,
// });

// Returns row of a search for the given WatIAM in the DB. Undefined if not found.
export function isVerified(watiam: string) {
  try {
    let row = db.prepare(`SELECT * FROM users WHERE watiam = ?;`).get(watiam);
    return row;
  } catch (e) {
    ErrorLog(`Failed to query users DB for ${watiam}!`);
    ErrorLog(e);
    throw new Error('Something went wrong. Please contact an administrator.');
  }
}

// Returns array consisting of search rows for given userid in the users and usercodes DBs respectively. Each undefined if not found.
export function userExistsInDB(id: string) {
  try {
    const idRegistered = db.prepare('SELECT * FROM users WHERE userid = ?;').get(id) as
      | User
      | undefined;
    const idAwaiting = db.prepare('SELECT * FROM usercodes WHERE userid = ?;').get(id) as
      | UserCode
      | undefined;
    return [idRegistered, idAwaiting] as const;
  } catch (e) {
    ErrorLog(`Failed to query users DB for ${id}!`);
    ErrorLog(e);
    throw new Error('Something went wrong. Please contact an administrator.');
  }
}

const watiamRegex = /^[a-z0-9]+$/;

/**
 * If given WatIAM alias is found in LDAP, returns the true WatIAM ID.
 *
 * UW seems to have disabled public access to their LDAP server in late 2025. Until an alternative
 * comes along, this will just perform some basic validation on the given string and return it. The
 * original code is commented out in the implementation.
 */
export function isValidId(watiam: string, _interaction: Interaction): string {
  if (!watiam.match(watiamRegex)) {
    throw new Error('Invalid WatIAM.');
  }
  return watiam;

  /*
  return new Promise(function (resolve, reject) {
    let email = `${watiam}@uwaterloo.ca`;
    ldapClient.bind('', '', (err) => {
      if (err) {
        ErrorLog(`Failed to validate ${watiam}!`);
        ErrorLog(err);
        reject(
          new Error("Couldn't validate the given WatIAM ID. Please contact an administrator.")
        );
        return;
      }
      const opts = {
        filter: `(mailLocalAddress=${email})`,
        scope: 'sub' as const,
        attributes: ['id'],
      };
      ldapClient.search('dc=uwaterloo,dc=ca', opts, (err, res) => {
        let isResolved = false;
        if (err) {
          ErrorLog(
            `Trouble validating WatIAM ID ${watiam} given by ${interaction.user.id} (${interaction.user.tag}).`
          );
          ErrorLog('Hint: is there a connection issue with the LDAP server?');
          ErrorLog(err);
          reject(
            new Error("Couldn't validate the given WatIAM ID. Please contact an administrator.")
          );
          isResolved = true;
        }
        res.on('searchEntry', (entry) => {
          // Convert possible alias to true WatIAM ID for email and storage.
          if (!entry.objectName) {
            reject(new Error('Entry found but missing objectName?'));
            return;
          }
          isResolved = true;
          resolve(entry.objectName.split(',')[0]!.substring(4));
        });
        res.on('error', (err) => {
          if (isResolved) return;
          ErrorLog(
            `Trouble validating WatIAM ID ${watiam} given by ${interaction.user.id} (${interaction.user.tag}).`
          );
          ErrorLog('Hint: was the query malformed?');
          ErrorLog(err);
          reject(
            new Error("Couldn't validate the given WatIAM ID. Please contact an administrator.")
          );
          isResolved = true;
        });
        res.on('connectError', (err) => {
          if (isResolved) return;
          ErrorLog(
            `Trouble validating WatIAM ID ${watiam} given by ${interaction.user.id} (${interaction.user.tag}).`
          );
          ErrorLog('Hint: was the query malformed?');
          ErrorLog(err);
          reject(
            new Error("Couldn't validate the given WatIAM ID. Please contact an administrator.")
          );
          isResolved = true;
        });
        res.on('end', (result) => {
          InfoLog(`Finished LDAP query with status ${result?.status}.`);
          if (!isResolved) {
            InfoLog(
              `Invalid WatIAM ID ${watiam} given by ${interaction.user.id} (${interaction.user.tag})`
            );
            //reject(new Error('The given WatIAM ID is invalid. Please try again.'));
            // Message is DELIBERATELY ambiguous
            // This is to prevent non-UW students from querying WatIAM IDs
            reject(
              new Error(CHECK_EMAIL)
            );
          }
        });
      });
      ldapClient.unbind();
    });
  });
  */
}

export async function verify(interaction: ModalSubmitInteraction, code: string) {
  let server = interaction.guild;
  if (!server) {
    throw new Error('Command must be run from a guild!');
  }
  const role = server.roles.cache.find((role) => role.name === 'Verified');
  const member = server.members.cache.get(interaction.user.id);

  if (!role) {
    throw new Error('Verified role does not exist!');
  }
  if (!member) {
    throw new Error('Member not found!');
  }

  let watiam = db.prepare('SELECT * FROM users WHERE userid = ?;').get(interaction.user.id) as User;
  if (watiam) {
    InfoLog(
      `In ${interaction.guild?.name}, user ${interaction.user.id} (${interaction.user.tag}) invoked verify but is already verified in database. Giving role...`
    );
    try {
      await member.roles.add(role);
    } catch {
      ErrorLog(
        `${interaction.guild?.name}: WARNING! Verified role has higher priority than bot role. Role endowment will fail.`
      );
      await interaction.reply({
        content: 'Something went wrong with your command. Please contact an administrator.',
        flags: [MessageFlags.Ephemeral],
      });
    }
    await interaction.reply({
      content: `You're already verified as ${watiam.watiam}. If this is a mistake, please contact an administrator.`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  let row;
  try {
    row = db
      .prepare(`
            SELECT
                watiam, code
            FROM usercodes
            WHERE
                userid = ? AND
                code = ? AND
                expires_at > datetime('now');`)
      .get(interaction.user.id, code) as UserCode | undefined;
  } catch (e) {
    ErrorLog('Failed to query usercodes database for verify.');
    ErrorLog(e);
    await interaction.reply({
      content: 'Something went wrong with your command. Please contact an administrator.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }
  if (!row) {
    InfoLog(
      `In ${interaction.guild?.name}, user ${interaction.user.id} (${interaction.user.tag}) tried to verify with invalid/expired code!`
    );
    await interaction.reply({
      content: 'Invalid/expired verification code.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }
  try {
    InfoLog(
      `In ${interaction.guild?.name}, user ${interaction.user.id} (${interaction.user.tag}) verified code ${code}. Adding to database...`
    );
    db.prepare(`DELETE FROM usercodes WHERE userid = ?;`).run(interaction.user.id);
    db.prepare(`
            INSERT INTO
                users(userid, watiam, code)
            VALUES
                (?, ?, ?)
                ON CONFLICT(userid) DO
                UPDATE
                SET
                    watiam = ?,
                    code = ?;`).run(
      interaction.user.id,
      row.watiam,
      row.code,
      row.watiam,
      row.code
    );
  } catch (e) {
    ErrorLog(`Failed to delete ${interaction.user.id} from usercodes or insert into users.`);
    ErrorLog(e);
    await interaction.reply({
      content: 'Something went wrong with your command. Please contact an administrator.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }
  try {
    if (role) {
      await member.roles.add(role);
    }
  } catch (e) {
    ErrorLog(
      `${interaction.guild?.name}: WARNING! Verified role has higher priority than bot role. Role endowment will fail.`
    );
    ErrorLog(e);
    await interaction.reply({
      content: 'Something went wrong with your command. Please contact an administrator.',
      flags: [MessageFlags.Ephemeral],
    });
  }
  InfoLog(
    `In ${interaction.guild?.name}, user ${interaction.user.id} (${interaction.user.tag}) successfully verified as ${row.watiam}.`
  );
  await interaction.reply({ content: "You've been verified!", flags: [MessageFlags.Ephemeral] });
}
