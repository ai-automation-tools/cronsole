import { PlatformType } from '@prisma/client';
import { PlatformConnector } from './platform.interface.js';
import { ClaudeConnector } from './ClaudeConnector.js';
import { WindowsAgentConnector } from './WindowsAgentConnector.js';
import { TaskHubNativeConnector } from './TaskHubNativeConnector.js';

class ConnectorRegistry {
  private connectors: Map<PlatformType, PlatformConnector> = new Map();

  constructor() {
    this.register(new ClaudeConnector());
    this.register(new WindowsAgentConnector());
    this.register(new TaskHubNativeConnector());
  }

  register(connector: PlatformConnector) {
    this.connectors.set(connector.platform, connector);
  }

  getConnector(platform: PlatformType): PlatformConnector | undefined {
    return this.connectors.get(platform);
  }
}

export const connectorRegistry = new ConnectorRegistry();
