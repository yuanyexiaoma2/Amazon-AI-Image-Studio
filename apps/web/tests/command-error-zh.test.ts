import { describe, expect, it } from 'vitest';
import { formatCommandErrorZh } from '../lib/zh-labels';

describe('formatCommandErrorZh (PR-6-08 报错中文化)', () => {
  it('INVALID_NODE_CONFIG + zod 消息 → 中文，去掉 command[0] 机器前缀', () => {
    const raw =
      'command[0] (INVALID_NODE_CONFIG): Invalid config for prompt: text: Expected string, received null';
    expect(formatCommandErrorZh(raw)).toBe(
      '节点配置不正确（提示词）— 提示词内容：需要文字，收到了空值',
    );
  });

  it('多条 issue 用中文分号连接，字段名翻成中文', () => {
    const raw =
      'command[1] (INVALID_NODE_CONFIG): Invalid config for generate: count: Number must be less than or equal to 8; seed: Expected number, received string';
    expect(formatCommandErrorZh(raw)).toBe(
      '节点配置不正确（生成）— 数量：不能大于 8；种子：需要数字，收到了文字',
    );
  });

  it('NODE_NOT_FOUND 等其他错误码 → 中文码 + 原文细节', () => {
    expect(formatCommandErrorZh('command[0] (NODE_NOT_FOUND): Node not found: n-x')).toBe(
      '节点不存在 — Node not found: n-x',
    );
  });

  it('翻不了的 zod 模式 → 配置未通过检查 + 原文', () => {
    const raw = 'command[0] (INVALID_NODE_CONFIG): Invalid config for prompt: text: 某种未知错误';
    expect(formatCommandErrorZh(raw)).toBe(
      '节点配置不正确（提示词）— 配置未通过检查：text: 某种未知错误',
    );
  });

  it('不是 command 错误的消息原样返回', () => {
    expect(formatCommandErrorZh('网络错误 — 命令未发送')).toBe('网络错误 — 命令未发送');
  });
});
