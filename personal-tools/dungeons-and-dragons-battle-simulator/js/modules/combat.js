// Combat logic for D&D Battle Simulator
import { gameState, getTeamColor } from './config.js';
import { rollD20, rollDice, logMessage, findClosestCreature, calculateDistance } from './utils.js';
import { getCreatureAt } from './arena.js';
import { eventBus } from './common.js';

// Process next turn
export function nextTurn() {
    // If there are no creatures, do nothing
    if (gameState.initiativeOrder.length === 0) {
        logMessage("Add creatures to start the battle!", 'info');
        return;
    }
    
    // Skip if combat has ended
    if (gameState.roundNumber === 0) {
        console.debug('[Combat] Combat has ended, cannot process next turn');
        return;
    }
    
    // Clear selected action
    gameState.selectedAction = null;
    
    // Move to next creature
    gameState.currentTurn = (gameState.currentTurn + 1) % gameState.initiativeOrder.length;
    
    // If we've gone through all creatures, increment round
    if (gameState.currentTurn === 0) {
        gameState.roundNumber++;
        eventBus.emit('round-updated', { round: gameState.roundNumber });
    }
    
    // Set active creature
    gameState.activeCreature = gameState.initiativeOrder[gameState.currentTurn];
    
    // Reset creature's movement and actions for the new turn
    gameState.activeCreature.remainingMove = gameState.activeCreature.speed;
    gameState.activeCreature.hasAction = true;
    gameState.activeCreature.hasBonusAction = true;
    gameState.activeCreature.hasReaction = true;
    
    // Remove dodge condition if it was active
    if (gameState.activeCreature.conditions.includes('dodge')) {
        removeCondition(gameState.activeCreature, 'dodge');
    }
    
    // Remove other one-turn conditions like helped
    if (gameState.activeCreature.conditions.includes('helped')) {
        removeCondition(gameState.activeCreature, 'helped');
    }
    
    // Log turn change
    logMessage(`It's ${gameState.activeCreature.name}'s turn (${gameState.activeCreature.team})!`);
    
    // Highlight active creature
    eventBus.emit('highlight-creature', { creature: gameState.activeCreature });
    
    // Update UI
    updateInitiativeList();
    eventBus.emit('ui-update', { type: 'turn-change' });
    
    // Check if AI should act
    const aiToggle = document.getElementById('auto-all');
    const autoTurnBtn = document.getElementById('auto-turn');
    
    // Debug current state
    console.debug(`[AI] Next turn - Active creature: ${gameState.activeCreature.name}, AI controlled: ${gameState.activeCreature.isAI}`);
    console.debug(`[AI] Auto-all checked: ${aiToggle && aiToggle.checked}`);
    
    // Run AI if:
    // 1. Auto-all is checked AND the creature is AI controlled, OR
    // 2. The auto-turn button was just clicked for this turn
    if ((aiToggle && aiToggle.checked && gameState.activeCreature.isAI)) {
        console.debug('[AI] Triggering AI turn due to auto-all setting');
        setTimeout(handleAI, 500); // Delay AI actions for better visualization
    }
}

// Start combat
export function startCombat() {
    // Reroll initiative for all creatures
    gameState.creatures.forEach(creature => {
        // Roll d20 + dexterity modifier (estimated from 10 if not defined)
        const dexMod = Math.floor(((creature.dexterity || 10) - 10) / 2);
        creature.initiative = rollD20() + dexMod;
        console.debug(`[Combat] ${creature.name} rolls initiative: ${creature.initiative}`);
    });
    
    // Re-create and sort initiative order
    gameState.initiativeOrder = [...gameState.creatures];
    gameState.initiativeOrder.sort((a, b) => b.initiative - a.initiative);
    
    // Reset the round number
    gameState.roundNumber = 1;
    eventBus.emit('round-updated', { round: gameState.roundNumber });
    
    // If no creatures, add a warning
    if (gameState.initiativeOrder.length === 0) {
        logMessage("Add creatures to start the battle!", 'warning');
        return;
    }
    
    // Set first creature as active
    gameState.currentTurn = 0;
    gameState.activeCreature = gameState.initiativeOrder[0];
    
    // Set up first turn
    gameState.activeCreature.remainingMove = gameState.activeCreature.speed;
    gameState.activeCreature.hasAction = true;
    gameState.activeCreature.hasBonusAction = true;
    
    // Log combat start
    logMessage(`Battle begins! Round 1 - ${gameState.activeCreature.name} goes first!`);
    
    // Highlight active creature
    eventBus.emit('highlight-creature', { creature: gameState.activeCreature });
    
    // Update UI
    updateInitiativeList();
    eventBus.emit('ui-update', { type: 'combat-start' });
    
    // Enable combat buttons
    const nextTurnBtn = document.getElementById('next-turn');
    const endCombatBtn = document.getElementById('end-combat');
    const autoTurnBtn = document.getElementById('auto-turn');
    
    if (nextTurnBtn) nextTurnBtn.disabled = false;
    if (endCombatBtn) endCombatBtn.disabled = false;
    if (autoTurnBtn) autoTurnBtn.disabled = false;
}

// End combat
export function endCombat() {
    // Clear active creature
    gameState.activeCreature = null;
    gameState.currentTurn = -1;
    
    // Clear initiative order completely
    gameState.initiativeOrder = [];
    
    // Reset round
    gameState.roundNumber = 0;
    eventBus.emit('round-updated', { round: gameState.roundNumber });
    
    // Log combat end
    logMessage("Combat has ended.", 'info');
    
    // Reset UI
    updateInitiativeList();
    eventBus.emit('ui-update', { type: 'combat-end' });
    
    // Clear range indicators
    const rangeIndicator = document.getElementById('range-indicators');
    if (rangeIndicator) {
        rangeIndicator.innerHTML = '';
    }
    
    // Clear any open target selection modal
    const targetModal = document.getElementById('targetSelectionModal');
    if (targetModal) {
        targetModal.classList.add('hidden');
    }
    
    // Disable combat buttons
    const nextTurnBtn = document.getElementById('next-turn');
    const endCombatBtn = document.getElementById('end-combat');
    const autoTurnBtn = document.getElementById('auto-turn');
    
    if (nextTurnBtn) nextTurnBtn.disabled = true;
    if (endCombatBtn) endCombatBtn.disabled = true;
    if (autoTurnBtn) autoTurnBtn.disabled = true;
    
    // Disable AI auto-turn checkbox if it exists
    const aiToggle = document.getElementById('auto-all');
    if (aiToggle) {
        aiToggle.checked = false;
    }
    
    console.debug('[Combat] Combat ended, initiative order cleared');
}

// Reset combat
export function resetCombat() {
    // End any active combat
    endCombat();
    
    // Reset creatures
    gameState.creatures.forEach(creature => {
        creature.hp = creature.maxHp;
        creature.remainingMove = creature.speed;
        creature.hasAction = true;
        creature.hasBonusAction = true;
        creature.conditions = [];
        
        // Re-render creature
        eventBus.emit('render-creature', { creature });
    });
    
    // Re-sort initiative
    gameState.initiativeOrder = [...gameState.creatures];
    gameState.initiativeOrder.sort((a, b) => b.initiative - a.initiative);
    
    // Reset turn
    gameState.currentTurn = -1;
    
    // Reset round
    gameState.roundNumber = 0;
    eventBus.emit('round-updated', { round: gameState.roundNumber });
    
    // Log reset
    logMessage("Combat has been reset. All creatures restored to full health.", 'info');
    
    // Update UI
    updateInitiativeList();
    eventBus.emit('ui-update', { type: 'combat-reset' });
}

// Update initiative list display
export function updateInitiativeList() {
    const initiativeList = document.getElementById('initiative-list');
    if (!initiativeList) return;
    
    initiativeList.innerHTML = '';
    
    gameState.initiativeOrder.forEach((creature, index) => {
        const item = document.createElement('div');
        item.classList.add('initiative-item');
        
        // Highlight current turn
        if (gameState.initiativeOrder[gameState.currentTurn] && index === gameState.currentTurn) {
            item.classList.add('current-turn');
        }
        
        // Show initiative roll, name, HP and AI status
        item.innerHTML = `
            <span class="initiative-roll">${creature.initiative}</span>
            <span class="initiative-name">${creature.name}</span>
            <span class="initiative-hp">${creature.hp}/${creature.maxHp} HP</span>
            ${creature.isAI ? '<span class="ai-controlled" title="AI Controlled">🤖</span>' : ''}
        `;
        
        // Color based on team
        item.style.borderColor = getTeamColor(creature.team);
        
        initiativeList.appendChild(item);
    });
}

// Find path to a target creature
function findPathToTarget(source, target, obstacles) {
    console.debug(`[Pathfinding] Finding path from (${source.x},${source.y}) to (${target.x},${target.y})`);
    
    // Simple implementation of A* pathfinding algorithm
    const openSet = [{ x: source.x, y: source.y, g: 0, h: 0, f: 0, parent: null }];
    const closedSet = [];
    const maxIterations = 100; // Prevent infinite loops
    let iterations = 0;
    
    // Create a unique key for a position
    const posKey = (x, y) => `${x},${y}`;
    
    // Get neighboring cells
    const getNeighbors = (node) => {
        const neighbors = [];
        const directions = [
            { dx: 1, dy: 0 },  // right
            { dx: -1, dy: 0 }, // left
            { dx: 0, dy: 1 },  // down
            { dx: 0, dy: -1 }, // up
            { dx: 1, dy: 1 },  // diagonal down-right
            { dx: -1, dy: 1 }, // diagonal down-left
            { dx: 1, dy: -1 }, // diagonal up-right
            { dx: -1, dy: -1 } // diagonal up-left
        ];
        
        for (const dir of directions) {
            const x = node.x + dir.dx;
            const y = node.y + dir.dy;
            
            // Skip if out of bounds
            if (x < 0 || x >= gameState.arenaWidth || y < 0 || y >= gameState.arenaHeight) continue;
            
            // Skip if occupied by another creature (except the target)
            const occupyingCreature = obstacles.find(c => c.x === x && c.y === y && c.id !== target.id);
            if (occupyingCreature) continue;
            
            // Add this neighbor
            neighbors.push({ x, y });
        }
        
        return neighbors;
    };
    
    // Heuristic function (Manhattan distance)
    const heuristic = (x, y) => {
        return Math.abs(x - target.x) + Math.abs(y - target.y);
    };
    
    // Main loop
    while (openSet.length > 0 && iterations < maxIterations) {
        iterations++;
        
        // Find node with lowest f score
        let currentIndex = 0;
        for (let i = 0; i < openSet.length; i++) {
            if (openSet[i].f < openSet[currentIndex].f) {
                currentIndex = i;
            }
        }
        
        const current = openSet[currentIndex];
        
        // Check if we reached the target
        if (current.x === target.x && current.y === target.y) {
            // Reconstruct path
            const path = [];
            let temp = current;
            while (temp.parent) {
                path.push({ x: temp.x, y: temp.y });
                temp = temp.parent;
            }
            console.debug(`[Pathfinding] Path found with ${path.length} steps`);
            return path.reverse(); // Return path from start to finish
        }
        
        // Move current from open to closed set
        openSet.splice(currentIndex, 1);
        closedSet.push(current);
        
        // Process neighbors
        const neighbors = getNeighbors(current);
        for (const neighbor of neighbors) {
            const key = posKey(neighbor.x, neighbor.y);
            
            // Skip if in closed set
            if (closedSet.some(node => posKey(node.x, node.y) === key)) continue;
            
            // Calculate g score (distance from start)
            const gScore = current.g + (
                // Diagonal movement costs more
                neighbor.x !== current.x && neighbor.y !== current.y ? 1.4 : 1
            );
            
            // Check if this is a better path to neighbor
            const existingNeighbor = openSet.find(node => posKey(node.x, node.y) === key);
            if (!existingNeighbor) {
                // New node
                const h = heuristic(neighbor.x, neighbor.y);
                openSet.push({
                    x: neighbor.x,
                    y: neighbor.y,
                    g: gScore,
                    h,
                    f: gScore + h,
                    parent: current
                });
            } else if (gScore < existingNeighbor.g) {
                // Better path to existing node
                existingNeighbor.g = gScore;
                existingNeighbor.f = gScore + existingNeighbor.h;
                existingNeighbor.parent = current;
            }
        }
    }
    
    // No path found or max iterations reached
    console.debug(`[Pathfinding] No path found after ${iterations} iterations`);
    return null;
}

// Attack a target
export function attackTarget(attacker, target) {
    if (!attacker || !target) return;
    
    console.debug(`[Combat] ${attacker.name} attacks ${target.name}`);
    
    // Use action
    attacker.hasAction = false;
    
    // Show attack animation
    const attackEffect = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    attackEffect.setAttribute('cx', target.x * gameState.gridSize + gameState.gridSize/2);
    attackEffect.setAttribute('cy', target.y * gameState.gridSize + gameState.gridSize/2);
    attackEffect.setAttribute('r', gameState.gridSize/2);
    attackEffect.setAttribute('fill', 'rgba(255, 0, 0, 0.5)');
    attackEffect.classList.add('attack-effect');
    
    const svg = document.getElementById('svg');
    if (svg) {
        const effectsLayer = document.getElementById('effects-layer') || svg;
        effectsLayer.appendChild(attackEffect);
        
        // Remove after animation
        setTimeout(() => {
            attackEffect.remove();
        }, 500);
    }
    
    // Roll attack with advantage/disadvantage based on conditions
    let attackRoll1 = rollD20();
    let attackRoll2 = rollD20();
    let attackRoll = attackRoll1;
    let advantage = false;
    let disadvantage = false;
    
    // Check conditions affecting the roll
    if (target.conditions.includes('dodge')) {
        console.debug('[Combat] Target has dodge - attack at disadvantage');
        disadvantage = true;
    }
    
    if (disadvantage) {
        attackRoll = Math.min(attackRoll1, attackRoll2);
        console.debug(`[Combat] Attack at disadvantage: ${attackRoll1} vs ${attackRoll2}, using ${attackRoll}`);
    } else if (advantage) {
        attackRoll = Math.max(attackRoll1, attackRoll2);
        console.debug(`[Combat] Attack at advantage: ${attackRoll1} vs ${attackRoll2}, using ${attackRoll}`);
    }
    
    // Add attack bonus
    const totalAttack = attackRoll + attacker.attackBonus;
    console.debug(`[Combat] Attack roll: ${attackRoll} + ${attacker.attackBonus} = ${totalAttack} vs AC ${target.ac}`);
    
    logMessage(`${attacker.name} rolls ${totalAttack} to hit (${attackRoll} + ${attacker.attackBonus}).`);
    
    // Check if hit
    if (attackRoll === 20 || (attackRoll !== 1 && totalAttack >= target.ac)) {
        // Handle critical hit on natural 20
        const isCritical = attackRoll === 20;
        
        // Roll damage
        const damageRoll = rollDice(attacker.damageDice);
        let damage = damageRoll.total + attacker.damageBonus;
        
        // Double dice on critical
        if (isCritical) {
            const criticalBonus = rollDice(attacker.damageDice).total;
            damage += criticalBonus;
            console.debug(`[Combat] Critical hit! Extra damage: ${criticalBonus}`);
            logMessage(`CRITICAL HIT! ${attacker.name} hits ${target.name} for ${damage} damage!`, 'critical');
        } else {
            logMessage(`HIT! ${attacker.name} hits ${target.name} for ${damage} damage!`);
        }
        
        // Apply damage
        target.hp = Math.max(0, target.hp - damage);
        console.debug(`[Combat] Target ${target.name} HP: ${target.hp}/${target.maxHp}`);
        
        // Check if target is defeated
        if (target.hp <= 0) {
            target.isDead = true;
            console.debug(`[Combat] ${target.name} is defeated!`);
            logMessage(`${target.name} is defeated!`, 'critical');
            
            // Remove from initiative if present
            const initIndex = gameState.initiativeOrder.findIndex(c => c.id === target.id);
            if (initIndex !== -1) {
                gameState.initiativeOrder.splice(initIndex, 1);
                
                // Adjust current turn if needed
                if (initIndex <= gameState.currentTurn && gameState.currentTurn > 0) {
                    gameState.currentTurn--;
                }
                
                // Update initiative display
                updateInitiativeList();
            }
        }
        
        // Update target rendering
        eventBus.emit('render-creature', { creature: target });
        
        // Check win condition
        checkWinCondition();
    } else {
        logMessage(`MISS! ${attacker.name}'s attack misses ${target.name}!`, 'miss');
    }
    
    // Update UI
    eventBus.emit('ui-update', { type: 'action-used' });
}

// Check if a team has won
function checkWinCondition() {
    // Get all living creatures
    const livingCreatures = gameState.creatures.filter(c => c.hp > 0);
    
    // Group by teams
    const teams = {};
    livingCreatures.forEach(creature => {
        if (!teams[creature.team]) {
            teams[creature.team] = [];
        }
        teams[creature.team].push(creature);
    });
    
    // If only one team remains, they win
    const teamNames = Object.keys(teams);
    if (teamNames.length === 1) {
        const winningTeam = teamNames[0];
        logMessage(`${winningTeam} is victorious!`, 'critical');
        
        // Keep combat going, but let the user know
        if (gameState.roundNumber > 0) {
            setTimeout(() => {
                if (confirm(`${winningTeam} has won the battle! End combat?`)) {
                    endCombat();
                }
            }, 1000);
        }
    }
}

// Add condition to creature
export function addCondition(creature, condition) {
    if (!creature || !condition) return;
    
    // Don't add duplicates
    if (!creature.conditions.includes(condition)) {
        creature.conditions.push(condition);
        logMessage(`${creature.name} gains the ${condition} condition.`);
        console.debug(`[Combat] ${creature.name} gained ${condition} condition`);
        
        // Emit condition changed event for UI update
        eventBus.emit('condition-changed', { creature });
    }
}

// Remove condition from creature
export function removeCondition(creature, condition) {
    if (!creature || !condition) return;
    
    const index = creature.conditions.indexOf(condition);
    if (index !== -1) {
        creature.conditions.splice(index, 1);
        logMessage(`${creature.name} loses the ${condition} condition.`);
        console.debug(`[Combat] ${creature.name} lost ${condition} condition`);
        
        // Emit condition changed event for UI update
        eventBus.emit('condition-changed', { creature });
    }
}

// Handle AI for computer-controlled creatures
export function handleAI() {
    // Only act if it's AI's turn
    if (!gameState.activeCreature) {
        console.debug('[AI] No active creature, cannot perform AI turn');
        return;
    }
    
    // Skip AI turn if combat has ended
    if (gameState.roundNumber === 0) {
        console.debug('[AI] Combat has ended, skipping AI turn');
        return;
    }
    
    // Check if the creature is AI controlled
    if (!gameState.activeCreature.isAI) {
        console.debug(`[AI] ${gameState.activeCreature.name} is not AI controlled, skipping AI turn`);
        return;
    }
    
    console.debug(`[AI] Starting AI turn for ${gameState.activeCreature.name}`);
    console.debug(`[AI] HP: ${gameState.activeCreature.hp}/${gameState.activeCreature.maxHp}, Position: (${gameState.activeCreature.x},${gameState.activeCreature.y})`);
    console.debug(`[AI] Movement: ${gameState.activeCreature.remainingMove}/${gameState.activeCreature.speed}ft, Has Action: ${gameState.activeCreature.hasAction}`);
    logMessage(`AI is thinking for ${gameState.activeCreature.name}...`);
    
    // Get enemies (different team)
    const enemies = gameState.creatures.filter(c => c.team !== gameState.activeCreature.team && c.hp > 0 && !c.isDead);
    console.debug(`[AI] Found ${enemies.length} potential enemies`);
    
    // Log info about each enemy
    enemies.forEach(enemy => {
        console.debug(`[AI] Enemy: ${enemy.name}, Team: ${enemy.team}, HP: ${enemy.hp}/${enemy.maxHp}, Position: (${enemy.x},${enemy.y})`);
    });
    
    // If no enemies, end turn
    if (enemies.length === 0) {
        console.debug('[AI] No enemies found, ending turn');
        logMessage(`${gameState.activeCreature.name} can't find any targets.`);
        setTimeout(nextTurn, 1000);
        return;
    }
    
    // Find enemies in attack range
    const enemiesInRange = enemies.filter(enemy => 
        calculateDistance(gameState.activeCreature.x, gameState.activeCreature.y, enemy.x, enemy.y) <= 1
    );
    console.debug(`[AI] Found ${enemiesInRange.length} enemies in attack range`);
    
    // If enemies are in range, attack the most wounded one
    if (enemiesInRange.length > 0 && gameState.activeCreature.hasAction) {
        enemiesInRange.sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp));
        const targetEnemy = enemiesInRange[0];
        
        console.debug(`[AI] Attacking ${targetEnemy.name} (${targetEnemy.hp}/${targetEnemy.maxHp} HP)`);
        console.debug(`[AI] Attack bonus: ${gameState.activeCreature.attackBonus}, Damage formula: ${gameState.activeCreature.damageDice}+${gameState.activeCreature.damageBonus}`);
        logMessage(`${gameState.activeCreature.name} decides to attack ${targetEnemy.name}.`);
        gameState.selectedAction = 'attack';
        attackTarget(gameState.activeCreature, targetEnemy);
        
        // End turn after action
        console.debug('[AI] Attack complete, ending turn');
        setTimeout(nextTurn, 1200);
        return;
    }
    
    // If no enemies in range, move towards closest enemy
    const closestEnemy = findClosestCreature(gameState.activeCreature, enemies);
    console.debug(`[AI] Closest enemy is ${closestEnemy.name} at (${closestEnemy.x},${closestEnemy.y})`);
    
    const currentDistance = calculateDistance(
        gameState.activeCreature.x, gameState.activeCreature.y, 
        closestEnemy.x, closestEnemy.y
    );
    console.debug(`[AI] Distance to closest enemy: ${currentDistance}, movement available: ${gameState.activeCreature.remainingMove / 5} squares`);
    
    // Try to move or dash towards enemy
    if (gameState.activeCreature.remainingMove > 0 || gameState.activeCreature.hasAction) {
        console.debug('[AI] Finding path to target');
        const path = findPathToTarget(gameState.activeCreature, closestEnemy, gameState.creatures);
        
        if (path && path.length > 0) {
            console.debug(`[AI] Found path with ${path.length} steps`);
            
            // Log the path
            path.forEach((step, index) => {
                console.debug(`[AI] Path step ${index+1}: (${step.x},${step.y})`);
            });
            
            // Use dash if we need to
            if (currentDistance > (gameState.activeCreature.remainingMove / 5) && gameState.activeCreature.hasAction) {
                console.debug('[AI] Using dash action to increase movement');
                console.debug(`[AI] Before dash: ${gameState.activeCreature.remainingMove}ft, after: ${gameState.activeCreature.remainingMove + gameState.activeCreature.speed}ft`);
                logMessage(`${gameState.activeCreature.name} dashes to close the distance.`);
                handleActionSelect('dash');
            }
            
            // Move along the path
            const stepsToTake = Math.min(
                path.length, 
                Math.floor(gameState.activeCreature.remainingMove / 5)
            );
            
            if (stepsToTake > 0) {
                const destination = path[stepsToTake - 1];
                console.debug(`[AI] Moving ${stepsToTake} steps to (${destination.x},${destination.y})`);
                console.debug(`[AI] Movement cost: ${stepsToTake * 5}ft, remaining after move: ${gameState.activeCreature.remainingMove - (stepsToTake * 5)}ft`);
                logMessage(`${gameState.activeCreature.name} moves towards ${closestEnemy.name}.`);
                
                // Move creature
                gameState.selectedAction = 'move';
                const oldX = gameState.activeCreature.x;
                const oldY = gameState.activeCreature.y;
                
                // Calculate move distance cost
                const moveDist = Math.sqrt(
                    Math.pow(destination.x - oldX, 2) + 
                    Math.pow(destination.y - oldY, 2)
                ) * 5;
                
                // Update position
                gameState.activeCreature.x = destination.x;
                gameState.activeCreature.y = destination.y;
                gameState.activeCreature.remainingMove -= moveDist;
                
                // Trigger move animation
                eventBus.emit('render-creature', { creature: gameState.activeCreature });
                
                // Check if we can attack after moving
                setTimeout(() => {
                    const newDistToEnemy = calculateDistance(
                        gameState.activeCreature.x, 
                        gameState.activeCreature.y,
                        closestEnemy.x,
                        closestEnemy.y
                    );
                    
                    // Can we attack after moving?
                    if (newDistToEnemy <= 1 && gameState.activeCreature.hasAction) {
                        console.debug(`[AI] In range after move, attacking ${closestEnemy.name}`);
                        logMessage(`${gameState.activeCreature.name} attacks after moving.`);
                        gameState.selectedAction = 'attack';
                        attackTarget(gameState.activeCreature, closestEnemy);
                        
                        // End turn after delayed attack
                        setTimeout(nextTurn, 1000);
                    } else {
                        // If we moved but still can't attack, end turn
                        console.debug('[AI] Move complete but not in attack range, ending turn');
                        setTimeout(nextTurn, 500);
                    }
                }, 700);
                
                return; // Wait for movement animation and possible attack
            }
        } else {
            console.debug('[AI] No path found, taking dodge action');
        }
    }
    
    // If we still have an action and can't do anything else, dodge
    if (gameState.activeCreature.hasAction) {
        console.debug('[AI] Taking dodge action');
        logMessage(`${gameState.activeCreature.name} takes the dodge action.`);
        handleActionSelect('dodge');
    }
    
    // End turn
    console.debug('[AI] AI turn complete, ending turn');
    setTimeout(nextTurn, 1500);
}

// Handle action selection
export function handleActionSelect(action) {
    if (!gameState.activeCreature) {
        logMessage("No active creature selected!", 'warning');
        return;
    }
    
    // If creature already used their action
    if ((action !== 'move' && !gameState.activeCreature.hasAction) || 
        (action === 'move' && gameState.activeCreature.remainingMove <= 0)) {
        logMessage(`${gameState.activeCreature.name} has no ${action === 'move' ? 'movement' : 'action'} left!`, 'warning');
        return;
    }
    
    gameState.selectedAction = action;
    
    // Clear existing range indicators
    const rangeIndicator = document.getElementById('range-indicators');
    if (rangeIndicator) {
        rangeIndicator.innerHTML = '';
    }
    
    // Show appropriate UI for the action
    switch(action) {
        case 'move':
            eventBus.emit('show-movement-range', { creature: gameState.activeCreature });
            logMessage(`Select a destination for ${gameState.activeCreature.name}`);
            break;
            
        case 'attack':
            eventBus.emit('show-attack-range', { creature: gameState.activeCreature });
            logMessage(`Select a target for ${gameState.activeCreature.name} to attack`);
            openTargetSelection(getTargetsInRange(gameState.activeCreature, 5)); // Assuming 5ft reach
            break;
            
        case 'dash':
            gameState.activeCreature.remainingMove += gameState.activeCreature.speed;
            gameState.activeCreature.hasAction = false;
            logMessage(`${gameState.activeCreature.name} dashes and gains ${gameState.activeCreature.speed}ft of movement!`);
            eventBus.emit('show-movement-range', { creature: gameState.activeCreature });
            eventBus.emit('ui-update', { type: 'action-used' });
            break;
            
        case 'dodge':
            addCondition(gameState.activeCreature, 'dodge');
            gameState.activeCreature.hasAction = false;
            logMessage(`${gameState.activeCreature.name} takes the dodge action!`);
            eventBus.emit('ui-update', { type: 'action-used' });
            break;
            
        case 'disengage':
            addCondition(gameState.activeCreature, 'disengage');
            gameState.activeCreature.hasAction = false;
            logMessage(`${gameState.activeCreature.name} disengages from combat!`);
            eventBus.emit('ui-update', { type: 'action-used' });
            break;
            
        case 'help':
            // Open target selection for allies
            openTargetSelection(
                gameState.creatures.filter(c => c.team === gameState.activeCreature.team && c.id !== gameState.activeCreature.id),
                'help'
            );
            logMessage(`Select an ally to help`);
            break;
    }
}

// Get targets in range for an attack
export function getTargetsInRange(attacker, range) {
    if (!attacker) return [];
    
    // Find all creatures within range that aren't on the same team
    return gameState.creatures.filter(creature => {
        // Skip self, dead creatures, and allies
        if (creature.id === attacker.id || creature.hp <= 0 || creature.isDead || creature.team === attacker.team) {
            return false;
        }
        
        // Check if within range (assuming grid distance)
        const distance = calculateDistance(attacker.x, attacker.y, creature.x, creature.y);
        return distance <= range / 5; // Convert from feet to grid spaces
    });
}

// Open target selection modal
export function openTargetSelection(targets, actionType = 'attack') {
    if (!targets || targets.length === 0) {
        logMessage('No valid targets in range!', 'warning');
        return;
    }
    
    const targetModal = document.getElementById('targetSelectionModal');
    const targetList = document.getElementById('targetList');
    
    if (!targetModal || !targetList) return;
    
    // Clear previous targets
    targetList.innerHTML = '';
    
    // Add each target as a button
    targets.forEach(target => {
        const button = document.createElement('button');
        button.classList.add('target-btn');
        button.textContent = `${target.name} (HP: ${target.hp}/${target.maxHp})`;
        button.addEventListener('click', () => {
            // Handle target selection based on action type
            if (actionType === 'attack') {
                attackTarget(gameState.activeCreature, target);
            } else if (actionType === 'help') {
                helpTarget(gameState.activeCreature, target);
            }
            
            // Close modal
            targetModal.classList.add('hidden');
            
            // If the target died, check win condition
            if (target.hp <= 0) {
                checkWinCondition();
            }
        });
        
        targetList.appendChild(button);
    });
    
    // Show the modal
    targetModal.classList.remove('hidden');
}

// Help another creature (grant advantage)
function helpTarget(helper, target) {
    if (!helper || !target) return;
    
    // Use action
    helper.hasAction = false;
    
    // Grant advantage on next attack (add 'helped' condition)
    addCondition(target, 'helped');
    
    // Log the help
    logMessage(`${helper.name} helps ${target.name}, granting advantage on the next attack.`);
    
    // Update UI
    eventBus.emit('ui-update', { type: 'action-used' });
}

