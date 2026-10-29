import { sendToBackground, toUserError } from '@/lib/messages';
import { getSettings, LANGUAGES, LENGTHS, MODELS, setSettings, STYLES, type Settings } from '@/lib/storage';

const form = document.getElementById('form') as HTMLFormElement;
const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const toggle = document.getElementById('toggle') as HTMLButtonElement;
const modelSelect = document.getElementById('model') as HTMLSelectElement;
const languageSelect = document.getElementById('language') as HTMLSelectElement;
const lengthSelect = document.getElementById('length') as HTMLSelectElement;
const styleSelect = document.getElementById('style') as HTMLSelectElement;
const testButton = document.getElementById('test') as HTMLButtonElement;
const status = document.getElementById('status')!;

const fill = (select: HTMLSelectElement, options: readonly { id: string; label: string }[]) =>
  select.append(...options.map((o) => new Option(o.label, o.id)));
fill(modelSelect, MODELS);
fill(languageSelect, LANGUAGES);
fill(lengthSelect, LENGTHS);
fill(styleSelect, STYLES);

void getSettings().then((s) => {
  apiKeyInput.value = s.apiKey;
  modelSelect.value = s.model;
  languageSelect.value = s.language;
  lengthSelect.value = s.length;
  styleSelect.value = s.style;
});

toggle.addEventListener('click', () => {
  const hidden = apiKeyInput.type === 'password';
  apiKeyInput.type = hidden ? 'text' : 'password';
  toggle.textContent = hidden ? 'Hide' : 'Show';
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  await setSettings(current());
  showStatus('Saved.', 'ok');
});

testButton.addEventListener('click', async () => {
  const { apiKey, model } = current();
  if (!apiKey) return showStatus('Enter an API key first.', 'error');
  testButton.disabled = true;
  showStatus('Testing…', 'pending');
  try {
    await sendToBackground({ type: 'testKey', apiKey, model });
    showStatus('Key works.', 'ok');
  } catch (err) {
    showStatus(toUserError(err).message.replace(', check Options', ''), 'error');
  } finally {
    testButton.disabled = false;
  }
});

function current(): Settings {
  // The selects only hold values from the option lists, so the casts are safe.
  return {
    apiKey: apiKeyInput.value.trim(),
    model: modelSelect.value as Settings['model'],
    language: languageSelect.value,
    length: lengthSelect.value as Settings['length'],
    style: styleSelect.value as Settings['style'],
  };
}

function showStatus(text: string, kind: 'ok' | 'error' | 'pending'): void {
  status.textContent = text;
  status.className = kind;
}
