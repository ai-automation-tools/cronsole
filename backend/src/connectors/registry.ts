import { PlatformType } from '@prisma/client';
import { PlatformConnector } from './platform.interface.js';
import { ClaudeConnector } from './ClaudeConnector.js';
import { WindowsAgentConnector } from './WindowsAgentConnector.js';
import { CronsoleNativeConnector } from './CronsoleNativeConnector.js';
import { GitHubActionsConnector } from './GitHubActionsConnector.js';
import { VercelCronConnector } from './VercelCronConnector.js';
import { GeminiTriggersConnector } from './GeminiTriggersConnector.js';
import { N8nConnector } from './N8nConnector.js';

class ConnectorRegistry {
  private connectors: Map<PlatformType, PlatformConnector> = new Map();

  constructor() {
    this.register(new ClaudeConnector());
    this.register(new WindowsAgentConnector());
    this.register(new CronsoleNativeConnector());
    this.register(new GitHubActionsConnector());
    this.register(new VercelCronConnector());
    this.register(new GeminiTriggersConnector());
    this.register(new N8nConnector());
  }

  register(connector: PlatformConnector) {
    this.connectors.set(connector.platform, connector);
  }

  getConnector(platform: PlatformType): PlatformConnector | undefined {
    return this.connectors.get(platform);
  }
}

export const connectorRegistry = new ConnectorRegistry();
