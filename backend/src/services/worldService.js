import assert from 'node:assert/strict';
import {
  chatCompletion,
  chatCompletionByStream,
  chatCompletionRegexStopByStream,
  rawCompletion,
  rawCompletionByStream,
  rawCompletionRegexStopByStream,
  checkRegexStopSequences,
  getModelInfo,
} from './aiService.js';
import db from '../db.js';
import { v4 as uuidv4 } from 'uuid';
import { promises as fsPromises } from 'fs';
import { loadPrompts, renderPrompt, getPromptRaw } from './promptLoader.js';
import path from 'path';
import yaml from 'js-yaml';
import { type } from 'node:os';

if (!process.env.TEMPERATURE) throw "Please set TEMPERATURE* variables in your .env files.";
await loadPrompts();

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function loc(world) {
  return world?.locale || 'en';
}

export function checkWorldAccess(worldId, userId) {
  return db.prepare('SELECT * FROM worlds WHERE id = ? AND user_id = ?').get(worldId, userId);
}

function getWorld(worldId) {
  return db.prepare('SELECT * FROM worlds WHERE id = ?').get(worldId);
}

// Phase 1: Tool definitions for OpenAI function calling format
export async function buildPhase1Tools(worldId, locale = 'en') {
  const _locale = locale;
  const ret = [];
  if (needRandomName(worldId))
    ret.push({
      type: 'function',
      function: {
        name: 'get_random_character_name',
        description: getPromptRaw('tool_get_random_character_name_desc', _locale),
        parameters: {
          type: 'object',
          properties: {
            character_trait: {
              type: 'string',
              description: getPromptRaw('tool_get_random_character_name_trait_desc', _locale),
            },
            count: {
              type: 'integer',
              description: getPromptRaw('tool_get_random_character_name_count_desc', _locale),
            }
          },
          required: ['character_trait', 'count'],
        }
      }
    });
  ret.push({
    type: 'function',
    function: {
      name: 'create_and_invite',
      description: getPromptRaw('tool_create_and_invite_desc', _locale),
      parameters: {
        type: 'object',
        properties: {
          joined_person_names: {
            type: 'array',
            items: { type: 'string' },
            description: getPromptRaw('tool_joined_person_names_desc', _locale),
          },
          joined_person_relations: {
            type: 'string',
            description: getPromptRaw('tool_joined_person_relations_desc', _locale),
          },
          place: { type: 'string', description: getPromptRaw('tool_place_desc', _locale) },
          plans_and_something_expected_to_happen: {
            type: 'array',
            items: { type: 'string' },
            description: getPromptRaw('tool_plans_desc', _locale),
          },
          new_persons_long_term_traits : {
            type: 'array',
            items: { type: 'string' },
            description: getPromptRaw('tool_new_persons_desc', _locale),
          },
          interaction_type: {
            type: 'integer',
            description: renderPrompt('tool_interaction_type_desc', _locale, {
              interaction_type_list: Array.from((getPromptRaw('interaction_type', _locale)).entries().map(([i, v]) => `${i}: ${v.ai_name}`)).join(', ')
            }),
          },
        },
        required: ['joined_person_names', 'place'],
      },
    },
  });
  return ret;
}

// Phase 1: Build assistant system prompt
export function buildAssistantPrompt(world) {
  const locale = loc(world);
  let prompt = renderPrompt('phase1_system_intro', locale, {
    user_display_name: world.user_display_name,
    world_name: world.name,
  });
  if (world.description)
    prompt += '\n' + renderPrompt('phase1_system_description', locale, { description: world.description });
  if (world.requirement)
    prompt += '\n' + renderPrompt('phase1_system_requirement', locale, { requirement: world.requirement });

  const reviews = getRoundsDiaryReviews(world.id);
  if (reviews.length > 0) {
    prompt += getPromptRaw('phase1_system_history_header', locale) + getDiaryPersistentText(reviews, locale);
  } else {
    prompt += getPromptRaw('phase1_system_first_time', locale);
  }

  return prompt;
}

export function getRound(roundId, worldId) {
  const round = db.prepare('SELECT * FROM rounds WHERE id = ? AND world_id = ?').get(roundId, worldId);
  if (!round) return null;
  return {
    ...round,
    phase1_messages: JSON.parse(round.phase1_messages),
    phase2_messages: JSON.parse(round.phase2_messages),
    phase2_meta: round.phase2_meta ? JSON.parse(round.phase2_meta) : null,
    pending_start_chat: round.pending_start_chat ? JSON.parse(round.pending_start_chat) : null,
  };
}

export function getRoundsDiaryReviews(worldId, finished=true) {
  let rounds;
  if (finished)
    rounds = db.prepare('SELECT review FROM rounds WHERE world_id = ? AND finished_at IS NOT NULL ORDER BY created_at').all(worldId);
  else
    rounds = db.prepare('SELECT review FROM rounds WHERE world_id = ? ORDER BY created_at').all(worldId);
  if (!rounds)
    return null;
  rounds = rounds.map(r => r.review ? JSON.parse(r.review): null);
  return rounds;
}

export function saveRound(roundId, updates) {
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(updates)) {
    if (k === 'phase1_messages' || k === 'phase2_messages' || k === 'phase2_meta' || k === 'pending_start_chat') {
      sets.push(`${k} = ?`);
      vals.push(v ? JSON.stringify(v) : null);
    } else {
      sets.push(`${k} = ?`);
      vals.push(v);
    }
  }
  vals.push(roundId);
  db.prepare(`UPDATE rounds SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function needRandomName(worldId) {
  if (process.env.PHASE1_RANDOM_NAME) {
    const ntimes = parseInt(process.env.PHASE1_RANDOM_NAME);
    if (ntimes > 0) {
      const ret = db.prepare('SELECT count(id) AS round_count FROM rounds WHERE world_id = ? AND finished_at IS NOT NULL').get(worldId);
      return (ret.round_count < ntimes);
    } else if (ntimes === -1) {
      return true;
    } else {
      return false;
    }
  } else {
    return false;
  }
}

export async function compileDiaryLines(world, inner) {
  try {
    const genAction = [];
    const genResult = [];
    const lines = [];

    if (typeof inner !== 'string')
      throw 'inner should be string';

    if (inner) {
      // <>: character description generation, []: scene description generation, {}: action/plan generation
      // @: 不對user顯示結果, #: 只執行，不將結果文字放入, +: 文字必須放入永久回顧(確保特性之後不會跑掉), -: 文字在做摘要時不放入, #: 文字完全不放入(imply @)
      // ~: prompt中提示"詳細"描述, =: 不做轉換或只做句型的轉換（對角色，做句型轉換為針對該名字；其他，直接輸出原本的描述，等於不做事）
      const matches = Array.from(inner.matchAll(/\s+|([@]?[+#-]?[~=]?|![ipsrP]*)(?:\(((?:[^()]|\([^()]*\))+)\)|\<(?:(\d+):)?([^<>]+)\>|\[(?:(\d+):)?([^\[\]]+)\]|\{(?:(\d+):)?([^{}]+)\})/gy));
      let count = 0;
      let lastIndex = 0;
      for (const match of matches) {
        lastIndex = match.index + match[0].length;
        if (match[1] !== undefined) {
          const attr = match[1];
          if (match[2] !== undefined) {
            // normal line
            lines.push([match[2], attr]);
          } else if (match[4] !== undefined) {
            // <>
            ++count;
            const idx = match[3] ? parseInt(match[3]) : count;
            if (genAction[idx] !== undefined)
              throw `index repeated: ${idx}`;
            genAction[idx] = [1, match[4], attr];
            lines.push([`$-${idx}: $${idx}`, attr]);
          } else if (match[6] !== undefined) {
            // []
            ++count;
            const idx = match[5] ? parseInt(match[5]) : count;
            if (genAction[idx] !== undefined)
              throw `index repeated: ${idx}`;
            genAction[idx] = [2, match[6], attr];
            lines.push([`$${idx}`, attr]);
          } else if (match[8] !== undefined) {
            // {}
            ++count;
            const idx = match[7] ? parseInt(match[7]) : count;
            if (genAction[idx])
              throw `index repeated: ${idx}`;
            genAction[idx] = [3, match[8], attr];
            lines.push([`$${idx}`, attr]);
          } else {
            throw "error!!";
          }
        }
      }
      if (lastIndex !== inner.length) {
        throw `error: lastIndex: ${lastIndex} inner.length: ${inner.length} not equal`;
      }

      if (genAction.length > 0) {
        const funExpend = (text, debugSymbol = null) => {
          const concat = [];
          let prevIndex = 0;
          for (const match of text.matchAll(/\$(-)?(\d+)|\${(-)?(\d+)}/g)) {
            concat.push(text.slice(prevIndex, match.index));
            const onlyName = Boolean(match[1] || match[3]);
            const genIndex = parseInt(match[2] || match[4]);
            if (genResult[genIndex]) {
              if (genResult[genIndex].type == 1) {
                if (onlyName)
                  concat.push(genResult[genIndex].name);
                else
                  concat.push(genResult[genIndex].description);
              } else if (genResult[genIndex].type == 2) {
                if (onlyName)
                  throw "error: $- can only apply to character description";
                concat.push(genResult[genIndex].description);
              } else if (genResult[genIndex].type == 3) {
                if (onlyName)
                  throw "error: $- can only apply to character description";
                concat.push(genResult[genIndex].description);
              }
            } else {
              if (debugSymbol)
                throw `error: ${debugSymbol}: cannot expand '${match[0]}'`
              else
                throw `error: cannot expand '${match[0]}'`
            }
            prevIndex = match.index + match[0].length;
          }
          concat.push(text.slice(prevIndex));
          return concat.join('');
        };

        const reviews = getRoundsDiaryReviews(world.id);
        const _compileLocale = loc(world);
        const diaryMessage = genDiaryCommandMessages(world, reviews);
        for (const idx in genAction) {
          if (genAction[idx][0] == 1) {  // character
            const result = await genDiaryCharacter(diaryMessage, funExpend(genAction[idx][1], `genAction#${idx}`), genAction[idx][2], _compileLocale);
            if (!result)
              throw `failed to expend (character) description #${idx}`;
            result.type = 1;
            genResult[idx] = result;
          } else if (genAction[idx][0] == 2) {  // scene
            const result = await genDiaryScene(diaryMessage, funExpend(genAction[idx][1], `genAction#${idx}`), genAction[idx][2], _compileLocale);
            if (!result)
              throw `failed to expend (scene) description #${idx}`;
            result.type = 2;
            genResult[idx] = result;
          } else if (genAction[idx][0] == 3) {  // action
            const result = await genDiaryAction(diaryMessage, funExpend(genAction[idx][1], `genAction#${idx}`), genAction[idx][2], _compileLocale);
            if (!result)
              throw `failed to expend (action/situation) description #${idx}`;
            result.type = 3;
            genResult[idx] = result;
          }
        }

        for (const idx in lines) {
          lines[idx][0] = funExpend(lines[idx][0], `line#${idx}`);
        }
      }
    }

    const linesInvite = [];
    for (const line of lines) {
      let needAdd = false;
      if (line[1].includes('!')) {
        if (line[1].includes('i'))
          needAdd = true;
      } else {
        if (!line[1].includes('#') && !line[1].includes('@'))
          needAdd = true;
      }
      if (needAdd)
        linesInvite.push(line[0]);
    }

    const linesPlay = [];
    for (const line of lines) {
      let needAdd = false;
      if (line[1].includes('!')) {
        if (line[1].includes('p'))
          needAdd = true;
      } else {
        if (!line[1].includes('#'))
          needAdd = true;
      }
      if (needAdd)
        linesPlay.push(line[0]);
    }

    const linesSummary = [];
    for (const line of lines) {
      let needAdd = false;
      if (line[1].includes('!')) {
        if (line[1].includes('s'))
          needAdd = true;
      } else {
        if (!line[1].includes('#') && !line[1].includes('-'))
          needAdd = true;
      }
      if (needAdd)
        linesSummary.push(line[0]);
    }

    const linesReview = [];
    for (const line of lines) {
      let needAdd = false;
      if (line[1].includes('!')) {
        if (line[1].includes('r'))
          needAdd = true;
      } else {
        if (!line[1].includes('#') && !line[1].includes('@') && line[1].includes('+'))
          needAdd = true;
      }
      if (needAdd)
        linesReview.push(line[0]);
    }

    const linesPersistent = [];
    for (const line of lines) {
      let needAdd = false;
      if (line[1].includes('!')) {
        if (line[1].includes('P'))
          needAdd = true;
      } else {
        if (!line[1].includes('#') && line[1].includes('+'))
          needAdd = true;
      }
      if (needAdd)
        linesPersistent.push(line[0]);
    }

    return { linesCompiled: lines, linesInvite, linesPlay, linesSummary, linesReview, linesPersistent }
  } catch (error) {
    console.log(`[compileDiaryLines] ${error}`);
    console.log(`[compileDiaryLines] ${error.message}`);
    return { error };
  }
}

export function getDiaryPersistentText(reviews, locale = 'en') {
  let prompt = '';
  for (const review of reviews) {
    if (review) {
      if (prompt)
        prompt += '\n\n';
      prompt += getPromptRaw('diary_section_title', locale) + review.title;
      if (review.linesPersistent && review.linesPersistent.length > 0)
        prompt += getPromptRaw('diary_section_info', locale) + review.linesPersistent.join('\n');
      prompt += getPromptRaw('diary_section_summary', locale) + review.summary;
    }
  }
  return prompt;
}

export function genDiaryCommandMessages(world, reviews) {
  const locale = loc(world);
  let content = getWorldDiaryPromptFromWorld(world);

  if (reviews.length > 0) {
    content += getPromptRaw('diary_cmd_has_previous', locale);
    const hasInfo = reviews.some(r => r.linesPersistent && r.linesPersistent.length > 0);
    if (hasInfo)
      content += getPromptRaw('diary_cmd_skip_info', locale);
    content += getPromptRaw('diary_cmd_previous_summary_header', locale);
    content += getDiaryPersistentText(reviews, locale);
  } else {
    content += getPromptRaw('diary_cmd_first_entry', locale);
  }

  const diaryMessages = [
    { role: 'user', content },
    { role: 'assistant', content: getPromptRaw('diary_cmd_assistant_ack', locale) },
  ];

  return diaryMessages;
}

export function genDiarySummaryMessages(world, reviews) {
  const locale = loc(world);
  let content = getWorldDiaryPromptFromWorld(world);

  if (reviews.length > 0) {
    content += getPromptRaw('diary_cmd_has_previous', locale);
    const hasInfo = reviews.some(r => r.linesPersistent && r.linesPersistent.length > 0);
    if (hasInfo)
      content += getPromptRaw('diary_cmd_skip_info', locale);
    content += getPromptRaw('diary_cmd_previous_summary_header', locale);
    content += getDiaryPersistentText(reviews, locale);
  } else {
    content += getPromptRaw('diary_cmd_first_entry', locale);
  }

  const diaryMessages = [
    { role: 'user', content },
    { role: 'assistant', content: getPromptRaw('diary_cmd_assistant_ack', locale) },
  ];

  return diaryMessages;
}

export function getWorldDiaryPromptFromWorld(world) {
  return getWorldDiaryPrompt(world.name, world.description, world.user_display_name, world.requirement, loc(world));
}

export function getWorldDiaryPrompt(name, description, user_display_name, requirement, locale = 'en') {
  let _requirement = (requirement || '').trim();
  // For zh locales, ensure the sentence ends with a Chinese period
  if (locale.startsWith('zh') && _requirement && _requirement.slice(-1) !== '。')
    _requirement += '。';

  let description_clause = '';
  if (description && description.trim()) {
    let _desc = description.trim();
    if (locale.startsWith('zh') && _desc.slice(-1) === '。')
      _desc = _desc.slice(0, -1).trim();
    if (_desc)
      description_clause = renderPrompt('diary_system_description_clause', locale, { description: _desc });
  }

  let prompt = renderPrompt('diary_system', locale, {
    world_name: name,
    description_clause,
    user_display_name,
    requirement_clause: _requirement ? _requirement + ' ' : '',
  });
  if (locale.startsWith('zh'))
    prompt = prompt.replace(/。。/g, '。');
  return prompt.trim();
}

export async function genDiaryCharacter(diaryMessages, description, optionString, locale = 'en') {
  if (optionString.includes('=')) {
    let name;
    const prompt = renderPrompt('char_gen_check_name', locale, { description });
    const messages = [...diaryMessages, { role: 'user', content: prompt}];
    const result = await chatCompletion(messages, { temperature: parseFloat(process.env.TEMPERATURE_DETERMINE) || 0.5 });
    try {
      let cleaned = result.replace(/```json|```/g, '').trim();
      cleaned = cleaned.match(/{[^{}]*}/)[0]
      const obj = JSON.parse(cleaned);
      if (obj.contains_name)
        name = obj.name
    } catch {
      
    }

    if (name) {
      diaryMessages.push({ role: 'user', content: prompt });
      diaryMessages.push({ role: 'assistant', content: `{"contains_name":true,"name":"${name}"}` });
      return { name, description };
    } else {
      let name;
      {
        const originalLength = diaryMessages.length;
        const mainPrompt = renderPrompt('char_gen_assign_name', locale, { description });
        diaryMessages.push({ role: 'user', content: mainPrompt });
        const textResponse = await chatCompletion(diaryMessages);
        diaryMessages.push({ role: 'assistant', content: textResponse });

        const jsonPrompt = getPromptRaw('char_gen_assign_name_json', locale);
        diaryMessages.push({ role: 'user', content: jsonPrompt });
        const jsonTextResponse = await chatCompletion(diaryMessages)
        //diaryMessages.push({ role: 'assistant', content: jsonTextResponse});
        let obj;
        try {
          const cleaned = jsonTextResponse.match(/\[[^\[\]]*\]/)[0]
          obj = JSON.parse(cleaned);
          obj = obj[Math.floor(Math.random() * obj.length)];
          name = obj.name;
        } catch {
          obj = null;
        }
        if (!name)
          return null;
        while (diaryMessages.length > originalLength)
          diaryMessages.pop();
      }

      const transferPrompt = renderPrompt('char_gen_transfer_sentence', locale, { name, description });
      diaryMessages.push({ role: 'user', content: transferPrompt });
      const jsonTextResponse = await chatCompletion(diaryMessages);
      diaryMessages[diaryMessages.length-1].content += getPromptRaw('char_gen_diary_note', locale);
      diaryMessages.push({ role: 'assistant', content: jsonTextResponse});
      let obj;
      try {
        const cleaned = jsonTextResponse.match(/{[^{}]*}/)[0]
        obj = JSON.parse(cleaned);
        if (!obj.name || !obj.description)
          obj = null;
      } catch {
        obj = null;
      }
      
      return obj ? { name: obj.name, description: obj.description } : null;
    }
  } else {
    const getLongDescription = optionString.includes('~');
    const detail_flag = getLongDescription ? getPromptRaw('char_gen_detail_flag_long', locale) : '';
    const mainPrompt = renderPrompt('char_gen_with_description', locale, { description, detail_flag });
    diaryMessages.push({ role: 'user', content: mainPrompt });
    const textResponse = await chatCompletion(diaryMessages);
    diaryMessages.push({ role: 'assistant', content: textResponse });
    const jsonPrompt = getPromptRaw('char_gen_with_description_json', locale);
    diaryMessages.push({ role: 'user', content: jsonPrompt });
    const jsonTextResponse = await chatCompletion(diaryMessages)
    diaryMessages.push({ role: 'assistant', content: jsonTextResponse});
    let obj;
    try {
      const cleaned = jsonTextResponse.match(/\[[^\[\]]*\]/)[0]
      obj = JSON.parse(cleaned);
      obj = obj[Math.floor(Math.random() * obj.length)];
      if (!obj.name || !obj.description)
        obj = null;
    } catch {
      obj = null;
    }
    return obj ? { name: obj.name, description: obj.description } : null;
  }
}

export async function genDiaryCharacterNames(diaryMessages, description, locale = 'en', count_possibilities, count_get) {
    let names;

    const originalLength = diaryMessages.length;
    const mainPrompt = renderPrompt('char_gen_assign_name_many', locale, { description, count: count_possibilities });
    diaryMessages.push({ role: 'user', content: mainPrompt });
    const textResponse = await chatCompletion(diaryMessages);
    diaryMessages.push({ role: 'assistant', content: textResponse });

    const jsonPrompt = getPromptRaw('char_gen_assign_name_json', locale);
    diaryMessages.push({ role: 'user', content: jsonPrompt });
    const jsonTextResponse = await chatCompletion(diaryMessages)
    //diaryMessages.push({ role: 'assistant', content: jsonTextResponse});
    let obj;
    try {
      const cleaned = jsonTextResponse.match(/\[[^\[\]]*\]/)[0]
      obj = JSON.parse(cleaned);
      names = obj.map(elem => elem.name);
    } catch {
      names = null;
    }
    if (!names)
      return null;
    while (diaryMessages.length > originalLength)
      diaryMessages.pop();

    names = shuffle(names);
    return names.slice(0, count_get);
}

export async function genDiaryScene(diaryMessages, description, optionString, locale = 'en') {
  if (optionString.includes('='))
    return description;
  const getLongDescription = optionString.includes('~');
  const detail_flag = getLongDescription ? getPromptRaw('scene_gen_detail_flag_long', locale) : '';
  const detail_flag_short = getLongDescription ? getPromptRaw('scene_gen_detail_flag_short', locale) : '';
  const mainPrompt = renderPrompt('scene_gen_prompt', locale, { description, detail_flag, detail_flag_short });
  diaryMessages.push({ role: 'user', content: mainPrompt });
  const jsonTextResponse = await chatCompletion(diaryMessages);
  diaryMessages.push({ role: 'assistant', content: jsonTextResponse });
  let obj;
  try {
    const cleaned = jsonTextResponse.match(/{[^{}]*}/)[0]
    obj = JSON.parse(cleaned);
    if (!obj.description)
      obj = null;
  } catch {
    obj = null;
  }
  return obj ? { description: obj.description } : null;
}

export async function genDiaryAction(diaryMessages, description, optionString, locale = 'en') {
  if (optionString.includes('='))
    return description;
  const getLongDescription = optionString.includes('~');
  const detail_flag = getLongDescription ? getPromptRaw('action_gen_detail_flag_long', locale) : '';
  const detail_flag_short = getLongDescription ? getPromptRaw('action_gen_detail_flag_short', locale) : '';
  const mainPrompt = renderPrompt('action_gen_prompt', locale, { description, detail_flag, detail_flag_short });
  diaryMessages.push({ role: 'user', content: mainPrompt });
  const jsonTextResponse = await chatCompletion(diaryMessages);
  diaryMessages.push({ role: 'assistant', content: jsonTextResponse });
  let obj;
  try {
    const cleaned = jsonTextResponse.match(/{[^{}]*}/)[0]
    obj = JSON.parse(cleaned);
    if (!obj.description) {
      obj = null;
    }
  } catch {
    obj = null;
  }
  return obj ? { description: obj.description } : null;
}

// Parse a single OpenAI tool_call object into our internal command format
export function parsePhase1Command(tool_call) {
  if (!tool_call || tool_call.type !== 'function') return null;
  const name = tool_call.function.name;
  let args;
  try {
    args = JSON.parse(tool_call.function.arguments);
  } catch {
    return null;
  }

  if (['get_random_character_name', 'create_and_invite'].includes(name)) {
    return { ...args, type: name };
  }

  return null;
}

// Build phase2 context (RAW format)
export function buildPhase2Context(world, meta, messages, options={}) {
  const stage = options.stage || 'play';  // play; summary
  let lines;
  if (stage === 'play')
    lines = meta.linesPlay;
  else if (stage === 'summary')
    lines = meta.linesSummary;
  else {
    console.log(`[buildPhase2Context] unsupported stage: ${stage}`);
    return null;
  }
  const locale = loc(world);
  let ctx = '';
  if (lines.length > 0) {
    ctx += getPromptRaw('phase2_section_info', locale);
    for (const line of lines) {
      ctx += `${line}\n`;
    }
  }
  
  if (ctx)
    ctx += '\n';
  ctx += getPromptRaw('phase2_section_dialogue', locale);

  for (const msg of simplifyPhase2Messages(messages)) {
    if (msg.speaker !== '_system' && msg.speaker !== '_continue') {
      ctx += `${msg.speaker}: ${msg.text}\n`;
    } else {
      ctx += `${msg.text}\n`;
    }
  }

  return ctx;
}

export function simplifyPhase2Messages(messages, user) {
  // TODO: it's may be different for user's messages
  const simplified = [];
  let prevSpeaker = null;
  let speaker = null;
  let spoken = false;
  for (const msg of messages) {
    if (speaker != msg.speaker && msg.speaker !== '_continue') {
      speaker = msg.speaker;
      spoken = false;
    }
    if (!msg.text.trim()) {
      continue;
    }
    if (!spoken)
      simplified.push({ speaker, text: msg.text.trim() });
    else
      simplified.push({ speaker: '_continue', text: msg.text.trim() });
    spoken = true;
  }
  return simplified;
}

export function getSpeakerText(line) {
  // Parse normal character line
  let colonIdx = -1;
  for (const match of line.matchAll(/([:：])|\([^()]*\)|（[^()]*）|\[[^()]*\]/g)) {
    if (match[1] !== undefined) {
      colonIdx = match.index;
      break;
    }
  }
  
  let speaker;
  let text;
  if (colonIdx > 0) {
    speaker = line.slice(0, colonIdx).trim();
    text = line.slice(colonIdx + 1).trim();

    //const m = speaker.match(/[*][*]\s*([^*]+)\s*[*][*]/);
    //if (m)
    //  speaker = m[1];

    return { speaker, text };
  } else {
    return { speaker: '_continue', text: line.trim()};
  }
}

export function getPhase2LastSpeaker(messages) {
  let defaultSpeaker;
  for (let i = messages.length - 1; i >= 0; --i) {
    if (messages[i].speaker !== '_continue') {
      return messages[i].speaker;
    } else {
      defaultSpeaker = null;
    }
  }
  return defaultSpeaker;
}

export class Phase2LineGenerator {
  constructor(world, linesPlay, method=(process.env.PHASE2_PROMPTING_METHOD ? parseInt(process.env.PHASE2_PROMPTING_METHOD) : undefined) ?? 0) {
    this.world = world;
    this.lines = linesPlay;
    this.method = method;
    this.options = {
      base_url: process.env.PHASE2_BASE_URL,
      api_key: process.env.PHASE2_API_KEY,
      model: process.env.PHASE2_MODEL,
      max_tokens: (process.env.PHASE2_MAX_TOKENS ? parseInt(process.env.PHASE2_MAX_TOKENS) : undefined),
      temperature: (process.env.PHASE2_TEMPERATURE ? parseFloat(process.env.PHASE2_TEMPERATURE) : undefined),
    };
  }

  async initialize() {
    const placeholder = '|||my_placeholder|||';
    const reviews = getRoundsDiaryReviews(this.world.id);
    let modelInfo;

    if ([3, 4, 5].includes(this.method)) {
      modelInfo = getModelInfo(this.options.base_url);
      if (!modelInfo.template) {
        if (modelInfo.name) {
          console.log(`[Phase2LineGenerator.initialize] Didn't get model chat template renderer for model: ${modelInfo.name}`);
        } else {
          console.log(`[Phase2LineGenerator.initialize] Didn't get backend model name, try to get it now.`);
          await chatCompletion([{ role: 'user', content: "Don't say anything else. 1 + 2 = ?" }]);
          modelInfo = getModelInfo(this.options.base_url);
        }
      }
    }

    if (this.method === 0) {  // -----------------------------------------------------------
      const locale = loc(this.world);
      let content = getWorldDiaryPromptFromWorld(this.world);
      if (reviews.length > 0) {
        content += getPromptRaw('phase2_gen_previous_header', locale);
        content += getDiaryPersistentText(reviews, locale);
      }

      content += getPromptRaw('phase2_gen_latest_entry_header', locale);

      if (this.lines.length > 0) {
        content += getPromptRaw('phase2_gen_section_info', locale);
        for (const line of this.lines) {
          content += `${line}\n`;
        }
        content += '\n';
      }
      
      content += getPromptRaw('phase2_gen_section_dialogue', locale);

      this.precontent = content;
    } else if (this.method === 1 || this.method === 3) {  // -----------------------------------------------------------
      const locale = loc(this.world);
      let content = getWorldDiaryPromptFromWorld(this.world);
      if (reviews.length > 0) {
        content += getPromptRaw('phase2_gen_previous_header', locale);
        content += getDiaryPersistentText(reviews, locale);
      }

      content += getPromptRaw('phase2_gen_method1_next_entry', locale);

      if (this.lines.length > 0) {
        content += getPromptRaw('phase2_gen_method1_info_header', locale);
        content += this.lines.join('\n');
      }

      let assistant_content = '';
      if (process.env.PHASE2_ASSISTANT_PERFILL_PREFIX)
        assistant_content += process.env.PHASE2_ASSISTANT_PERFILL_PREFIX;
      assistant_content += getPromptRaw('phase2_gen_method1_assistant_ack', locale);

      const diaryMessages = [
        { role: 'user', content },
        { role: 'assistant', content: assistant_content },
      ]

      if (this.method === 1) {
        this.diaryMessages = diaryMessages;
      } else {
        assert(this.method === 3);

        diaryMessages[diaryMessages.length-1].content += placeholder;

        let rawMessage = modelInfo.template.render({ ...modelInfo.tokenizer_config, messages: diaryMessages });
        //console.log(`[Phase2LineGenerator.initialize] rawMessage: ${rawMessage}`);
      
        const i = rawMessage.lastIndexOf(placeholder);
        if (i < 0) {
          console.log(`[Phase2LineGenerator.initialize] error to get location.`)
          return null;
        }
        this.prefix = rawMessage.slice(0, i);
      }
    } else if (this.method === 4) {  // -----------------------------------------------------------
      const diaryMessages = genDiarySummaryMessages(this.world, reviews);

      diaryMessages.push({ role: 'user', content: placeholder });
    
      let rawMessage = modelInfo.template.render({ ...modelInfo.tokenizer_config, messages: diaryMessages });
      //console.log(`[Phase2LineGenerator.initialize] rawMessage: ${rawMessage}`);
    
      const i = rawMessage.lastIndexOf(placeholder);
      if (i < 0) {
        console.log(`[Phase2LineGenerator.initialize] error to get location.`)
        return null;
      }
      this.prefix = rawMessage.slice(0, i);

      const _locale4 = loc(this.world);
      if (this.lines.length > 0) {
        this.prefix += getPromptRaw('phase2_gen_section_info', _locale4);
        for (const line of this.lines) {
          this.prefix += `${line}\n`;
        }
        this.prefix += '\n';
      }
      
      this.prefix += getPromptRaw('phase2_section_dialogue', _locale4);
    } else if (this.method === 5) {  // -----------------------------------------------------------
      const _locale5 = loc(this.world);
      this.prefix = getWorldDiaryPromptFromWorld(this.world);
      if (reviews.length > 0) {
        this.prefix += getPromptRaw('phase2_gen_previous_header', _locale5);
        this.prefix += getDiaryPersistentText(reviews, _locale5);
      }

      this.prefix += getPromptRaw('phase2_gen_latest_entry_header', _locale5);

      if (this.lines.length > 0) {
        this.prefix += getPromptRaw('phase2_gen_section_info', _locale5);
        for (const line of this.lines) {
          this.prefix += `${line}\n`;
        }
        this.prefix += '\n';
      }
      
      this.prefix += getPromptRaw('phase2_gen_section_full_dialogue', _locale5);
    } else {
      throw `[Phase2LineGenerator.initialize] Unsupported chat prompting method: ${JSON.stringify(this.method)}`;
    }
  }

  async generate(messages, nextSpeaker=null, nextSpeakerInvert=false, stopSequences = ['\n'], withRegex = false) {
    if (this.method === 0) {
      let content = this.precontent;
      content += phase2PlayingMessagesToText(messages);

      // TODO: check if this is OK to specify next speaker for method#0:
      if (nextSpeaker)
        content += `${nextSpeaker}: `

      const _genLocale = loc(this.world);
      content += getPromptRaw('phase2_gen_method0_continue', _genLocale);

      if (nextSpeaker) {
        if (nextSpeakerInvert) {
          content += renderPrompt('phase2_gen_method0_not_next_speaker', _genLocale, { next_speaker: nextSpeaker });
        } else {
          content += renderPrompt('phase2_gen_method0_next_speaker', _genLocale, { next_speaker: nextSpeaker });
        }
      }

      const diaryMessages = [
        { role: 'user', content },
      ];

      if (messages.length > 0) {
        const msgs = simplifyPhase2Messages(messages);

        let _funCheck_prevNewline = -1;
        let _funCheck_mode = 0;  // 0: undetermined (first time), 1: repeat from last line, 2: repeat from first line
        let _funCheck_mode_2_nextLineNumber;
        let _funCheck_startIndex;
        let _funCheck_obj = {
          text: "",
          finish_reason: undefined,
          triggeredStop: null,
          triggeredStopBufferIndex: null,
          triggeredStopIndex: null,
          triggeredStopMatch: null,
        };
        const funCheckOkProxy = (text) => {
          //console.log(`[funCheckOkProxy] text: ${text}`);
          _funCheck_obj.text = text.slice(_funCheck_startIndex);
          if (checkRegexStopSequences(_funCheck_obj, stopSequences)) {
            return {
              index: _funCheck_startIndex + _funCheck_obj.triggeredStopBufferIndex,
              string: _funCheck_obj.triggeredStop,
              obj: _funCheck_obj,
            }
          }
        };
        const funCheck = (text) => {
          if (_funCheck_startIndex !== undefined)
              return funCheckOkProxy(text);
          //console.log(`[funCheck] text: ${text}`);
          let newline = text.lastIndexOf('\n');
          while (newline > _funCheck_prevNewline) {
            const prevNextNewline = text.indexOf('\n', _funCheck_prevNewline + 1);
            const currentChatLine = text.slice(_funCheck_prevNewline + 1, prevNextNewline).trim();
            if (!currentChatLine) {
              _funCheck_prevNewline = prevNextNewline;
              continue;
            }
            const currentMsg = getSpeakerText(currentChatLine);
            if (_funCheck_mode === 0) {
              if (msgs[msgs.length-1].speaker == currentMsg.speaker && msgs[msgs.length-1].text == currentMsg.text) {
                _funCheck_mode = 1;
              } else if (msgs[0].speaker == currentMsg.speaker && msgs[0].text == currentMsg.text) {
                _funCheck_mode = 2;
                _funCheck_mode_2_nextLineNumber = 1;
              } else {
                _funCheck_startIndex = 0;
              }
            } else if (_funCheck_mode === 1) {
              _funCheck_startIndex = _funCheck_prevNewline + 1;
            } else if (_funCheck_mode === 2) {
              if (_funCheck_startIndex === msgs.length) {
                _funCheck_startIndex = _funCheck_prevNewline + 1;
              } else if (msgs[_funCheck_mode_2_nextLineNumber].speaker == currentMsg.speaker && msgs[_funCheck_mode_2_nextLineNumber].text == currentMsg.text) {
                ++_funCheck_mode_2_nextLineNumber;
              } else {
                _funCheck_startIndex = 0;
              }
            }
            if (_funCheck_startIndex !== undefined)
              return funCheckOkProxy(text);
            _funCheck_prevNewline = prevNextNewline;
          }
        };
        const result = await chatCompletionRegexStopByStream(diaryMessages, this.options, [funCheck]);
        if (result.triggeredStopMatch) {
          assert(_funCheck_startIndex !== undefined);
          return result.triggeredStopMatch.obj;
        } else {
          return result;
        }
      } else {
        if (withRegex)
          return await chatCompletionRegexStopByStream(diaryMessages, this.options, stopSequences);
        else
          return await chatCompletionByStream(diaryMessages, this.options, stopSequences);
      }
    } else if (this.method === 1) {
      const diaryMessages = [];
      for (const turn of this.diaryMessages) {
        diaryMessages.push({...turn});
      }
      diaryMessages[diaryMessages.length-1].content += phase2PlayingMessagesToText(messages);

      if (nextSpeaker && !nextSpeakerInvert)
        diaryMessages[diaryMessages.length-1].content += `${nextSpeaker}: `;

      let result;
      if (withRegex)
        result = await chatCompletionRegexStopByStream(diaryMessages, { ...this.options , /*continue_: true*/ }, stopSequences);
      else
        result = await chatCompletionByStream(diaryMessages, { ...this.options, /*continue_: true*/ }, stopSequences);

      if (nextSpeaker && !nextSpeakerInvert)
        return {...result, text: `${nextSpeaker}: ` + result.text};
      else
        return result;
    } else if (this.method === 3 || this.method === 4 || this.method === 5) {
      assert(this.prefix);

      let ctx = this.prefix;
      ctx += phase2PlayingMessagesToText(messages);

      if (nextSpeaker && !nextSpeakerInvert)
        ctx += `${nextSpeaker}: `;

      let result;
      if (withRegex)
        result = await rawCompletionRegexStopByStream(ctx, this.options, stopSequences);
      else
        result = await rawCompletionByStream(ctx, this.options, stopSequences);

      if (nextSpeaker && !nextSpeakerInvert)
        return {...result, text: `${nextSpeaker}: ` + result.text};
      else
        return result;
    }
  }
}

export function phase2PlayingMessagesToText(messages) {
  let ctx = '';
  for (const msg of simplifyPhase2Messages(messages)) {
    if (msg.speaker !== '_system' && msg.speaker !== '_continue') {
      ctx += `${msg.speaker}: ${msg.text}\n`;
    } else {
      ctx += `${msg.text}\n`;
    }
  }
  return ctx;
}

export async function generateRoundReview(world, messages, context) {
  const locale = loc(world);
  let content = context;
  content += getPromptRaw('round_review_prompt', locale);
  messages.push({ role: 'user', content: content});
  const result = await chatCompletion(messages);

  let obj = null;
  try {
    const cleaned = result.match(/({[^{}]*})[^{}]*$/)[1];
    obj = JSON.parse(cleaned);
    obj = { title: obj.title, summary: obj.summary };
  } catch(error) {
    console.log(`[generateRoundReview] exception: ${error.message}`);
    obj = null;
  }

  return obj;
}

export function getPhase1MessagesViewForUser(messages) {
  if (!messages) return messages;
  const result = [];
  for (const turn of messages) {
    if (turn.hidden)
      continue;
    if (turn.show_assistant) {
      result.push({ role: 'assistant', content: turn.show_assistant });
      continue;
    }
    if (turn.role === 'tool') {
      // Skip tool result messages from user-visible output
      continue;
    }
    if (turn.role === 'assistant' && turn.tool_calls && turn.tool_calls.length > 0 && !turn.content) {
      // Pure tool-call turn with no text — add a placeholder annotation if not only_useful
      const annotation = turn.tool_calls.map(tc => {
        const n = tc.function && tc.function.name;
        //if (n === 'create_and_invite') return '[Invitation sent]';
        return null;
      }).filter(Boolean).join('');
      if (annotation) result.push({...turn, content: annotation, tool_calls: undefined});
      // else skip entirely
      continue;
    }
    if (turn.role === 'super_user') {
      turn.role = 'user';
    } else if (turn.role === 'super_assistant') {
      turn.role = 'assistant';
    } else if (turn.role === 'super_assistant_error') {
      if (process.env.NODE_ENV != 'development') {
        turn.content = '[An error occurred while processing the user instruction]';
      }
    }
    if (turn.role === 'assistant')
      result.push({...turn, content: turn.content.trim()});
    else
      result.push({...turn});
  }
  return result;
}

export function getPhase1MessagesViewForAssistant(messages) {
  if (!messages) return messages;
  const result = [];
  for (const turn of messages) {
    if (['super_user', 'super_assistant', 'super_assistant_error'].includes(turn.role))
      continue;
    result.push({...turn, hidden: undefined});
  }
  return result;
}

export { getWorld };