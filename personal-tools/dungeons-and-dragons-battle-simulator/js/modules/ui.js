// UI management for D&D Battle Simulator
import { gameState } from './config.js';
import { logMessage, rollDice as rollDiceUtil, rollD20 } from './utils.js';
import { showMoveRange, getCreatureAt, highlightCell, clearHighlights } from './arena.js';
import { moveCreature, addCreature } from './creatures.js';
import { handleActionSelect, startCombat, nextTurn, endCombat, resetCombat, handleAI, updateInitiativeList } from './combat.js';
import { eventBus } from './common.js';

// Active drawer
let activeDrawer = null;

// Initialize UI elements and event listeners
export function initUI() {
    // FAB control buttons
    initFabControls();
    
    // Initialize drawers
    initDrawers();
    
    // Initialize settings
    initSettings();
    
    // Initialize combat controls
    initCombatControls();
    
    // Initialize creature import
    initCreatureImport();
    
    // Initialize dice roller
    initDiceRoller();
    
    // Setup keyboard controls
    initKeyboardControls();
    
    // Setup grid cell event listeners
    initGridListeners();
    
    // Listen for grid updates
    document.addEventListener('grid-updated', initGridListeners);
    
    // Make updateUI globally available
    window.updateUI = updateUI;
    
    // Ensure target selection modal is hidden initially
    const targetModal = document.getElementById('targetSelectionModal');
    if (targetModal) {
        targetModal.classList.add('hidden');
    }
}

// Update UI elements based on current state
export function updateUI() {
    // Update action buttons based on available actions
    if (gameState.activeCreature) {
        document.querySelectorAll('.action-btn').forEach(btn => {
            const action = btn.dataset.action;
            
            // Disable action buttons if action used
            if (action !== 'move' && !gameState.activeCreature.hasAction) {
                btn.disabled = true;
                btn.classList.add('disabled');
            } else if (action === 'move' && gameState.activeCreature.remainingMove <= 0) {
                btn.disabled = true;
                btn.classList.add('disabled');
            } else {
                btn.disabled = false;
                btn.classList.remove('disabled');
            }
        });
        
        // Update movement display
        const movementDisplay = document.getElementById('movement-remaining');
        if (movementDisplay) {
            movementDisplay.textContent = 
                `${gameState.activeCreature.remainingMove}/${gameState.activeCreature.speed}ft`;
        }
        
        // Show active creature stats
        const creatureInfoDisplay = document.getElementById('active-creature-info');
        if (creatureInfoDisplay) {
            creatureInfoDisplay.innerHTML = `
                <strong>${gameState.activeCreature.name}</strong> (${gameState.activeCreature.team})<br>
                HP: ${gameState.activeCreature.hp}/${gameState.activeCreature.maxHp} | AC: ${gameState.activeCreature.ac}
            `;
        }
    } else {
        // No active creature
        document.querySelectorAll('.action-btn').forEach(btn => {
            btn.disabled = true;
            btn.classList.add('disabled');
        });
        
        const movementDisplay = document.getElementById('movement-remaining');
        if (movementDisplay) {
            movementDisplay.textContent = '0/0ft';
        }
        
        const creatureInfoDisplay = document.getElementById('active-creature-info');
        if (creatureInfoDisplay) {
            creatureInfoDisplay.textContent = 'No active creature';
        }
    }
    
    // Update initiative list
    updateInitiativeList();
}

// Toggle a drawer open/closed
export function toggleDrawer(drawerId) {
    const drawer = document.getElementById(drawerId);
    if (!drawer) {
        console.error(`Drawer with id ${drawerId} not found`);
        return;
    }
    
    if (activeDrawer && activeDrawer !== drawerId) {
        // Close the currently active drawer
        const currentDrawer = document.getElementById(activeDrawer);
        if (currentDrawer) {
            currentDrawer.classList.remove('open');
        }
    }
    
    // Toggle the requested drawer
    drawer.classList.toggle('open');
    
    // Update active drawer reference
    if (drawer.classList.contains('open')) {
        activeDrawer = drawerId;
        document.body.classList.add('drawer-open');
    } else {
        activeDrawer = null;
        document.body.classList.remove('drawer-open');
    }
}

// Close all open drawers
function closeAllDrawers() {
    if (!activeDrawer) return;
    
    const drawer = document.getElementById(activeDrawer);
    if (drawer) {
        drawer.classList.remove('open');
    }
    
    activeDrawer = null;
    document.body.classList.remove('drawer-open');
}

// Initialize grid cell event listeners
function initGridListeners() {
    // Remove existing event listeners first (to prevent duplicates)
    const cells = document.querySelectorAll('.grid-cell');
    cells.forEach(cell => {
        // Clone the cell to remove all event listeners
        const newCell = cell.cloneNode(true);
        cell.parentNode.replaceChild(newCell, cell);
    });
    
    // Add new event listeners
    document.querySelectorAll('.grid-cell').forEach(cell => {
        cell.addEventListener('click', handleCellClick);
        const x = parseInt(cell.getAttribute('data-x'));
        const y = parseInt(cell.getAttribute('data-y'));
        cell.addEventListener('mouseenter', () => handleCellHover(x, y));
        cell.addEventListener('mouseleave', () => clearCellHover());
    });
}

// Handle cell click events
export function handleCellClick(event) {
    const x = parseInt(event.target.getAttribute('data-x'));
    const y = parseInt(event.target.getAttribute('data-y'));
    
    if (gameState.selectedAction === 'move' && gameState.activeCreature) {
        moveCreature(gameState.activeCreature, x, y);
    } else if (gameState.selectedAction === 'place' && !getCreatureAt(x, y)) {
        // Show add creature form at the selected position
        const xInput = document.getElementById('creature-x');
        const yInput = document.getElementById('creature-y');
        if (xInput && yInput) {
            xInput.value = x;
            yInput.value = y;
            showAddCreatureForm();
        }
    }
}

// Handle cell hover
export function handleCellHover(x, y) {
    gameState.hoveredCell = { x, y };
    
    if (gameState.activeCreature && gameState.selectedAction === 'move') {
        showMoveRange(gameState.activeCreature, x, y);
    }
}

// Clear cell hover effects
export function clearCellHover() {
    gameState.hoveredCell = null;
    // Clear range indicators
    const rangeIndicator = document.getElementById('range-indicators');
    if (rangeIndicator) {
        rangeIndicator.innerHTML = '';
    }
}

// Initialize FAB controls
function initFabControls() {
    // Settings button
    const btnSettings = document.getElementById('btnSettings');
    if (btnSettings) {
        btnSettings.addEventListener('click', () => toggleDrawer('settingsDrawer'));
    }
    
    // Logs button
    const btnLogs = document.getElementById('btnLogs');
    if (btnLogs) {
        btnLogs.addEventListener('click', () => toggleDrawer('logDrawer'));
    }
    
    // Import button
    const btnImport = document.getElementById('btnImport');
    if (btnImport) {
        btnImport.addEventListener('click', () => toggleDrawer('importDrawer'));
    }
    
    // Combat button
    const btnCombat = document.getElementById('btnCombat');
    if (btnCombat) {
        btnCombat.addEventListener('click', () => toggleDrawer('combatDrawer'));
    }
    
    // Inspect button
    const btnInspect = document.getElementById('btnInspect');
    if (btnInspect) {
        btnInspect.addEventListener('click', () => toggleDrawer('inspectDrawer'));
    }
    
    // Dice Roller button
    const btnDiceRoller = document.getElementById('btnDiceRoller');
    if (btnDiceRoller) {
        btnDiceRoller.addEventListener('click', () => toggleDrawer('diceRollerDrawer'));
    }
}

// Initialize drawers
function initDrawers() {
    // Initialize drawer close functionality
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && activeDrawer) {
            closeAllDrawers();
        }
    });
    
    // Close drawer when clicking outside
    document.addEventListener('click', (e) => {
        if (activeDrawer && !e.target.closest(`#${activeDrawer}`) && !e.target.closest('#fabControls')) {
            closeAllDrawers();
        }
    });
    
    // Listen for drawer open events from other modules
    eventBus.on('open-drawer', (data) => {
        if (data && data.drawerId) {
            toggleDrawer(data.drawerId);
        }
    });
    
    // Make sure the dice roller drawer exists in DOM
    if (!document.getElementById('diceRollerDrawer')) {
        createDiceRollerDrawer();
    }
}

// Create dice roller drawer if it doesn't exist
function createDiceRollerDrawer() {
    console.log('[DEBUG] Creating dice roller drawer');
    const existingDrawer = document.getElementById('diceRollerDrawer');
    if (existingDrawer) {
        console.log('[DEBUG] Dice drawer already exists, not creating a new one');
        
        // Ensure it has the right styles
        existingDrawer.className = 'drawer'; 
        console.log('[DEBUG] Drawer classname set to:', existingDrawer.className);
        
        return;
    }
    
    const diceDrawer = document.createElement('div');
    diceDrawer.id = 'diceRollerDrawer';
    diceDrawer.className = 'drawer'; // Add the drawer class
    console.log('[DEBUG] Created new drawer with ID:', diceDrawer.id, 'and class:', diceDrawer.className);
    
    // Apply inline styles as a fallback
    diceDrawer.style.cssText = `
        position: fixed;
        top: 0;
        bottom: 0;
        right: 0;
        width: 300px;
        background: #333;
        color: white;
        border-left: 2px solid #888;
        box-shadow: -2px 0 8px rgba(0,0,0,0.4);
        padding: 10px;
        overflow-y: auto;
        z-index: 999;
        transform: translateX(100%);
        transition: transform 0.3s ease;
    `;
    
    diceDrawer.innerHTML = `
        <h3>Dice Roller</h3>
        <div id="diceControls">
            <div class="dice-row">
                <button class="dice-btn" data-dice="d4">d4</button>
                <input type="number" id="d4Count" value="1" min="1" max="20">
                <span class="dice-plus">+</span>
                <input type="number" id="d4Modifier" value="0" min="-20" max="20">
            </div>
            <div class="dice-row">
                <button class="dice-btn" data-dice="d6">d6</button>
                <input type="number" id="d6Count" value="1" min="1" max="20">
                <span class="dice-plus">+</span>
                <input type="number" id="d6Modifier" value="0" min="-20" max="20">
            </div>
            <div class="dice-row">
                <button class="dice-btn" data-dice="d8">d8</button>
                <input type="number" id="d8Count" value="1" min="1" max="20">
                <span class="dice-plus">+</span>
                <input type="number" id="d8Modifier" value="0" min="-20" max="20">
            </div>
            <div class="dice-row">
                <button class="dice-btn" data-dice="d10">d10</button>
                <input type="number" id="d10Count" value="1" min="1" max="20">
                <span class="dice-plus">+</span>
                <input type="number" id="d10Modifier" value="0" min="-20" max="20">
            </div>
            <div class="dice-row">
                <button class="dice-btn" data-dice="d12">d12</button>
                <input type="number" id="d12Count" value="1" min="1" max="20">
                <span class="dice-plus">+</span>
                <input type="number" id="d12Modifier" value="0" min="-20" max="20">
            </div>
            <div class="dice-row">
                <button class="dice-btn" data-dice="d20">d20</button>
                <input type="number" id="d20Count" value="1" min="1" max="20">
                <span class="dice-plus">+</span>
                <input type="number" id="d20Modifier" value="0" min="-20" max="20">
            </div>
            <div class="dice-row">
                <button class="dice-btn" data-dice="d100">d100</button>
                <input type="number" id="d100Count" value="1" min="1" max="20">
                <span class="dice-plus">+</span>
                <input type="number" id="d100Modifier" value="0" min="-20" max="20">
            </div>
            
            <div class="advantage-row">
                <label>
                    <input type="radio" name="advantage" value="normal" checked> Normal
                </label>
                <label>
                    <input type="radio" name="advantage" value="advantage"> Advantage
                </label>
                <label>
                    <input type="radio" name="advantage" value="disadvantage"> Disadvantage
                </label>
            </div>
            
            <div class="custom-roll">
                <input type="text" id="customDiceFormula" placeholder="e.g. 2d6+3" value="">
                <button id="rollCustom" class="combat-button">Roll Custom</button>
            </div>
        </div>
        
        <div id="diceResults">
            <h4>Results</h4>
            <div id="resultsList"></div>
        </div>
    `;
    
    document.body.appendChild(diceDrawer);
    console.log('[DEBUG] Dice drawer created and added to document.body');
    
    // Display it to check it's working
    setTimeout(() => {
        console.log('[DEBUG] Testing if dice drawer is in DOM:', !!document.getElementById('diceRollerDrawer'));
    }, 100);
}

// Initialize settings controls
function initSettings() {
    const applySettings = document.getElementById('applySettings');
    if (applySettings) {
        applySettings.addEventListener('click', applyArenaSettings);
    }
    
    // Populate custom URL field with stored value if any
    const customUrlField = document.getElementById('customToolsUrl');
    if (customUrlField && gameState.customToolsUrl) {
        customUrlField.value = gameState.customToolsUrl;
    }
}

// Apply arena settings
export function applyArenaSettings() {
    const gridSizeSel = document.getElementById('gridSizeSel');
    const arenaWidth = document.getElementById('arenaWidth');
    const arenaHeight = document.getElementById('arenaHeight');
    const customToolsUrl = document.getElementById('customToolsUrl');
    
    if (gridSizeSel && arenaWidth && arenaHeight) {
        // Update game state with new settings
        gameState.gridSize = parseInt(gridSizeSel.value) || 10;
        gameState.arenaWidth = parseInt(arenaWidth.value) || 20;
        gameState.arenaHeight = parseInt(arenaHeight.value) || 20;
        
        // Update custom tools URL if provided
        if (customToolsUrl) {
            // Trim any trailing slash to ensure consistency
            const url = customToolsUrl.value.trim().replace(/\/+$/, '');
            gameState.customToolsUrl = url;
            logMessage(url ? `Custom 5e.tools URL set to: ${url}` : "Using default 5e.tools URL");
        }
        
        // Trigger arena resize
        if (typeof window._resizeArena === 'function') {
            window._resizeArena();
        }
        
        logMessage(`Arena settings updated: ${gameState.arenaWidth}x${gameState.arenaHeight} grid, ${gameState.gridSize}ft squares`);
    }
}

// Set all creatures to AI control
export function setAllAI(enabled) {
    gameState.creatures.forEach(creature => {
        creature.isAI = enabled;
    });
    logMessage(`${enabled ? 'Enabled' : 'Disabled'} AI control for all creatures.`);
}

// Update combat buttons state
export function updateCombatButtons(enabled) {
    const nextTurnBtn = document.getElementById('next-turn');
    const endCombatBtn = document.getElementById('end-combat');
    const autoTurnBtn = document.getElementById('auto-turn');
    
    if (nextTurnBtn) nextTurnBtn.disabled = !enabled;
    if (endCombatBtn) endCombatBtn.disabled = !enabled;
    if (autoTurnBtn) autoTurnBtn.disabled = !enabled;
}

// Show add creature form
export function showAddCreatureForm() {
    const form = document.getElementById('creature-form-container');
    if (form) {
        form.style.display = 'block';
    }
}

// Initialize creature import
function initCreatureImport() {
    // This would contain code to initialize the creature import functionality
    // For now it's a placeholder as the implementation details aren't clear
    console.log('[DEBUG] Creature import initialized');
}

// Initialize dice roller
function initDiceRoller() {
    // This would contain code to initialize the dice roller functionality
    // For now it's a placeholder as the implementation details aren't clear
    console.log('[DEBUG] Dice roller initialized');
    
    // Add event listeners for dice buttons if they exist
    document.querySelectorAll('.dice-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const diceType = e.target.dataset.dice;
            const countInput = document.getElementById(`${diceType}Count`);
            const modifierInput = document.getElementById(`${diceType}Modifier`);
            
            if (diceType && countInput && modifierInput) {
                const count = parseInt(countInput.value) || 1;
                const modifier = parseInt(modifierInput.value) || 0;
                const formula = `${count}${diceType}+${modifier}`;
                
                // Roll the dice using the utility function
                const result = rollDiceUtil(formula);
                
                // Display result
                displayDiceResult(result);
            }
        });
    });
    
    // Add event listener for custom roll button
    const rollCustomBtn = document.getElementById('rollCustom');
    if (rollCustomBtn) {
        rollCustomBtn.addEventListener('click', () => {
            const formulaInput = document.getElementById('customDiceFormula');
            if (formulaInput && formulaInput.value) {
                const result = rollDiceUtil(formulaInput.value);
                displayDiceResult(result);
            }
        });
    }
}

// Display dice roll result
function displayDiceResult(result) {
    const resultsList = document.getElementById('resultsList');
    if (!resultsList) return;
    
    const resultItem = document.createElement('div');
    resultItem.classList.add('dice-result');
    resultItem.innerHTML = `
        <strong>${result.formula}:</strong> ${result.total}
        <span class="dice-details">
            [${result.rolls.join(', ')}] + ${result.bonus}
        </span>
    `;
    
    resultsList.prepend(resultItem);
    
    // Limit to last 10 results
    while (resultsList.children.length > 10) {
        resultsList.removeChild(resultsList.lastChild);
    }
}

// Initialize keyboard controls
function initKeyboardControls() {
    document.addEventListener('keydown', (e) => {
        // Only handle keyboard shortcuts when not in an input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        
        switch (e.key) {
            case 'n':
                // Next turn
                if (!e.ctrlKey && !e.altKey && !e.shiftKey) {
                    const nextTurnBtn = document.getElementById('next-turn');
                    if (nextTurnBtn && !nextTurnBtn.disabled) {
                        nextTurn();
                    }
                }
                break;
                
            case 'm':
                // Move action
                if (!e.ctrlKey && !e.altKey && !e.shiftKey) {
                    handleActionSelect('move');
                }
                break;
                
            case 'a':
                // Attack action
                if (!e.ctrlKey && !e.altKey && !e.shiftKey) {
                    handleActionSelect('attack');
                }
                break;
                
            // Add more keyboard shortcuts as needed
        }
    });
}

// Initialize combat controls
function initCombatControls() {
    // Start combat button
    const startCombatBtn = document.getElementById('start-combat');
    if (startCombatBtn) {
        startCombatBtn.addEventListener('click', () => {
            startCombat();
            updateCombatButtons(true);
        });
    }
    
    // Next turn button
    const nextTurnBtn = document.getElementById('next-turn');
    if (nextTurnBtn) {
        nextTurnBtn.addEventListener('click', nextTurn);
    }
    
    // End combat button
    const endCombatBtn = document.getElementById('end-combat');
    if (endCombatBtn) {
        endCombatBtn.addEventListener('click', () => {
            endCombat();
            updateCombatButtons(false);
        });
    }
    
    // Reset combat button
    const resetCombatBtn = document.getElementById('reset-combat');
    if (resetCombatBtn) {
        resetCombatBtn.addEventListener('click', () => {
            resetCombat();
            updateCombatButtons(false);
        });
    }
    
    // Auto-turn button for AI on current turn
    const autoTurnBtn = document.getElementById('auto-turn');
    if (autoTurnBtn) {
        autoTurnBtn.addEventListener('click', () => {
            if (gameState.activeCreature) {
                console.debug(`[AI] Auto-turn button clicked for ${gameState.activeCreature.name}`);
                
                // Store the original AI state
                const wasAI = gameState.activeCreature.isAI;
                
                // Temporarily set the creature to AI-controlled
                if (!wasAI) {
                    console.debug(`[AI] Temporarily enabling AI for ${gameState.activeCreature.name}`);
                    gameState.activeCreature.isAI = true;
                }
                
                // Run the AI turn
                handleAI();
                
                // Restore the original AI state if it was changed
                if (!wasAI) {
                    setTimeout(() => {
                        console.debug(`[AI] Restoring manual control for ${gameState.activeCreature.name}`);
                        gameState.activeCreature.isAI = false;
                    }, 1500);
                }
            } else {
                console.debug('[AI] No active creature, cannot run AI turn');
            }
        });
    }
    
    // Auto-all checkbox
    const autoAllCheck = document.getElementById('auto-all');
    if (autoAllCheck) {
        autoAllCheck.addEventListener('change', (e) => {
            if (e.target.checked) {
                logMessage("AI control enabled. Computer will play turns automatically.");
                
                // If it's already an AI turn, make it act
                if (gameState.activeCreature && gameState.activeCreature.isAI) {
                    handleAI();
                }
            } else {
                logMessage("AI control disabled. Use the Next Turn button to progress.");
            }
        });
    }
    
    // Set all creatures to AI control button
    const setAllAIBtn = document.getElementById('set-all-ai');
    if (setAllAIBtn) {
        setAllAIBtn.addEventListener('click', () => {
            setAllAI(true);
            
            // Update all creature renderings
            gameState.creatures.forEach(creature => {
                eventBus.emit('render-creature', { creature });
            });
            
            // Update initiative list to show AI status
            eventBus.emit('initiative-updated', { initiativeOrder: gameState.initiativeOrder });
            
            // Check auto-all checkbox
            const autoAllCheck = document.getElementById('auto-all');
            if (autoAllCheck) {
                autoAllCheck.checked = true;
            }
        });
    }
}