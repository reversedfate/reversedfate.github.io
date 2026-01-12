// Main entry point for D&D Battle Simulator
import { gameState } from './modules/config.js';
import { initArena } from './modules/arena.js';
import { initUI, updateUI, toggleDrawer } from './modules/ui.js';
import { addCreature } from './modules/creatures.js';

// Set DEBUG to true for verbose logging
const DEBUG = true;

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    console.log('[INIT] D&D Battle Simulator loading...');
    
    if (DEBUG) console.log('[DEBUG] Setting up global resize function');
    
    // Make resizeArena available globally to avoid circular imports
    window.resizeArena = resizeArena;
    
    // Initialize the arena
    if (DEBUG) console.log('[DEBUG] Initializing arena');
    initArena();
    
    // Initialize UI
    if (DEBUG) console.log('[DEBUG] Initializing UI');
    initUI();
    
    // Ensure dice drawer exists at startup
    if (DEBUG) {
        console.log('[DEBUG] Ensuring dice roller drawer exists at startup');
        
        // Import toggleDrawer without using await - a simpler approach
        import('./modules/ui.js').then(uiModule => {
            // Make sure dice drawer exists
            if (typeof uiModule.toggleDrawer === 'function') {
                // Just access it first without opening
                setTimeout(() => {
                    uiModule.toggleDrawer('diceRollerDrawer');
                    // Close it immediately
                    setTimeout(() => {
                        uiModule.toggleDrawer('diceRollerDrawer');
                    }, 100);
                }, 500);
            }
            
            // Make toggle function available in console for debugging
            window.openDiceDrawer = function() {
                console.log('[DEBUG] Manual trigger to open dice drawer');
                if (typeof uiModule.toggleDrawer === 'function') {
                    uiModule.toggleDrawer('diceRollerDrawer');
                } else {
                    console.error('[ERROR] toggleDrawer function not found!');
                }
            };
            
            // Add simple direct toggle function for browser console
            window.toggleDiceDrawer = function() {
                const drawer = document.getElementById('diceRollerDrawer');
                if (drawer) {
                    drawer.classList.toggle('open');
                    console.log('Toggled dice drawer open class. Now:', drawer.classList.contains('open'));
                } else {
                    console.error('Dice drawer element not found in DOM!');
                }
            };
        });
        
        // Add a direct global access to the dice drawer button for debugging
        window.debugDiceDrawer = function() {
            console.log('[DEBUG] Direct debug of dice drawer elements');
            console.log('Dice button:', document.getElementById('btnDiceRoller'));
            console.log('Dice drawer:', document.getElementById('diceRollerDrawer'));
            
            // Force toggle with direct DOM manipulation
            const drawer = document.getElementById('diceRollerDrawer');
            if (drawer) {
                console.log('Current drawer class:', drawer.className);
                if (drawer.classList.contains('open')) {
                    drawer.classList.remove('open');
                    console.log('Removed open class');
                } else {
                    drawer.classList.add('open');
                    console.log('Added open class');
                }
            }
        };
    }
    
    // Add random creatures for initial setup
    if (gameState.creatures.length === 0) {
        if (DEBUG) console.log('[DEBUG] Adding random creatures for initial setup');
        addRandomCreatures();
    }
    
    console.log('[INIT] D&D Battle Simulator loaded!');
});

// Re-export arena resize to make it globally available
function resizeArena() {
    if (DEBUG) console.log('[DEBUG] Global resize called');
    // This will be replaced by the actual resizeArena function from arena.js
    if (typeof window._resizeArena === 'function') {
        window._resizeArena();
    }
}

// List of predefined creatures for random selection
const creatureTemplates = [
    { name: "Fighter", type: "Humanoid", hp: 25, ac: 17, attackBonus: 5, damageBonus: 3, damageDice: "1d8" },
    { name: "Ranger", type: "Humanoid", hp: 18, ac: 15, attackBonus: 4, damageBonus: 2, damageDice: "1d8" },
    { name: "Wizard", type: "Humanoid", hp: 15, ac: 12, attackBonus: 6, damageBonus: 4, damageDice: "1d10" },
    { name: "Cleric", type: "Humanoid", hp: 22, ac: 16, attackBonus: 3, damageBonus: 1, damageDice: "1d6" },
    { name: "Goblin", type: "Humanoid", hp: 7, ac: 15, attackBonus: 4, damageBonus: 2, damageDice: "1d6" },
    { name: "Orc", type: "Humanoid", hp: 15, ac: 13, attackBonus: 5, damageBonus: 3, damageDice: "1d12" },
    { name: "Wolf", type: "Beast", hp: 11, ac: 13, attackBonus: 4, damageBonus: 2, damageDice: "2d4" },
    { name: "Skeleton", type: "Undead", hp: 13, ac: 13, attackBonus: 4, damageBonus: 2, damageDice: "1d6" },
    { name: "Zombie", type: "Undead", hp: 22, ac: 8, attackBonus: 3, damageBonus: 1, damageDice: "1d6" },
    { name: "Ghost", type: "Undead", hp: 45, ac: 11, attackBonus: 5, damageBonus: 4, damageDice: "4d6" },
    { name: "Dragon Wyrmling", type: "Dragon", hp: 33, ac: 17, attackBonus: 5, damageBonus: 3, damageDice: "2d6" },
    { name: "Ogre", type: "Giant", hp: 59, ac: 11, attackBonus: 6, damageBonus: 4, damageDice: "2d8" },
    { name: "Troll", type: "Giant", hp: 84, ac: 15, attackBonus: 7, damageBonus: 4, damageDice: "2d6" },
    { name: "Bandit", type: "Humanoid", hp: 11, ac: 12, attackBonus: 3, damageBonus: 1, damageDice: "1d6" },
    { name: "Giant Rat", type: "Beast", hp: 7, ac: 12, attackBonus: 4, damageBonus: 0, damageDice: "1d4" }
];

// Add random creatures for initial setup
function addRandomCreatures() {
    console.log('[SETUP] Adding random creatures to the battle');
    
    // Team 1 creatures (3-5 creatures randomly positioned)
    const team1Count = Math.floor(Math.random() * 3) + 3; // 3-5 creatures
    
    for (let i = 0; i < team1Count; i++) {
        // Select random creature template
        const template = creatureTemplates[Math.floor(Math.random() * creatureTemplates.length)];
        
        // Generate random position in the left part of the arena
        const x = Math.floor(Math.random() * (gameState.arenaWidth / 3));
        const y = Math.floor(Math.random() * gameState.arenaHeight);
        
        // Add creature with a numbered name
        addCreature(
            `${template.name} ${i+1}`, 
            template.type, 
            "Team 1", 
            template.hp, 
            template.ac, 
            x, y, 
            Math.floor(Math.random() * 20) + 1, // Random initiative
            template.attackBonus, 
            template.damageBonus, 
            template.damageDice
        );
        
        console.log(`[SETUP] Added ${template.name} ${i+1} to Team 1 at position (${x}, ${y})`);
    }
    
    // Team 2 creatures (3-5 creatures randomly positioned)
    const team2Count = Math.floor(Math.random() * 3) + 3; // 3-5 creatures
    
    for (let i = 0; i < team2Count; i++) {
        // Select random creature template
        const template = creatureTemplates[Math.floor(Math.random() * creatureTemplates.length)];
        
        // Generate random position in the right part of the arena
        const x = Math.floor(Math.random() * (gameState.arenaWidth / 3)) + (gameState.arenaWidth * 2/3);
        const y = Math.floor(Math.random() * gameState.arenaHeight);
        
        // Add creature with a numbered name
        addCreature(
            `${template.name} ${i+1}`, 
            template.type, 
            "Team 2", 
            template.hp, 
            template.ac, 
            x, y, 
            Math.floor(Math.random() * 20) + 1, // Random initiative
            template.attackBonus, 
            template.damageBonus, 
            template.damageDice
        );
        
        console.log(`[SETUP] Added ${template.name} ${i+1} to Team 2 at position (${x}, ${y})`);
    }
}