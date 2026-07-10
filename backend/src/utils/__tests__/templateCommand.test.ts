import { describe, it, expect } from 'vitest';
import {
  resolveTemplateParams,
  substituteStructuredCommand,
  substitutePlainCommand,
  formatCommandLine,
  TemplateParamError,
  TemplateParameterDef
} from '../templateCommand.js';

const defs: TemplateParameterDef[] = [
  { key: 'scriptPath', type: 'path', required: true },
  { key: 'args', type: 'text', required: false, default: '' },
  { key: 'method', type: 'select', required: true, default: 'GET', options: ['GET', 'POST'] }
];

describe('resolveTemplateParams', () => {
  it('fills defaults for omitted optional params', () => {
    expect(
      resolveTemplateParams(defs, { scriptPath: 'C:\\x.ps1' })
    ).toEqual({ scriptPath: 'C:\\x.ps1', args: '', method: 'GET' });
  });

  it('rejects missing required params', () => {
    expect(() => resolveTemplateParams(defs, { args: '-v' })).toThrow(
      /Missing required parameter\(s\): scriptPath/
    );
  });

  it('rejects blank required params', () => {
    expect(() => resolveTemplateParams(defs, { scriptPath: '   ' })).toThrow(
      TemplateParamError
    );
  });

  it('rejects a select value outside its options', () => {
    expect(() =>
      resolveTemplateParams(defs, { scriptPath: 'x', method: 'DELETE' })
    ).toThrow(/must be one of: GET, POST/);
  });

  it('rejects undeclared parameter keys', () => {
    expect(() =>
      resolveTemplateParams(defs, { scriptPath: 'x', evil: 'y' })
    ).toThrow(/Unknown parameter\(s\): evil/);
  });

  it('rejects non-string values', () => {
    expect(() =>
      resolveTemplateParams(defs, { scriptPath: 42 as unknown as string })
    ).toThrow(/must be a string/);
  });

  it('rejects a non-object parameters payload', () => {
    expect(() => resolveTemplateParams(defs, ['a'])).toThrow(TemplateParamError);
  });

  it('treats missing defs as no declared parameters', () => {
    expect(resolveTemplateParams(null, {})).toEqual({});
    expect(() => resolveTemplateParams(null, { any: 'x' })).toThrow(
      /Unknown parameter/
    );
  });
});

describe('substituteStructuredCommand', () => {
  it('keeps a quoted placeholder as exactly one argument', () => {
    const { action } = substituteStructuredCommand(
      'powershell.exe -NoProfile -File "{{scriptPath}}"',
      { scriptPath: 'C:\\my scripts\\daily job.ps1' }
    );
    expect(action).toEqual({
      executable: 'powershell.exe',
      args: ['-NoProfile', '-File', 'C:\\my scripts\\daily job.ps1']
    });
  });

  it('contains an unbalanced quote in a value to a single argument (the roadmap residual)', () => {
    const { action } = substituteStructuredCommand(
      'python "{{scriptPath}}"',
      { scriptPath: 'x.ps1" & calc.exe' }
    );
    // The malicious value stays one literal argument to the intended executable.
    expect(action).toEqual({
      executable: 'python',
      args: ['x.ps1" & calc.exe']
    });
  });

  it('expands a bare unquoted placeholder into multiple arguments', () => {
    const { action } = substituteStructuredCommand(
      'python "{{scriptPath}}" {{args}}',
      { scriptPath: 'C:\\x.py', args: '-v --out "my report.txt"' }
    );
    expect(action).toEqual({
      executable: 'python',
      args: ['C:\\x.py', '-v', '--out', 'my report.txt']
    });
  });

  it('drops an empty bare placeholder entirely', () => {
    const { action, command } = substituteStructuredCommand(
      'python "{{scriptPath}}" {{args}}',
      { scriptPath: 'C:\\x.py', args: '' }
    );
    expect(action).toEqual({ executable: 'python', args: ['C:\\x.py'] });
    expect(command).toBe('python C:\\x.py');
  });

  it('keeps an empty quoted placeholder as an explicit empty argument', () => {
    const { action } = substituteStructuredCommand('app "{{x}}" b', { x: '' });
    expect(action).toEqual({ executable: 'app', args: ['', 'b'] });
  });

  it('substitutes composite tokens literally (one argument)', () => {
    const { action } = substituteStructuredCommand(
      'tool --path={{p}} run',
      { p: 'a b' }
    );
    expect(action).toEqual({ executable: 'tool', args: ['--path=a b', 'run'] });
  });

  it('substitutes multiple placeholders inside one quoted token', () => {
    const { action } = substituteStructuredCommand(
      'powershell.exe -Command "{{cmd}} -Tag {{tag}}"',
      { cmd: 'Get-Date', tag: 'now now' }
    );
    expect(action).toEqual({
      executable: 'powershell.exe',
      args: ['-Command', 'Get-Date -Tag now now']
    });
  });

  it('throws on unfilled placeholders', () => {
    expect(() =>
      substituteStructuredCommand('run "{{a}}" {{b}}', { a: 'x' })
    ).toThrow(/unfilled placeholders: b/);
  });

  it('does not mistake {{...}} inside a value for an unfilled placeholder', () => {
    const { action } = substituteStructuredCommand('echo "{{msg}}"', {
      msg: 'literal {{braces}} are data'
    });
    expect(action.args).toEqual(['literal {{braces}} are data']);
  });

  it('is immune to replacement-pattern injection ($& etc.)', () => {
    const { action } = substituteStructuredCommand('echo "{{msg}}"', {
      msg: `$&$'$1`
    });
    expect(action.args).toEqual([`$&$'$1`]);
  });

  it('throws when the template resolves to an empty command', () => {
    expect(() => substituteStructuredCommand('{{args}}', { args: '' })).toThrow(
      /empty command/
    );
  });

  it('allows the executable itself to be a quoted placeholder', () => {
    const { action } = substituteStructuredCommand('"{{exePath}}" --once', {
      exePath: 'C:\\Program Files\\tool\\tool.exe'
    });
    expect(action).toEqual({
      executable: 'C:\\Program Files\\tool\\tool.exe',
      args: ['--once']
    });
  });
});

describe('substitutePlainCommand', () => {
  it('does whole-string substitution for non-argv platforms', () => {
    expect(
      substitutePlainCommand('https://api.example.com/run?job={{job}}', {
        job: 'nightly'
      })
    ).toBe('https://api.example.com/run?job=nightly');
  });

  it('throws on unfilled placeholders', () => {
    expect(() => substitutePlainCommand('{{url}}', {})).toThrow(
      /unfilled placeholders: url/
    );
  });
});

describe('formatCommandLine', () => {
  it('quotes tokens with whitespace or quotes and empty tokens', () => {
    expect(formatCommandLine(['python', 'a b', '', 'c"d', 'plain'])).toBe(
      'python "a b" "" "c"d" plain'
    );
  });
});
