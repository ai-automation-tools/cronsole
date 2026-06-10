import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { connectorRegistry } from '../connectors/registry.js';

const prisma = new PrismaClient();
const router = Router();

// List all templates
router.get('/', async (req: Request, res: Response) => {
  try {
    const templates = await prisma.template.findMany({
      orderBy: { upvotes: 'desc' }
    });
    res.json(templates);
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// Apply a template to a platform
router.post('/:id/apply', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { platform, command, scheduleExpression, name } = req.body;
  const userId = 'cli_user_placeholder'; // For MVP

  try {
    const template = await prisma.template.findUnique({
      where: { id }
    });

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    // Resolve the task to create. The client may send overrides produced by the
    // Apply modal (placeholders substituted, schedule confirmed); fall back to the
    // stored template otherwise.
    const finalName =
      typeof name === 'string' && name.trim() ? name.trim() : template.name;
    const finalSchedule =
      typeof scheduleExpression === 'string' && scheduleExpression.trim()
        ? scheduleExpression.trim()
        : template.scheduleExpression;
    const finalCommand =
      typeof command === 'string' && command.trim()
        ? command.trim()
        : template.command || '';

    // Never register a task with unfilled {{placeholders}} (see Templates.md §5).
    if (finalCommand.includes('{{')) {
      return res
        .status(400)
        .json({ error: 'Command still contains unfilled placeholders' });
    }

    const connection = await prisma.platformConnection.findUnique({
      where: { userId_platform: { userId, platform } }
    });

    if (!connection) {
      return res.status(400).json({ error: `No connection found for platform ${platform}` });
    }

    const connector = connectorRegistry.getConnector(platform);
    if (!connector) {
      return res.status(400).json({ error: `No connector registered for platform ${platform}` });
    }

    // Call createTask on the connector
    const result = await connector.createTask(
      finalName,
      finalSchedule,
      finalCommand,
      { ...(connection.config as object), userId }
    );

    if (result.success) {
      res.json({ message: 'Template applied successfully', externalId: result.externalId });
    } else {
      res.status(500).json({ error: result.message || 'Failed to apply template' });
    }
  } catch (error: any) {
    console.error('Error applying template:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
