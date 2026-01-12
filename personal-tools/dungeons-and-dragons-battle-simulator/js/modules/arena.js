// Arena management and grid functionality for D&D Battle Simulator
import { gameState } from './config.js';
import { logMessage } from './utils.js';
import { calculateDistance } from './common.js';
import { eventBus } from './common.js';

// Initialize the arena
export function initArena() {
    // Get SVG element
    const svg = document.getElementById('svg');
    if (!svg) return;
    
    // Set SVG dimensions
    resizeArena();
    window.addEventListener('resize', resizeArena);
    
    // Create grid
    drawGrid();
    
    // Update round display
    updateRoundDisplay();
    
    // Make resizeArena globally available
    window._resizeArena = resizeArena;
    
    // Set up map dragging
    setupMapDragging();
}

// Variables for map dragging
let isDraggingMap = false;
let lastMouseX = 0;
let lastMouseY = 0;
let mapOffsetX = 0;
let mapOffsetY = 0;

// Set up map dragging functionality
function setupMapDragging() {
    const arena = document.getElementById('arena');
    const svg = document.getElementById('svg');
    if (!arena || !svg) return;
    
    // Create a viewBox for the SVG to enable panning
    const width = arena.clientWidth;
    const height = arena.clientHeight;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    
    // Add event listeners for dragging
    svg.addEventListener('mousedown', startMapDrag);
    document.addEventListener('mousemove', dragMap);
    document.addEventListener('mouseup', endMapDrag);
    
    // Add touch support for mobile
    svg.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            // Prevent default only for single-finger drag
            e.preventDefault();
            const touch = e.touches[0];
            startMapDrag({
                clientX: touch.clientX,
                clientY: touch.clientY,
                target: e.target
            });
        }
    });
    
    document.addEventListener('touchmove', (e) => {
        if (e.touches.length === 1 && isDraggingMap) {
            e.preventDefault();
            const touch = e.touches[0];
            dragMap({
                clientX: touch.clientX,
                clientY: touch.clientY
            });
        }
    });
    
    document.addEventListener('touchend', endMapDrag);
    
    // Add mouse wheel zoom
    svg.addEventListener('wheel', handleZoom);
}

// Start map dragging
function startMapDrag(e) {
    // Only start dragging if the click is directly on the SVG background 
    // or grid, not on a creature or other interactive element
    const isCreature = e.target.closest('.creature');
    const isButton = e.target.tagName === 'BUTTON';
    const isInput = e.target.tagName === 'INPUT';
    
    // Don't start map drag if we're clicking on a creature or UI element
    if (isCreature || isButton || isInput) return;
    
    isDraggingMap = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    
    // Add dragging class to body to change cursor
    document.body.classList.add('map-dragging');
}

// Drag the map
function dragMap(e) {
    if (!isDraggingMap) return;
    
    const svg = document.getElementById('svg');
    if (!svg) return;
    
    // Calculate how much the mouse has moved
    const deltaX = e.clientX - lastMouseX;
    const deltaY = e.clientY - lastMouseY;
    
    // Update last mouse position
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    
    // Update map offset
    mapOffsetX -= deltaX;
    mapOffsetY -= deltaY;
    
    // Update the viewBox
    const viewBox = svg.getAttribute('viewBox').split(' ');
    // Fix: Invert the signs to move the map in the same direction as the cursor drag
    const newX = parseFloat(viewBox[0]) - deltaX;
    const newY = parseFloat(viewBox[1]) - deltaY;
    
    svg.setAttribute('viewBox', `${newX} ${newY} ${viewBox[2]} ${viewBox[3]}`);
}

// End map dragging
function endMapDrag() {
    isDraggingMap = false;
    document.body.classList.remove('map-dragging');
}

// Handle mouse wheel zoom
function handleZoom(e) {
    e.preventDefault();
    
    const svg = document.getElementById('svg');
    if (!svg) return;
    
    // Get the current viewBox
    const viewBox = svg.getAttribute('viewBox').split(' ').map(parseFloat);
    
    // Calculate zoom factor based on wheel delta
    const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
    
    // Calculate the mouse position relative to the SVG
    const rect = svg.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Calculate new width and height
    const newWidth = viewBox[2] * zoomFactor;
    const newHeight = viewBox[3] * zoomFactor;
    
    // Calculate new viewBox coordinates to zoom in toward the mouse position
    const mouseViewBoxX = viewBox[0] + (mouseX / rect.width) * viewBox[2];
    const mouseViewBoxY = viewBox[1] + (mouseY / rect.height) * viewBox[3];
    
    const newX = mouseViewBoxX - (mouseX / rect.width) * newWidth;
    const newY = mouseViewBoxY - (mouseY / rect.height) * newHeight;
    
    // Set the new viewBox
    svg.setAttribute('viewBox', `${newX} ${newY} ${newWidth} ${newHeight}`);
}

// Resize the arena to fill the available space
export function resizeArena() {
    const arena = document.getElementById('arena');
    const svg = document.getElementById('svg');
    if (!arena || !svg) return;
    
    const width = arena.clientWidth;
    const height = arena.clientHeight;
    
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    
    // Adjust grid size based on container dimensions
    const cellSize = Math.min(
        Math.floor(width / gameState.arenaWidth),
        Math.floor(height / gameState.arenaHeight)
    );
    
    // Store the actual cell size
    gameState.gridSize = cellSize;
    
    // Update grid with new dimensions
    drawGrid(cellSize);
}

// Draw the grid overlay
export function drawGrid(cellSize = gameState.gridSize) {
    const svg = document.getElementById('svg');
    if (!svg) return;
    
    // Clear existing grid
    // Create a group for the grid if it doesn't exist
    let gridGroup = svg.querySelector('#grid-group');
    if (!gridGroup) {
        gridGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        gridGroup.id = 'grid-group';
        svg.appendChild(gridGroup);
    } else {
        gridGroup.innerHTML = '';
    }
    
    // Draw horizontal lines
    for (let y = 0; y <= gameState.arenaHeight; y++) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', 0);
        line.setAttribute('y1', y * cellSize);
        line.setAttribute('x2', gameState.arenaWidth * cellSize);
        line.setAttribute('y2', y * cellSize);
        line.setAttribute('stroke', '#444');
        line.setAttribute('stroke-width', 1);
        gridGroup.appendChild(line);
    }
    
    // Draw vertical lines
    for (let x = 0; x <= gameState.arenaWidth; x++) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x * cellSize);
        line.setAttribute('y1', 0);
        line.setAttribute('x2', x * cellSize);
        line.setAttribute('y2', gameState.arenaHeight * cellSize);
        line.setAttribute('stroke', '#444');
        line.setAttribute('stroke-width', 1);
        gridGroup.appendChild(line);
    }
    
    // Create clickable cells for grid interaction
    let cellGroup = svg.querySelector('#cell-group');
    if (!cellGroup) {
        cellGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        cellGroup.id = 'cell-group';
        svg.appendChild(cellGroup);
    } else {
        cellGroup.innerHTML = '';
    }
    
    for (let y = 0; y < gameState.arenaHeight; y++) {
        for (let x = 0; x < gameState.arenaWidth; x++) {
            const cell = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            cell.setAttribute('x', x * cellSize);
            cell.setAttribute('y', y * cellSize);
            cell.setAttribute('width', cellSize);
            cell.setAttribute('height', cellSize);
            cell.setAttribute('fill', 'transparent');
            cell.setAttribute('data-x', x);
            cell.setAttribute('data-y', y);
            cell.classList.add('grid-cell');
            
            // Add event listeners for cell interaction - these will be set by UI
            cellGroup.appendChild(cell);
        }
    }
    
    // Create range indicators group if it doesn't exist
    if (!svg.querySelector('#range-indicators')) {
        const rangeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        rangeGroup.id = 'range-indicators';
        svg.appendChild(rangeGroup);
    }
    
    // Create creatures group if it doesn't exist
    if (!svg.querySelector('#creatures-layer')) {
        const creaturesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        creaturesGroup.id = 'creatures-layer';
        svg.appendChild(creaturesGroup);
    }
    
    // Dispatch an event to notify that the grid has been updated
    document.dispatchEvent(new CustomEvent('grid-updated'));
    // Also notify using the event bus
    eventBus.emit('grid-updated', { cellSize });
}

// Highlight a specific cell
export function highlightCell(x, y, color) {
    // Clear existing highlights
    clearHighlights();
    
    // Find the cell
    const cell = document.querySelector(`[data-x="${x}"][data-y="${y}"]`);
    if (cell) {
        cell.setAttribute('fill', color);
    }
}

// Clear all cell highlights
export function clearHighlights() {
    const cells = document.querySelectorAll('.grid-cell');
    cells.forEach(cell => {
        cell.setAttribute('fill', 'transparent');
    });
}

// Show movement range for a creature
export function showMovementRange(creature) {
    if (!creature) return;
    
    const rangeIndicator = document.getElementById('range-indicators');
    if (!rangeIndicator) return;
    
    // Clear existing range indicators
    rangeIndicator.innerHTML = '';
    
    // Calculate how many squares the creature can move
    const squaresRemaining = Math.floor(creature.remainingMove / 5);
    
    // Show movement range as a circle
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', (creature.x + 0.5) * gameState.gridSize);
    circle.setAttribute('cy', (creature.y + 0.5) * gameState.gridSize);
    circle.setAttribute('r', squaresRemaining * gameState.gridSize);
    circle.setAttribute('fill', 'rgba(0, 255, 0, 0.1)');
    circle.setAttribute('stroke', 'rgba(0, 255, 0, 0.8)');
    circle.setAttribute('stroke-width', 2);
    circle.setAttribute('stroke-dasharray', '5,5');
    rangeIndicator.appendChild(circle);
}

// Show attack range for a creature
export function showAttackRange(creature, range = 5) {
    if (!creature) return;
    
    const rangeIndicator = document.getElementById('range-indicators');
    if (!rangeIndicator) return;
    
    // Clear existing range indicators
    rangeIndicator.innerHTML = '';
    
    // Calculate how many squares the attack can reach
    const squaresRange = Math.floor(range / 5);
    
    // Show attack range as a circle
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', (creature.x + 0.5) * gameState.gridSize);
    circle.setAttribute('cy', (creature.y + 0.5) * gameState.gridSize);
    circle.setAttribute('r', squaresRange * gameState.gridSize);
    circle.setAttribute('fill', 'rgba(255, 0, 0, 0.1)');
    circle.setAttribute('stroke', 'rgba(255, 0, 0, 0.8)');
    circle.setAttribute('stroke-width', 2);
    rangeIndicator.appendChild(circle);
}

// Show movement path to a target location
export function showMoveRange(creature, targetX, targetY) {
    if (!creature) return;
    
    const rangeIndicator = document.getElementById('range-indicators');
    if (!rangeIndicator) return;
    
    // Clear existing path
    rangeIndicator.querySelectorAll('.path-segment').forEach(el => el.remove());
    
    // If no hover target, keep general movement range
    if (targetX === undefined || targetY === undefined) return;
    
    // Simple direct path for now (for A* implementation later)
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    path.setAttribute('x1', (creature.x + 0.5) * gameState.gridSize);
    path.setAttribute('y1', (creature.y + 0.5) * gameState.gridSize);
    path.setAttribute('x2', (targetX + 0.5) * gameState.gridSize);
    path.setAttribute('y2', (targetY + 0.5) * gameState.gridSize);
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

// Update the round display
export function updateRoundDisplay() {
    const timerDisplay = document.getElementById('timerDisplay');
    if (!timerDisplay) return;
    
    if (gameState.roundNumber === 0) {
        timerDisplay.textContent = 'Round 0 - Not Started';
    } else {
        timerDisplay.textContent = `Round ${gameState.roundNumber}`;
    }
}

// Get creature at specific grid coordinates
export function getCreatureAt(x, y) {
    return gameState.creatures.find(c => c.x === x && c.y === y);
}