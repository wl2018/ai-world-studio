import assert from 'node:assert';'node:assert/strict';
import util from 'node:util';
import express from 'express';
import db from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  checkWorldAccess,
  buildAssistantPrompt,
  buildPhase1Tools,
  parsePhase1Command,
  buildPhase2Context,
  Phase2LineGenerator,
  generateRoundReview,
  getPhase1MessagesViewForUser,
  getPhase1MessagesViewForAssistant,
  compileDiaryLines,
  genDiarySummaryMessages,
  getRound,
  saveRound,
  getRoundsDiaryReviews,
  getSpeakerText,
  getPhase2LastSpeaker,
  genDiaryCharacter,
  genDiaryCharacterNames,
  genDiaryCommandMessages,
  getDiaryPersistentText,
  needRandomName,
} from '../services/worldService.js';
import { chatCompletion, rawCompletionByStream } from '../services/aiService.js';
import { getPromptRaw, renderPrompt } from '../services/promptLoader.js';

const router = express.Router({ mergeParams: true });
router.use(authMiddleware);

if (!process.env.TEMPERATURE) throw "Please set TEMPERATURE* variables in your .env files.";

function plainStringRegex(plainString) {
  return plainString.replace(/[\^\$\\\/\.\[\]\(\)\{\}\+\*\?\-\|]/g, '\\$&');
}

export async function phase1Greeting(world, round) {
  const locale = world.locale;
  const count = round.phase1_messages.length;
  const message = getPromptRaw('phase1_cmd_greeting', locale);
  await phase1Assistant(world, round, message, 
    {
      notAllowToolMsg: getPromptRaw('phase1_cmd_greeting_tool_not_allowed', locale),
      hidden_user_message: true,
    }
  );

  // Remove tool calling, etc. in the middle:
  if (process.env.PHASE1_GREETING_REMOVE_TOOL_CALLS && parseInt(process.env.PHASE1_GREETING_REMOVE_TOOL_CALLS)) {
    if (round.phase1_messages.length > count + 2) {
      const last_message = round.phase1_messages[round.phase1_messages.length-1];
      while (round.phase1_messages.length > count + 1)
        round.phase1_messages.pop();
      round.phase1_messages.push(last_message);
      saveRound(round.id, { phase1_messages: round.phase1_messages });
    }
  }
}

async function phase1Assistant(world, round, message, options = {}) {
  const notAllowToolMsg = options.notAllowToolMsg;
  const hidden_user_message = options.hidden_user_message;

  const locale = world.locale;

  const isSkip = !message || !message.trim();

  const systemPrompt = buildAssistantPrompt(world);
  const phase1 = round.phase1_messages;

  // Handle super command
  const superMatch = message.match(/^\/(j(?:oin)?)(?: |$)/);
  if (superMatch) {
    try {
      if (['j', 'join'].includes(superMatch[1])) {
        const inner = message.slice(superMatch[0].length);
        
        const result = await compileDiaryLines(world, inner);

        if (result.error)
          throw result.error;

        phase1.push({ role: 'super_user', content: message });
        phase1.push({ role: 'super_assistant', content: '[The user has generated an invitation through the command]' });
        saveRound(round.id, { phase1_messages: phase1, pending_start_chat: result });
        return { messages: getPhase1MessagesViewForUser(phase1), command: { type: 'start_chat', linesInvite: result.linesInvite } };
      }
    } catch (error) {
      phase1.push({ role: 'super_assistant_error', content: `Error: ${util.inspect(error)}` });
      saveRound(round.id, { phase1_messages: phase1 });
      return { messages: getPhase1MessagesViewForUser(phase1), command: null };
    }
  }

  // Append user message (skip if empty — user chose to skip their turn)
  if (!isSkip) {
    phase1.push({ role: 'user', content: message, hidden: hidden_user_message });
  } else {
    phase1.push({ role: 'user', content: getPromptRaw('phase1_cmd_continue', locale), hidden: hidden_user_message ?? true });
  }

  // Loop: keep processing AI tool calls (find_character / create_random_character) until
  // start_chat is called, AI gives no tool call, or safety limit reached.
  const MAX_COMMAND_LOOPS = 10;
  let loopCount = 0;
  let prevCommandFailed = false;

  while (loopCount < MAX_COMMAND_LOOPS) {
    loopCount++;

    const aiMessages = [
      { role: 'system', content: systemPrompt },
      ...phase1,
    ];

    const aiResp = await chatCompletion(getPhase1MessagesViewForAssistant(aiMessages), {
      temperature: (process.env.PHASE1_TEMPERATURE ? parseFloat(process.env.PHASE1_TEMPERATURE) : undefined),
      max_tokens: (process.env.PHASE1_MAX_TOKENS ? parseInt(process.env.PHASE1_MAX_TOKENS) : undefined),
      assistant_perfill: process.env.PHASE1_ASSISTANT_PERFILL_PREFIX,
      tools: await buildPhase1Tools(world.id, world.locale || 'en'),
    });

    const { content: aiText, tool_calls } = aiResp;
    if (!aiText && tool_calls.length <= 0)
      break;

    // Build the assistant turn for history (must include tool_calls if present)
    const assistantTurn = { role: 'assistant', content: aiText || '' };
    if (tool_calls && tool_calls.length > 0) assistantTurn.tool_calls = tool_calls;

    prevCommandFailed = false;

    if (!tool_calls || tool_calls.length === 0) {
      // No tool calls — this is a plain text response to the user
      phase1.push(assistantTurn);
      saveRound(round.id, { phase1_messages: phase1 });
      break;
    }

    phase1.push(assistantTurn);

    // Process each tool call in order
    for (const tool_call of tool_calls) {
      const cmd = parsePhase1Command(tool_call);
      let toolResult = '';

      if (!cmd) {
        toolResult = getPromptRaw('phase1_cmd_unknown', locale);
        phase1.push({ role: 'tool', tool_call_id: tool_call.id, content: toolResult });
        continue;
      }

      if (notAllowToolMsg) {
        toolResult = notAllowToolMsg;
        phase1.push({ role: 'tool', tool_call_id: tool_call.id, content: toolResult });
        continue;
      }

      if (cmd.type === 'get_random_character_name') {
        const reviews = getRoundsDiaryReviews(world.id);
        const diaryMessages = [...genDiaryCommandMessages(world, reviews), ...phase1];
        const characters = await genDiaryCharacterNames(diaryMessages, cmd.character_trait, locale, cmd.count * 2 + 3, cmd.count);
        if (characters)
          toolResult = `${characters.join(getPromptRaw('seperator_name_list', locale))}`;
        else
          toolResult = getPromptRaw('phase1_cmd_random_name_error', locale);
        phase1.push({ role: 'tool', tool_call_id: tool_call.id, content: toolResult });
        saveRound(round.id, { phase1_messages: phase1 });
        continue;
      } else if (cmd.type === 'create_and_invite') {
        let newchars = [];
        if (needRandomName(world.id)) {
          if (phase1.some(elem => elem.role === 'assistant' && elem.tool_calls && elem.tool_calls.some(tc => tc.type === 'function' && tc.function.name === 'get_random_character_name'))) {
            for (const elem of phase1) {
              if (elem.role === 'assistant' && elem.tool_calls) {
                for (const tc of tool_calls) {
                  if (tc.type === 'function' && tc.function.name === 'get_random_character_name') {
                    for (const name of tc.content.split(getPromptRaw('seperator_name_list', locale)).map(n => n.trim()))
                    newchars.push(name);
                  }
                }
              }
            }
          } else {
            toolResult = getPromptRaw('phase1_cmd_random_name_required', locale);
            phase1.push({ role: 'tool', tool_call_id: tool_call.id, content: toolResult });
            saveRound(round.id, { phase1_messages: phase1 });
            continue;
          }
        }
        if (newchars.length > 0) {
          const missing = [];
          for (const name of newchars) {
            if (cmd.joined_person_names.includes(name)) {
              if (!cmd.new_persons_long_term_traits || !cmd.new_persons_long_term_traits.some(trait => trait.includes(name))) {
                if (!systemPrompt.includes(name))
                  missing.push(name);
              }
            }
          }
          if (missing.length > 0) {
            toolResult = renderPrompt('phase1_cmd_missing_traits', locale, { names: missing.join(getPromptRaw('seperator_name_list', locale)) });
            phase1.push({ role: 'tool', tool_call_id: tool_call.id, content: toolResult });
            saveRound(round.id, { phase1_messages: phase1 });
            continue;
          }
        }
        const joinClauses = [];
        if (cmd.joined_person_names && cmd.joined_person_names.length > 0) {
          joinClauses.push(`@+(${renderPrompt('tool_gen_primary_participants', locale, { name_list: cmd.joined_person_names })})`);
          joinClauses.push(`!ir(${renderPrompt('tool_gen_participants', locale, { name_list: cmd.joined_person_names })})`);
        }
        if (cmd.joined_person_relations) {
          joinClauses.push(`+(${renderPrompt('tool_gen_relations', locale, { description: cmd.joined_person_relations })})`);
        }
        if (cmd.place) {
          joinClauses.push(`+(${renderPrompt('tool_gen_scene', locale, { description: cmd.place })})`);
        }
        if (cmd.new_persons_long_term_traits && cmd.new_persons_long_term_traits.length > 0) {
          for (const l of cmd.new_persons_long_term_traits) {
            if (l)
              joinClauses.push(`@+(${l})`);
          }
        }
        if (cmd.plans_and_something_expected_to_happen) {
          for (const p of cmd.plans_and_something_expected_to_happen) {
            if (p)
              joinClauses.push(`@(${p})`)
          }
        }

        if (cmd.interaction_type !== undefined) {
          const interaction_type = getPromptRaw('interaction_type', locale);
          joinClauses.push(`!i(${renderPrompt('tool_gen_interaction_type', locale, { name: interaction_type[cmd.interaction_type].name})})`);
          if (interaction_type[cmd.interaction_type].prompt)
            joinClauses.push(`@(${interaction_type[cmd.interaction_type].prompt})`);
        }

        const inner = joinClauses.join(' ');

        //console.log(`inner: ${JSON.stringify(inner)}`);
        
        const result = await compileDiaryLines(world, inner);

        if (result.error) {
          toolResult = getPromptRaw('phase1_cmd_internal_error', locale);
          phase1.push({ role: 'tool', tool_call_id: tool_call.id, content: toolResult });
          saveRound(round.id, { phase1_messages: phase1 });
          continue;
        }

        toolResult = getPromptRaw('phase1_cmd_invited', locale);
        phase1.push({ role: 'tool', tool_call_id: tool_call.id, content: toolResult, show_assistant: '[Invitation sent]' });
        saveRound(round.id, { phase1_messages: phase1, pending_start_chat: result });
        return { messages: getPhase1MessagesViewForUser(phase1), command: { type: 'start_chat', linesInvite: result.linesInvite } };
      }

      // Unknown command
      toolResult = `${getPromptRaw('phase1_cmd_unknown')} "${cmd.type}"`;
      phase1.push({ role: 'tool', tool_call_id: tool_call.id, content: toolResult });
    }

    // After processing all tool calls, loop to get next AI response
  }

  saveRound(round.id, { phase1_messages: phase1 });
  return { messages: getPhase1MessagesViewForUser(phase1), command: null };
}

// POST /api/worlds/:worldId/rounds/:roundId/chat/phase1
// User sends message to assistant, AI responds (may trigger find/create character in a loop)
router.post('/phase1', async (req, res) => {
  const { worldId, roundId } = req.params;
  const world = checkWorldAccess(worldId, req.userId);
  if (!world) return res.status(404).json({ error: "Could not find the world." });

  const round = getRound(roundId, worldId);
  if (!round) return res.status(404).json({ error: "Round not found." });
  if (round.status !== 'phase1') return res.status(400).json({ error: 'this round is not in phase 1' });

  const { message } = req.body;

  return res.json(await phase1Assistant(world, round, message));
});

// POST /api/worlds/:worldId/rounds/:roundId/chat/start_phase2
// Transition to phase2
router.post('/start_phase2', async (req, res) => {
  const { worldId, roundId } = req.params;
  const world = checkWorldAccess(worldId, req.userId);
  if (!world) return res.status(404).json({ error: "Could not find the world." });

  const round = getRound(roundId, worldId);
  if (!round) return res.status(404).json({ error: "Round not found." });

  const phase2Meta = {
    linesInvite: round.pending_start_chat.linesInvite,
    linesPlay: round.pending_start_chat.linesPlay,
    linesSummary: round.pending_start_chat.linesSummary,
    linesReview: round.pending_start_chat.linesReview,
    linesPersistent: round.pending_start_chat.linesPersistent,
    allCharsLeft: false,
  };

  saveRound(roundId, {
    status: 'phase2',
    phase2_messages: [],
    phase2_meta: phase2Meta,
    pending_start_chat: null,
  });

  res.json({
    ok: true,
    meta: phase2Meta,
   });
});

// POST /api/worlds/:worldId/rounds/:roundId/chat/phase2/user
// User sends message in phase2
router.post('/phase2/user', async (req, res) => {
  const { worldId, roundId } = req.params;
  const world = checkWorldAccess(worldId, req.userId);
  if (!world) return res.status(404).json({ error: "Could not find the world." });

  const locale = world.locale;

  const roundRaw = db.prepare('SELECT * FROM rounds WHERE id = ? AND world_id = ?').get(roundId, worldId);
  if (!roundRaw) return res.status(404).json({ error: "Round not found." });

  const round = {
    ...roundRaw,
    phase1_messages: JSON.parse(roundRaw.phase1_messages),
    phase2_messages: JSON.parse(roundRaw.phase2_messages),
    phase2_meta: roundRaw.phase2_meta ? JSON.parse(roundRaw.phase2_meta) : null,
  };

  if (round.status !== 'phase2') return res.status(400).json({ error: "This round is not in Phase 2." });

  const { message, singleLineMode, allowAfterUserComment } = req.body;
  const isSkip = !message || !message.trim();

  const meta = round.phase2_meta;
  const phase2 = round.phase2_messages;

  const newMessages = [];

  // Add user message (skip if empty — user chose to skip their turn)
  if (!isSkip) {
    phase2.push({ speaker: `${world.user_display_name}`, text: message });
  }

  const supressContinueAfterUserWords = getPhase2LastSpeaker(phase2) === world.user_display_name ? !allowAfterUserComment : false;

  const generator = new Phase2LineGenerator(world, meta.linesPlay);
  await generator.initialize();

  // Build context and get AI response
  //let context = buildPhase2Context(world, meta, phase2);
  //if (context.slice(-1) === '\n')
  //  context = context.slice(0, -1);

  let loopCount = 0;
  const maxLoopCount = 5;

  function endChat() {
    meta.allCharsLeft = true;
    db.prepare('UPDATE rounds SET phase2_messages = ?, phase2_meta = ? WHERE id = ?')
      .run(JSON.stringify(phase2), JSON.stringify(meta), roundId);
    res.json({ messages: phase2, event: 'all_left', newMessages, meta });
    return true
  }

  function userTurn() {
    db.prepare('UPDATE rounds SET phase2_messages = ?, phase2_meta = ? WHERE id = ?')
    .run(JSON.stringify(phase2), JSON.stringify(meta), roundId);

    // If user tried to skip but no new messages were generated, hint them to input
    const shouldInputHint = isSkip && newMessages.length <= 0;
    res.json({ messages: phase2, event: null, newMessages, shouldInputHint });
  }

  let _prevNewLine_prevNewLine = -1;
  //let _prevNewLine_sublines = [];
  let _prevNewLine_speaker;
  let _prevNewLine_isFirstLine = true;
  let _prevNewLine_match;
  const funMatchCharSpeaker = (multiline) => {
    if (_prevNewLine_match) return _prevNewLine_match;
    if (_prevNewLine_speaker) return null;
    const newline = multiline.lastIndexOf('\n');
    if (newline > _prevNewLine_prevNewLine) {
      let new_sublines = multiline.slice(_prevNewLine_prevNewLine + 1, newline).split('\n').map(l => l.trim()).filter(Boolean);
      _prevNewLine_prevNewLine = newline;

      for (const subline of new_sublines) {
        const msg = getSpeakerText(subline);
        if (msg.speaker !== '_continue')
          _prevNewLine_speaker = msg.speaker;
        if (!msg.text)
          continue;
        if (!_prevNewLine_speaker) {
          _prevNewLine_isFirstLine = false;
          continue;
        } else if (!singleLineMode) {
          return null;
        } else {
          const regex = new RegExp(`^\s*(${plainStringRegex(_prevNewLine_speaker)})\s*[:：].*()$`, 'md');
          const m = regex.exec(multiline);
          _prevNewLine_match = { index: m.indices[2][0], length: 1, isFirstLine: _prevNewLine_isFirstLine, 1: m[1] };
          return _prevNewLine_match;
        }
        break;
      }
    }

    let speaker = _prevNewLine_speaker;
    let isFirstLine = _prevNewLine_isFirstLine;
    if (!speaker) {
      let sublines = multiline.slice(newline + 1).split('\n').map(l => l.trim()).filter(Boolean);
      for (const subline of sublines) {
        const msg = getSpeakerText(subline);
        if (msg.speaker !== '_continue')
          speaker = msg.speaker;
        if (!msg.text)
          continue;
        if (!speaker) {
          isFirstLine = false;
          continue;
        } else if (!singleLineMode) {
          return null;
        }
        break;
      }
    }
    
    if (speaker) {
      if (!isFirstLine) {
        const regex = new RegExp(`^\s*(${plainStringRegex(speaker)})\s*[:：]`, 'm');
        _prevNewLine_match = regex.exec(multiline);
        _prevNewLine_match.isFirstLine = isFirstLine;
        return _prevNewLine_match;
      } else if (!singleLineMode) {
        _prevNewLine_speaker = speaker;
        return null;
      }
    }
  };

  let _funSingleLine_prevLast = -1;
  let _funSingleLine_match;
  const funSingleLine = (text) => {
    if (_funSingleLine_match) return _funSingleLine_match;
    const last = text.lastIndexOf('\n');
    while (last > _funSingleLine_prevLast) {
      const prevNextLast = text.indexOf('\n', _funSingleLine_prevLast + 1);
      if (text.slice(_funSingleLine_prevLast + 1, prevNextLast).trim()) {
        _funSingleLine_match = { index: prevNextLast, length: 1 };
        return _funSingleLine_match
      }
      _funSingleLine_prevLast = prevNextLast;
    }
  };

  const endingSequences = [
    '#', '--', '\n\n**',
    `${getPromptRaw('phase2_chat_title', locale)}:`,`${getPromptRaw('phase2_chat_title', locale)}：`,
    `${getPromptRaw('phase2_chat_summary', locale)}:`,`${getPromptRaw('phase2_chat_summary', locale)}：`,
  ];
  const stopSequences = [`${world.user_display_name}:`, `${world.user_display_name}：`, ...endingSequences];
  const stopSequencesSingleLine = [`${world.user_display_name}:`, `${world.user_display_name}：`, funSingleLine, ...endingSequences];
  const stopSequences2 = [funMatchCharSpeaker, `${world.user_display_name}:`, `${world.user_display_name}：`, ...endingSequences];
  
  let generateReturn;
  if (supressContinueAfterUserWords) {
    generateReturn = await generator.generate(phase2, world.user_display_name, true, stopSequences2, true);
  } else if (singleLineMode) {
    generateReturn = await generator.generate(phase2, world.user_display_name, true, stopSequencesSingleLine, true);
  } else {
    generateReturn = await generator.generate(phase2, world.user_display_name, true, stopSequences, true);
  }

  let multiline = generateReturn.text;
  multiline = multiline.trim();
  let sublines = multiline.split('\n').map(l => l.trim()).filter(Boolean);

  if (supressContinueAfterUserWords) {
    if (generateReturn.triggeredStopIndex === 0) {
      const speaker = generateReturn.triggeredStopMatch[1];
      if (speaker === world.user_display_name) {
        return userTurn();
      } else if (!generateReturn.triggeredStopMatch.isFirstLine) {
        //const _context = context + `${speaker}: `;
        if (singleLineMode)
          generateReturn = await generator.generate(phase2, speaker, false, ['\n', ...stopSequences]);
        else
          generateReturn = await generator.generate(phase2, speaker, false, stopSequences);

        multiline = generateReturn.text;
        multiline = multiline.trim();
        sublines = multiline.split('\n').map(l => l.trim()).filter(Boolean);
        if (sublines.length) {
          const msg = getSpeakerText(sublines[0]);
          if (msg.speaker === world.user_display_name || msg.speaker === '_continue')
            return userTurn();
        }
      } else {
        assert(singleLineMode);
      }
    } else {
      if (sublines.length > 0) {
        let speaker;
        for (const subline of sublines) {
          const msg = getSpeakerText(subline);
          if (msg.speaker !== '_continue')
            speaker = msg.speaker;
          if (!msg.text)
            continue;
          break;
        }
        if (!speaker) {
          sublines = [];
        }
      }
    }
  }

  for (const subline of sublines) {
    const msg = getSpeakerText(subline);
    phase2.push(msg);
    newMessages.push(msg);
  }

  if ((!generateReturn.triggeredStop && generateReturn.finish_reason !== 'length') || endingSequences.includes(generateReturn.triggeredStop)) {
    return endChat();
  }

  return userTurn();
});

// POST /api/worlds/:worldId/rounds/:roundId/chat/phase2/go_back
router.post('/phase2/go_back', async (req, res) => {
  const { worldId, roundId } = req.params;
  const world = checkWorldAccess(worldId, req.userId);
  if (!world) return res.status(404).json({ error: "Could not find the world." });

  const roundRaw = db.prepare('SELECT * FROM rounds WHERE id = ? AND world_id = ?').get(roundId, worldId);
  if (!roundRaw) return res.status(404).json({ error: "Round not found." });

  const { singleLineMode } = req.body;

  const round = {
    ...roundRaw,
    phase2_messages: JSON.parse(roundRaw.phase2_messages),
    phase2_meta: roundRaw.phase2_meta ? JSON.parse(roundRaw.phase2_meta) : null,
  };

  if (round.status !== 'phase2') return res.status(400).json({ error: "This round is not in Phase 2." });

  if (singleLineMode) {
    if (round.phase2_messages.length > 0)
      round.phase2_messages.pop();
  } else {
    while (round.phase2_messages.length > 0 && getPhase2LastSpeaker(round.phase2_messages) !== world.user_display_name)
      round.phase2_messages.pop();
    if (round.phase2_messages.length > 0)
      round.phase2_messages.pop();
  }

  db.prepare('UPDATE rounds SET phase2_messages = ? WHERE id = ?')
    .run(JSON.stringify(round.phase2_messages), roundId);

  res.json({ messages: round.phase2_messages });
});

// POST /api/worlds/:worldId/rounds/:roundId/chat/phase2/continue_chat
router.post('/phase2/continue_chat', async (req, res) => {
  const { worldId, roundId } = req.params;
  const world = checkWorldAccess(worldId, req.userId);
  if (!world) return res.status(404).json({ error: "Could not find the world." });

  const roundRaw = db.prepare('SELECT * FROM rounds WHERE id = ? AND world_id = ?').get(roundId, worldId);
  if (!roundRaw) return res.status(404).json({ error: "Round not found." });

  const round = {
    ...roundRaw,
    phase2_messages: JSON.parse(roundRaw.phase2_messages),
    phase2_meta: roundRaw.phase2_meta ? JSON.parse(roundRaw.phase2_meta) : null,
  };

  if (round.status !== 'phase2') return res.status(400).json({ error: "This round is not in Phase 2." });

  round.phase2_meta.allCharsLeft = false;

  db.prepare('UPDATE rounds SET phase2_meta = ? WHERE id = ?')
    .run(JSON.stringify(round.phase2_meta), roundId);

  res.json({ allCharsLeft: round.phase2_meta.allCharsLeft });
});


// Finish round and generate review
router.post('/finish', async (req, res) => {
  const { worldId, roundId } = req.params;
  const world = checkWorldAccess(worldId, req.userId);
  if (!world) return res.status(404).json({ error: "Could not find the world." });

  const roundRaw = db.prepare('SELECT * FROM rounds WHERE id = ? AND world_id = ?').get(roundId, worldId);
  if (!roundRaw) return res.status(404).json({ error: "Round not found." });

  const round = {
    ...roundRaw,
    phase1_messages: JSON.parse(roundRaw.phase1_messages),
    phase2_messages: JSON.parse(roundRaw.phase2_messages),
  };

  if (!roundRaw.phase2_meta) return res.status(404).json({ error: "Metadata for Phase 2 not found." });

  // Update all present characters
  const phase2_meta = JSON.parse(roundRaw.phase2_meta);
  const reviewContext = buildPhase2Context(world, phase2_meta, round.phase2_messages, { stage: 'summary' });
  const reviews = getRoundsDiaryReviews(worldId);
  const diaryMessage = genDiarySummaryMessages(world, reviews);

  const roundReview = await generateRoundReview(world, diaryMessage, reviewContext);
  roundReview.linesReview = phase2_meta.linesReview;
  roundReview.linesPersistent = phase2_meta.linesPersistent;
  
  db.prepare('UPDATE rounds SET status = ?, review = ?, finished_at = unixepoch() WHERE id = ?')
    .run('finished', JSON.stringify(roundReview), roundId);

  res.json({ roundReview });
});

// DELETE /api/worlds/:worldId/rounds/:roundId - discard phase1 round
router.delete('/', async (req, res) => {
  const { worldId, roundId } = req.params;
  const world = checkWorldAccess(worldId, req.userId);
  if (!world) return res.status(404).json({ error: "Could not find the world." });

  const round = db.prepare('SELECT * FROM rounds WHERE id = ? AND world_id = ?').get(roundId, worldId);
  if (!round) return res.status(404).json({ error: "Round not found." });

  db.prepare('DELETE FROM rounds WHERE id = ?').run(roundId);
  res.json({ ok: true });
});

export default router;