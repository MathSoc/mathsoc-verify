const { SlashCommandBuilder } = require('discord.js');
const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');
const {db_path, sendinblue, templateId} = require('../config.json');
const sib = require('sib-api-v3-sdk');
const {InfoLog, ErrorLog} = require('../utils/logger.js');
const {isVerified, isValidId, userExistsInDB} = require('../utils/verify.js');

const mailClient = sib.ApiClient.instance
const apiKey = mailClient.authentications['api-key']
apiKey.apiKey = sendinblue;

let sibMail = new sib.TransactionalEmailsApi();

function getCode(n) {
    var code = '';
    for (i = 0; i < n; ++i) {
        code += String(Math.floor(Math.random() * 10));
    }
    return code;
}

// Store usercode in database and send email
async function storeAndEmail(watiam, db, interaction) {
    const code = getCode(6);
    const msg = {
        to: [{email: watiam+'@uwaterloo.ca'}],
        replyTo: {email: 'tech@mathsoc.uwaterloo.ca'},
        templateId: templateId,
        params: {
            userid: interaction.user.tag,
            code: code
        }
    };

    try {
        await db.run(`
	    DELETE FROM
                usercodes
	    WHERE
                expires_at <= DATETIME('now', '-15 minutes')`);
        let existing = await db.get(`SELECT * FROM usercodes WHERE userid = ?`, [interaction.user.id]);
        if (existing) {
            code = existing[0].code;
        }
        await db.run(`
            INSERT INTO
                usercodes(userid, watiam, code)
            VALUES 
                (?, ?, ?)
                ON CONFLICT(userid) DO
                UPDATE
                SET
                    watiam = ?,
                    code = ?,
                    expires_at = DATETIME('now', '+15 minutes')`,
            [interaction.user.id, watiam, code, watiam, code]);
        await sibMail.sendTransacEmail(msg);
        InfoLog(`Sent verification email for ${interaction.user.id} (${interaction.user.tag}) to ${watiam}@uwaterloo.ca.`)
    } catch (e) {
        ErrorLog(`Trouble in storeAndEmail for ${watiam} submitted by ${interaction.user.id} (${interaction.user.tag})!`)
        ErrorLog(e);
        interaction.reply({content: 'Something went wrong with your command. Please contact an administrator.', ephemeral: true});
        return;
    }
    await interaction.reply({content: 'Please check your @uwaterloo.ca email inbox for a verification code. Once you receive it, press the "enter verification code" button and enter the verification code from the email.\nNote that if you are already verified, you will not receive an email. Your verification code will expire in 15 minutes.', ephemeral: true});
}

module.exports = {
    async iam(interaction, watiam) {
        const db = await sqlite.open({
            filename: db_path,
            driver: sqlite3.Database
        });
        // Has the requestor already been verified under some WatIAM ID, or do they have an outstanding code?
        let row;
        try {
            row = await userExistsInDB(interaction.user.id, db);
        } catch (e) {
            await interaction.reply({content: e.message, ephemeral: true});
            await db.close();
            return;
        }
        // If verified under a WatIAM ID, make sure they have the Verified role and quit.
        if (row[0]) {
            InfoLog(`In ${interaction.guild.name}, user ${interaction.user.id} (${interaction.user.tag}) already verified as ${row[0].watiam}. Giving role...`);
            let server = await interaction.guild;
            let role = await server.roles.cache.find(role => role.name === 'Verified');
            let member = await server.members.cache.get(interaction.user.id);
            if (!(await member.roles.cache.find(role => role.name === 'Verified'))) {
                try {
                    await interaction.member.roles.add(role);
                } catch (e) {
                    ErrorLog('!!WARNING!! Verified role has higher priority than bot role. Role endowment will fail.');
                    await interaction.reply({content: 'Something went wrong with your command. Please contact an administrator', ephemeral: true});
                    await db.close();
                    return;
                }
            }
            await interaction.reply({content: `You're already verified as ${row[0].watiam}. If this is a mistake, please contact an administrator.`, ephemeral: true});
            await db.close();
            return;
        }
        // If they have an outstanding code, quit.
        else if (row[1]) {
            InfoLog(`In ${interaction.guild.name}, user ${interaction.user.id} (${interaction.user.tag}) already has an outstanding verification code ${row[1].code}. Quitting...`);
            // Message is DELIBERATELY ambiguous
            // This is to prevent non-UW students from querying WatIAM IDs
            await interaction.reply({content: 'Please check your @uwaterloo.ca email inbox for a verification code. Once you receive it, press the "enter verification code" button and enter the verification code from the email.\nNote that if you are already verified, you will not receive an email. Your verification code will expire in 15 minutes.', ephemeral: true});
            await db.close();
            return;
        }

        // If not, continue
        // De-alias the given WatIAM
        let res;
        try {
            res = await isValidId(watiam, interaction);
        } catch (e) {
            await interaction.reply({content: e.message, ephemeral: true});
            await db.close();
            return;
        }
        // Is someone else already registered with WatIAM ID res?
        let watiamExists;
        try {
            watiamExists = await isVerified(res, db);
        } catch (e) {
            await interaction.reply({content: e.message, ephemeral: true});
            await db.close();
            return;
        }
        // If yes, block them from claiming it
        if (watiamExists) {
            InfoLog(`In ${interaction.guild.name}, user ${interaction.user.id} (${interaction.user.tag}) tried to claim ${res} which is already verified in database. Quitting...`);
            await db.close();
            // Message is DELIBERATELY ambiguous
            // This is to prevent non-UW students from querying WatIAM IDs
            await interaction.reply({content: 'Please check your @uwaterloo.ca email inbox for a verification code. Once you receive it, press the "enter verification code" button and enter the verification code from the email.\nNote that if you are already verified, you will not receive an email. Your verification code will expire in 15 minutes.', ephemeral: true});
        }
        // If not, register in usercodes and send email.
        else {
            InfoLog(`In ${interaction.guild.name}, validated ${watiam} -> ${res} given by ${interaction.user.id} (${interaction.user.tag}).`)
            await storeAndEmail(res, db, interaction);
            await db.close();
        }
    }
}
