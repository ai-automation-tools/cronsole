import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';
import {
  buildDownload,
  findDownload,
  packFile,
  textByteLength,
  CONNECT_PACK_DOWNLOADS,
  CONNECT_PACK_HOME,
  CONNECT_PACK_VERSION
} from '../connectPack.js';
import { CONNECT_PACK_FILES } from '../connectPackBundled.js';
import { renderBundle } from '../generate-connect-pack.js';

describe('connect pack bundle', () => {
  it('has not drifted from the markdown sources', () => {
    // The .md files under connect-pack/ are the editable source; the bundle is
    // generated because tsc emits only .js, so the markdown never reaches dist/.
    // Editing the markdown without regenerating would ship stale instructions
    // that nothing else would notice.
    const onDisk = readFileSync(fileURLToPath(new URL('../connectPackBundled.ts', import.meta.url)), 'utf8');
    expect(onDisk.replace(/\r\n/g, '\n')).toBe(renderBundle().replace(/\r\n/g, '\n'));
  });

  it('carries every file the downloads reference', () => {
    for (const download of CONNECT_PACK_DOWNLOADS) {
      for (const path of download.contents) {
        expect(() => packFile(path)).not.toThrow();
      }
    }
  });

  it('throws a fixable message for a file the bundle is missing', () => {
    expect(() => packFile('nope.md')).toThrow(/connectpack:build/);
  });
});

describe('version stamping', () => {
  // A downloaded copy on someone else's machine can never be updated. It cannot
  // be kept current, so it must at least be able to say how old it is.
  it('stamps the version into every artifact a user can download', () => {
    for (const download of CONNECT_PACK_DOWNLOADS) {
      for (const path of download.contents) {
        expect(packFile(path), `${path} is missing the version stamp`).toContain(CONNECT_PACK_VERSION);
      }
    }
  });

  it('points every artifact at the canonical home', () => {
    for (const path of Object.keys(CONNECT_PACK_FILES)) {
      expect(packFile(path), `${path} has no canonical URL`).toContain(CONNECT_PACK_HOME);
    }
  });

  it('names the version in each download filename that carries one', () => {
    const pack = findDownload('connect-pack')!;
    expect(pack.filename).toContain(CONNECT_PACK_VERSION);
  });
});

describe('download assembly', () => {
  it('builds the skill archive under taskhub/ so it drops into a skills folder', async () => {
    const download = findDownload('skill')!;
    const zip = await JSZip.loadAsync(await buildDownload(download));
    const entries = Object.values(zip.files).filter(f => !f.dir).map(f => f.name).sort();
    expect(entries).toEqual([
      'taskhub/SKILL.md',
      'taskhub/references/task-authoring.md'
    ]);
  });

  it('keeps the full pack README at the archive root, where someone will look for it', async () => {
    const download = findDownload('connect-pack')!;
    const zip = await JSZip.loadAsync(await buildDownload(download));
    expect(zip.files['README.md']).toBeDefined();
    expect(zip.files['taskhub/README.md']).toBeUndefined();
  });

  it('round-trips archived content unchanged', async () => {
    const zip = await JSZip.loadAsync(await buildDownload(findDownload('skill')!));
    const skill = await zip.file('taskhub/SKILL.md')!.async('string');
    expect(skill).toBe(packFile('SKILL.md'));
  });

  it('returns single-file downloads as their raw text', async () => {
    const body = await buildDownload(findDownload('agents-md')!);
    expect(body.toString('utf8')).toBe(packFile('AGENTS.md'));
  });

  it('ships a parseable MCP config', () => {
    const parsed = JSON.parse(packFile('mcp-config.json'));
    expect(parsed.mcpServers.taskhub.env.TASKHUB_TOKEN).toBe('${TASKHUB_TOKEN}');
  });

  it('never bakes a literal token into the shipped config', () => {
    // The whole point of the ${ENV} reference: a file thousands of people may
    // download must not be able to carry a secret.
    expect(packFile('mcp-config.json')).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
  });

  it('does not enable the destructive gate by default', () => {
    const parsed = JSON.parse(packFile('mcp-config.json'));
    expect(parsed.mcpServers.taskhub.env.TASKHUB_MCP_ALLOW_DESTRUCTIVE).toBeUndefined();
  });

  it('reports a real size for single-file downloads', () => {
    expect(textByteLength('AGENTS.md')).toBeGreaterThan(500);
  });

  it('has no unknown download ids', () => {
    expect(findDownload('does-not-exist')).toBeUndefined();
  });
});

describe('audience', () => {
  // The repo's own skills/taskhub/ teaches an agent to work ON the codebase.
  // Shipping that to an end user would hand them build internals instead of
  // usage instructions — the mistake this pack exists to avoid.
  const REPO_INTERNALS = ['catalogSync', 'normalize.ts', 'bundled.ts', 'registry:build', 'publish-registry'];

  it('contains no TaskHub build internals', () => {
    for (const path of Object.keys(CONNECT_PACK_FILES)) {
      for (const term of REPO_INTERNALS) {
        expect(packFile(path), `${path} leaks repo internals: ${term}`).not.toContain(term);
      }
    }
  });

  it('contains no repo-relative links, which would 404 for an outside reader', () => {
    for (const path of Object.keys(CONNECT_PACK_FILES)) {
      expect(packFile(path), `${path} has a repo-relative link`).not.toMatch(/\]\(\.\.\//);
    }
  });

  it('teaches the invariants an agent would otherwise get wrong', () => {
    const skill = packFile('SKILL.md');
    const agents = packFile('AGENTS.md');
    for (const doc of [skill, agents]) {
      expect(doc).toContain('UTC');
      expect(doc).toMatch(/\\Microsoft\\/);
      expect(doc.toLowerCase()).toContain('disable');
    }
  });
});
