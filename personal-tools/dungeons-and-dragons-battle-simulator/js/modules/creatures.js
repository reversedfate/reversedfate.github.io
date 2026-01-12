// Creature management for D&D Battle Simulator
import { gameState, getTeamColor } from './config.js';
import { calculateDistance, rollD20, rollDice, logMessage } from './utils.js';
import { eventBus } from './common.js';

// Add a new creature to the battle
export function addCreature(name, type, team, hp, ac, x, y, initiative, attackBonus, damageBonus, damageDice) {
    const creature = {
        id: Date.now(), // Unique ID
        name,
        type,
        team,
        hp: parseInt(hp),
        maxHp: parseInt(hp),
        ac: parseInt(ac),
        x: parseInt(x),
        y: parseInt(y),
        initiative: initiative || rollD20(),
        attackBonus: parseInt(attackBonus) || 0,
        damageBonus: parseInt(damageBonus) || 0,
        damageDice: damageDice || '1d6',
        speed: 30,
        remainingMove: 30,
        actions: ['attack', 'dash', 'dodge', 'disengage', 'help'],
        hasAction: true,
        hasBonusAction: true,
        hasReaction: true, // Add reaction tracking
        conditions: [],
        element: null,
        isDead: false, // Track dead state
        isAI: team === "Team 2" // Automatically set Team 2 creatures as AI controlled
    };
    
    gameState.creatures.push(creature);
    renderCreature(creature);
    addToInitiative(creature);
    
    // Log the addition
    logMessage(`${name} (${type}) joins the battle for ${team}!`);
    
    return creature;
}

// Render creature on grid
export function renderCreature(creature) {
    if (!creature) return;
    
    console.debug(`[Render] Rendering creature ${creature.name} at (${creature.x}, ${creature.y})`);
    
    // If creature already has an element, update it
    if (creature.element) {
        creature.element.setAttribute('transform', 
            `translate(${creature.x * gameState.gridSize}, ${creature.y * gameState.gridSize})`
        );
        
        // Update health indicator
        const healthIndicator = creature.element.querySelector('.health-indicator');
        if (healthIndicator) {
            const healthPercent = Math.max(0, Math.min(100, Math.floor(creature.hp / creature.maxHp * 100)));
            healthIndicator.setAttribute('stroke-dasharray', `${healthPercent} 100`);
        }
        
        // Update AI indicator
        let aiIndicator = creature.element.querySelector('.ai-indicator');
        if (creature.isAI) {
            if (!aiIndicator) {
                aiIndicator = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                aiIndicator.classList.add('ai-indicator');
                aiIndicator.setAttribute('x', gameState.gridSize / 2);
                aiIndicator.setAttribute('y', gameState.gridSize - 2);
                aiIndicator.setAttribute('text-anchor', 'middle');
                aiIndicator.setAttribute('font-size', Math.floor(gameState.gridSize / 3.5));
                aiIndicator.setAttribute('fill', '#00CFFF');
                aiIndicator.setAttribute('stroke', '#000');
                aiIndicator.setAttribute('stroke-width', '0.5px');
                aiIndicator.textContent = '🤖';
                creature.element.appendChild(aiIndicator);
            }
        } else if (aiIndicator) {
            aiIndicator.remove();
        }
        
        return;
    }
    
    // Create a group for the creature
    const creaturesLayer = document.getElementById('creatures-layer');
    if (!creaturesLayer) return;
    
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.classList.add('creature');
    group.setAttribute('transform', `translate(${creature.x * gameState.gridSize}, ${creature.y * gameState.gridSize})`);
    group.setAttribute('data-id', creature.id);
    
    // Create a circle for the creature
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', gameState.gridSize / 2);
    circle.setAttribute('cy', gameState.gridSize / 2);
    circle.setAttribute('r', gameState.gridSize / 2 - 2);
    circle.setAttribute('fill', getTeamColor(creature.team));
    circle.setAttribute('stroke', '#000');
    circle.setAttribute('stroke-width', '1');
    group.appendChild(circle);
    
    // Create health indicator (ring around creature)
    const healthRing = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    healthRing.classList.add('health-indicator');
    healthRing.setAttribute('cx', gameState.gridSize / 2);
    healthRing.setAttribute('cy', gameState.gridSize / 2);
    healthRing.setAttribute('r', gameState.gridSize / 2 - 4);
    healthRing.setAttribute('fill', 'none');
    healthRing.setAttribute('stroke', '#00FF00');
    healthRing.setAttribute('stroke-width', '2');
    
    // Calculate percentage of health
    const healthPercent = Math.max(0, Math.min(100, Math.floor(creature.hp / creature.maxHp * 100)));
    healthRing.setAttribute('stroke-dasharray', `${healthPercent} 100`);
    healthRing.setAttribute('transform', 'rotate(-90, ' + gameState.gridSize / 2 + ', ' + gameState.gridSize / 2 + ')');
    healthRing.style.transformOrigin = 'center';
    healthRing.style.transition = 'stroke-dasharray 0.3s ease';
    
    group.appendChild(healthRing);
    
    // Create a text label for the creature
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', gameState.gridSize / 2);
    label.setAttribute('y', gameState.gridSize / 2);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'middle');
    label.setAttribute('fill', '#fff');
    label.setAttribute('font-size', Math.floor(gameState.gridSize / 4));
    label.setAttribute('stroke', '#000');
    label.setAttribute('stroke-width', '0.5px');
    label.textContent = creature.name.split(' ')[0]; // First word only for display
    group.appendChild(label);
    
    // If AI controlled, add indicator
    if (creature.isAI) {
        const aiIndicator = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        aiIndicator.classList.add('ai-indicator');
        aiIndicator.setAttribute('x', gameState.gridSize / 2);
        aiIndicator.setAttribute('y', gameState.gridSize - 2);
        aiIndicator.setAttribute('text-anchor', 'middle');
        aiIndicator.setAttribute('font-size', Math.floor(gameState.gridSize / 3.5));
        aiIndicator.setAttribute('fill', '#00CFFF');
        aiIndicator.setAttribute('stroke', '#000');
        aiIndicator.setAttribute('stroke-width', '0.5px');
        aiIndicator.textContent = '🤖';
        group.appendChild(aiIndicator);
    }
    
    // Add event listeners for interactions
    setupCreatureEvents(creature, group);
    
    // Add to creatures layer
    creaturesLayer.appendChild(group);
    creature.element = group;
}

// Setup creature event listeners
function setupCreatureEvents(creature, groupElement) {
    console.log(`[DEBUG] Setting up events for creature: ${creature.name}`);
    
    // Add selection event for left click
    groupElement.addEventListener('click', (e) => {
        console.log(`[DEBUG] Creature clicked: ${creature.name}`);
        // Select this creature for inspection
        eventBus.emit('select-creature', { creature });
        
        // Open the inspect drawer automatically
        eventBus.emit('open-drawer', { drawerId: 'inspectDrawer' });
        
        e.stopPropagation();
    });
    
    // Add context menu for right click (edit options)
    groupElement.addEventListener('contextmenu', (e) => {
        console.log(`[DEBUG] Context menu for creature: ${creature.name}`);
        e.preventDefault();
        e.stopPropagation();
        
        // Create context menu
        showCreatureContextMenu(e, creature);
    });
    
    // Allow dragging creatures at any time before combat starts
    // or if it's the active creature during combat
    const canDrag = !gameState.roundNumber || 
                    (gameState.activeCreature && creature.id === gameState.activeCreature.id);
    
    if (canDrag) {
        groupElement.addEventListener('mousedown', (e) => {
            // Only handle left mouse button for dragging
            if (e.button === 0) {
                startDrag(e, creature);
            }
        });
    }
}

// Show context menu for creature editing
function showCreatureContextMenu(event, creature) {
    console.log(`[DEBUG] Showing context menu at ${event.clientX}, ${event.clientY}`);
    
    // Remove any existing context menus
    removeContextMenus();
    
    // Create context menu element
    const contextMenu = document.createElement('div');
    contextMenu.id = 'creatureContextMenu';
    contextMenu.className = 'context-menu';
    contextMenu.style.cssText = `
        position: fixed;
        top: ${event.clientY}px;
        left: ${event.clientX}px;
        background: #333;
        color: white;
        border: 1px solid #888;
        box-shadow: 0 2px 10px rgba(0,0,0,0.5);
        padding: 10px;
        border-radius: 5px;
        z-index: 1100;
        min-width: 150px;
    `;
    
    // Add menu title
    const menuTitle = document.createElement('div');
    menuTitle.classList.add('context-menu-title');
    menuTitle.textContent = creature.name;
    menuTitle.style.cssText = `
        font-weight: bold;
        padding-bottom: 5px;
        margin-bottom: 5px;
        border-bottom: 1px solid #555;
    `;
    contextMenu.appendChild(menuTitle);
    
    // Add Hit Points editor
    const hpEditor = document.createElement('div');
    hpEditor.classList.add('context-menu-item');
    hpEditor.style.cssText = `
        padding: 8px 0;
        display: flex;
        flex-direction: column;
        gap: 5px;
    `;
    
    const hpLabel = document.createElement('label');
    hpLabel.textContent = `HP: ${creature.hp}/${creature.maxHp}`;
    hpEditor.appendChild(hpLabel);
    
    const hpControls = document.createElement('div');
    hpControls.style.cssText = `
        display: flex;
        gap: 5px;
        align-items: center;
    `;
    
    // HP input
    const hpInput = document.createElement('input');
    hpInput.type = 'number';
    hpInput.min = '0';
    hpInput.max = creature.maxHp.toString();
    hpInput.value = creature.hp.toString();
    hpInput.style.cssText = `
        width: 60px;
        padding: 3px;
    `;
    hpControls.appendChild(hpInput);
    
    // Apply HP button
    const applyHpBtn = document.createElement('button');
    applyHpBtn.textContent = 'Apply';
    applyHpBtn.style.cssText = `
        padding: 3px 8px;
        background: #555;
        border: none;
        color: white;
        border-radius: 3px;
        cursor: pointer;
    `;
    applyHpBtn.addEventListener('click', () => {
        const newHp = parseInt(hpInput.value);
        if (!isNaN(newHp)) {
            // Set new HP and update creature
            creature.hp = Math.min(Math.max(0, newHp), creature.maxHp);
            renderCreature(creature);
            removeContextMenus();
            
            // Log the HP change
            logMessage(`${creature.name}'s HP changed to ${creature.hp}`);
        }
    });
    hpControls.appendChild(applyHpBtn);
    
    hpEditor.appendChild(hpControls);
    contextMenu.appendChild(hpEditor);
    
    // Add AI control toggle
    const aiToggleContainer = document.createElement('div');
    aiToggleContainer.classList.add('context-menu-item');
    aiToggleContainer.style.cssText = `
        padding: 8px 0;
        display: flex;
        align-items: center;
        gap: 10px;
    `;
    
    // Toggle checkbox
    const aiToggle = document.createElement('input');
    aiToggle.type = 'checkbox';
    aiToggle.id = 'ai-toggle-' + creature.id;
    aiToggle.checked = creature.isAI;
    
    // Label for toggle
    const aiLabel = document.createElement('label');
    aiLabel.htmlFor = aiToggle.id;
    aiLabel.textContent = 'AI Controlled';
    
    aiToggle.addEventListener('change', () => {
        creature.isAI = aiToggle.checked;
        console.debug(`[AI] ${creature.name} AI control set to: ${creature.isAI}`);
        renderCreature(creature);
        
        // If we're in combat, update the initiative list to reflect the AI status change
        if (gameState.initiativeOrder.includes(creature)) {
            eventBus.emit('initiative-updated', { initiativeOrder: gameState.initiativeOrder });
        }
        
        logMessage(`${creature.name} is now ${creature.isAI ? 'controlled by AI' : 'under manual control'}.`);
    });
    
    aiToggleContainer.appendChild(aiToggle);
    aiToggleContainer.appendChild(aiLabel);
    contextMenu.appendChild(aiToggleContainer);
    
    // Delete creature option
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete Creature';
    deleteBtn.classList.add('context-menu-button', 'delete-button');
    deleteBtn.style.cssText = `
        background: #e74c3c;
        color: white;
        border: none;
        padding: 8px;
        margin-top: 10px;
        border-radius: 3px;
        width: 100%;
        cursor: pointer;
    `;
    deleteBtn.addEventListener('click', () => {
        // Remove from creatures array
        const index = gameState.creatures.findIndex(c => c.id === creature.id);
        if (index !== -1) {
            gameState.creatures.splice(index, 1);
            
            // Remove from initiative order if present
            const initIndex = gameState.initiativeOrder.findIndex(c => c.id === creature.id);
            if (initIndex !== -1) {
                gameState.initiativeOrder.splice(initIndex, 1);
            }
            
            // Remove element from display
            if (creature.element) {
                creature.element.remove();
            }
            
            // Log the deletion
            logMessage(`${creature.name} has been removed from the battle.`);
        }
        removeContextMenus();
    });
    contextMenu.appendChild(deleteBtn);
    
    // Add to document body
    document.body.appendChild(contextMenu);
    
    // Add click listener to close menu when clicking outside
    setTimeout(() => {
        document.addEventListener('click', removeContextMenus);
    }, 10);
}

// Remove any context menus
function removeContextMenus() {
    const existingMenu = document.getElementById('creatureContextMenu');
    if (existingMenu) {
        existingMenu.remove();
    }
    document.removeEventListener('click', removeContextMenus);
}

// Highlight the active creature
export function highlightActiveCreature(creature) {
    if (!creature) return;
    
    // Clear existing highlights
    document.querySelectorAll('.creature').forEach(el => {
        el.classList.remove('active-creature');
    });
    
    // Highlight active creature
    if (creature.element) {
        creature.element.classList.add('active-creature');
        
        // Show movement range
        eventBus.emit('show-movement-range', { creature });
    }
}

// Add creature to initiative order
export function addToInitiative(creature) {
    if (!creature) return;
    
    // Add to initiative order
    gameState.initiativeOrder.push(creature);
    
    // Sort by initiative, highest first
    gameState.initiativeOrder.sort((a, b) => b.initiative - a.initiative);
    
    // Update initiative display
    eventBus.emit('initiative-updated', { initiativeOrder: gameState.initiativeOrder });
}

// Handle drag start
export function startDrag(event, creature) {
    // Only allow dragging if in placement mode or it's the active creature's turn
    if (gameState.selectedAction === 'place' || 
       (gameState.activeCreature && creature.id === gameState.activeCreature.id)) {
        event.preventDefault();
        gameState.isDragging = true;
        gameState.draggedCreature = creature;
        
        // Add global mouse events
        document.addEventListener('mousemove', handleDrag);
        document.addEventListener('mouseup', endDrag);
    }
}

// Handle dragging
export function handleDrag(event) {
    if (!gameState.isDragging || !gameState.draggedCreature) return;
    
    const svg = document.getElementById('svg');
    if (!svg) return;
    
    const rect = svg.getBoundingClientRect();
    
    // Calculate grid coordinates
    const x = Math.floor((event.clientX - rect.left) / gameState.gridSize);
    const y = Math.floor((event.clientY - rect.top) / gameState.gridSize);
    
    // Ensure within bounds
    if (x >= 0 && x < gameState.arenaWidth && y >= 0 && y < gameState.arenaHeight) {
        // Get creature at location
        const creatureAtLocation = getCreatureAt(x, y);
        
        // Check if can move here
        if (!creatureAtLocation || (gameState.draggedCreature.x === x && gameState.draggedCreature.y === y)) {
            // Update visual position
            gameState.draggedCreature.element.setAttribute('transform', 
                `translate(${x * gameState.gridSize}, ${y * gameState.gridSize})`);
            
            // Highlight potential drop location
            eventBus.emit('highlight-cell', { x, y, color: 'rgba(0, 255, 0, 0.3)' });
        }
    }
}

// Handle drag end
export function endDrag(event) {
    if (!gameState.isDragging || !gameState.draggedCreature) return;
    
    const svg = document.getElementById('svg');
    if (!svg) return;
    
    const rect = svg.getBoundingClientRect();
    
    // Calculate final grid coordinates
    const x = Math.floor((event.clientX - rect.left) / gameState.gridSize);
    const y = Math.floor((event.clientY - rect.top) / gameState.gridSize);
    
    // Ensure within bounds and no other creature is there
    if (x >= 0 && x < gameState.arenaWidth && y >= 0 && y < gameState.arenaHeight) {
        // Get creature at location
        const creatureAtLocation = getCreatureAt(x, y);
        
        if (!creatureAtLocation || (gameState.draggedCreature.x === x && gameState.draggedCreature.y === y)) {
            // If it's the active creature moving, apply movement rules
            if (gameState.activeCreature && gameState.draggedCreature.id === gameState.activeCreature.id && gameState.selectedAction === 'move') {
                moveCreature(gameState.draggedCreature, x, y);
            } else {
                // Just update position for placement
                gameState.draggedCreature.x = x;
                gameState.draggedCreature.y = y;
                renderCreature(gameState.draggedCreature);
            }
        } else {
            // Revert to original position
            gameState.draggedCreature.element.setAttribute('transform', 
                `translate(${gameState.draggedCreature.x * gameState.gridSize}, ${gameState.draggedCreature.y * gameState.gridSize})`);
        }
    } else {
        // Revert to original position
        gameState.draggedCreature.element.setAttribute('transform', 
            `translate(${gameState.draggedCreature.x * gameState.gridSize}, ${gameState.draggedCreature.y * gameState.gridSize})`);
    }
    
    // Clean up
    gameState.isDragging = false;
    gameState.draggedCreature = null;
    document.removeEventListener('mousemove', handleDrag);
    document.removeEventListener('mouseup', endDrag);
    
    // Clear all highlights
    eventBus.emit('clear-highlights');
}

// Move a creature to a new position
export function moveCreature(creature, x, y) {
    if (!creature) return;
    
    // Calculate distance in 5ft squares (assuming each cell is 5ft)
    const distance = calculateDistance(creature.x, creature.y, x, y) * 5;
    
    // Check if within movement range
    if (distance <= creature.remainingMove) {
        const oldX = creature.x;
        const oldY = creature.y;
        
        // Check for threatening creatures that might get opportunity attacks
        const threateningCreatures = getThreateningCreatures(creature);
        
        // Update position
        creature.x = x;
        creature.y = y;
        
        // Reduce remaining movement
        creature.remainingMove -= distance;
        
        // Update rendering
        renderCreature(creature);
        
        // Log the movement
        logMessage(`${creature.name} moves to (${x},${y}). ${creature.remainingMove}ft of movement remaining.`);
        
        // Trigger opportunity attacks if we left a threatened square
        // and don't have the disengage condition
        if (threateningCreatures.length > 0 && !creature.conditions.includes('disengage')) {
            // Get threatening creatures that are still threatening after the move
            const stillThreatening = threateningCreatures.filter(c => {
                // Check if the creature is still threatening after the move
                return !isAdjacent(c, creature);
            });
            
            if (stillThreatening.length > 0) {
                handleOpportunityAttacks(stillThreatening, creature);
            }
        }
        
        // Update UI
        eventBus.emit('ui-update', { type: 'creature-moved' });
    } else {
        logMessage(`${creature.name} cannot move that far! ${creature.remainingMove}ft remaining.`, 'warning');
    }
}

// Check if two creatures are adjacent (for opportunity attacks)
export function isAdjacent(creature1, creature2) {
    if (!creature1 || !creature2) return false;
    
    // Calculate grid distance
    const distance = calculateDistance(creature1.x, creature1.y, creature2.x, creature2.y);
    
    // Adjacent if 1 square away (5ft)
    return distance <= 1;
}

// Get creatures that threaten the given creature (adjacent enemies)
export function getThreateningCreatures(creature) {
    if (!creature) return [];
    
    return gameState.creatures.filter(c => {
        // Skip self, dead creatures, and allies
        if (c.id === creature.id || c.hp <= 0 || c.isDead || c.team === creature.team) return false;
        
        // Check if adjacent
        return isAdjacent(c, creature);
    });
}

// Handle opportunity attacks
export function handleOpportunityAttacks(attackers, target) {
    if (!attackers || attackers.length === 0 || !target) return;
    
    // Process each attacker's opportunity attack
    attackers.forEach(attacker => {
        logMessage(`${attacker.name} gets an opportunity attack against ${target.name}!`, 'warning');
        
        // Roll attack with normal rules (no advantage/disadvantage for opportunity attacks)
        const attackRoll = rollD20();
        const totalAttack = attackRoll + attacker.attackBonus;
        
        logMessage(`${attacker.name} rolls ${attackRoll} + ${attacker.attackBonus} = ${totalAttack} for opportunity attack.`);
        
        // Check if hit
        if (attackRoll === 20 || (attackRoll !== 1 && totalAttack >= target.ac)) {
            // Critical hit on natural 20
            const isCritical = attackRoll === 20;
            
            // Roll damage
            const damageRoll = rollDice(attacker.damageDice);
            
            // Double dice on critical
            let damage = damageRoll.total + attacker.damageBonus;
            if (isCritical) {
                // Roll additional dice for critical
                const criticalBonus = rollDice(attacker.damageDice).total;
                damage += criticalBonus;
                
                logMessage(`CRITICAL OPPORTUNITY ATTACK! ${attacker.name} hits ${target.name} for ${damage} damage!`, 'critical');
            } else {
                logMessage(`HIT! ${attacker.name}'s opportunity attack hits ${target.name} for ${damage} damage!`);
            }
            
            // Apply damage
            target.hp = Math.max(0, target.hp - damage);
            
            // Check if target is defeated
            if (target.hp <= 0) {
                logMessage(`${target.name} is defeated by an opportunity attack!`, 'critical');
                target.isDead = true;
                
                // Remove from initiative
                const initIndex = gameState.initiativeOrder.findIndex(c => c.id === target.id);
                if (initIndex !== -1) {
                    gameState.initiativeOrder.splice(initIndex, 1);
                    eventBus.emit('initiative-updated', { initiativeOrder: gameState.initiativeOrder });
                }
                
                // Check win condition
                eventBus.emit('check-win-condition');
            }
            
            // Update target rendering
            renderCreature(target);
        } else {
            logMessage(`MISS! ${attacker.name}'s opportunity attack misses ${target.name}!`, 'miss');
        }
    });
}

// Update creature condition indicators
export function updateCreatureConditions(creature) {
    if (!creature || !creature.element) return;
    
    // Remove existing condition indicators
    creature.element.querySelectorAll('.condition-indicator').forEach(el => el.remove());
    
    // Add indicators for each condition
    creature.conditions.forEach((condition, index) => {
        const indicator = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        indicator.setAttribute('cx', gameState.gridSize * 0.25);
        indicator.setAttribute('cy', gameState.gridSize * 0.25 + (index * 15));
        indicator.setAttribute('r', gameState.gridSize * 0.1);
        indicator.classList.add('condition-indicator');
        
        // Set color based on condition
        switch(condition) {
            case 'dodge':
                indicator.setAttribute('fill', 'lightblue');
                break;
            case 'disengage':
                indicator.setAttribute('fill', 'lightgreen');
                break;
            case 'helped':
                indicator.setAttribute('fill', 'yellow');
                break;
            default:
                indicator.setAttribute('fill', 'gray');
        }
        
        creature.element.appendChild(indicator);
    });
}

// Get creatures for a specific team
export function getTeamCreatures(teamName) {
    return gameState.creatures.filter(c => c.team === teamName && c.hp > 0);
}

// Get all creatures except the ones from a given team
export function getOpponentCreatures(teamName) {
    return gameState.creatures.filter(c => c.team !== teamName && c.hp > 0);
}

// Get creature at specific grid coordinates
export function getCreatureAt(x, y) {
    return gameState.creatures.find(c => c.x === x && c.y === y);
}

// Set up event listeners
export function setupEventListeners() {
    // Listen for condition changes
    eventBus.on('condition-changed', (data) => {
        updateCreatureConditions(data.creature);
    });
    
    // Listen for render requests
    eventBus.on('render-creature', (data) => {
        renderCreature(data.creature);
    });
    
    // Listen for highlight requests
    eventBus.on('highlight-creature', (data) => {
        highlightActiveCreature(data.creature);
    });
    
    // Listen for move requests
    eventBus.on('move-creature', (data) => {
        moveCreature(data.creature, data.x, data.y);
    });
}