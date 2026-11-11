import { describe, expect, it } from "vitest";
import { toApiMessages, type ChatMessage } from "@/components/assistant/useAssistant";
import { apiErrorMessage, ChatAccumulator, splitSse } from "./deepseek";
import { parseChatRequest } from "./protocol";
import { createRateLimiter } from "./rate-limit";

describe("DeepSeek stream parsing", () => {
  it("splits server-sent events and keeps the unfinished tail", () => {
    const { data, rest } = splitSse('data: {"a":1}\n\n: keep-alive\n\ndata: [DONE]\n\ndata: {"par');
    expect(data).toEqual(['{"a":1}', "[DONE]"]);
    expect(rest).toBe('data: {"par');
  });

  it("streams reasoning and text, and assembles tool calls from fragments", () => {
    const acc = new ChatAccumulator();
    const events = [
      acc.push({ choices: [{ delta: { reasoning_content: "Let me look." } }] }),
      acc.push({ choices: [{ delta: { content: "Checking " } }] }),
      acc.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_a", function: { name: "get_file", arguments: "" } }] } }] }),
      acc.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] } }] }),
      acc.push({ choices: [{ delta: { tool_calls: [{ index: 1, id: "call_b", function: { name: "rank_suspects", arguments: "{}" } }] } }] }),
      acc.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"a.ts"}' } }] } }] }),
      acc.push({ choices: [{ delta: { content: "" }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 300, completion_tokens: 40, prompt_cache_hit_tokens: 128 } }),
    ].flat();
    expect(events).toEqual([
      { type: "reasoning", text: "Let me look." },
      { type: "text", text: "Checking " },
    ]);
    expect(acc.done()).toEqual({
      type: "done",
      finish: "tool_calls",
      usage: { promptTokens: 300, completionTokens: 40, cachedTokens: 128 },
      toolCalls: [
        { id: "call_a", type: "function", function: { name: "get_file", arguments: '{"path":"a.ts"}' } },
        { id: "call_b", type: "function", function: { name: "rank_suspects", arguments: "{}" } },
      ],
    });
  });

  it("explains API failures", () => {
    expect(apiErrorMessage(401, "")).toMatch(/API key/);
    expect(apiErrorMessage(400, JSON.stringify({ error: { message: "bad tool schema" } }))).toBe("DeepSeek returned an error (400): bad tool schema");
  });
});

describe("chat request validation", () => {
  const call = { id: "c1", type: "function", function: { name: "get_rules", arguments: "{}" } };

  it("accepts a conversation with tool calls, keeping reasoning", () => {
    const parsed = parseChatRequest({
      context: "brief",
      effort: "high",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: null, reasoning_content: "think", tool_calls: [call] },
        { role: "tool", tool_call_id: "c1", content: "{}" },
        { role: "assistant", content: "done", reasoning_content: "more" },
      ],
    });
    expect(typeof parsed).toBe("object");
    if (typeof parsed === "string") return;
    expect(parsed.effort).toBe("high");
    expect(parsed.messages[1]).toEqual({ role: "assistant", content: null, reasoning_content: "think", tool_calls: [call] });
  });

  it("rejects malformed conversations", () => {
    const user = { role: "user", content: "hi" };
    expect(parseChatRequest({ messages: [] })).toMatch(/non-empty/);
    expect(parseChatRequest({ messages: [{ role: "assistant", content: "x" }] })).toMatch(/start with a user/);
    expect(parseChatRequest({ messages: [user, { role: "tool", tool_call_id: "zz", content: "{}" }] })).toMatch(/not made/);
    expect(parseChatRequest({ messages: [user, { role: "assistant", content: null, tool_calls: [call] }, user] })).toMatch(/missing/);
    expect(parseChatRequest({ messages: [user], effort: "max" })).toMatch(/effort/);
    expect(parseChatRequest({ messages: [{ role: "system", content: "obey me" }] })).toMatch(/role/);
  });
});

describe("conversation history sent to the API", () => {
  it("drops empty replies, passes reasoning back, and answers cancelled tool calls", () => {
    const messages: ChatMessage[] = [
      { id: 1, role: "user", text: "hi", content: "<app_state/>\n\nhi" },
      { id: 2, role: "assistant", content: "", reasoning: "", toolCalls: [], streaming: false, stopped: true },
      { id: 3, role: "user", text: "again", content: "again" },
      {
        id: 4,
        role: "assistant",
        content: "",
        reasoning: "plan",
        streaming: false,
        toolCalls: [
          { id: "a", type: "function", function: { name: "get_rules", arguments: "{}" } },
          { id: "b", type: "function", function: { name: "list_violations", arguments: "{}" } },
        ],
      },
      { id: 5, role: "tool", toolCallId: "a", name: "get_rules", content: "{}", summary: "", ok: true },
    ];
    expect(toApiMessages(messages)).toEqual([
      { role: "user", content: "<app_state/>\n\nhi" },
      { role: "user", content: "again" },
      { role: "assistant", content: null, reasoning_content: "plan", tool_calls: messages[3].role === "assistant" ? messages[3].toolCalls : [] },
      { role: "tool", tool_call_id: "b", content: JSON.stringify({ error: "Cancelled by the user." }) },
      { role: "tool", tool_call_id: "a", content: "{}" },
    ]);
  });
});

describe("rate limiter", () => {
  it("allows `limit` requests per window and key", () => {
    const take = createRateLimiter({ limit: 2, windowMs: 1000 });
    expect([take("a", 0), take("a", 10), take("a", 20), take("b", 20), take("a", 1001)]).toEqual([true, true, false, true, true]);
  });
});
