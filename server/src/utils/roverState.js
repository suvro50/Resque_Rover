// ============================================================================
// GridZero Server — In-Memory Rover State Manager
// ============================================================================
// Manages real-time operational state (START/STOP and Direction Commands)
// for low-latency response to ESP32 polling and Dashboard WebSockets.
// ============================================================================

const roverStates = {
    'GZ-ROVER-01': {
        rover_id: 'GZ-ROVER-01',
        is_active: false,
        operation_mode: 'idle',
        command: 'stop',
        speed: 200,
        motor_left_speed: 0,
        motor_right_speed: 0,
        last_updated: new Date()
    }
};

function getRoverState(roverId = 'GZ-ROVER-01') {
    if (!roverStates[roverId]) {
        roverStates[roverId] = {
            rover_id: roverId,
            is_active: false,
            operation_mode: 'idle',
            command: 'stop',
            speed: 200,
            motor_left_speed: 0,
            motor_right_speed: 0,
            last_updated: new Date()
        };
    }
    return roverStates[roverId];
}

function setRoverActive(roverId = 'GZ-ROVER-01', active = true) {
    const state = getRoverState(roverId);
    state.is_active = Boolean(active);
    state.operation_mode = active ? 'manual' : 'idle';
    state.command = 'stop';
    state.motor_left_speed = 0;
    state.motor_right_speed = 0;
    state.last_updated = new Date();
    return state;
}

function setRoverCommand(roverId = 'GZ-ROVER-01', command = 'stop', speed = 200) {
    const state = getRoverState(roverId);
    if (!state.is_active && command !== 'stop') {
        return { success: false, error: 'Rover is STOPPED. Start rover first.', state };
    }
    const clampedSpeed = Math.min(Math.max(parseInt(speed) || 200, 0), 255);
    state.command = command;
    state.speed = clampedSpeed;

    switch (command) {
        case 'forward':
            state.motor_left_speed = clampedSpeed;
            state.motor_right_speed = clampedSpeed;
            break;
        case 'backward':
            state.motor_left_speed = -clampedSpeed;
            state.motor_right_speed = -clampedSpeed;
            break;
        case 'left':
            state.motor_left_speed = -clampedSpeed;
            state.motor_right_speed = clampedSpeed;
            break;
        case 'right':
            state.motor_left_speed = clampedSpeed;
            state.motor_right_speed = -clampedSpeed;
            break;
        case 'stop':
        default:
            state.command = 'stop';
            state.motor_left_speed = 0;
            state.motor_right_speed = 0;
            break;
    }
    state.last_updated = new Date();
    return { success: true, state };
}

module.exports = {
    getRoverState,
    setRoverActive,
    setRoverCommand
};
