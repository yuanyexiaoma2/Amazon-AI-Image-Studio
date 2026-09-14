import { describe, expect, it } from 'vitest';
import {
  ApplyWorkflowCommandsRequestSchema,
  UndoWorkflowCommandsRequestSchema,
  RedoWorkflowCommandsRequestSchema,
  WorkflowCommandSchema,
} from '../src/workflow-commands.js';

const runCommand = {
  type: 'run',
  scope: { type: 'ALL' },
  idempotencyKey: 'canvas-run-1',
};

function batch(commands: unknown[]) {
  return {
    ifRevision: 3,
    batchId: '5b9e3b0c-2d7a-4f1e-9c2d-7a4f1e9c2d7a',
    commands,
  };
}

describe('WorkflowCommandSchema', () => {
  it('parses each command variant', () => {
    const commands = [
      { type: 'addNode', nodeType: 'generate', position: { x: 0, y: 0 } },
      { type: 'removeNode', nodeId: 'n1' },
      { type: 'connect', source: 'a', target: 'b' },
      { type: 'disconnect', edgeId: 'e1' },
      { type: 'configure', nodeId: 'n1', config: { count: 2 } },
      { type: 'moveNode', nodeId: 'n1', position: { x: 1, y: 2 } },
      { type: 'rename', name: 'flow' },
      runCommand,
    ];
    for (const command of commands) {
      expect(WorkflowCommandSchema.safeParse(command).success).toBe(true);
    }
  });

  it('run command applies confirmBudget default and requires idempotencyKey >= 8 chars', () => {
    const parsed = WorkflowCommandSchema.parse(runCommand);
    expect(parsed.type === 'run' && parsed.confirmBudget).toBe(false);
    expect(
      WorkflowCommandSchema.safeParse({ ...runCommand, idempotencyKey: 'short' }).success,
    ).toBe(false);
  });
});

describe('ApplyWorkflowCommandsRequestSchema', () => {
  it('accepts a batch with a trailing run command', () => {
    const parsed = ApplyWorkflowCommandsRequestSchema.safeParse(
      batch([{ type: 'rename', name: 'flow' }, runCommand]),
    );
    expect(parsed.success).toBe(true);
  });

  it('rejects run that is not the last command', () => {
    const parsed = ApplyWorkflowCommandsRequestSchema.safeParse(
      batch([runCommand, { type: 'rename', name: 'flow' }]),
    );
    expect(parsed.success).toBe(false);
  });

  it('rejects two run commands', () => {
    const parsed = ApplyWorkflowCommandsRequestSchema.safeParse(batch([runCommand, runCommand]));
    expect(parsed.success).toBe(false);
  });

  it('rejects empty batches and batches over 50 commands', () => {
    expect(ApplyWorkflowCommandsRequestSchema.safeParse(batch([])).success).toBe(false);
    const many = Array.from({ length: 51 }, (_, i) => ({
      type: 'moveNode',
      nodeId: `n${i}`,
      position: { x: 0, y: 0 },
    }));
    expect(ApplyWorkflowCommandsRequestSchema.safeParse(batch(many)).success).toBe(false);
  });
});

describe('Undo/Redo request schemas', () => {
  it('share the same shape; batchId optional', () => {
    const base = { ifRevision: 0 };
    expect(UndoWorkflowCommandsRequestSchema.safeParse(base).success).toBe(true);
    expect(RedoWorkflowCommandsRequestSchema.safeParse(base).success).toBe(true);
    const withBatch = { ifRevision: 0, batchId: '5b9e3b0c-2d7a-4f1e-9c2d-7a4f1e9c2d7a' };
    expect(UndoWorkflowCommandsRequestSchema.safeParse(withBatch).success).toBe(true);
    expect(RedoWorkflowCommandsRequestSchema.safeParse(withBatch).success).toBe(true);
    expect(UndoWorkflowCommandsRequestSchema.safeParse({ batchId: withBatch.batchId }).success).toBe(
      false,
    );
  });
});
