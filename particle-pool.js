class ParticlePool {
    constructor(maxSize = window.CONSTANTS?.LIMITS?.PARTICLE_POOL_SIZE || 100) {
        this.pool = [];
        this.maxSize = maxSize;
        this.activeParticles = new Set();
    }

    getParticle() {
        let particle;

        if (this.pool.length > 0) {
            particle = this.pool.pop();
        } else if (this.activeParticles.size < this.maxSize * 2) {
            particle = document.createElement('div');
            particle.className = 'effect-particle';
        } else {
            console.warn('ParticlePool: limite massimo raggiunto');
            particle = document.createElement('div');
            particle.className = 'effect-particle';
        }

        this.activeParticles.add(particle);
        return particle;
    }

    releaseParticle(particle) {
        if (!particle || !this.activeParticles.has(particle)) {
            return;
        }

        this.activeParticles.delete(particle);

        setTimeout(() => {
            try {
                if (particle.parentNode) {
                    particle.parentNode.removeChild(particle);
                }

                particle.style.cssText = '';
                particle.className = 'effect-particle';

                if (this.pool.length < this.maxSize) {
                    this.pool.push(particle);
                }
            } catch (error) {
                console.warn('Errore rilascio particella:', error);
            }
        }, 50);
    }

    cleanup() {
        this.activeParticles.forEach(particle => {
            try {
                if (particle && particle.parentNode) {
                    particle.parentNode.removeChild(particle);
                }
            } catch (error) {
                console.warn('Errore cleanup particella:', error);
            }
        });

        this.activeParticles.clear();
        this.pool = [];
    }

    getStats() {
        return {
            pooled: this.pool.length,
            active: this.activeParticles.size,
            total: this.pool.length + this.activeParticles.size
        };
    }
}

window.ParticlePool = ParticlePool;
