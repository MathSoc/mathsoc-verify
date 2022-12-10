const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');
const ldap = require('ldapjs');
const ldapClient = ldap.createClient({url: 'ldaps://uwldap.uwaterloo.ca', timeLimit: 7000, reconnect: true});
const {db_path, serverId} = require('../config.json');
const {InfoLog, ErrorLog} = require('./logger.js');

// Returns row of a search for the given WatIAM in the DB. Undefined if not found.
async function isVerified(watiam, db) {
    try {
        let row = db.get(`SELECT * FROM users WHERE watiam = ?`, [watiam]);
        return row;
    } catch (e) {
        ErrorLog(`Failed to query users DB for ${watiam}!`);
        ErrorLog(e);
        throw new Error('Something went wrong. Please contact an administrator.');
    }
}

// Returns array consisting of search rows for given userid in the users and usercodes DBs respectively. Each undefined if not found.
async function userExistsInDB(id, db) {
    try {
        let idRegistered = await db.get(`SELECT * FROM users WHERE userid = ?`, [id]);
        let idAwaiting   = await db.get(`SELECT * FROM usercodes WHERE userid = ?`, [id]);
        return [idRegistered, idAwaiting];
    } catch (e) {
        ErrorLog(`Failed to query users DB for ${id}!`);
        ErrorLog(e);
        throw new Error('Something went wrong. Please contact an administrator.');
    }
}

// If given WatIAM alias is found in LDAP, returns the true WatIAM ID.
async function isValidId(watiam, interaction) {
    let prom = new Promise(function(resolve, reject) {
        let email = watiam + '@uwaterloo.ca';
        ldapClient.bind('', '', err => {
            if (err) {
                ErrorLog(`Failed to validate ${watiam}!`);
                ErrorLog(err);
                reject(new Error('Couldn\'t validate the given WatIAM ID. Please contact an administrator.'));
                return;
            }
            const opts = {
                filter: `(mailLocalAddress=${email})`,
                scope: 'sub',
                attributes: ['id']
            };
            ldapClient.search('dc=uwaterloo,dc=ca', opts, (err, res) => {
                isResolved = false;
                if (err) {
                    ErrorLog(`Trouble validating WatIAM ID ${watiam} given by ${interaction.user.id} (${interaction.user.tag}).`);
                    ErrorLog('Hint: is there a connection issue with the LDAP server?');
                    ErrorLog(err);
                    reject(new Error('Couldn\'t validate the given WatIAM ID. Please contact an administrator.'));
                    isResolved = true;
                }
                res.on('searchEntry', entry => {
                    // Convert possible alias to true WatIAM ID for email and storage.
                    isResolved = true;
                    resolve(entry.objectName.split(',')[0].substring(4));
                });
                res.on('error', err => {
                    if (isResolved) return;
                    ErrorLog(`Trouble validating WatIAM ID ${watiam} given by ${interaction.user.id} (${interaction.user.tag}).`);
                    ErrorLog('Hint: was the query malformed?');
                    ErrorLog(err);
                    reject(new Error('Couldn\'t validate the given WatIAM ID. Please contact an administrator.'));
                    isResolved = true;
                });
                res.on('connectError', err => {
                    if (isResolved) return;
                    ErrorLog(`Trouble validating WatIAM ID ${watiam} given by ${interaction.user.id} (${interaction.user.tag}).`);
                    ErrorLog('Hint: was the query malformed?');
                    ErrorLog(err);
                    reject(new Error('Couldn\'t validate the given WatIAM ID. Please contact an administrator.'));
                    isResolved = true;
                });
                res.on('end', result => {
                    InfoLog(`Finished LDAP query with status ${result.status}.`);
                    if (!isResolved) {
                        InfoLog(`Invalid WatIAM ID ${watiam} given by ${interaction.user.id} (${interaction.user.tag})`);
                        //reject(new Error('The given WatIAM ID is invalid. Please try again.'));
                        // Message is DELIBERATELY ambiguous
                        // This is to prevent non-UW students from querying WatIAM IDs
                        reject(new Error('Please check your @uwaterloo.ca email inbox for a verification code. Once you receive it, press the "enter verification code" button and enter the verification code from the email.\nNote that if you are already verified, you will not receive an email. Your verification code will expire in 15 minutes.'));
                    }
                });
            });
            ldapClient.unbind((err) => {
                ErrorLog('Trouble running ldapClient.unbind');
                ErrorLog(err);
            });
            ldapClient.destroy();
        });
    });
    let pr = await prom;
    return pr;
}

async function verify(interaction, code) {
    let db = await sqlite.open({
        filename: db_path,
        driver: sqlite3.Database
    });
    let server = interaction.guild;
    let role = server.roles.cache.find(role => role.name === 'Verified');
    let member = server.members.cache.get(interaction.user.id);

    let watiam = await db.get(`SELECT * FROM users WHERE userid = ?`, [interaction.user.id]);
    if (watiam) {
        InfoLog(`In ${interaction.guild.name}, user ${interaction.user.id} (${interaction.user.tag}) invoked verify but is already verified in database. Giving role...`);
        try {
            interaction.member.roles.add(server.roles.cache.find(role => role.name === 'Verified'));
            await db.close();
         } catch (e) {
            ErrorLog(`${interaction.guild.name}: WARNING! Verified role has higher priority than bot role. Role endowment will fail.`);
            await interaction.reply({content: 'Something went wrong with your command. Please contact an administrator.', ephemeral: true});
            await db.close();
        }
        await interaction.reply({content: `You're already verified as ${watiam.watiam}. If this is a mistake, please contact an administrator.`, ephemeral: true});
        return;
    }

    let row;
    try {
        row = await db.get(`
            SELECT
                watiam, code
            FROM usercodes
            WHERE
                userid = ? AND
                code = ? AND
                expires_at > datetime('now')`,
            [interaction.user.id, code]);
    } catch (e) {
        ErrorLog('Failed to query usercodes database for verify.');
        ErrorLog(e);
        await db.close();
        await interaction.reply({content: 'Something went wrong with your command. Please contact an administrator.', ephemeral: true});
        return;
    }
    if (!row) {
        InfoLog(`In ${interaction.guild.name}, user ${interaction.user.id} (${interaction.user.tag}) tried to verify with invalid/expired code!`);
        await db.close();
        await interaction.reply({content: 'Invalid/expired verification code.', ephemeral: true})
        return;
    }
    try {
        InfoLog(`In ${interaction.guild.name}, user ${interaction.user.id} (${interaction.user.tag}) verified code ${code}. Adding to database...`);
        await db.run(`DELETE FROM usercodes WHERE userid = ?`, [interaction.user.id]);
        await db.run(`
            INSERT INTO
                users(userid, watiam, code)
            VALUES
                (?, ?, ?)
                ON CONFLICT(userid) DO
                UPDATE
                SET
                    watiam = ?,
                    code = ?`,
            [interaction.user.id, row.watiam, row.code, row.watiam, row.code]);
    } catch (e) {
        ErrorLog(`Failed to delete ${interaction.user.id} from usercodes or insert into users.`);
        ErrorLog(e);
        await db.close();
        await interaction.reply({content: 'Something went wrong with your command. Please contact an administrator.', ephemeral: true});
        return;
    }
    await db.close();
    try {
        interaction.member.roles.add(role);
    } catch (e) {
        ErrorLog(`${interaction.guild.name}: WARNING! Verified role has higher priority than bot role. Role endowment will fail.`);
        ErrorLog(e);
        await interaction.reply({content: 'Something went wrong with your command. Please contact an administrator.', ephemeral: true});
    }
    InfoLog(`In ${interaction.guild.name}, user ${interaction.user.id} (${interaction.user.tag}) successfully verified as ${row.watiam}.`);
    await interaction.reply({content: 'You\'ve been verified!', ephemeral: true});
}

module.exports = {isVerified, isValidId, userExistsInDB, verify}
