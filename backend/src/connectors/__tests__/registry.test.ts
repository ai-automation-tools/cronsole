import { describe, it, expect } from 'vitest';
import { PlatformType } from '@prisma/client';
import { connectorRegistry } from '../registry.js';
import { ClaudeConnector } from '../ClaudeConnector.js';
import { WindowsAgentConnector } from '../WindowsAgentConnector.js';

describe('ConnectorRegistry', () => {
  it('should have predefined connectors registered', () => {
    const claude = connectorRegistry.getConnector(PlatformType.CLAUDE_CODE);
    const windows = connectorRegistry.getConnector(PlatformType.WINDOWS_TASK_SCHEDULER);

    expect(claude).toBeDefined();
    expect(claude).toBeInstanceOf(ClaudeConnector);

    expect(windows).toBeDefined();
    expect(windows).toBeInstanceOf(WindowsAgentConnector);
  });

  it('should return undefined for unregistered platforms', () => {
    // @ts-ignore - purposefully passing invalid platform
    const unknown = connectorRegistry.getConnector('UNKNOWN_PLATFORM');
    expect(unknown).toBeUndefined();
  });
});
