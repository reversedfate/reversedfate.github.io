// Utility functions for D&D Battle Simulator
import { calculateDistance } from './common.js';

// Re-export calculateDistance to avoid circular dependencies
export { calculateDistance };

// Roll a d20
export function rollD20() {
    return Math.floor(Math.random() * 20) + 1;
}

// Roll any dice (format: "2d6+3")
export function rollDice(diceString) {
    const regex = /(\d+)d(\d+)(?:\+(\d+))?/;
    const match = diceString.match(regex);
    
    if (match) {
        const numDice = parseInt(match[1]);
        const dieType = parseInt(match[2]);
        const bonus = match[3] ? parseInt(match[3]) : 0;
        
        let total = bonus;
        const rolls = [];
        
        for (let i = 0; i < numDice; i++) {
            const roll = Math.floor(Math.random() * dieType) + 1;
            rolls.push(roll);
            total += roll;
        }
        
        return {
            total,
            rolls,
            bonus,
            formula: diceString
        };
    }
    
    return { total: 0, rolls: [], bonus: 0, formula: diceString };
}

// Log a message to the combat log
export function logMessage(message, type = 'normal') {
    const logContainer = document.getElementById('logContainer');
    if (!logContainer) return;
    
    const log = document.createElement('div');
    log.classList.add('log-entry');
    log.classList.add(`log-${type}`);
    log.textContent = message;
    
    logContainer.appendChild(log);
    logContainer.scrollTop = logContainer.scrollHeight;
    
    // Update log badge
    updateLogBadge();
}

// Update log badge count
function updateLogBadge() {
    const badge = document.getElementById('logBadge');
    if (!badge) return;
    
    const count = document.querySelectorAll('.log-entry').length;
    badge.textContent = count;
    
    if (count > 0) {
        badge.style.display = 'block';
    }
}

// Find closest creature to a source creature from a list
export function findClosestCreature(source, creatureList) {
    let closest = null;
    let minDistance = Infinity;
    
    creatureList.forEach(creature => {
        const distance = calculateDistance(source.x, source.y, creature.x, creature.y);
        if (distance < minDistance) {
            minDistance = distance;
            closest = creature;
        }
    });
    
    return closest;
}