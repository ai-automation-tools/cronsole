INSERT INTO "PlatformConnection" (id, "userId", platform, config, "isActive", "healthState", "createdAt", "updatedAt") 
VALUES ('default-windows', 'cli_user_placeholder', 'WINDOWS_TASK_SCHEDULER', '{}', true, 'HEALTHY', NOW(), NOW()) 
ON CONFLICT DO NOTHING;