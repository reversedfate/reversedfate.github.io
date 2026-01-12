// D&D Battle Simulator Script
document.addEventListener('DOMContentLoaded', function() {
    // Constants
    const GRID_SIZE = 20; // Size of each grid square in pixels
    const ARENA_WIDTH = 30; // Number of squares horizontally
    const ARENA_HEIGHT = 20; // Number of squares vertically
    
    // DOM Elements
    const arena = document.getElementById('arena');
    const gridOverlay = document.getElementById('grid-overlay');
    const creaturesLayer = document.getElementById('creatures-layer');
    const rangeIndicator = document.getElementById('range-indicator');
    const logContainer = document.getElementById('combat-log');
    const initiativeList = document.getElementById('initiative-list');
    const targetModal = document.getElementById('target-selection-modal');
    const targetList = document.getElementById('target-list');
    const closeTargetBtn = document.getElementById('close-target-selection');
    
    // Game State
    let creatures = []; // All creatures in the battle
    let teams = ['Team 1', 'Team 2']; // Available teams
    let activeCreature = null; // Currently active creature
    let initiativeOrder = []; // Sorted initiative order
    let currentTurn = 0; // Current turn index in initiative order
    let isTargetSelectionOpen = false; // Track if target selection is open
    let selectedAction = null; // Currently selected action
    let hoveredCell = null; // Currently hovered grid cell
    let isDragging = false; // Is the user dragging a creature
    let draggedCreature = null; // The creature being dragged
    
    // Initialize the arena
    function initArena() {
        // Set SVG dimensions
        resizeArena();
        window.addEventListener('resize', resizeArena);
        
        // Create grid
        drawGrid();
        
        // Initialize UI event listeners
        initUI();
        
        // Close target modal initially
        targetModal.style.display = 'none';
    }
    
    // Resize the arena to fill the available space
    function resizeArena() {
        const container = arena.parentElement;
        const width = container.clientWidth;
        const height = container.clientHeight;
        
        arena.setAttribute('width', width);
        arena.setAttribute('height', height);
        
        // Adjust grid size based on container dimensions
        const cellSize = Math.min(
            Math.floor(width / ARENA_WIDTH),
            Math.floor(height / ARENA_HEIGHT)
        );
        
        // Update grid with new dimensions
        drawGrid(cellSize);
    }
    
    // Draw the grid overlay
    function drawGrid(cellSize = GRID_SIZE) {
        // Clear existing grid
        gridOverlay.innerHTML = '';
        
        // Draw horizontal lines
        for (let y = 0; y <= ARENA_HEIGHT; y++) {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', 0);
            line.setAttribute('y1', y * cellSize);
            line.setAttribute('x2', ARENA_WIDTH * cellSize);
            line.setAttribute('y2', y * cellSize);
            line.setAttribute('stroke', '#444');
            line.setAttribute('stroke-width', 1);
            gridOverlay.appendChild(line);
        }
        
        // Draw vertical lines
        for (let x = 0; x <= ARENA_WIDTH; x++) {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', x * cellSize);
            line.setAttribute('y1', 0);
            line.setAttribute('x2', x * cellSize);
            line.setAttribute('y2', ARENA_HEIGHT * cellSize);
            line.setAttribute('stroke', '#444');
            line.setAttribute('stroke-width', 1);
            gridOverlay.appendChild(line);
        }
        
        // Create clickable cells for grid interaction
        for (let y = 0; y < ARENA_HEIGHT; y++) {
            for (let x = 0; x < ARENA_WIDTH; x++) {
                const cell = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                cell.setAttribute('x', x * cellSize);
                cell.setAttribute('y', y * cellSize);
                cell.setAttribute('width', cellSize);
                cell.setAttribute('height', cellSize);
                cell.setAttribute('fill', 'transparent');
                cell.setAttribute('data-x', x);
                cell.setAttribute('data-y', y);
                cell.classList.add('grid-cell');
                
                // Add event listeners for cell interaction
                cell.addEventListener('click', handleCellClick);
                cell.addEventListener('mouseenter', () => handleCellHover(x, y));
                cell.addEventListener('mouseleave', () => clearCellHover());
                
                gridOverlay.appendChild(cell);
            }
        }
    }
    
    // Initialize UI elements and event listeners
    function initUI() {
        // Add creature button
        document.getElementById('add-creature-btn').addEventListener('click', showAddCreatureForm);
        
        // Form submission for adding creatures
        document.getElementById('creature-form').addEventListener('submit', handleAddCreature);
        
        // Next turn button
        document.getElementById('next-turn-btn').addEventListener('click', nextTurn);
        
        // Action buttons
        document.querySelectorAll('.action-btn').forEach(btn => {
            btn.addEventListener('click', () => handleActionSelect(btn.dataset.action));
        });
        
        // Close target selection button
        closeTargetBtn.addEventListener('click', () => {
            targetModal.style.display = 'none';
            isTargetSelectionOpen = false;
        });
        
        // AI toggle
        document.getElementById('ai-toggle').addEventListener('change', toggleAI);
    }
    
    // Handle cell click event
    function handleCellClick(event) {
        const x = parseInt(event.target.getAttribute('data-x'));
        const y = parseInt(event.target.getAttribute('data-y'));
        
        if (selectedAction === 'move' && activeCreature) {
            moveCreature(activeCreature, x, y);
        } else if (selectedAction === 'place' && !getCreatureAt(x, y)) {
            // Show add creature form at the selected position
            document.getElementById('creature-x').value = x;
            document.getElementById('creature-y').value = y;
            showAddCreatureForm();
        }
    }
    
    // Handle cell hover
    function handleCellHover(x, y) {
        hoveredCell = { x, y };
        
        if (activeCreature && selectedAction === 'move') {
            showMoveRange(activeCreature, x, y);
        }
    }
    
    // Clear cell hover effects
    function clearCellHover() {
        hoveredCell = null;
        // Clear range indicators
        rangeIndicator.innerHTML = '';
    }
    
    // Add a new creature to the battle
    function addCreature(name, type, team, hp, ac, x, y, initiative, attackBonus, damageBonus, damageDice) {
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
            conditions: [],
            element: null
        };
        
        creatures.push(creature);
        renderCreature(creature);
        addToInitiative(creature);
        
        // Log the addition
        logMessage(`${name} (${type}) joins the battle for ${team}!`);
        
        return creature;
    }
    
    // Render a creature on the grid
    function renderCreature(creature) {
        // Remove existing render if any
        if (creature.element) {
            creature.element.remove();
        }
        
        const cellSize = parseInt(gridOverlay.querySelector('.grid-cell').getAttribute('width'));
        
        // Create group for the creature
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.classList.add('creature');
        group.setAttribute('data-id', creature.id);
        group.setAttribute('transform', `translate(${creature.x * cellSize}, ${creature.y * cellSize})`);
        
        // Create circle for the creature body
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', cellSize / 2);
        circle.setAttribute('cy', cellSize / 2);
        circle.setAttribute('r', cellSize / 2 * 0.8);
        circle.setAttribute('fill', getTeamColor(creature.team));
        group.appendChild(circle);
        
        // Add HP indicator
        const hpText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        hpText.setAttribute('x', cellSize / 2);
        hpText.setAttribute('y', cellSize / 2);
        hpText.setAttribute('text-anchor', 'middle');
        hpText.setAttribute('dominant-baseline', 'middle');
        hpText.setAttribute('fill', '#fff');
        hpText.setAttribute('font-size', cellSize / 3);
        hpText.textContent = creature.hp;
        hpText.classList.add('creature-hp');
        group.appendChild(hpText);
        
        // Add label with creature name and type
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', cellSize / 2);
        label.setAttribute('y', cellSize + 5);
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('fill', '#fff');
        label.setAttribute('font-size', cellSize / 4);
        label.setAttribute('stroke', '#000');
        label.setAttribute('stroke-width', '0.5px');
        label.textContent = creature.name;
        group.appendChild(label);
        
        // Add event listeners for drag interaction
        group.addEventListener('mousedown', (e) => startDrag(e, creature));
        
        // Add to creatures layer
        creaturesLayer.appendChild(group);
        creature.element = group;
        
        // Highlight active creature
        if (activeCreature && creature.id === activeCreature.id) {
            highlightActiveCreature(creature);
        }
        
        // Show conditions if any
        updateCreatureConditions(creature);
    }
    
    // Get color based on team
    function getTeamColor(team) {
        if (team === 'Team 1') return '#3498db';
        if (team === 'Team 2') return '#e74c3c';
        return '#2ecc71'; // Default or other teams
    }
    
    // Handle drag start
    function startDrag(event, creature) {
        // Only allow dragging if in placement mode or it's the active creature's turn
        if (selectedAction === 'place' || 
           (activeCreature && creature.id === activeCreature.id)) {
            event.preventDefault();
            isDragging = true;
            draggedCreature = creature;
            
            // Add global mouse events
            document.addEventListener('mousemove', handleDrag);
            document.addEventListener('mouseup', endDrag);
        }
    }
    
    // Handle dragging
    function handleDrag(event) {
        if (!isDragging || !draggedCreature) return;
        
        const cellSize = parseInt(gridOverlay.querySelector('.grid-cell').getAttribute('width'));
        const rect = arena.getBoundingClientRect();
        
        // Calculate grid coordinates
        const x = Math.floor((event.clientX - rect.left) / cellSize);
        const y = Math.floor((event.clientY - rect.top) / cellSize);
        
        // Ensure within bounds
        if (x >= 0 && x < ARENA_WIDTH && y >= 0 && y < ARENA_HEIGHT) {
            // Check if can move here
            if (!getCreatureAt(x, y) || (draggedCreature.x === x && draggedCreature.y === y)) {
                // Update visual position
                draggedCreature.element.setAttribute('transform', 
                    `translate(${x * cellSize}, ${y * cellSize})`);
                
                // Highlight potential drop location
                highlightCell(x, y, 'rgba(0, 255, 0, 0.3)');
            }
        }
    }
    
    // Handle drag end
    function endDrag(event) {
        if (!isDragging || !draggedCreature) return;
        
        const cellSize = parseInt(gridOverlay.querySelector('.grid-cell').getAttribute('width'));
        const rect = arena.getBoundingClientRect();
        
        // Calculate final grid coordinates
        const x = Math.floor((event.clientX - rect.left) / cellSize);
        const y = Math.floor((event.clientY - rect.top) / cellSize);
        
        // Ensure within bounds and no other creature is there
        if (x >= 0 && x < ARENA_WIDTH && y >= 0 && y < ARENA_HEIGHT) {
            if (!getCreatureAt(x, y) || (draggedCreature.x === x && draggedCreature.y === y)) {
                // If it's the active creature moving, apply movement rules
                if (activeCreature && draggedCreature.id === activeCreature.id && selectedAction === 'move') {
                    moveCreature(draggedCreature, x, y);
                } else {
                    // Just update position for placement
                    draggedCreature.x = x;
                    draggedCreature.y = y;
                    renderCreature(draggedCreature);
                }
            } else {
                // Revert to original position
                draggedCreature.element.setAttribute('transform', 
                    `translate(${draggedCreature.x * cellSize}, ${draggedCreature.y * cellSize})`);
            }
        } else {
            // Revert to original position
            draggedCreature.element.setAttribute('transform', 
                `translate(${draggedCreature.x * cellSize}, ${draggedCreature.y * cellSize})`);
        }
        
        // Clean up
        isDragging = false;
        draggedCreature = null;
        document.removeEventListener('mousemove', handleDrag);
        document.removeEventListener('mouseup', endDrag);
        
        // Clear all highlights
        clearHighlights();
    }
    
    // Move a creature to a new position
    function moveCreature(creature, x, y) {
        // Calculate distance in 5ft squares (assuming each cell is 5ft)
        const distance = calculateDistance(creature.x, creature.y, x, y) * 5;
        
        // Check if within movement range
        if (distance <= creature.remainingMove) {
            // Update position
            creature.x = x;
            creature.y = y;
            
            // Reduce remaining movement
            creature.remainingMove -= distance;
            
            // Update rendering
            renderCreature(creature);
            
            // Log the movement
            logMessage(`${creature.name} moves to (${x},${y}). ${creature.remainingMove}ft of movement remaining.`);
            
            // Update UI to show remaining movement
            updateUI();
        } else {
            logMessage(`${creature.name} cannot move that far! ${creature.remainingMove}ft remaining.`, 'warning');
        }
    }
    
    // Calculate grid distance between two points (using 5e diagonal rules)
    function calculateDistance(x1, y1, x2, y2) {
        // In D&D 5e, moving diagonally counts as 5ft (not 7.07ft)
        return Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    }
    
    // Add creature to initiative order
    function addToInitiative(creature) {
        // Add to initiative order
        initiativeOrder.push(creature);
        
        // Sort by initiative, highest first
        initiativeOrder.sort((a, b) => b.initiative - a.initiative);
        
        // Update initiative display
        updateInitiativeList();
    }
    
    // Update initiative list display
    function updateInitiativeList() {
        initiativeList.innerHTML = '';
        
        initiativeOrder.forEach((creature, index) => {
            const item = document.createElement('div');
            item.classList.add('initiative-item');
            
            // Highlight current turn
            if (initiativeOrder[currentTurn] && index === currentTurn) {
                item.classList.add('current-turn');
            }
            
            // Show initiative roll and name
            item.innerHTML = `
                <span class="initiative-roll">${creature.initiative}</span>
                <span class="initiative-name">${creature.name}</span>
                <span class="initiative-hp">${creature.hp}/${creature.maxHp} HP</span>
            `;
            
            // Color based on team
            item.style.borderColor = getTeamColor(creature.team);
            
            initiativeList.appendChild(item);
        });
    }
    
    // Process next turn
    function nextTurn() {
        // If there are no creatures, do nothing
        if (initiativeOrder.length === 0) {
            logMessage("Add creatures to start the battle!", 'info');
            return;
        }
        
        // Clear selected action
        selectedAction = null;
        
        // Move to next creature
        currentTurn = (currentTurn + 1) % initiativeOrder.length;
        
        // Set active creature
        activeCreature = initiativeOrder[currentTurn];
        
        // Reset creature's movement and actions for the new turn
        activeCreature.remainingMove = activeCreature.speed;
        activeCreature.hasAction = true;
        activeCreature.hasBonusAction = true;
        
        // Remove dodge condition if it was active
        if (activeCreature.conditions.includes('dodge')) {
            removeCondition(activeCreature, 'dodge');
        }
        
        // Log turn change
        logMessage(`It's ${activeCreature.name}'s turn (${activeCreature.team})!`);
        
        // Highlight active creature
        highlightActiveCreature(activeCreature);
        
        // Update UI
        updateInitiativeList();
        updateUI();
        
        // Check if AI should act
        const aiToggle = document.getElementById('ai-toggle');
        if (aiToggle.checked) {
            setTimeout(handleAI, 500); // Delay AI actions for better visualization
        }
    }
    
    // Highlight the active creature
    function highlightActiveCreature(creature) {
        // Clear existing highlights
        document.querySelectorAll('.creature').forEach(el => {
            el.classList.remove('active-creature');
        });
        
        // Highlight active creature
        if (creature && creature.element) {
            creature.element.classList.add('active-creature');
            
            // Show movement range
            showMovementRange(creature);
        }
    }
    
    // Roll a d20
    function rollD20() {
        return Math.floor(Math.random() * 20) + 1;
    }
    
    // Roll any dice (format: "2d6+3")
    function rollDice(diceString) {
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
    
    // Get creature at specific grid coordinates
    function getCreatureAt(x, y) {
        return creatures.find(c => c.x === x && c.y === y);
    }
    
    // Log a message to the combat log
    function logMessage(message, type = 'normal') {
        const log = document.createElement('div');
        log.classList.add('log-entry');
        log.classList.add(`log-${type}`);
        log.textContent = message;
        
        logContainer.appendChild(log);
        logContainer.scrollTop = logContainer.scrollHeight;
    }
    
    // Highlight a specific cell
    function highlightCell(x, y, color) {
        // Clear existing highlights
        clearHighlights();
        
        // Find the cell
        const cell = gridOverlay.querySelector(`[data-x="${x}"][data-y="${y}"]`);
        if (cell) {
            cell.setAttribute('fill', color);
        }
    }
    
    // Clear all cell highlights
    function clearHighlights() {
        gridOverlay.querySelectorAll('.grid-cell').forEach(cell => {
            cell.setAttribute('fill', 'transparent');
        });
    }
    
    // Handle action selection
    function handleActionSelect(action) {
        if (!activeCreature) {
            logMessage("No active creature selected!", 'warning');
            return;
        }
        
        // If creature already used their action
        if ((action !== 'move' && !activeCreature.hasAction) || 
            (action === 'move' && activeCreature.remainingMove <= 0)) {
            logMessage(`${activeCreature.name} has no ${action === 'move' ? 'movement' : 'action'} left!`, 'warning');
            return;
        }
        
        selectedAction = action;
        
        // Clear existing range indicators
        rangeIndicator.innerHTML = '';
        
        // Show appropriate UI for the action
        switch(action) {
            case 'move':
                showMovementRange(activeCreature);
                logMessage(`Select a destination for ${activeCreature.name}`);
                break;
                
            case 'attack':
                showAttackRange(activeCreature);
                logMessage(`Select a target for ${activeCreature.name} to attack`);
                openTargetSelection(getTargetsInRange(activeCreature, 5)); // Assuming 5ft reach
                break;
                
            case 'dash':
                activeCreature.remainingMove += activeCreature.speed;
                activeCreature.hasAction = false;
                logMessage(`${activeCreature.name} dashes and gains ${activeCreature.speed}ft of movement!`);
                showMovementRange(activeCreature);
                updateUI();
                break;
                
            case 'dodge':
                addCondition(activeCreature, 'dodge');
                activeCreature.hasAction = false;
                logMessage(`${activeCreature.name} takes the dodge action!`);
                updateUI();
                break;
                
            case 'disengage':
                addCondition(activeCreature, 'disengage');
                activeCreature.hasAction = false;
                logMessage(`${activeCreature.name} disengages from combat!`);
                updateUI();
                break;
                
            case 'help':
                // Open target selection for allies
                openTargetSelection(
                    creatures.filter(c => c.team === activeCreature.team && c.id !== activeCreature.id),
                    'help'
                );
                logMessage(`Select an ally to help`);
                break;
        }
    }
    
    // Show movement range for a creature
    function showMovementRange(creature) {
        const cellSize = parseInt(gridOverlay.querySelector('.grid-cell').getAttribute('width'));
        
        // Clear existing range indicators
        rangeIndicator.innerHTML = '';
        
        // Calculate how many squares the creature can move
        const squaresRemaining = Math.floor(creature.remainingMove / 5);
        
        // Show movement range as a circle
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', (creature.x + 0.5) * cellSize);
        circle.setAttribute('cy', (creature.y + 0.5) * cellSize);
        circle.setAttribute('r', squaresRemaining * cellSize);
        circle.setAttribute('fill', 'rgba(0, 255, 0, 0.1)');
        circle.setAttribute('stroke', 'rgba(0, 255, 0, 0.8)');
        circle.setAttribute('stroke-width', 2);
        circle.setAttribute('stroke-dasharray', '5,5');
        rangeIndicator.appendChild(circle);
    }
    
    // Show attack range for a creature
    function showAttackRange(creature, range = 5) {
        const cellSize = parseInt(gridOverlay.querySelector('.grid-cell').getAttribute('width'));
        
        // Clear existing range indicators
        rangeIndicator.innerHTML = '';
        
        // Calculate how many squares the attack can reach
        const squaresRange = Math.floor(range / 5);
        
        // Show attack range as a circle
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', (creature.x + 0.5) * cellSize);
        circle.setAttribute('cy', (creature.y + 0.5) * cellSize);
        circle.setAttribute('r', squaresRange * cellSize);
        circle.setAttribute('fill', 'rgba(255, 0, 0, 0.1)');
        circle.setAttribute('stroke', 'rgba(255, 0, 0, 0.8)');
        circle.setAttribute('stroke-width', 2);
        rangeIndicator.appendChild(circle);
    }
    
    // Show movement path to a target location
    function showMoveRange(creature, targetX, targetY) {
        // Clear existing path
        rangeIndicator.querySelectorAll('.path-segment').forEach(el => el.remove());
        
        // If no hover target, keep general movement range
        if (targetX === undefined || targetY === undefined) return;
        
        const cellSize = parseInt(gridOverlay.querySelector('.grid-cell').getAttribute('width'));
        
        // Simple direct path for now (for A* implementation later)
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        path.setAttribute('x1', (creature.x + 0.5) * cellSize);
        path.setAttribute('y1', (creature.y + 0.5) * cellSize);
        path.setAttribute('x2', (targetX + 0.5) * cellSize);
        path.setAttribute('y2', (targetY + 0.5) * cellSize);
        path.setAttribute('stroke', 'white');
        path.setAttribute('stroke-width', 3);
        path.setAttribute('stroke-dasharray', '8,4');
        path.classList.add('path-segment');
        rangeIndicator.appendChild(path);
        
        // Calculate distance
        const distance = calculateDistance(creature.x, creature.y, targetX, targetY) * 5;
        
        // Highlight cell green if movable, red if not
        if (distance <= creature.remainingMove && !getCreatureAt(targetX, targetY)) {
            highlightCell(targetX, targetY, 'rgba(0, 255, 0, 0.3)');
        } else {
            highlightCell(targetX, targetY, 'rgba(255, 0, 0, 0.3)');
        }
    }
    
    // Get targets in range of a creature
    function getTargetsInRange(creature, range = 5) {
        const squaresRange = Math.floor(range / 5);
        
        return creatures.filter(target => {
            // Skip self and defeated creatures
            if (target.id === creature.id || target.hp <= 0) return false;
            
            // Skip allies for attacks
            if (target.team === creature.team && selectedAction === 'attack') return false;
            
            // Calculate distance
            const distance = calculateDistance(creature.x, creature.y, target.x, target.y);
            
            return distance <= squaresRange;
        });
    }
    
    // Open target selection modal
    function openTargetSelection(targets, actionType = 'attack') {
        // If no valid targets
        if (!targets || targets.length === 0) {
            logMessage("No valid targets in range!", 'warning');
            selectedAction = null;
            return;
        }
        
        // Clear existing targets
        targetList.innerHTML = '';
        
        // Add each target to the list
        targets.forEach(target => {
            const item = document.createElement('div');
            item.classList.add('target-item');
            item.dataset.id = target.id;
            
            item.innerHTML = `
                <span class="target-name">${target.name}</span>
                <span class="target-hp">${target.hp}/${target.maxHp} HP</span>
                <span class="target-ac">AC: ${target.ac}</span>
            `;
            
            // Highlight with team color
            item.style.borderColor = getTeamColor(target.team);
            
            // Add click handler
            item.addEventListener('click', () => {
                targetModal.style.display = 'none';
                isTargetSelectionOpen = false;
                
                if (actionType === 'attack') {
                    attackTarget(activeCreature, target);
                } else if (actionType === 'help') {
                    helpTarget(activeCreature, target);
                }
            });
            
            targetList.appendChild(item);
        });
        
        // Show the modal
        targetModal.style.display = 'block';
        isTargetSelectionOpen = true;
    }
    
    // Attack a target
    function attackTarget(attacker, target) {
        // Use action
        attacker.hasAction = false;
        
        // Roll attack with advantage if target is dodging
        let attackRoll;
        let advantageType = 'normal';
        
        if (target.conditions.includes('dodge')) {
            // Roll with disadvantage against dodging targets
            const roll1 = rollD20();
            const roll2 = rollD20();
            attackRoll = Math.min(roll1, roll2);
            advantageType = 'disadvantage';
            
            logMessage(`${attacker.name} attacks ${target.name} with disadvantage (dodge)! Rolls ${roll1} and ${roll2}, takes ${attackRoll}.`);
        } else {
            attackRoll = rollD20();
            logMessage(`${attacker.name} attacks ${target.name}! Rolls ${attackRoll}.`);
        }
        
        // Add attack bonus
        const totalAttack = attackRoll + attacker.attackBonus;
        
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
                
                logMessage(`CRITICAL HIT! ${attacker.name} hits ${target.name} for ${damage} damage!`, 'critical');
            } else {
                logMessage(`HIT! ${attacker.name} hits ${target.name} for ${damage} damage!`);
            }
            
            // Apply damage
            target.hp = Math.max(0, target.hp - damage);
            
            // Check if target is defeated
            if (target.hp <= 0) {
                logMessage(`${target.name} is defeated!`, 'critical');
                
                // Remove from initiative if in combat
                const initIndex = initiativeOrder.findIndex(c => c.id === target.id);
                if (initIndex !== -1) {
                    initiativeOrder.splice(initIndex, 1);
                    
                    // Adjust current turn if needed
                    if (initIndex <= currentTurn && currentTurn > 0) {
                        currentTurn--;
                    }
                    
                    // Update initiative display
                    updateInitiativeList();
                }
                
                // Remove from battlefield
                if (target.element) {
                    target.element.remove();
                }
                
                // Remove from creatures array
                const index = creatures.findIndex(c => c.id === target.id);
                if (index !== -1) {
                    creatures.splice(index, 1);
                }
                
                // Check win condition
                checkWinCondition();
            } else {
                // Update creature rendering
                renderCreature(target);
            }
        } else {
            logMessage(`MISS! ${attacker.name}'s attack misses ${target.name}!`, 'miss');
        }
        
        // Update UI
        updateUI();
    }
    
    // Help target (grant advantage)
    function helpTarget(helper, target) {
        // Use action
        helper.hasAction = false;
        
        // Add help condition to target
        addCondition(target, 'helped');
        
        logMessage(`${helper.name} helps ${target.name}, granting advantage on their next attack!`);
        
        // Update UI
        updateUI();
    }
    
    // Add condition to a creature
    function addCondition(creature, condition) {
        if (!creature.conditions.includes(condition)) {
            creature.conditions.push(condition);
            updateCreatureConditions(creature);
        }
    }
    
    // Remove condition from a creature
    function removeCondition(creature, condition) {
        const index = creature.conditions.indexOf(condition);
        if (index !== -1) {
            creature.conditions.splice(index, 1);
            updateCreatureConditions(creature);
        }
    }
    
    // Update creature condition indicators
    function updateCreatureConditions(creature) {
        if (!creature.element) return;
        
        // Remove existing condition indicators
        creature.element.querySelectorAll('.condition-indicator').forEach(el => el.remove());
        
        const cellSize = parseInt(gridOverlay.querySelector('.grid-cell').getAttribute('width'));
        
        // Add indicators for each condition
        creature.conditions.forEach((condition, index) => {
            const indicator = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            indicator.setAttribute('cx', cellSize * 0.25);
            indicator.setAttribute('cy', cellSize * 0.25 + (index * 15));
            indicator.setAttribute('r', cellSize * 0.1);
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
    
    // Check win condition
    function checkWinCondition() {
        // Get surviving teams
        const survivingTeams = [...new Set(creatures.map(c => c.team))];
        
        // If only one team left, they win
        if (survivingTeams.length === 1) {
            logMessage(`${survivingTeams[0]} wins the battle!`, 'victory');
        } else if (survivingTeams.length === 0) {
            logMessage('Everyone is defeated! It\'s a draw!', 'victory');
        }
    }
    
    // Update UI elements based on current state
    function updateUI() {
        // Update action buttons based on available actions
        if (activeCreature) {
            document.querySelectorAll('.action-btn').forEach(btn => {
                const action = btn.dataset.action;
                
                // Disable action buttons if action used
                if (action !== 'move' && !activeCreature.hasAction) {
                    btn.disabled = true;
                    btn.classList.add('disabled');
                } else if (action === 'move' && activeCreature.remainingMove <= 0) {
                    btn.disabled = true;
                    btn.classList.add('disabled');
                } else {
                    btn.disabled = false;
                    btn.classList.remove('disabled');
                }
            });
            
            // Update movement display
            document.getElementById('movement-remaining').textContent = 
                `${activeCreature.remainingMove}/${activeCreature.speed}ft`;
                
            // Show active creature stats
            document.getElementById('active-creature-info').innerHTML = `
                <strong>${activeCreature.name}</strong> (${activeCreature.team})<br>
                HP: ${activeCreature.hp}/${activeCreature.maxHp} | AC: ${activeCreature.ac}
            `;
        } else {
            // No active creature
            document.querySelectorAll('.action-btn').forEach(btn => {
                btn.disabled = true;
                btn.classList.add('disabled');
            });
            
            document.getElementById('movement-remaining').textContent = '0/0ft';
            document.getElementById('active-creature-info').textContent = 'No active creature';
        }
        
        // Update initiative list
        updateInitiativeList();
    }
    
    // Show add creature form
    function showAddCreatureForm() {
        const form = document.getElementById('creature-form-container');
        form.style.display = 'block';
    }
    
    // Handle add creature form submission
    function handleAddCreature(event) {
        event.preventDefault();
        
        // Get form values
        const name = document.getElementById('creature-name').value || 'Creature';
        const type = document.getElementById('creature-type').value || 'Fighter';
        const team = document.getElementById('creature-team').value || 'Team 1';
        const hp = document.getElementById('creature-hp').value || '10';
        const ac = document.getElementById('creature-ac').value || '10';
        const x = document.getElementById('creature-x').value || '0';
        const y = document.getElementById('creature-y').value || '0';
        const initiative = document.getElementById('creature-initiative').value || '';
        const attackBonus = document.getElementById('creature-attack').value || '0';
        const damageBonus = document.getElementById('creature-damage').value || '0';
        const damageDice = document.getElementById('creature-damage-dice').value || '1d6';
        
        // Create creature
        addCreature(name, type, team, hp, ac, x, y, initiative, attackBonus, damageBonus, damageDice);
        
        // Hide form
        document.getElementById('creature-form-container').style.display = 'none';
        
        // Reset form
        event.target.reset();
        
        // If first creature, start initiative
        if (initiativeOrder.length === 1) {
            currentTurn = 0;
            activeCreature = initiativeOrder[0];
            highlightActiveCreature(activeCreature);
            updateUI();
            logMessage(`Battle begins! ${activeCreature.name} goes first!`);
        }
    }
    
    // Handle AI for computer-controlled creatures
    function handleAI() {
        // Only act if it's AI's turn
        if (!activeCreature) return;
        
        // Get enemies (different team)
        const enemies = creatures.filter(c => c.team !== activeCreature.team && c.hp > 0);
        
        // If no enemies, end turn
        if (enemies.length === 0) {
            nextTurn();
            return;
        }
        
        // Simple AI: move towards closest enemy and attack if in range
        const closestEnemy = findClosestCreature(activeCreature, enemies);
        
        // If enemy in attack range (5ft or 1 square)
        if (calculateDistance(activeCreature.x, activeCreature.y, closestEnemy.x, closestEnemy.y) <= 1) {
            // Attack the enemy
            selectedAction = 'attack';
            attackTarget(activeCreature, closestEnemy);
        } else {
            // Move towards enemy
            selectedAction = 'move';
            
            // Simple pathfinding - move directly towards target
            const dx = closestEnemy.x - activeCreature.x;
            const dy = closestEnemy.y - activeCreature.y;
            
            // Normalize direction
            const distance = Math.max(Math.abs(dx), Math.abs(dy));
            const stepX = dx !== 0 ? Math.sign(dx) : 0;
            const stepY = dy !== 0 ? Math.sign(dy) : 0;
            
            // Calculate max steps based on remaining movement
            const maxSteps = Math.floor(activeCreature.remainingMove / 5);
            const steps = Math.min(distance, maxSteps);
            
            // Try to move
            let newX = activeCreature.x;
            let newY = activeCreature.y;
            
            // Try to move along each step
            for (let i = 0; i < steps; i++) {
                const nextX = newX + stepX;
                const nextY = newY + stepY;
                
                // Check if the space is empty
                if (!getCreatureAt(nextX, nextY)) {
                    newX = nextX;
                    newY = nextY;
                } else {
                    // Try to move only horizontally or vertically
                    if (stepX !== 0 && !getCreatureAt(newX + stepX, newY)) {
                        newX += stepX;
                    } else if (stepY !== 0 && !getCreatureAt(newX, newY + stepY)) {
                        newY += stepY;
                    } else {
                        // Can't move further
                        break;
                    }
                }
            }
            
            // If we found a new position, move there
            if (newX !== activeCreature.x || newY !== activeCreature.y) {
                moveCreature(activeCreature, newX, newY);
                
                // If we can attack after moving, do so
                if (calculateDistance(newX, newY, closestEnemy.x, closestEnemy.y) <= 1 && activeCreature.hasAction) {
                    setTimeout(() => {
                        selectedAction = 'attack';
                        attackTarget(activeCreature, closestEnemy);
                        
                        // End turn after attack
                        setTimeout(nextTurn, 1000);
                    }, 500);
                    return; // Wait for the attack to complete
                }
            } else if (activeCreature.hasAction) {
                // If we couldn't move but still have an action, dash
                selectedAction = 'dash';
                handleActionSelect('dash');
            }
        }
        
        // End turn after AI acts
        setTimeout(nextTurn, 1000);
    }
    
    // Find closest creature to a source creature from a list
    function findClosestCreature(source, creatureList) {
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
    
    // Toggle AI control
    function toggleAI(event) {
        if (event.target.checked) {
            logMessage("AI control enabled. Computer will play turns automatically.");
            
            // If it's already an AI turn, make it act
            if (activeCreature) {
                handleAI();
            }
        } else {
            logMessage("AI control disabled. Use the Next Turn button to progress.");
        }
    }
    
    // Initialize the simulator
    initArena();
    
    // Add some default creatures if the arena is empty
    if (creatures.length === 0) {
        // Add a few example creatures
        addCreature("Hero", "Fighter", "Team 1", 20, 16, 5, 5, 18, 5, 3, "1d8");
        addCreature("Goblin 1", "Goblin", "Team 2", 7, 15, 20, 5, 12, 4, 2, "1d6");
        addCreature("Goblin 2", "Goblin", "Team 2", 7, 15, 22, 7, 8, 4, 2, "1d6");
        
        // Start combat
        currentTurn = 0;
        activeCreature = initiativeOrder[0];
        highlightActiveCreature(activeCreature);
        updateUI();
        logMessage("Battle begins! " + activeCreature.name + " goes first!");
    }
    
    // Ensure target modal is hidden initially
    targetModal.style.display = 'none';
});