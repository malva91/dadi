class ColorTypesRegistry {
    constructor() {
        this.colors = new Map();
        this.initializeDefaultColors();
    }

    initializeDefaultColors() {
        this.registerColor({
            id: 'base',
            label: 'Base',
            emoji: '🎲',
            visible: true
        });

        this.registerColor({
            id: 'rosso',
            label: 'Rosso',
            emoji: '🔴',
            visible: true
        });

        this.registerColor({
            id: 'blu',
            label: 'Blu',
            emoji: '🔵',
            visible: true
        });

        this.registerColor({
            id: 'danni',
            label: 'Danni',
            emoji: '⚔️',
            visible: true
        });

        this.registerColor({
            id: 'protezione',
            label: 'Protezione',
            emoji: '🛡️',
            visible: true
        });

        this.registerColor({
            id: 'cura',
            label: 'Cura',
            emoji: '❤️',
            visible: true
        });

    }

    registerColor(config) {
        if (!config.id || !config.label) {
            throw new Error('Color must have id and label');
        }

        this.colors.set(config.id, {
            id: config.id,
            label: config.label,
            emoji: config.emoji || '',
            visible: config.visible !== false
        });
    }

    getColor(id) {
        return this.colors.get(id);
    }

    getAllColors() {
        return Array.from(this.colors.values());
    }

    getVisibleColors() {
        return this.getAllColors().filter(color => color.visible);
    }

    setColorVisibility(id, visible) {
        const color = this.colors.get(id);
        if (color) {
            color.visible = visible;
        }
    }

    getColorEmoji(id) {
        const color = this.colors.get(id);
        return color ? color.emoji : '';
    }

    removeColor(id) {
        return this.colors.delete(id);
    }
}

window.ColorTypesRegistry = ColorTypesRegistry;
