import { Router, Request, Response } from 'express';
import { PlatformType, PrismaClient } from '@prisma/client';
import { connectorRegistry } from '../connectors/registry.js';
import {
  convertCronToWindowsTrigger,
  getTemplateConfidence,
  WindowsTrigger
} from '../utils/scheduler-conversion.js';

const prisma = new PrismaClient();
const router = Router();

const isValidCron = (cron: string) => cron.trim().split(/\s+/).length === 5;

/**
 * Resolve the platform-native trigger for a schedule. Only Windows needs a
 * converted trigger today; other platforms consume the cron directly.
 */
const resolveTrigger = (
  platform: PlatformType,
  schedule: string
): { trigger: WindowsTrigger | null; confidence: number; warnings: string[] } => {
  if (platform !== PlatformType.WINDOWS_TASK_SCHEDULER) {
    return { trigger: null, confidence: 1.0, warnings: [] };
  }
  const result = convertCronToWindowsTrigger(schedule);
  return { trigger: result.trigger, confidence: result.confidence, warnings: result.warnings };
};

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

// Preview how a template + schedule converts for a target platform, so the
// Apply modal can warn about lossy cron→trigger conversions before creating.
router.post('/:id/preview', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { platform, schedule, scheduleExpression } = req.body;

  try {
    const template = await prisma.template.findUnique({ where: { id } });
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    if (!platform || !Object.values(PlatformType).includes(platform)) {
      return res.status(400).json({ error: `Invalid platform: ${platform}` });
    }

    const finalSchedule =
      [schedule, scheduleExpression].find(s => typeof s === 'string' && s.trim())?.trim() ||
      template.scheduleExpression;

    if (!isValidCron(finalSchedule)) {
      return res.json({
        score: 0,
        warnings: ['Schedule must be a 5-field cron expression (min hour dom month dow).'],
        trigger: null
      });
    }

    const conversion = resolveTrigger(platform, finalSchedule);
    const compat = getTemplateConfidence(
      { ...template, scheduleExpression: finalSchedule },
      platform
    );

    res.json({
      score: Math.min(compat.score, conversion.confidence),
      warnings: [...new Set([...compat.warnings, ...conversion.warnings])],
      trigger: conversion.trigger
    });
  } catch (error) {
    console.error('Error previewing template:', error);
    res.status(500).json({ error: 'Failed to preview template' });
  }
});

// Apply a template to a platform
router.post('/:id/apply', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { platform, command, schedule, scheduleExpression, name } = req.body;
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
    // stored template otherwise. Accept both `schedule` (what the modal sends)
    // and `scheduleExpression` (the template field name).
    const finalName =
      typeof name === 'string' && name.trim() ? name.trim() : template.name;
    const finalSchedule =
      [schedule, scheduleExpression].find(s => typeof s === 'string' && s.trim())?.trim() ||
      template.scheduleExpression;
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

    if (!isValidCron(finalSchedule)) {
      return res.status(400).json({
        error: 'Schedule must be a 5-field cron expression (min hour dom month dow).'
      });
    }

    // Convert the cron to a platform-native trigger so the agent registers the
    // real schedule instead of guessing (see docs/resources/Templates.md §6).
    const conversion = resolveTrigger(platform, finalSchedule);
    if (platform === PlatformType.WINDOWS_TASK_SCHEDULER && !conversion.trigger) {
      return res.status(400).json({
        error: 'Schedule cannot be converted to a Windows trigger.',
        warnings: conversion.warnings
      });
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
      { ...(connection.config as object), userId },
      { trigger: conversion.trigger }
    );

    if (result.success) {
      res.json({
        message: 'Template applied successfully',
        externalId: result.externalId,
        conversion: { confidence: conversion.confidence, warnings: conversion.warnings }
      });
    } else {
      res.status(500).json({ error: result.message || 'Failed to apply template' });
    }
  } catch (error: any) {
    console.error('Error applying template:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
