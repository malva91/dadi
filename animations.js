// Sistema di animazioni 3D e particelle

class DiceAnimations {
    constructor() {
        this.initSnowEffect();
        this.initAuroraEffect();
    }

    // Effetto neve
    initSnowEffect() {
        const snowContainer = document.createElement('div');
        snowContainer.id = 'snowContainer';
        snowContainer.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 1;
            overflow: hidden;
        `;
        document.body.appendChild(snowContainer);

        for (let i = 0; i < window.CONSTANTS.ANIMATIONS.SNOW_PARTICLE_COUNT; i++) {
            this.createSnowflake(snowContainer);
        }
    }

    createSnowflake(container) {
        const snowflake = document.createElement('div');
        snowflake.className = 'snowflake';
        const size = Math.random() * 4 + 1;
        const startX = Math.random() * 100;
        const duration = Math.random() * 15 + 20;
        const delay = Math.random() * 15;
        const opacity = Math.random() * 0.6 + 0.3;
        const drift = Math.random() * 50 - 25;

        snowflake.style.cssText = `
            position: absolute;
            width: ${size}px;
            height: ${size}px;
            background: radial-gradient(circle, rgba(255, 255, 255, ${opacity}) 0%, rgba(255, 255, 255, ${opacity * 0.5}) 100%);
            border-radius: 50%;
            top: -10px;
            left: ${startX}%;
            opacity: ${opacity};
            animation: snowfall${Math.floor(Math.random() * 3)} ${duration}s linear ${delay}s infinite;
            box-shadow: 0 0 ${size}px rgba(255, 255, 255, ${opacity * 0.8});
            filter: blur(${size > 2 ? 0.3 : 0}px);
        `;
        snowflake.style.setProperty('--drift', `${drift}px`);

        container.appendChild(snowflake);
    }

    // Effetto aurora nordica sottile
    initAuroraEffect() {
        const aurora = document.createElement('div');
        aurora.id = 'aurora';
        aurora.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 0;
            opacity: 0.08;
            background: linear-gradient(
                180deg,
                rgba(129, 161, 193, 0.15) 0%,
                rgba(94, 129, 172, 0.1) 50%,
                transparent 100%
            );
            animation: auroraShift 30s ease-in-out infinite;
        `;
        document.body.insertBefore(aurora, document.body.firstChild);
    }

    // Animazione dado rimossa - risultato immediato
    rollDice3D(element, finalValue, diceType) {
        return new Promise((resolve) => {
            resolve();
        });
    }

    // Sistema di particelle per risultati critici e fumble
    createParticleExplosion(x, y, type = 'critical') {
        let colors;

        if (type === 'critical') {
            colors = ['#FFD700', '#FFA500', '#FF6347', '#FFE66D'];
        } else if (type === 'fumble') {
            colors = ['#FF4444', '#CC0000', '#990000', '#8B0000'];
        } else {
            colors = ['#4169E1', '#1E90FF', '#00BFFF', '#87CEEB'];
        }

        const particleCount = window.CONSTANTS.ANIMATIONS.PARTICLE_EXPLOSION_COUNT;

        for (let i = 0; i < particleCount; i++) {
            this.createParticle(x, y, colors);
        }
    }

    createParticle(x, y, colors) {
        const particle = document.createElement('div');
        particle.className = 'particle';

        const size = Math.random() * 8 + 4;
        const color = colors[Math.floor(Math.random() * colors.length)];
        const angle = Math.random() * Math.PI * 2;
        const velocity = Math.random() * 150 + 50;
        const vx = Math.cos(angle) * velocity;
        const vy = Math.sin(angle) * velocity;
        const rotation = Math.random() * 360;
        const duration = Math.random() * 1000 + 500;

        particle.style.cssText = `
            position: fixed;
            width: ${size}px;
            height: ${size}px;
            background: ${color};
            border-radius: ${Math.random() > 0.5 ? '50%' : '0'};
            left: ${x}px;
            top: ${y}px;
            pointer-events: none;
            z-index: 10000;
            box-shadow: 0 0 ${size * 2}px ${color};
            transform: rotate(${rotation}deg);
        `;

        document.body.appendChild(particle);

        const startTime = performance.now();

        const animate = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = elapsed / duration;

            if (progress < 1) {
                const currentX = x + vx * (elapsed / 1000);
                const currentY = y + vy * (elapsed / 1000) + (0.5 * 500 * Math.pow(elapsed / 1000, 2));
                const opacity = 1 - progress;
                const scale = 1 - progress * 0.5;

                particle.style.left = `${currentX}px`;
                particle.style.top = `${currentY}px`;
                particle.style.opacity = opacity;
                particle.style.transform = `rotate(${rotation + progress * 720}deg) scale(${scale})`;

                requestAnimationFrame(animate);
            } else {
                particle.remove();
            }
        };

        requestAnimationFrame(animate);
    }

    // Animazione scintilla per dado singolo
    createSparkle(element) {
        const rect = element.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        for (let i = 0; i < window.CONSTANTS.ANIMATIONS.SPARKLE_COUNT; i++) {
            const sparkle = document.createElement('div');
            sparkle.className = 'sparkle';

            const angle = (Math.PI * 2 * i) / 8;
            const distance = 30;
            const endX = centerX + Math.cos(angle) * distance;
            const endY = centerY + Math.sin(angle) * distance;

            sparkle.style.cssText = `
                position: fixed;
                width: 3px;
                height: 3px;
                background: white;
                border-radius: 50%;
                left: ${centerX}px;
                top: ${centerY}px;
                pointer-events: none;
                z-index: 9999;
                box-shadow: 0 0 10px #fff, 0 0 20px #fff;
            `;

            document.body.appendChild(sparkle);

            sparkle.animate([
                {
                    left: `${centerX}px`,
                    top: `${centerY}px`,
                    opacity: 1,
                    transform: 'scale(1)'
                },
                {
                    left: `${endX}px`,
                    top: `${endY}px`,
                    opacity: 0,
                    transform: 'scale(0)'
                }
            ], {
                duration: 600,
                easing: 'ease-out'
            }).onfinish = () => sparkle.remove();
        }
    }

    // Effetto onde per transizioni
    createRipple(x, y) {
        const ripple = document.createElement('div');
        ripple.className = 'ripple-effect';

        ripple.style.cssText = `
            position: fixed;
            width: 20px;
            height: 20px;
            border: 2px solid rgba(127, 179, 211, 0.6);
            border-radius: 50%;
            left: ${x - 10}px;
            top: ${y - 10}px;
            pointer-events: none;
            z-index: 9998;
        `;

        document.body.appendChild(ripple);

        ripple.animate([
            {
                width: '20px',
                height: '20px',
                opacity: 1
            },
            {
                width: '200px',
                height: '200px',
                opacity: 0,
                left: `${x - 100}px`,
                top: `${y - 100}px`
            }
        ], {
            duration: 800,
            easing: 'ease-out'
        }).onfinish = () => ripple.remove();
    }
}

// Stili CSS per le animazioni
const animationStyles = `
@keyframes snowfall0 {
    0% {
        transform: translateY(-10px) translateX(0) rotate(0deg);
    }
    50% {
        transform: translateY(50vh) translateX(var(--drift)) rotate(180deg);
    }
    100% {
        transform: translateY(110vh) translateX(calc(var(--drift) * 0.5)) rotate(360deg);
    }
}

@keyframes snowfall1 {
    0% {
        transform: translateY(-10px) translateX(0) rotate(0deg);
    }
    33% {
        transform: translateY(33vh) translateX(calc(var(--drift) * -0.5)) rotate(120deg);
    }
    66% {
        transform: translateY(66vh) translateX(var(--drift)) rotate(240deg);
    }
    100% {
        transform: translateY(110vh) translateX(0) rotate(360deg);
    }
}

@keyframes snowfall2 {
    0% {
        transform: translateY(-10px) translateX(0) rotate(0deg);
    }
    40% {
        transform: translateY(40vh) translateX(calc(var(--drift) * 0.8)) rotate(144deg);
    }
    80% {
        transform: translateY(80vh) translateX(calc(var(--drift) * -0.3)) rotate(288deg);
    }
    100% {
        transform: translateY(110vh) translateX(var(--drift)) rotate(360deg);
    }
}

@keyframes auroraShift {
    0% {
        transform: translateY(0) scaleY(1);
        opacity: 0.08;
    }
    50% {
        transform: translateY(-10px) scaleY(1.05);
        opacity: 0.12;
    }
    100% {
        transform: translateY(0) scaleY(1);
        opacity: 0.08;
    }
}

.particle {
    will-change: transform, opacity;
}

.sparkle {
    will-change: left, top, opacity, transform;
}

.ripple-effect {
    will-change: width, height, opacity, left, top;
}

/* Transizioni fluide per schermate */
.screen {
    transition: opacity 0.5s ease-in-out, transform 0.5s ease-in-out;
}

.screen:not(.active) {
    opacity: 0;
    transform: scale(0.95);
}

.screen.active {
    opacity: 1;
    transform: scale(1);
}

/* Animazioni 3D per dadi */
@keyframes dice3DRoll {
    0% {
        transform: rotateX(0) rotateY(0) rotateZ(0);
    }
    25% {
        transform: rotateX(180deg) rotateY(90deg) rotateZ(45deg);
    }
    50% {
        transform: rotateX(360deg) rotateY(180deg) rotateZ(90deg);
    }
    75% {
        transform: rotateX(540deg) rotateY(270deg) rotateZ(135deg);
    }
    100% {
        transform: rotateX(720deg) rotateY(360deg) rotateZ(180deg);
    }
}

.dice-rolling {
    animation: dice3DRoll 1s ease-out;
    transform-style: preserve-3d;
}

/* Glow per risultati critici */
@keyframes criticalGlow {
    0%, 100% {
        box-shadow: 0 0 10px rgba(255, 215, 0, 0.5),
                    0 0 20px rgba(255, 215, 0, 0.3),
                    inset 0 0 10px rgba(255, 215, 0, 0.2);
    }
    50% {
        box-shadow: 0 0 20px rgba(255, 215, 0, 0.8),
                    0 0 40px rgba(255, 215, 0, 0.5),
                    inset 0 0 20px rgba(255, 215, 0, 0.4);
    }
}

.critical-result {
    animation: criticalGlow 1.5s ease-in-out infinite;
}

/* Animazione per fumble */
@keyframes fumbleShake {
    0%, 100% { transform: translateX(0); }
    10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
    20%, 40%, 60%, 80% { transform: translateX(5px); }
}

.fumble-result {
    animation: fumbleShake 0.5s ease-in-out;
    border-left-color: #dc143c !important;
}

/* Stili per valori critici e fumble */
.critical-value {
    color: #FFD700 !important;
    font-size: 1.3em;
    text-shadow: 0 0 10px rgba(255, 215, 0, 0.8), 2px 2px 4px rgba(0, 0, 0, 0.9);
    animation: criticalPulse 0.5s ease-in-out;
}

.fumble-value {
    color: #FF4444 !important;
    font-size: 1.3em;
    text-shadow: 0 0 10px rgba(255, 68, 68, 0.8), 2px 2px 4px rgba(0, 0, 0, 0.9);
    animation: fumblePulse 0.5s ease-in-out;
}

@keyframes criticalPulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.2); }
}

@keyframes fumblePulse {
    0%, 100% { transform: scale(1); }
    25% { transform: scale(0.9) rotate(-5deg); }
    75% { transform: scale(0.9) rotate(5deg); }
}
`;

const styleSheet = document.createElement('style');
styleSheet.textContent = animationStyles;
document.head.appendChild(styleSheet);

window.DiceAnimations = DiceAnimations;
