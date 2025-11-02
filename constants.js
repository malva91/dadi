const CONSTANTS = {
    TIMING: {
        HEARTBEAT_INTERVAL_MS: 30000,
        DISCONNECT_TIMEOUT_MS: 24 * 60 * 60 * 1000,
        CLEANUP_INTERVAL_MS: 60000,
        DICE_RESULTS_CLEANUP_MS: 300000,
        ANIMATION_DELAY_MS: 100,
        NOTIFICATION_DURATION_MS: 3000,
        DICE_ROLL_ANIMATION_MS: 1500,
        RIPPLE_DELAY_MS: 100,
        PRESET_AUTO_ROLL_DELAY_MS: 100,
        BUTTON_ANIMATION_DELAY_MS: 150,
        DICE_ROW_ANIMATION_DELAY_MS: 10,
        DICE_ROW_REMOVE_DELAY_MS: 300,
        EFFECT_DELAY_MS: 100,
        EFFECT_STAGGER_MS: 150,
        NOTIFICATION_FADE_MS: 300,
        DUPLICATE_RESULT_THRESHOLD_MS: 2000
    },

    LIMITS: {
        MAX_DICE_RESULTS: 100,
        MAX_CHAT_MESSAGES: 100,
        MAX_STORED_ERRORS: 50,
        PARTICLE_POOL_SIZE: 200,
        MAX_DICE_PER_ROLL: 12,
        DICE_RESULTS_HISTORY_LIMIT: 100,
        CHAT_HISTORY_LIMIT: 100,
        MAX_DICE_RESULTS_DISPLAY: 100
    },

    VALIDATION: {
        MAX_PLAYER_NAME_LENGTH: 30,
        MIN_PLAYER_NAME_LENGTH: 2,
        MAX_ROOM_CODE_LENGTH: 20,
        MIN_ROOM_CODE_LENGTH: 3,
        MAX_CHAT_MESSAGE_LENGTH: 200
    },

    RATE_LIMITS: {
        CHAT: { maxActions: 5, windowMs: 10000 },
        ROLL: { maxActions: 10, windowMs: 10000 },
        JOIN: { maxActions: 3, windowMs: 30000 }
    },

    STORAGE: {
        TTL_DAYS: 7,
        PREFIX: 'taverna_'
    },

    ANIMATIONS: {
        SNOW_PARTICLE_COUNT: 150,
        PARTICLE_EXPLOSION_COUNT: 30,
        FIRE_PARTICLE_COUNT: 40,
        SPARKLE_COUNT: 8,
        SMOKE_PARTICLE_COUNT: 8,
        COLORED_SMOKE_COUNT: 6,
        SPIRAL_SMOKE_COUNT: 10,
        EXPLOSION_SMOKE_COUNT: 12,
        RAINBOW_PARTICLE_COUNT: 40,
        MAX_SIMULTANEOUS_PARTICLES: 200
    },

    EFFECTS: {
        PARTICLE_MIN_SIZE: 4,
        PARTICLE_MAX_SIZE: 12,
        PARTICLE_MIN_VELOCITY: 50,
        PARTICLE_MAX_VELOCITY: 200,
        PARTICLE_MIN_DURATION: 500,
        PARTICLE_MAX_DURATION: 1500,
        GLOW_INTENSITY_NORMAL: 30,
        GLOW_INTENSITY_INTENSE: 50,
        SHAKE_INTENSITY_NORMAL: 10,
        SHAKE_INTENSITY_HARD: 20,
        SHAKE_DURATION_NORMAL: 500,
        SHAKE_DURATION_HARD: 800
    },

    UI: {
        DICE_ROW_TRANSFORM_Y: -15,
        DICE_ROW_REMOVE_TRANSFORM_X: -15,
        BUTTON_SCALE_PRESSED: 0.9,
        EFFECT_Y_OFFSET_BASE: -50,
        EFFECT_Y_OFFSET_STAGGER: 30
    },

    COLOR_PALETTE: [
        '#8B3A3A', '#3A3A8B', '#3A8B3A', '#8B8B3A',
        '#8B5A3A', '#6B3A6B', '#3A8B8B', '#8B3A5A',
        '#5A5A5A', '#704040', '#8B4040', '#408B40',
        '#40408B', '#8B408B', '#608060', '#806080',
        '#608080', '#805050', '#505080', '#805060'
    ],

    NOTIFICATION_COLORS: {
        success: 'var(--steel-blue)',
        error: '#8b4513',
        warning: '#b8860b',
        info: 'var(--ice-blue)'
    },

    DICE_COLOR_EMOJIS: {
        base: '',
        rosso: '🔴',
        blu: '🔵',
        verde: '🟢',
        giallo: '🟡',
        arancione: '🟠',
        viola: '🟣',
        nero: '⚫',
        bianco: '⚪',
        oro: '🟡✨',
        argento: '⚪✨'
    }
    ,

    TAG_COLORS: {
        attacco: '#ffe5e5',
        difesa:  '#e5f0ff',
        magia:   '#f4e5ff',
        cura:    '#e6ffef',
        loot:    '#fff7e5',
        default: '#f2f4f7'
    }
};

if (typeof window !== 'undefined') {
    window.CONSTANTS = CONSTANTS;
}
