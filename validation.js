class InputValidator {
    constructor() {
        const { VALIDATION } = window.CONSTANTS;
        this.MAX_PLAYER_NAME_LENGTH = VALIDATION.MAX_PLAYER_NAME_LENGTH;
        this.MIN_PLAYER_NAME_LENGTH = VALIDATION.MIN_PLAYER_NAME_LENGTH;
        this.MAX_ROOM_CODE_LENGTH = VALIDATION.MAX_ROOM_CODE_LENGTH;
        this.MIN_ROOM_CODE_LENGTH = VALIDATION.MIN_ROOM_CODE_LENGTH;
        this.MAX_CHAT_MESSAGE_LENGTH = VALIDATION.MAX_CHAT_MESSAGE_LENGTH;
        this.ALLOWED_PLAYER_NAME_CHARS = /^[a-zA-Z0-9àèéìòùÀÈÉÌÒÙáéíóúÁÉÍÓÚäëïöüÄËÏÖÜâêîôûÂÊÎÔÛ\s\-_\.]+$/;
        this.ALLOWED_ROOM_CODE_CHARS = /^[A-Z0-9\-_]+$/;
        this.DANGEROUS_CHARS = /<|>|&|\{|\}|\[|\]|\||\\|\/|;|:|'|"|`|\$|\(|\)/g;

        this.rateLimiter = new RateLimiter();
    }

    validatePlayerName(name) {
        if (!name || typeof name !== 'string') {
            return { valid: false, error: 'Il nome è obbligatorio' };
        }

        const trimmed = name.trim().replace(/\s+/g, ' ');

        if (this.DANGEROUS_CHARS.test(trimmed)) {
            return { valid: false, error: 'Il nome contiene caratteri pericolosi non ammessi' };
        }

        if (trimmed.length < this.MIN_PLAYER_NAME_LENGTH) {
            return { valid: false, error: `Il nome deve essere lungo almeno ${this.MIN_PLAYER_NAME_LENGTH} caratteri` };
        }

        if (trimmed.length > this.MAX_PLAYER_NAME_LENGTH) {
            return { valid: false, error: `Il nome non può superare ${this.MAX_PLAYER_NAME_LENGTH} caratteri` };
        }

        if (!this.ALLOWED_PLAYER_NAME_CHARS.test(trimmed)) {
            return { valid: false, error: 'Il nome contiene caratteri non ammessi. Usa solo lettere, numeri, spazi, trattini e punti.' };
        }

        const sanitized = this.sanitizeInput(trimmed);
        return { valid: true, value: sanitized };
    }

    validateRoomCode(code) {
        if (!code || typeof code !== 'string') {
            return { valid: false, error: 'Il codice taverna è obbligatorio' };
        }

        const trimmed = code.trim().toUpperCase().replace(/\s+/g, '');

        if (this.DANGEROUS_CHARS.test(trimmed)) {
            return { valid: false, error: 'Il codice contiene caratteri pericolosi non ammessi' };
        }

        if (trimmed.length < this.MIN_ROOM_CODE_LENGTH) {
            return { valid: false, error: `Il codice deve essere lungo almeno ${this.MIN_ROOM_CODE_LENGTH} caratteri` };
        }

        if (trimmed.length > this.MAX_ROOM_CODE_LENGTH) {
            return { valid: false, error: `Il codice non può superare ${this.MAX_ROOM_CODE_LENGTH} caratteri` };
        }

        if (!this.ALLOWED_ROOM_CODE_CHARS.test(trimmed)) {
            return { valid: false, error: 'Il codice taverna contiene caratteri non ammessi. Usa solo lettere maiuscole, numeri, trattini e underscore.' };
        }

        return { valid: true, value: trimmed };
    }

    validateChatMessage(message) {
        if (!message || typeof message !== 'string') {
            return { valid: false, error: 'Il messaggio è vuoto' };
        }

        const trimmed = message.trim().replace(/\s+/g, ' ');

        if (trimmed.length === 0) {
            return { valid: false, error: 'Il messaggio è vuoto' };
        }

        if (trimmed.length > this.MAX_CHAT_MESSAGE_LENGTH) {
            return { valid: false, error: `Il messaggio non può superare ${this.MAX_CHAT_MESSAGE_LENGTH} caratteri` };
        }

        const sanitized = this.sanitizeInput(trimmed);
        return { valid: true, value: sanitized };
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    sanitizeInput(text) {
        if (!text) return '';
        return text
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;')
            .replace(/\//g, '&#x2F;');
    }

    sanitizePlayerName(name) {
        const validation = this.validatePlayerName(name);
        if (!validation.valid) {
            return null;
        }
        return this.escapeHtml(validation.value);
    }

    sanitizeRoomCode(code) {
        const validation = this.validateRoomCode(code);
        if (!validation.valid) {
            return null;
        }
        return validation.value;
    }

    sanitizeChatMessage(message) {
        const validation = this.validateChatMessage(message);
        if (!validation.valid) {
            return null;
        }
        return this.escapeHtml(validation.value);
    }
}

class RateLimiter {
    constructor() {
        this.actions = new Map();
        this.limits = {
            chat: window.CONSTANTS.RATE_LIMITS.CHAT,
            roll: window.CONSTANTS.RATE_LIMITS.ROLL,
            join: window.CONSTANTS.RATE_LIMITS.JOIN
        };
    }

    checkLimit(userId, action) {
        const key = `${userId}_${action}`;
        const now = Date.now();
        const limit = this.limits[action];

        if (!limit) {
            return { allowed: true };
        }

        if (!this.actions.has(key)) {
            this.actions.set(key, []);
        }

        const timestamps = this.actions.get(key);
        const validTimestamps = timestamps.filter(ts => now - ts < limit.windowMs);

        if (validTimestamps.length >= limit.maxActions) {
            const oldestTimestamp = validTimestamps[0];
            const waitTime = Math.ceil((limit.windowMs - (now - oldestTimestamp)) / 1000);
            return {
                allowed: false,
                error: `Troppe azioni. Attendi ${waitTime} secondi prima di riprovare.`,
                waitTime
            };
        }

        validTimestamps.push(now);
        this.actions.set(key, validTimestamps);

        return { allowed: true };
    }

    reset(userId, action) {
        const key = `${userId}_${action}`;
        this.actions.delete(key);
    }

    cleanup() {
        const now = Date.now();
        const maxWindow = Math.max(...Object.values(this.limits).map(l => l.windowMs));

        for (const [key, timestamps] of this.actions.entries()) {
            const validTimestamps = timestamps.filter(ts => now - ts < maxWindow);
            if (validTimestamps.length === 0) {
                this.actions.delete(key);
            } else {
                this.actions.set(key, validTimestamps);
            }
        }
    }
}

if (typeof window !== 'undefined') {
    window.InputValidator = InputValidator;
    window.RateLimiter = RateLimiter;
}
