// src/db/crypto.js
const crypto = require('crypto');
const os = require('os');
const { execSync } = require('child_process');

const ALGO = 'aes-256-gcm';

// Derive machine-specific key from hardware/OS info
function getHardwareId() {
    let parts = [];
    parts.push(os.type());
    parts.push(os.release());
    parts.push(os.arch());
    const cpus = os.cpus();
    if (cpus.length > 0) {
        parts.push(cpus[0].model.trim());
        parts.push(cpus.length.toString());
    }
    try {
        const output = execSync('wmic diskdrive get serialnumber', {
            encoding: 'utf8'
        });
        const lines = output.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length > 1) {
            parts.push(lines[1]);
        }
    }
    catch (err) {
        parts.push(os.homedir());
    }
    return parts.join('|');
}

const HARDWARE_ID = getHardwareId();
const KEY = crypto.createHash('sha256').update(HARDWARE_ID).digest();

function encrypt(text) {
    if (!text) throw new Error('Cannot encrypt empty string');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGO, KEY, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decrypt(payload) {
    if (!payload) throw new Error('Cannot decrypt empty payload');
    try {
        const data = Buffer.from(payload, 'base64');
        const iv = data.slice(0, 12);
        const tag = data.slice(12, 28);
        const text = data.slice(28);
        const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
        decipher.setAuthTag(tag);
        return decipher.update(text, null, 'utf8') + decipher.final('utf8');
    }
    catch (err) {
        throw new Error('Decryption failed: invalid key or corrupted data');
    }
}

module.exports = {
    encrypt,
    decrypt
};