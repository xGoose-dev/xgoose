import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { createAgent, type ChatMessage } from "../packages/core/src/createAgent.ts";
import { detachResultImages } from "../packages/core/src/resultImages.ts";
import { defineTool } from "../packages/core/src/tools/buildTool.ts";
import { normalizeHostedError } from "../apps/chrome/src/shared/hosted.ts";

const settings = {
  provider: "openai-compat" as const, model: "gpt-6.1-sol",
  baseUrl: "https://api.xgoose.org/ai/v1", apiKey: "fixture", thinking: false,
};
const mimeType = "image/jpeg";
const dataUrl = (data: string) => `data:${mimeType};base64,${data}`;
const sourceUrl = "https://forum.example/uploads/post-image.jpg";
const tooLarge = "/9j/" + "A".repeat(340_000);
const tooLargeUser = "/9j/" + "B".repeat(340_000);
const small = "/9j/AAAA";
const compressed = "/9j/BBBB";

function completion(delta: object, finishReason = "stop") {
  const chunks = [
    {choices:[{index:0,delta:{role:"assistant", ...delta},finish_reason:null}]},
    {choices:[{index:0,delta:{},finish_reason:finishReason}],usage:{prompt_tokens:100,completion_tokens:10}},
  ];
  return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
    headers: {"content-type": "text/event-stream"},
  });
}

async function runChat(options: Parameters<typeof createAgent>[0], messages: ChatMessage[]) {
  const { agent } = createAgent(options);
  const run = await agent.stream({ messages });
  const events = [];
  for await (const event of run.fullStream) events.push(event);
  return { events, response: await run.response };
}

test("Hosted Continue shrinks user images and replaces only uncompressible tool images in saved chats", async () => {
  const history: ChatMessage[] = [
    {role:"user",content:[{type:"text",text:"Research this post."},{type:"image",data:tooLargeUser,mimeType}]},
    {role:"assistant",content:[{type:"tool-call",toolName:"read",toolCallId:"old",input:{}}]},
    {role:"tool",content:[{type:"tool-result",toolName:"read",toolCallId:"old",
      output:{type:"json",value:{text:"Forum evidence",images:[{attached:1,url:sourceUrl},{attached:2}]}},
      images:[{type:"image",data:tooLarge,mimeType},{type:"image",data:small,mimeType}],
    }]},
    {role:"user",content:"Continue."},
  ];
  const original = structuredClone(history);
  const seen: string[] = [];
  const { events } = await runChat({
    settings, tools: [],
    compressHostedImage: async (url, maxChars) => {
      assert.equal(maxChars, 320_050);
      return url === dataUrl(tooLargeUser) ? dataUrl(compressed) : undefined;
    },
    fetchImpl: async (_input, init) => {
      seen.push(String(init?.body));
      return completion({content:"Continued."});
    },
  }, history);
  assert.equal(seen.length, 1);
  assert.ok(seen[0].includes(dataUrl(compressed)));
  assert.ok(seen[0].includes(dataUrl(small)));
  assert.ok(seen[0].includes(`[Image omitted because it exceeds the Hosted size limit. Source: ${sourceUrl}]`));
  assert.ok(seen[0].includes("Forum evidence"));
  assert.ok(!seen[0].includes(tooLarge));
  assert.deepEqual(history, original);
  assert.equal(events.find(event => event.type === "error"), undefined);
});

test("Hosted retries one image-specific rejection without re-running the tool", async () => {
  let requests = 0;
  let reads = 0;
  const tool = defineTool({name:"read",description:"Read a forum image",inputSchema:z.object({}),execute:() => {
    reads++;
    return detachResultImages({text:"Forum evidence",images:[{type:"image",data:small,mimeType,url:sourceUrl}]});
  }});
  const { events, response } = await runChat({
    settings, tools: [tool],
    fetchImpl: async (_input, init) => {
      if (++requests === 1) {
        return completion({tool_calls:[{index:0,id:"read-post",type:"function",function:{name:"read",arguments:"{}"}}]}, "tool_calls");
      }
      const raw = JSON.parse(String(init?.body));
      if (requests === 2) {
        const messageIndex = raw.messages.findIndex(message => Array.isArray(message.content) &&
          message.content.some(part => part.image_url?.url === dataUrl(small)));
        assert.ok(messageIndex >= 0);
        const contentIndex = raw.messages[messageIndex].content.findIndex(part => part.image_url?.url === dataUrl(small));
        return normalizeHostedError(Response.json({
          error:"image_too_large", message:"An image exceeds the Hosted size limit.",
          detail:{images:[{message_index:messageIndex,content_index:contentIndex}]},
        }, {status:400}));
      }
      assert.ok(String(init?.body).includes(`[Image omitted because it exceeds the Hosted size limit. Source: ${sourceUrl}]`));
      assert.ok(String(init?.body).includes("Forum evidence"));
      assert.ok(!String(init?.body).includes(dataUrl(small)));
      return completion({content:"Finished with the saved evidence."});
    },
  }, [{role:"user",content:"Read the post."}]);
  assert.equal(requests, 3);
  assert.equal(reads, 1);
  assert.equal(events.find(event => event.type === "error"), undefined);
  assert.equal(response.messages.find(message => message.role === "tool")?.content[0].images[0].data, small);
});
