import { sendToBackground, toUserError } from '@/lib/messages';
import { getSettings, MODELS, setSettings, type ModelId } from '@/lib/storage';

const form = document.getElementById('form') as HTMLFormElement;
const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const toggle = document.getElementById('toggle') as HTMLButtonElement;
const modelSelect = document.getElementById('model') as HTMLSelectElement;
const testButton = document.getElementById('test') as HTMLButtonElement;
const status = document.getElementById('status')!;

modelSelect.append(...MODELS.map((m) => new Option(m.label, m.id)));

void getSettings().then(({ apiKey, model }) => {
  apiKeyInput.value = apiKey;
  modelSelect.value = model;
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

function current(): { apiKey: string; model: ModelId } {
  return { apiKey: apiKeyInput.value.trim(), model: modelSelect.value as ModelId };
}

function showStatus(text: string, kind: 'ok' | 'error' | 'pending'): void {
  status.textContent = text;
  status.className = kind;
}
