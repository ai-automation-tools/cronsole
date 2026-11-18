import { describe, it, expect } from 'vitest';
import { suggestTaskName } from '../suggestTaskName';

describe('suggestTaskName', () => {
  it.each([
    ['powershell -File "D:\\scripts\\backup.ps1"', 'backup'],
    ['node "C:\\jobs\\digest.js" --verbose', 'digest'],
    ['C:\\Program Files\\Tool\\app.exe /sync', 'app'],
    ['git pull', 'git'],
    ['https://api.example.com/health', 'api.example.com health'],
    ['https://example.com/', 'example.com'],
    ['db.internal:5432', 'db.internal:5432'],
    ['${secret.WEBHOOK_URL}', ''],
    ['   ', '']
  ])('%s → %s', (input, expected) => {
    expect(suggestTaskName(input)).toBe(expected);
  });
});
