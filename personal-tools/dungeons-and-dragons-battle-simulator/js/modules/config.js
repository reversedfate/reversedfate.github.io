// Configuration and constants for D&D Battle Simulator
import { getTeamColor } from './common.js';

// Default grid settings
export const DEFAULT_GRID_SIZE = 20; // Size of each grid square in pixels
export const DEFAULT_ARENA_WIDTH = 30; // Number of squares horizontally
export const DEFAULT_ARENA_HEIGHT = 20; // Number of squares vertically

// 5e.tools default URL
export const DEFAULT_5E_TOOLS_URL = "https://5e.tools";

// Re-export getTeamColor to avoid circular dependencies
export { getTeamColor };

// Game state
export const gameState = {
    creatures: [], // All creatures in the battle
    teams: ['Team 1', 'Team 2', 'Team 3', 'Team 4'], // Available teams
    activeCreature: null, // Currently active creature
    initiativeOrder: [], // Sorted initiative order
    currentTurn: 0, // Current turn index in initiative order
    isTargetSelectionOpen: false, // Track if target selection is open
    selectedAction: null, // Currently selected action
    hoveredCell: null, // Currently hovered grid cell
    isDragging: false, // Is the user dragging a creature
    draggedCreature: null, // The creature being dragged
    gridSize: DEFAULT_GRID_SIZE,
    arenaWidth: DEFAULT_ARENA_WIDTH,
    arenaHeight: DEFAULT_ARENA_HEIGHT,
    roundNumber: 0, // Current round number
    customToolsUrl: '', // URL for custom self-hosted 5e.tools website
};