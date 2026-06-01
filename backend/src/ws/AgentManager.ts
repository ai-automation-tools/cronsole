import { Socket } from 'socket.io';

class AgentManager {
  // Map of userId -> Socket
  // In a real system, a user might have multiple agents (multiple machines)
  // For MVP, we assume one agent per user.
  private agentSockets: Map<string, Socket> = new Map();

  registerAgent(userId: string, socket: Socket) {
    this.agentSockets.set(userId, socket);
    console.log(`Agent registered for user ${userId}`);
  }

  unregisterAgent(userId: string) {
    this.agentSockets.delete(userId);
    console.log(`Agent unregistered for user ${userId}`);
  }

  getSocket(userId: string): Socket | undefined {
    return this.agentSockets.get(userId);
  }
}

export const agentManager = new AgentManager();
