import { describe, it, expect } from 'vitest';
import { agentManager } from '../AgentManager.js';
import { Socket } from 'socket.io';

describe('AgentManager', () => {
  it('should register and retrieve a socket', () => {
    const mockSocket = { id: 'socket-123' } as unknown as Socket;
    agentManager.registerAgent('user-1', mockSocket);
    
    const retrieved = agentManager.getSocket('user-1');
    expect(retrieved).toBe(mockSocket);
    expect(retrieved?.id).toBe('socket-123');
  });

  it('should return undefined for unregistered user', () => {
    const retrieved = agentManager.getSocket('unknown-user');
    expect(retrieved).toBeUndefined();
  });

  it('should unregister a socket', () => {
    const mockSocket = { id: 'socket-123' } as unknown as Socket;
    agentManager.registerAgent('user-2', mockSocket);
    
    expect(agentManager.getSocket('user-2')).toBe(mockSocket);
    
    agentManager.unregisterAgent('user-2');
    expect(agentManager.getSocket('user-2')).toBeUndefined();
  });
});
