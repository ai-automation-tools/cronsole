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
  const { platform } = req.body;
  const userId = 'cli_user_placeholder'; // For MVP

  try {
    const template = await prisma.template.findUnique({
      where: { id }
    });

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
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
      template.name,
      template.scheduleExpression,
      template.command || '',
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
