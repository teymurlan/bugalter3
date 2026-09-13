import { state } from './state.js';

if (state && typeof state.resetDraft === 'function' && !state.__releaseResetWrapped) {
  const originalReset = state.resetDraft.bind(state);
  state.resetDraft = async function resetDraftWithoutUiDelay() {
    const cleanup = originalReset();
    Promise.resolve(cleanup).catch((error) => console.warn('Draft cleanup continued in background', error));
  };
  state.__releaseResetWrapped = true;
}
