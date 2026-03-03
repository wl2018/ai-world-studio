import dotenv from 'dotenv';
import { promises as fsPromises } from 'fs';
import path from 'path';
dotenv.config();
import { Template } from "@huggingface/jinja";
import assert from 'node:assert/strict';

const BASE_URL = process.env.BASE_URL || 'https://127.0.0.1:5000/v1';
const API_KEY = process.env.API_KEY || '';
const MODEL = process.env.MODEL || '';

if (!process.env.TEMPERATURE) throw "Please set TEMPERATURE* variables in your .env files.";

//let g_modelName;
//let g_tokenizer_config;
//let g_template;

let g_modelInfo = {};

export function getModelInfo(base_url) {
  const _base_url = base_url || BASE_URL;
  return g_modelInfo[base_url];
}

async function updateModelUsed(modelName, base_url) {
  assert(base_url);
  g_modelInfo[base_url] ||= {};
  const modelInfo = g_modelInfo[base_url];
  if (modelName && modelName !== modelInfo.modelName) {
    modelInfo.modelName = modelName;
    console.log(`Model changed: ${modelInfo.modelName}`)
    modelInfo.tokenizer_config = undefined;
    modelInfo.template = undefined;
    let full_match_json, model_name_match_json;
    let full_match_jinja, model_name_match_jinja;
    const p = path.join(path.dirname(process.argv[1]), '..', 'chat_template');
    for (const fn of await fsPromises.readdir(p)) {
      const ext = path.extname(fn);
      const main = fn.slice(0,-ext.length);
      const separated = main.split('_');
      if (separated.length === 1) {
        if (modelInfo.modelName.toLowerCase().includes(separated[0].toLowerCase())) {
          if (ext === '.json')
            model_name_match_json = fn;
          else if (ext === '.jinja')
            model_name_match_jinja = fn;
        }
      } else if (separated.length >= 2) {  // we don't compare parts of filename after second '_' so that we can use that part as out own comment
        const full_compare = separated[0] + '_' + separated[1];
        if (modelInfo.modelName.toLowerCase().includes(full_compare.toLowerCase())) {
          if (ext === '.json')
            full_match_json = fn;
          else if (ext === '.jinja')
            full_match_jinja = fn;
        } else if (modelInfo.modelName.toLowerCase().includes(separated[1].toLowerCase())) {
          if (ext === '.json')
            model_name_match_json = fn;
          else if (ext === '.jinja')
            model_name_match_jinja = fn;
        }
      } else {
        console.log(`[updateModelUsed] Unrecognized template/json filename: ${fn}`);
      }
    }
    
    let match_json = full_match_json || model_name_match_json;
    if (match_json) {
      modelInfo.tokenizer_config = JSON.parse(await fsPromises.readFile(path.join(path.dirname(process.argv[1]), '..', 'chat_template', match_json), 'utf-8'));
      if (modelInfo.tokenizer_config) {
        if (modelInfo.tokenizer_config.chat_template) {
          modelInfo.template = new Template(modelInfo.tokenizer_config.chat_template);
        } else {
          let match_jinja = full_match_jinja || model_name_match_jinja;
          if (match_jinja)
            modelInfo.template = new Template(await fsPromises.readFile(path.join(path.dirname(process.argv[1]), '..', 'chat_template', match_jinja), 'utf-8'));
        }
      }
    }
    if (modelInfo.tokenizer_config)
      console.log(`Model tokenizer config loaded.`);
    if (modelInfo.template)
      console.log(`Model chat template loaded`);
  }
}

function checkRegexStopSequences(obj, stopSequences) {
  for (const [idx, seq] of stopSequences.entries()) {
    if (typeof seq === 'string') {
      const ret = obj.text.indexOf(seq);
      if (ret >= 0 && (obj.triggeredStopBufferIndex === null || ret < obj.triggeredStopBufferIndex)) {
        obj.triggeredStopBufferIndex = ret;
        obj.triggeredStop = seq;
        obj.triggeredStopIndex = idx;
        obj.triggeredStopMatch = ret;
      }
    } else {
      let match;
      try {
        match = seq.exec(obj.text);
      } catch {
        match = seq(obj.text);
      }
      if (match && (obj.triggeredStopBufferIndex === null || match.index < obj.triggeredStopBufferIndex)) {
        obj.triggeredStopBufferIndex = match.index;
        if (typeof obj.triggeredStopBufferIndex !== 'number') {
          throw `[rawCompletionRegexStopByStream] error: typeof match.index !== 'number'`;
          return null;
        }
        const match0 = match[0];
        if (match0 === undefined) {
          const string = match.string;
          if (string === undefined) {
            const index = match.index;
            const length = match.length;
            if (index === undefined || length === undefined) {
              throw `[rawCompletionRegexStopByStream] error: don't know how to get obj.triggeredStop from the match object!`;
              return null;
            } else {
              obj.triggeredStop = obj.text.slice(match.index, match.index + match.length);
            }
          } else {
            obj.triggeredStop = string;
          }
        } else {
          obj.triggeredStop = match[0];
        }
        obj.triggeredStopIndex = idx;
        obj.triggeredStopMatch = match;
      }
    }
  }
  if (obj.triggeredStopBufferIndex !== null) {
    obj.text = obj.text.slice(0, obj.triggeredStopBufferIndex);
    obj.finish_reason = 'stop';
    return true;
  } else {
    return false;
  }
}

async function chatCompletion(messages, options = {}) {
  const base_url = options.base_url || BASE_URL;
  if (process.env.AI_SYSTEM_PROMPT && messages[0].role !== 'system') {
    const systen_turn = { role: 'system', content: process.env.AI_SYSTEM_PROMPT  };
    messages = [systen_turn, ...messages];
  }
  let body = {
    model: options.model ?? MODEL,
    temperature: options.temperature ?? (process.env.TEMPERATURE ? parseFloat(process.env.TEMPERATURE) : undefined) ?? 1.0,
    enable_thinking: options.enable_thinking,
    seed: (options.seed !== undefined ? options.seed : Date.now()),
  }

  // Note: We assume this function is not used in Phase 2 chatting.
  // The implementation of assistant perfill is different in Phase 2 chatting.
  const assistant_perfill = options.assistant_perfill ?? process.env.ASSISTANT_PERFILL_PREFIX ?? undefined;
  if (assistant_perfill) {
    body.messages = [...messages, { role: 'assistant', content: assistant_perfill }];
  } else {
    body.messages = messages;
  }

  const maxTokens = options.max_tokens ?? (process.env.MAX_TOKENS ? parseInt(process.env.MAX_TOKENS) : undefined);
  if (maxTokens !== undefined) {
    body.max_tokens = maxTokens;
  }
  if (options.continue_) {
    body['continue'] = body.continue_ = Boolean(assistant_perfill || options.continue_);
  }
  if (options.stop) {
    body.stop = options.stop;
  }
  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
    if (options.tool_choice !== undefined) {
      body.tool_choice = options.tool_choice;
    }
  }
  const response = await fetch(`${base_url}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${options.api_key ?? API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`AI API error: ${response.status} ${err}`);
  }

  const data = await response.json();
  await updateModelUsed(data.model, base_url);
  const message = data.choices[0].message;
  // Return both content and tool_calls for callers that need tool use
  if (options.tools && options.tools.length > 0) {
    let tool_calls = message.tool_calls || [];
    let content = message.content || '';

    // Some backends (vLLM, llama.cpp, etc.) degrade failed tool calls into plain text
    // instead of populating tool_calls. Detect and suppress this junk text.
    if (tool_calls.length === 0 && content) {
      const looksLikeDegradedToolCall = (
        /\(Made a function call\b/i.test(content) ||
        /\bcall_[a-zA-Z0-9]+\b/.test(content) ||
        /\btool_call\b/i.test(content) ||
        /^[\s\S]*"name"\s*:\s*"[a-z_]+"[\s\S]*"arguments"\s*:/m.test(content)
      );
      if (looksLikeDegradedToolCall) {
        console.warn(`[aiService] Detected degraded tool call in content, suppressing: ${content.slice(0, 120)}`);
        content = '';
      }
    }

    return { content, tool_calls };
  }
  return message.content;
}

async function chatCompletionByStream(messages, options = {}, stopSequences = [], print_streaming_stdout = false) {
  const base_url = options.base_url || BASE_URL;
  if (process.env.AI_SYSTEM_PROMPT && messages[0].role !== 'system') {
    const systen_turn = { role: 'system', content: process.env.AI_SYSTEM_PROMPT  };
    messages = [systen_turn, ...messages];
  }
  let body = {
    model: options.model ?? MODEL,
    messages,
    temperature: options.temperature ?? (process.env.TEMPERATURE ? parseFloat(process.env.TEMPERATURE) : undefined) ?? 1.0,
    enable_thinking: options.enable_thinking,
    seed: (options.seed !== undefined ? options.seed : Date.now()),
    stream: true,
  }
  const maxTokens = options.max_tokens ?? (process.env.MAX_TOKENS ? parseInt(process.env.MAX_TOKENS) : undefined);
  if (maxTokens !== undefined) {
    body.max_tokens = maxTokens;
  }
  if (options.continue_) {
    body['continue'] = body.continue_ = options.continue_;
  }
  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
    if (options.tool_choice !== undefined) {
      body.tool_choice = options.tool_choice;
    }
  }
  const response = await fetch(`${base_url}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${options.api_key ?? API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  let buffer = "";
  let triggeredStop = null;

  let peekLength = 0;
  for (const seq of stopSequences) {
    if (seq.length > peekLength)
      peekLength = seq.length;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let done = false;
  let finish_reason;
  while (!done) {
    const { value, done: readerDone } = await reader.read();
    done = readerDone;

    let text = decoder.decode(value, { stream: true });

    //console.log(`[chatCompletionByStream] text: ${text}`);

    // The format of each line in SSE is: "data: {...}" or "data: [DONE]"
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;

      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") {
        done = true;
        break;
      }

      let chunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }

      assert(chunk.finish_reason === undefined);
      finish_reason = chunk.choices[0].finish_reason;
      assert(finish_reason !== undefined);

      const gotText = chunk.choices[0].delta.content;
      assert(gotText !== undefined);
      if (!gotText)
        continue;

      buffer += gotText;
      if (print_streaming_stdout)
        process.stdout.write(gotText);

      if (buffer.length >= peekLength) {
        let indexFirst = null;
        let seqFirst = null;
        for (const seq of stopSequences) {
          const ret = buffer.indexOf(seq);
          if (ret >= 0 && (indexFirst === null || ret < indexFirst)) {
            indexFirst = ret;
            seqFirst = seq;
          }
        }
        if (indexFirst !== null && indexFirst <= buffer.length - peekLength) {
          triggeredStop = seqFirst;
          buffer = buffer.slice(0, indexFirst);
          finish_reason = 'stop';
          done = true;
          break;
        }
      }

      if (done) break;
    }
  }

  reader.cancel(); // Ensure the stream is closed

  if (print_streaming_stdout)
    process.stdout.write('\n\n');

  return { text: buffer, finish_reason, triggeredStop };
}

async function chatCompletionRegexStopByStream(messages, options = {}, stopSequences = [], print_streaming_stdout = false) {
  const base_url = options.base_url || BASE_URL;
  if (process.env.AI_SYSTEM_PROMPT && messages[0].role !== 'system') {
    const systen_turn = { role: 'system', content: process.env.AI_SYSTEM_PROMPT  };
    messages = [systen_turn, ...messages];
  }
  let body = {
    model: options.model ?? MODEL,
    messages,
    temperature: options.temperature ?? (process.env.TEMPERATURE ? parseFloat(process.env.TEMPERATURE) : undefined) ?? 1.0,
    enable_thinking: options.enable_thinking,
    seed: (options.seed !== undefined ? options.seed : Date.now()),
    stream: true,
  }
  const maxTokens = options.max_tokens ?? (process.env.MAX_TOKENS ? parseInt(process.env.MAX_TOKENS) : undefined);
  if (maxTokens !== undefined) {
    body.max_tokens = maxTokens;
  }
  if (options.continue_) {
    body['continue'] = body.continue_ = options.continue_;
  }
  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
    if (options.tool_choice !== undefined) {
      body.tool_choice = options.tool_choice;
    }
  }
  const response = await fetch(`${base_url}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${options.api_key ?? API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const obj = {
    text: "",
    finish_reason: undefined,
    triggeredStop: null,
    triggeredStopBufferIndex: null,
    triggeredStopIndex: null,
    triggeredStopMatch: null,
  };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let done = false;
  while (!done) {
    const { value, done: readerDone } = await reader.read();
    done = readerDone;

    let text = decoder.decode(value, { stream: true });

    //console.log(`[chatCompletionRegexStopByStream] text: ${text}`);

    // The format of each line in SSE is: "data: {...}" or "data: [DONE]"
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;

      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") {
        done = true;
        break;
      }

      let chunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }

      assert(chunk.finish_reason === undefined);
      obj.finish_reason = chunk.choices[0].finish_reason;
      assert(obj.finish_reason !== undefined);

      const gotText = chunk.choices[0].delta.content;
      assert(gotText !== undefined);
      if (!gotText)
        continue;

      obj.text += gotText;
      if (print_streaming_stdout)
        process.stdout.write(gotText);

      if (checkRegexStopSequences(obj, stopSequences))
        done = true;

      if (done) break;
    }
  }

  reader.cancel(); // Ensure the stream is closed

  if (print_streaming_stdout)
    process.stdout.write('\n\n');

  return obj;
}

async function rawCompletion(prompt, options = {}, stopSequences = ['\n']) {
  const base_url = options.base_url || BASE_URL;
  const response = await fetch(`${base_url}/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${options.api_key ?? API_KEY}`,
    },
    body: JSON.stringify({
      model: options.model ?? MODEL,
      prompt,
      max_tokens: options.max_tokens ?? (process.env.MAX_TOKENS_RAW ? parseInt(process.env.MAX_TOKENS_RAW) : undefined) ?? undefined,
      temperature: (process.env.TEMPERATURE_RAW ? parseFloat(process.env.TEMPERATURE_RAW) : undefined) ?? 1.0,
      enable_thinking: options.enable_thinking,
      stop: stopSequences,
      seed: Date.now(),
    }),
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  await updateModelUsed(data.model, base_url);
  return data.choices[0].text;
}

async function rawCompletionByStream(prompt, options = {}, stopSequences = ['\n'], print_streaming_stdout = false) {
  const base_url = options.base_url || BASE_URL;
  let buffer = "";
  let triggeredStop = null;

  const response = await fetch(`${base_url}/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${options.api_key ?? API_KEY}`,
    },
    body: JSON.stringify({
      model: options.model ?? MODEL,
      prompt,
      max_tokens: options.max_tokens ?? (process.env.MAX_TOKENS_RAW ? parseInt(process.env.MAX_TOKENS_RAW) : undefined) ?? undefined,
      temperature: (process.env.TEMPERATURE_RAW ? parseFloat(process.env.TEMPERATURE_RAW) : undefined) || 1.0,
      enable_thinking: options.enable_thinking,
      seed: Date.now(),
      stream: true,
    }),
  });

  let peekLength = 0;
  for (const seq of stopSequences) {
    if (seq.length > peekLength)
      peekLength = seq.length;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let done = false;
  let finish_reason;
  while (!done) {
    const { value, done: readerDone } = await reader.read();
    done = readerDone;

    let text = decoder.decode(value, { stream: true });

    //console.log(`[rawCompletionByStream] text: ${text}`);

    // The format of each line in SSE is: "data: {...}" or "data: [DONE]"
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;

      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") {
        done = true;
        break;
      }

      let chunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }

      assert(chunk.finish_reason === undefined);
      finish_reason = chunk.choices[0].finish_reason;
      assert(finish_reason !== undefined);

      const gotText = chunk.choices[0].text;
      assert(gotText !== undefined);
      if (!gotText)
        continue;

      buffer += gotText;
      if (print_streaming_stdout)
        process.stdout.write(gotText);

      if (buffer.length >= peekLength) {
        let indexFirst = null;
        let seqFirst = null;
        for (const seq of stopSequences) {
          const ret = buffer.indexOf(seq);
          if (ret >= 0 && (indexFirst === null || ret < indexFirst)) {
            indexFirst = ret;
            seqFirst = seq;
          }
        }
        if (indexFirst !== null && indexFirst <= buffer.length - peekLength) {
          triggeredStop = seqFirst;
          buffer = buffer.slice(0, indexFirst);
          finish_reason = 'stop';
          done = true;
          break;
        }
      }

      if (done) break;
    }
  }

  reader.cancel(); // Ensure the stream is closed

  if (print_streaming_stdout)
    process.stdout.write('\n\n');

  return { text: buffer, finish_reason, triggeredStop };
}

async function rawCompletionRegexStopByStream(prompt, options = {}, stopSequences = ['\n'], print_streaming_stdout = false) {
  const base_url = options.base_url || BASE_URL;
  const response = await fetch(`${base_url}/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${options.api_key ?? API_KEY}`,
    },
    body: JSON.stringify({
      model: options.model ?? MODEL,
      prompt,
      max_tokens: options.max_tokens ?? (process.env.MAX_TOKENS_RAW ? parseInt(process.env.MAX_TOKENS_RAW) : undefined) ?? undefined,
      temperature: (process.env.TEMPERATURE_RAW ? parseFloat(process.env.TEMPERATURE_RAW) : undefined) || 1.0,
      enable_thinking: options.enable_thinking,
      seed: Date.now(),
      stream: true,
    }),
  });

  const obj = {
    text: "",
    finish_reason: undefined,
    triggeredStop: null,
    triggeredStopBufferIndex: null,
    triggeredStopIndex: null,
    triggeredStopMatch: null,
  };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let done = false;
  let finish_reason;
  while (!done) {
    const { value, done: readerDone } = await reader.read();
    done = readerDone;

    let text = decoder.decode(value, { stream: true });

    //console.log(`[rawCompletionRegexStopByStream] text: ${text}`);

    // The format of each line in SSE is: "data: {...}" or "data: [DONE]"
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;

      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") {
        done = true;
        break;
      }

      let chunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }

      assert(chunk.finish_reason === undefined);
      obj.finish_reason = chunk.choices[0].finish_reason;
      assert(obj.finish_reason !== undefined);

      const gotText = chunk.choices[0].text;
      assert(gotText !== undefined);
      if (!gotText)
        continue;

      obj.text += gotText;
      if (print_streaming_stdout)
        process.stdout.write(gotText);

      if (checkRegexStopSequences(obj, stopSequences))
        done = true;

      if (done) break;
    }
  }

  reader.cancel(); // Ensure the stream is closed

  if (print_streaming_stdout)
    process.stdout.write('\n\n');

  return obj;
}

export { chatCompletion, chatCompletionByStream, chatCompletionRegexStopByStream, rawCompletion, rawCompletionByStream, rawCompletionRegexStopByStream, checkRegexStopSequences };
