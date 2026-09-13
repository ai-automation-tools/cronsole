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

  describe('recordHello — elevation', () => {
    it('records a true or false elevated flag from the agent', () => {
      const mockSocket = { id: 'socket-elevated' } as unknown as Socket;
      agentManager.registerAgent('user-elevated', mockSocket);

      agentManager.recordHello('user-elevated', [{ elevated: true }]);
      expect(agentManager.getLiveness('user-elevated')?.identity?.elevated).toBe(true);

      agentManager.recordHello('user-elevated', [{ elevated: false }]);
      expect(agentManager.getLiveness('user-elevated')?.identity?.elevated).toBe(false);
    });

    it('leaves elevated undefined — unknown, never a guessed false — when the agent predates the field', () => {
      const mockSocket = { id: 'socket-old' } as unknown as Socket;
      agentManager.registerAgent('user-old-agent', mockSocket);

      agentManager.recordHello('user-old-agent', [{ machineName: 'DESKTOP-1' }]);
      expect(agentManager.getLiveness('user-old-agent')?.identity?.elevated).toBeUndefined();
    });

    it('ignores a non-boolean elevated value rather than coercing it', () => {
      const mockSocket = { id: 'socket-bad' } as unknown as Socket;
      agentManager.registerAgent('user-bad-hello', mockSocket);

      agentManager.recordHello('user-bad-hello', [{ elevated: 'yes' }]);
      expect(agentManager.getLiveness('user-bad-hello')?.identity?.elevated).toBeUndefined();
    });
  });
});
