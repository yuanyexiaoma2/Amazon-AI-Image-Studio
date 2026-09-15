import { describe, expect, it } from 'vitest';
import { NODE_REGISTRY } from '@studio/domain';
import {
  CHAT_AGENT_SYSTEM_PROMPT,
  ChatProviderError,
  FakeChatAgentProvider,
  KieChatAgentProvider,
  buildNodeHandleDoc,
  createChatAgentProvider,
  resolveChatProviderKind,
  kieChatCompletion,
  KIE_DEFAULT_BASE_URL,
} from '../src/index.js';

const KEY = 'test-key-not-real';

function okFetch(body: unknown, capture?: (url: string, init: RequestInit) => void) {
  return (async (url: string | URL, init?: RequestInit) => {
    capture?.(String(url), init ?? {});
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

function completion(content: string) {
  return { choices: [{ message: { role: 'assistant', content } }] };
}

const TURN = {
  messages: [{ role: 'user' as const, text: '你好' }],
  graphSummary: '（空画布）',
  catalog: 'models: fake-primary',
};

const GOOD_TURN = JSON.stringify({
  reply: '已为你添加一个生图节点。',
  commands: [
    { type: 'addNode', nodeType: 'generate', nodeId: 'gen-1', position: { x: 10, y: 20 } },
  ],
});

describe('CHAT_AGENT_SYSTEM_PROMPT handle documentation', () => {
  it('lists every palette node type with its registry input/output port ids', () => {
    for (const def of NODE_REGISTRY.filter((n) => n.palette)) {
      expect(CHAT_AGENT_SYSTEM_PROMPT).toContain(`- ${def.type}：`);
      for (const port of [...def.inputPorts, ...def.outputPorts]) {
        expect(CHAT_AGENT_SYSTEM_PROMPT).toContain(port.id);
      }
    }
  });

  it('embeds buildNodeHandleDoc() verbatim (no drift between doc and prompt)', () => {
    expect(CHAT_AGENT_SYSTEM_PROMPT).toContain(buildNodeHandleDoc());
  });

  it('per-port ids appear on the line of their own node type', () => {
    const lines = CHAT_AGENT_SYSTEM_PROMPT.split('\n');
    for (const def of NODE_REGISTRY.filter((n) => n.palette)) {
      const line = lines.find((l) => l.startsWith(`- ${def.type}：`));
      expect(line, `prompt line for ${def.type}`).toBeDefined();
      for (const port of def.inputPorts) expect(line).toContain(port.id);
      for (const port of def.outputPorts) expect(line).toContain(port.id);
    }
  });
});

describe('resolveChatProviderKind / createChatAgentProvider', () => {
  it('defaults to fake', () => {
    expect(resolveChatProviderKind({})).toBe('fake');
    expect(createChatAgentProvider({ env: {} })).toBeInstanceOf(FakeChatAgentProvider);
  });

  it('kie without KIE_API_KEY throws AUTH', () => {
    expect(() => createChatAgentProvider({ env: { CHAT_PROVIDER: 'kie' } })).toThrow(
      ChatProviderError,
    );
    try {
      createChatAgentProvider({ env: { CHAT_PROVIDER: 'kie' } });
      expect.unreachable();
    } catch (e) {
      expect((e as ChatProviderError).errorClass).toBe('AUTH');
    }
  });

  it('kie with key returns the kie chat agent', () => {
    const p = createChatAgentProvider({ env: { CHAT_PROVIDER: 'kie', KIE_API_KEY: KEY } });
    expect(p).toBeInstanceOf(KieChatAgentProvider);
    expect(p.name).toBe('kie-llm-chat-agent');
  });
});

describe('FakeChatAgentProvider (deterministic rules)', () => {
  const fake = new FakeChatAgentProvider();

  it('「搭建」produces addNode+addNode+connect with deterministic ids', async () => {
    const out = await fake.runTurn({
      ...TURN,
      messages: [{ role: 'user', text: '帮我搭建一个生图流程' }],
    });
    expect(out.commands).toEqual([
      { type: 'addNode', nodeType: 'source_image', nodeId: 'chat-src-1', position: { x: 0, y: 0 } },
      { type: 'addNode', nodeType: 'generate', nodeId: 'chat-gen-1', position: { x: 320, y: 0 } },
      {
        type: 'connect',
        edgeId: 'chat-edge-1',
        source: 'chat-src-1',
        sourceHandle: 'image',
        target: 'chat-gen-1',
        targetHandle: 'references',
      },
    ]);
    expect(out.reply).toContain('source_image');
    expect(out.meta.provider).toBe('fake-chat-agent');

    // Deterministic: identical input → identical output
    const again = await fake.runTurn({
      ...TURN,
      messages: [{ role: 'user', text: '帮我搭建一个生图流程' }],
    });
    expect(again).toEqual(out);
  });

  it('「加节点」also triggers the build rule', async () => {
    const out = await fake.runTurn({ ...TURN, messages: [{ role: 'user', text: '加节点吧' }] });
    expect(out.commands).toHaveLength(3);
  });

  it('「运行」returns a single run command; turnNonce keeps keys unique per turn', async () => {
    const a = await fake.runTurn({
      ...TURN,
      messages: [{ role: 'user', text: '运行整个流程' }],
      turnNonce: 'turn-1',
    });
    const b = await fake.runTurn({
      ...TURN,
      messages: [{ role: 'user', text: '运行整个流程' }],
      turnNonce: 'turn-2',
    });
    expect(a.commands).toEqual([
      { type: 'run', scope: { type: 'ALL' }, idempotencyKey: 'chat-run-turn-1' },
    ]);
    expect(b.commands).toEqual([
      { type: 'run', scope: { type: 'ALL' }, idempotencyKey: 'chat-run-turn-2' },
    ]);
    // without turnNonce: deterministic (same messages → same key = idempotent replay)
    const c1 = await fake.runTurn({ ...TURN, messages: [{ role: 'user', text: '跑一下' }] });
    const c2 = await fake.runTurn({ ...TURN, messages: [{ role: 'user', text: '跑一下' }] });
    expect(c1).toEqual(c2);
    expect((c1.commands[0] as { idempotencyKey: string }).idempotencyKey).toMatch(/^chat-run-[0-9a-f]{8}$/);
  });

  it('idempotencyKeyFactory overrides run key derivation', async () => {
    const custom = new FakeChatAgentProvider({ idempotencyKeyFactory: () => 'custom-key-123' });
    const out = await custom.runTurn({ ...TURN, messages: [{ role: 'user', text: '运行' }] });
    expect((out.commands[0] as { idempotencyKey: string }).idempotencyKey).toBe('custom-key-123');
  });

  it('「撤销」replies with guidance and no commands (undo is a separate endpoint)', async () => {
    const out = await fake.runTurn({ ...TURN, messages: [{ role: 'user', text: '撤销上一步' }] });
    expect(out.commands).toEqual([]);
    expect(out.reply).toContain('撤销');
  });

  it('chit-chat returns text only', async () => {
    const out = await fake.runTurn({ ...TURN, messages: [{ role: 'user', text: '今天天气如何' }] });
    expect(out.commands).toEqual([]);
    expect(out.reply).toContain('今天天气如何');
  });
});

describe('KieChatAgentProvider', () => {
  it('sends OpenAI-compatible request with json_object and parses commands', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const p = new KieChatAgentProvider({
      apiKey: KEY,
      fetchImpl: okFetch(completion(GOOD_TURN), (url, init) => {
        seen = { url, init };
      }),
    });
    const out = await p.runTurn({
      messages: [{ role: 'user', text: '加一个生图节点' }],
      graphSummary: 'nodes: []',
      catalog: 'models: fake-primary',
    });

    expect(seen!.url).toBe('https://api.kie.ai/gemini-3-flash/v1/chat/completions');
    const body = JSON.parse(String(seen!.init.body));
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content[0].text).toBe(CHAT_AGENT_SYSTEM_PROMPT);
    expect(JSON.stringify(body.messages)).toContain('加一个生图节点');
    expect(JSON.stringify(body.messages)).toContain('nodes: []');

    expect(out.reply).toBe('已为你添加一个生图节点。');
    expect(out.commands).toEqual([
      { type: 'addNode', nodeType: 'generate', nodeId: 'gen-1', position: { x: 10, y: 20 } },
    ]);
    expect(out.meta.degraded).toBeUndefined();
    expect(out.meta.provider).toBe('kie-llm-chat-agent');
  });

  it('tolerates markdown fences around the JSON', async () => {
    const p = new KieChatAgentProvider({
      apiKey: KEY,
      fetchImpl: okFetch(completion('```json\n' + GOOD_TURN + '\n```')),
    });
    const out = await p.runTurn(TURN);
    expect(out.commands).toHaveLength(1);
    expect(out.meta.degraded).toBeUndefined();
  });

  it('degrades to text-only reply on unparseable JSON (never throws)', async () => {
    const p = new KieChatAgentProvider({
      apiKey: KEY,
      fetchImpl: okFetch(completion('这根本不是 JSON')),
    });
    const out = await p.runTurn(TURN);
    expect(out.commands).toEqual([]);
    expect(out.meta.degraded).toBe(true);
    expect(out.reply).toContain('解析失败');
  });

  it('degrades when commands fail schema validation', async () => {
    const p = new KieChatAgentProvider({
      apiKey: KEY,
      fetchImpl: okFetch(
        completion(JSON.stringify({ reply: '好的', commands: [{ type: 'nukeEverything' }] })),
      ),
    });
    const out = await p.runTurn(TURN);
    expect(out.commands).toEqual([]);
    expect(out.meta.degraded).toBe(true);
    expect(out.reply).toContain('未通过校验');
  });

  it('maps kie HTTP-200 error envelopes to thrown ChatProviderError', async () => {
    const p = new KieChatAgentProvider({
      apiKey: KEY,
      fetchImpl: okFetch({ code: 500, msg: 'kie error', data: null }),
    });
    await expect(p.runTurn(TURN)).rejects.toMatchObject({ errorClass: 'TRANSIENT' });
  });

  it('maps HTTP 401 to AUTH and preserves transport errors for the API layer', async () => {
    const p = new KieChatAgentProvider({
      apiKey: KEY,
      fetchImpl: (async () => new Response('err', { status: 401 })) as typeof fetch,
    });
    await expect(p.runTurn(TURN)).rejects.toBeInstanceOf(ChatProviderError);
    await expect(p.runTurn(TURN)).rejects.toMatchObject({ errorClass: 'AUTH' });
  });
});

describe('kieChatCompletion (shared client)', () => {
  it('sends parts-array content and returns text + latencyMs', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const { text, latencyMs } = await kieChatCompletion({
      config: {
        apiKey: KEY,
        model: 'gemini-3-flash',
        fetchImpl: okFetch(completion('{"a":1}'), (url, init) => {
          seen = { url, init };
        }),
      },
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
      jsonMode: true,
    });
    expect(text).toBe('{"a":1}');
    expect(latencyMs).toBeGreaterThanOrEqual(0);
    expect(seen!.url).toBe(`${KIE_DEFAULT_BASE_URL}/gemini-3-flash/v1/chat/completions`);
    const body = JSON.parse(String(seen!.init.body));
    expect(body.messages[1].content).toEqual([{ type: 'text', text: 'hi' }]);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.stream).toBe(false);
  });

  it('omits response_format unless jsonMode is set', async () => {
    let body: Record<string, unknown> = {};
    await kieChatCompletion({
      config: {
        apiKey: KEY,
        model: 'm',
        fetchImpl: okFetch(completion('ok'), (_u, init) => {
          body = JSON.parse(String(init.body));
        }),
      },
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(body.response_format).toBeUndefined();
  });

  it('maps abort to TIMEOUT and network errors to TRANSIENT', async () => {
    await expect(
      kieChatCompletion({
        config: {
          apiKey: KEY,
          model: 'm',
          fetchImpl: (async () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            throw e;
          }) as typeof fetch,
        },
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toMatchObject({ errorClass: 'TIMEOUT' });

    await expect(
      kieChatCompletion({
        config: {
          apiKey: KEY,
          model: 'm',
          fetchImpl: (async () => {
            throw new Error('socket hangup');
          }) as typeof fetch,
        },
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toMatchObject({ errorClass: 'TRANSIENT' });
  });

  it('accepts array-of-parts message content from the API', async () => {
    const { text } = await kieChatCompletion({
      config: {
        apiKey: KEY,
        model: 'm',
        fetchImpl: okFetch({ choices: [{ message: { content: [{ type: 'text', text: 'parted' }] } }] }),
      },
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(text).toBe('parted');
  });
});
