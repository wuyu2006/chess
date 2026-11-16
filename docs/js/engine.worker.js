/* GAMBIT local engine worker */
import { chooseLocalMove } from './engine.js';

self.onmessage = (event) => {
  const { id, fen, options } = event.data || {};
  try {
    const result = chooseLocalMove(fen, options || {});
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error?.message || 'Local engine failed.' });
  }
};
