class UIRenderer {
    constructor(validator, effectsEngine, launchTypesRegistry, colorTypesRegistry) {
        this.validator = validator;
        this.effectsEngine = effectsEngine;
        this.launchTypesRegistry = launchTypesRegistry;
        this.colorTypesRegistry = colorTypesRegistry;
        this.pendingDiceResults = [];
        this.pendingChatMessages = [];
        this.diceRenderScheduled = false;
        this.chatRenderScheduled = false;
        this.effectDebounceMap = new Map();
    }

    renderUsersList(users, headerUsersList) {
        if (!headerUsersList) {
            console.warn('headerUsersList element non trovato');
            return;
        }

        headerUsersList.innerHTML = '';

        if (!users || typeof users !== 'object') {
            return;
        }

        const userArray = Object.values(users);

        userArray.forEach(user => {
            if (!user) return;

            const badge = document.createElement('div');
            badge.className = 'user-badge';
            badge.style.backgroundColor = user.color || '#666';
            badge.style.color = '#fff';
            badge.textContent = `🐺 ${this.validator.escapeHtml(user.name || 'Anonimo')}`;
            headerUsersList.appendChild(badge);
        });
    }

    renderPresets(presets, presetButtons, customDiceTypes, onPresetClick) {
        if (!presetButtons) {
            console.warn('Elemento presetButtons non trovato');
            return;
        }

        if (!Array.isArray(presets)) {
            console.error('presets non è un array:', presets);
            return;
        }

        presetButtons.innerHTML = '';

        if (presets.length === 0) {
            presetButtons.innerHTML = '<p style="color: var(--silver); font-style: italic;">Nessun preset disponibile</p>';
            return;
        }

        const visiblePresets = presets.filter(preset => preset.visible !== false);

        if (visiblePresets.length === 0) {
            presetButtons.innerHTML = '<p style="color: var(--silver); font-style: italic;">Nessun preset visibile</p>';
            return;
        }

        visiblePresets.forEach(preset => {
            if (!preset || !preset.id || !preset.name) {
                console.warn('Preset non valido saltato:', preset);
                return;
            }

            const btn = document.createElement('button');
            btn.className = 'btn-preset';
            btn.id = preset.id;
            btn.dataset.presetId = preset.id;

            if (preset.bgColor) {
                btn.style.background = preset.bgColor;
            }

            const diceDescription = (preset.dice && Array.isArray(preset.dice)) ? preset.dice.map(d => {
                let diceType;
                let displayText;

                if (customDiceTypes[d.type]) {
                    diceType = customDiceTypes[d.type].label;
                    displayText = `${d.count} ${diceType}`;
                } else {
                    const launchType = this.launchTypesRegistry.getType(d.type);
                    if (launchType && launchType.category === 'array') {
                        displayText = `${d.count} ${launchType.icon} ${launchType.name}`;
                    } else {
                        diceType = `d${d.type}`;
                        displayText = `${d.count}${diceType}`;
                    }
                }

                return displayText;
            }).join(' + ') : 'Nessun dado';
            const modifierText = preset.modifier !== 0 ? ` ${preset.modifier >= 0 ? '+' : ''}${preset.modifier}` : '';

            btn.innerHTML = `
                <span class="preset-name">${preset.name}</span>
                <span class="preset-details">${diceDescription}${modifierText}</span>
            `;

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (typeof onPresetClick === 'function') {
                    onPresetClick(preset);
                }
            });
            presetButtons.appendChild(btn);
        });
    }

    scheduleDiceResultRender(result, diceResults, customDiceTypes) {
        this.pendingDiceResults.push({ result, diceResults, customDiceTypes, timestamp: Date.now() });

        if (!this.diceRenderScheduled) {
            this.diceRenderScheduled = true;
            requestAnimationFrame(() => this.flushDiceResults());
        }
    }

    flushDiceResults() {
        this.diceRenderScheduled = false;

        if (this.pendingDiceResults.length === 0) return;

        const fragment = document.createDocumentFragment();
        const batch = this.pendingDiceResults.splice(0, 10);

        batch.sort((a, b) => a.timestamp - b.timestamp);

        batch.forEach(({ result, diceResults, customDiceTypes }) => {
            const resultDiv = this.createDiceResultElement(result, diceResults, customDiceTypes);
            fragment.appendChild(resultDiv);
        });

        if (batch.length > 0) {
            const diceResults = batch[0].diceResults;
            const firstChild = diceResults.firstChild;
            if (firstChild) {
                diceResults.insertBefore(fragment, firstChild);
            } else {
                diceResults.appendChild(fragment);
            }
            diceResults.scrollTop = diceResults.scrollHeight;

            const maxResults = window.CONSTANTS.LIMITS.MAX_DICE_RESULTS_DISPLAY;
            if (diceResults.children.length > maxResults) {
                const toRemove = diceResults.children.length - maxResults;
                for (let i = 0; i < toRemove; i++) {
                    if (diceResults.firstChild) {
                        diceResults.removeChild(diceResults.firstChild);
                    }
                }
            }
        }
    }

    addDiceResultToDisplay(result, diceResults, customDiceTypes) {
        if (!result || !diceResults) {
            console.warn('addDiceResultToDisplay: parametri non validi');
            return;
        }
        this.scheduleDiceResultRender(result, diceResults, customDiceTypes);
    }

    createDiceResultElement(result, diceResults, customDiceTypes) {
        if (!result || !result.results) {
            console.warn('createDiceResultElement: result non valido');
            return document.createElement('div');
        }

        const resultDiv = document.createElement('div');
        resultDiv.className = 'dice-result';
        resultDiv.style.backgroundColor = result.color || '#666';

        const safePlayerName = this.validator.escapeHtml(result.playerName || 'Anonimo');
        let content = `<div class="player-name" style="padding:2px; color: #fff;">🐺 ${safePlayerName}</div>`;
        content += `<div class="dice-details">`;

        const triggeredEffects = [];
        const allEffects = (this.effectsEngine && Array.isArray(result.results)) ?
            this.effectsEngine.checkForEffects(result.results, result.presetRules) : null;

        const diceEffectsMap = new Map();
        if (allEffects && Array.isArray(allEffects) && allEffects.length > 0) {
            allEffects.forEach(effect => {
                if (!effect) return;
                if (effect.matchedDiceIndices && Array.isArray(effect.matchedDiceIndices)) {
                    effect.matchedDiceIndices.forEach(idx => {
                        if (!diceEffectsMap.has(idx)) {
                            diceEffectsMap.set(idx, []);
                        }
                        diceEffectsMap.get(idx).push(effect);
                    });
                }
            });
        }

        if (Array.isArray(result.results)) {
            result.results.forEach((dice, index) => {
                if (!dice) return;

                const colorEmoji = this.getColorEmoji(dice.color);

            if (dice.type === 'custom') {
                const diceEmoji = dice.emoji || '';
                content += `${colorEmoji}${diceEmoji ? diceEmoji + ' ' : ''}${dice.displayName} = <strong>${dice.value}</strong><br>`;
            } else if (dice.type === 'array') {
                const diceEmoji = dice.emoji || '';
                content += `${colorEmoji}${diceEmoji ? diceEmoji + ' ' : ''}${dice.displayName} = <strong>${dice.value}</strong><br>`;
            } else {
                let resultClass = '';
                let effectEmoji = '';
                let customStyle = '';

                if (diceEffectsMap.has(index)) {
                    const diceEffects = diceEffectsMap.get(index);
                    const styles = [];

                    diceEffects.forEach(effect => {
                        effectEmoji += ' ' + (effect.config.emoji || '');

                        if (effect.config.effectType === 'custom') {
                            styles.push(`font-weight: 700`);
                            if (effect.config.diceColor) {
                                styles.push(`color: ${effect.config.diceColor}`);
                            }
                            if (effect.config.diceBgColor &&
                                effect.config.diceBgColor !== 'transparent' &&
                                effect.config.diceBgColor !== '#transparent' &&
                                effect.config.diceBgColor !== '' &&
                                effect.config.diceBgColor !== 'rgba(0,0,0,0)') {
                                styles.push(`background: ${effect.config.diceBgColor}`);
                                styles.push(`padding: 2px 6px`);
                                styles.push(`border-radius: 4px`);
                            }
                        } else {
                            if (effect.config.diceColor) {
                                styles.push(`color: ${effect.config.diceColor}`);
                            }
                            if (effect.config.diceBgColor &&
                                effect.config.diceBgColor !== 'transparent' &&
                                effect.config.diceBgColor !== '#transparent' &&
                                effect.config.diceBgColor !== '' &&
                                effect.config.diceBgColor !== 'rgba(0,0,0,0)') {
                                styles.push(`background: ${effect.config.diceBgColor}`);
                                styles.push(`padding: 2px 6px`);
                                styles.push(`border-radius: 4px`);
                            }
                        }

                        if (effect.type === 'failure') {
                            resultClass = 'fumble-value';
                        } else if (effect.type === 'success' && resultClass !== 'fumble-value') {
                            resultClass = 'critical-value';
                        }
                    });

                    if (styles.length > 0) {
                        customStyle = ` style="${styles.join('; ')}"`;
                    }
                }

                content += `${colorEmoji} D${dice.sides} = <strong class="${resultClass}"${customStyle}>${dice.value}${effectEmoji}</strong><br>`;
            }
            });
        }

        content += `</div>`;

        if (allEffects && allEffects.length > 0) {
            allEffects.forEach(effect => {
                triggeredEffects.push({ effect });
            });
        }

        const numericResults = Array.isArray(result.results) ?
            result.results.filter(dice => dice && dice.type === 'numeric') : [];
        if (numericResults.length > 0) {
            const total = numericResults.reduce((sum, dice) => sum + (dice.value || 0), 0);
            const modifierInput = document.getElementById('diceModifier');
            const modifier = modifierInput ? (parseInt(modifierInput.value) || 0) : 0;
            const totalWithMod = total + modifier;
            const modSign = modifier >= 0 ? '+' + modifier : modifier;
            content += `<div class="total">Totale = ${total}${modSign} = <strong>${totalWithMod}</strong></div>`;
        }

        resultDiv.innerHTML = content;

        const hasCritical = triggeredEffects.some(e => e.effect.type === 'success');
        const hasFumble = triggeredEffects.some(e => e.effect.type === 'failure');

        if (hasCritical && !hasFumble) {
            resultDiv.classList.add('critical-result');
        } else if (hasFumble && !hasCritical) {
            resultDiv.classList.add('fumble-result');
        }

        if (triggeredEffects.length > 0 && this.effectsEngine && resultDiv) {
            const effectKey = `${result.localTimestamp || result.timestamp}_${result.playerId || 'unknown'}`;
            const baseDelay = window.CONSTANTS.TIMING.EFFECT_DELAY_MS || 300;

            let effectDelay = baseDelay;
            if (this.effectDebounceMap.has(effectKey)) {
                effectDelay = baseDelay + 50;
            } else {
                this.effectDebounceMap.set(effectKey, true);
                setTimeout(() => this.effectDebounceMap.delete(effectKey), 2000);
            }

            setTimeout(() => {
                triggeredEffects.forEach(({ effect }, index) => {
                    if (!effect || !effect.config) return;

                    setTimeout(() => {
                        if (this.effectsEngine && resultDiv) {
                            this.effectsEngine.applyEffects(resultDiv, effect.config);
                        }

                        const yOffset = window.CONSTANTS.UI.EFFECT_Y_OFFSET_BASE - (index * window.CONSTANTS.UI.EFFECT_Y_OFFSET_STAGGER);

                        if (effect.config.effectType === 'custom' && effect.config.customText) {
                            this.effectsEngine.showTextEffectWithOffset(resultDiv, null, null, yOffset, effect.config);
                        } else if (effect.config.text || effect.config.emoji) {
                            this.effectsEngine.showTextEffectWithOffset(resultDiv, effect.config.text, effect.config.emoji, yOffset);
                        }
                    }, index * window.CONSTANTS.TIMING.EFFECT_STAGGER_MS);
                });
            }, effectDelay);
        }

        return resultDiv;
    }

    scheduleChatMessageRender(message, chatMessages) {
        this.pendingChatMessages.push({ message, chatMessages, timestamp: Date.now() });

        if (!this.chatRenderScheduled) {
            this.chatRenderScheduled = true;
            requestAnimationFrame(() => this.flushChatMessages());
        }
    }

    flushChatMessages() {
        this.chatRenderScheduled = false;

        if (this.pendingChatMessages.length === 0) return;

        const fragment = document.createDocumentFragment();
        const batch = this.pendingChatMessages.splice(0, 10);

        batch.sort((a, b) => a.timestamp - b.timestamp);

        batch.forEach(({ message, chatMessages }) => {
            const messageDiv = this.createChatMessageElement(message);
            fragment.appendChild(messageDiv);
        });

        if (batch.length > 0) {
            const chatMessages = batch[0].chatMessages;
            const firstChild = chatMessages.firstChild;
            if (firstChild) {
                chatMessages.insertBefore(fragment, firstChild);
            } else {
                chatMessages.appendChild(fragment);
            }

            const maxMessages = window.CONSTANTS.LIMITS.MAX_CHAT_MESSAGES;
            if (chatMessages.children.length > maxMessages) {
                const toRemove = chatMessages.children.length - maxMessages;
                for (let i = 0; i < toRemove; i++) {
                    if (chatMessages.lastChild) {
                        chatMessages.removeChild(chatMessages.lastChild);
                    }
                }
            }
        }
    }

    addChatMessage(message, chatMessages) {
        if (!message || !chatMessages) {
            console.warn('addChatMessage: parametri non validi');
            return;
        }
        this.scheduleChatMessageRender(message, chatMessages);
    }

    createChatMessageElement(message) {
        if (!message) {
            console.warn('createChatMessageElement: message non valido');
            return document.createElement('div');
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = 'chat-message';
        messageDiv.style.backgroundColor = message.color || '#666';

        let time = '--:--';
        try {
            time = new Date(message.timestamp).toLocaleTimeString('it-IT', {
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (error) {
            console.warn('Errore formato timestamp:', error);
        }

        const safePlayerName = this.validator.escapeHtml(message.playerName || 'Anonimo');
        const safeText = this.validator.escapeHtml(message.text || '');

        messageDiv.innerHTML = `
            <div class="message-header">
                <span class="message-author" style="padding:2px; color: #fff;">🐺 ${safePlayerName}</span>
                <span class="message-time">${time}</span>
            </div>
            <div class="message-text">${safeText}</div>
        `;

        return messageDiv;
    }

    getColorEmoji(color) {
        if (this.colorTypesRegistry) {
            return this.colorTypesRegistry.getColorEmoji(color);
        }
        return window.CONSTANTS.DICE_COLOR_EMOJIS[color] || '';
    }

    showNotification(message, type = 'info') {
        if (!message) return;

        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;

        const colors = window.CONSTANTS.NOTIFICATION_COLORS;

        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: linear-gradient(135deg, ${colors[type]}, rgba(255,255,255,0.1));
            color: ${type === 'warning' ? 'var(--midnight-blue)' : 'white'};
            padding: 1rem 1.5rem;
            border-radius: var(--radius);
            box-shadow: var(--shadow-deep);
            z-index: 1000;
            font-weight: 600;
            animation: slideInNotification 0.3s ease-out;
            backdrop-filter: blur(10px);
            border: 2px solid ${colors[type]};
        `;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideOutNotification 0.3s ease-in forwards';
            setTimeout(() => {
                if (notification.parentNode === document.body) {
                    document.body.removeChild(notification);
                }
            }, window.CONSTANTS.TIMING.NOTIFICATION_FADE_MS);
        }, window.CONSTANTS.TIMING.NOTIFICATION_DURATION_MS);
    }
}

window.UIRenderer = UIRenderer;
