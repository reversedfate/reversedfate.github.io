// Common utilities and shared functions for D&D Battle Simulator
// This file helps resolve circular dependencies between modules

// Calculate grid distance between two points (using 5e diagonal rules)
export function calculateDistance(x1, y1, x2, y2) {
    // In D&D 5e, moving diagonally counts as 5ft (not 7.07ft)
    return Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
}

// Get team color based on team name
export function getTeamColor(team) {
    if (team === 'Team 1') return '#3498db'; // Blue
    if (team === 'Team 2') return '#e74c3c'; // Red
    if (team === 'Team 3') return '#2ecc71'; // Green
    if (team === 'Team 4') return '#f39c12'; // Orange
    return '#9b59b6'; // Purple (default or other teams)
}

// Global message event bus for inter-module communication
export const eventBus = {
    listeners: {},
    
    // Register a listener for an event
    on(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    },
    
    // Remove a listener
    off(event, callback) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    },
    
    // Emit an event with data
    emit(event, data) {
        if (!this.listeners[event]) return;
        this.listeners[event].forEach(callback => callback(data));
    }
};