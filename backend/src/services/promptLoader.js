import assert from 'node:assert/strict';
import { promises as fsPromises } from 'fs';
import path from 'path';
import yaml from 'js-yaml';

let g_prompts = null;
let g_defaultLocale = null;

/**
 * Load and cache the prompts YAML file.
 */
async function loadPrompts() {
  if (g_prompts) return;

  let prompts, userPrompts;
  try {
    const filePath = path.join(path.dirname(process.argv[1]), '..', 'prompts', 'prompts.yaml');
    const raw = await fsPromises.readFile(filePath, 'utf-8');
    prompts = yaml.load(raw);
  } catch (error) {
    console.log(`[loadPrompts] Error: failed to load prompts.yaml`);
    console.log(`[loadPrompts] Error: ${error.message}`);
    assert(false);
  }
  try {
    const filePath = path.join(path.dirname(process.argv[1]), '..', 'prompts', 'user-prompts.yaml');
    const raw = await fsPromises.readFile(filePath, 'utf-8');
    userPrompts = yaml.load(raw);
  } catch (error) {
    console.log(`[loadPrompts] Warning: failed to load user-prompts.yaml`);
    console.log(`[loadPrompts] Warning: ${error.message}`);
  }

  const locales = ['en', 'zh-TW', 'zh-CN'];

  const funSingleTraverse = (prompts, locale) => {
    if (typeof prompts === 'object' && !Array.isArray(prompts)) {
      if (locale === null) {  // default locale
        const defaultLocale = Object.keys(prompts)[0];
        if (locales.includes(defaultLocale))
          return prompts[defaultLocale];
      } else {
        if (prompts[locale] !== undefined)
          return prompts[locale];
      }
    }

    if (typeof prompts === 'object') {
      if (Array.isArray(prompts)) {
        const result = [];
        for (const v of prompts) {
          assert(v !== undefined);
          result.push(funSingleTraverse(v));
        }
        return result;
      } else {
        const result = {};
        for (const k of Object.keys(prompts)) {
          assert(prompts[k] !== undefined);
          result[k] = funSingleTraverse(prompts[k], locale);
        }
        return result;
      }
    } else {
      return prompts;
    }
  };
  const funTraverse = (prompts, userPrompts, locale, localePrompts=undefined, localeUserPrompts=undefined) => {
    if (localePrompts === undefined && typeof prompts === 'object' && !Array.isArray(prompts)) {
      if (locale === null) {  // default locale
        const defaultLocale = Object.keys(prompts)[0];
        if (locales.includes(defaultLocale)) {
          prompts = prompts[defaultLocale];
          localePrompts = null;
        }
      } else {
        if (prompts[locale] !== undefined) {
          prompts = prompts[locale];
          localePrompts = locale;
        }
      }
    }

    if (localeUserPrompts === undefined && typeof userPrompts === 'object' && !Array.isArray(userPrompts)) {
      if (locale === null) {  // default locale
        const defaultLocale = Object.keys(userPrompts)[0];
        if (locales.includes(defaultLocale)) {
          userPrompts = userPrompts[defaultLocale];
          localeUserPrompts = null;
        }
      } else {
        if (userPrompts[locale] !== undefined) {
          userPrompts = userPrompts[locale];
          localeUserPrompts = locale;
        }
      }
    }

    if (typeof prompts === 'object') {
      if (Array.isArray(prompts)) {
        if (userPrompts !== undefined) {
          assert(typeof userPrompts === 'object');
          assert(Array.isArray(userPrompts));
          if (localeUserPrompts === undefined) {
            return funSingleTraverse(userPrompts, locale);
          } else {
            assert(localeUserPrompts === locale);
            return userPrompts;
          }
        } else if (localePrompts === undefined) {
          return funSingleTraverse(prompts, locale);
        } else {
          assert(localePrompts === locale);
          return prompts;
        }
      } else {
        if (userPrompts !== undefined) {
          assert(typeof userPrompts === 'object');
          assert(!Array.isArray(userPrompts));
          const result = {};
          for (const k of Object.keys(prompts)) {
            assert(prompts[k] !== undefined);
            if (userPrompts[k] !== undefined) {
              result[k] = funTraverse(prompts[k], userPrompts[k], locale, localePrompts, localeUserPrompts);
            } else if (localePrompts === undefined) {
              result[k] = funSingleTraverse(prompts[k], locale);
            } else {
              assert(localePrompts === locale);
              result[k] = prompts[k];
            }
          }
          return result;
        } else if (localePrompts === undefined) {
          return funSingleTraverse(prompts, locale);
        } else {
          assert(localePrompts === locale);
          return prompts;
        }
      }
    } else if (prompts !== undefined) {
      assert(typeof userPrompts !== 'object');
      if (userPrompts !== undefined)
        return userPrompts;
      else
        return prompts
    } else {
      assert(userPrompts === undefined);
      return undefined;
    }
  };

  g_prompts = {};
  g_prompts[''] = funTraverse(prompts, userPrompts, null);
  for (const locale of locales)
    g_prompts[locale] = funTraverse(prompts, userPrompts, locale);
}


/**
 * Get the raw (un-rendered) text for a prompt key in the requested locale,
 * falling back to the default locale if not found.
 *
 * @param {string} key   - Prompt key, e.g. 'phase1_system_intro'
 * @param {string} locale - Locale string, e.g. 'zh-TW', 'en', 'zh-CN'
 * @returns {string}
 */
export function getPromptRaw(keyString, locale) {
  if (!g_prompts) throw new Error('[promptLoader] Prompts not loaded. Call loadPrompts() first.');

  if (!keyString) throw new Error('[promptLoader] keyString should not be empty.');

  const keys = keyString.split('.');

  let walk = g_prompts[''];
  let count = 0;
  for (const k of keys) {
    ++count;
    walk = walk[k];
    if (walk === undefined) {
      throw new Error(`[promptLoader] Unknown prompt key: "${keyString}" (unknown prefix: "${keys.slice(0, count).join('.')}")`);
    }
  }

  if (locale) {
    let walk2 = g_prompts[locale];
    for (const k of keys) {
      walk2 = walk2[k];
      if (walk2 === undefined) {
        break;
      }
    }

    return walk2 !== undefined ? walk2 : walk;
  } else {
    console.log(`[promptLoader] Warning: get value of default locale, for keyString "${keyString}".`);
    return walk;
  }
}

/**
 * Render a prompt: get its text and substitute {{variable}} placeholders.
 *
 * @param {string} key    - Prompt key
 * @param {string} locale - Locale string
 * @param {Object} vars   - Variables to substitute, e.g. { world_name: 'Foo' }
 * @returns {string}
 */
export function renderPrompt(key, locale, vars = {}) {
  let text = getPromptRaw(key, locale);
  for (let [k, v] of Object.entries(vars)) {
    if (Array.isArray(v)) {
      const seperator = getPromptRaw('seperator_' + k, locale);
      v = v.join(seperator);
    }
    text = text.replaceAll(`{{${k}}}`, v ?? '');
  }
  return text;
}

/**
 * Must be called once at startup (before any renderPrompt calls).
 */
export { loadPrompts };
