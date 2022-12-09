var winston = require('winston')

const options = {
    file: {
        level: 'info',
        filename: 'mathsoc-verify.log',
        handleExceptions: true,
        json: true,
        maxsize: 5242880,
        maxFiles: 5,
        colorize: false
    },
    console: {
        level: 'debug',
        handleExceptions: true,
        json: false,
        colorize: true
    }
}
const info_logger = winston.createLogger({
    level: 'info',
    transports: [
        new winston.transports.File(options.file),
        new winston.transports.Console(options.console)
    ],
    exitOnError: false,
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.align(),
        winston.format.printf(info => `[${info.level}] ${[info.timestamp]}: ${info.message}`)
    )
});

const error_logger = winston.createLogger({
    level: 'error',
    transports: [
        new winston.transports.File(options.file),
        new winston.transports.Console(options.console)
    ],
    exitOnError: false,
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.align(),
        winston.format.printf(info => `[${info.level}] ${[info.timestamp]}: ${info.message}`)
    )
});

function InfoLog(msg) {
    info_logger.info(msg);
}

function ErrorLog(msg) {
    error_logger.info(msg);
}

module.exports = {InfoLog, ErrorLog}
