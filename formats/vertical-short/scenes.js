// The example of the vertical-short format: why a phone battery dies in the
// cold. Every scene changes the picture at least every two seconds.
import { backdrop, beats, fact, hookFrame, payoff, punch } from './format.js';

export default {
  hook(s) {
    s.camera(punch(s, '#dies', { zoom: 1.15 }));
    hookFrame(s, 'Your phone dies in the *cold*', { icon: 'battery-low', color: 'orange' });
    fact(s, '*20*%', { at: '#twenty' });
    s.short.flash('#dies', { color: '#4dabf7', alpha: 0.35 });
  },

  why(s) {
    s.camera(punch(s, 'enough', { zoom: 1.15 }));
    backdrop(s);
    s.short.step(1, 2);
    beats(s, [
      { at: '#still', icon: 'battery-medium', label: 'Still charged', color: 'green' },
      { at: '#slow', icon: 'snowflake', label: 'Cold slows it', color: 'blue' },
      { at: '#chem', icon: 'flask-conical', label: 'Slow chemistry', color: 'purple' },
      { at: '#power', icon: 'zap-off', label: 'Not enough power', color: 'orange' },
    ]);
  },

  turn(s) {
    s.camera(punch(s, '#back'));
    s.short.interrupt('#turn', { flash: false });
    backdrop(s, { glow: '#f59f00', pattern: 'rays' });
    s.short.step(2, 2);
    beats(s, [
      { at: '#turn', icon: 'sparkles', label: 'The good part', color: 'yellow' },
      { at: '#warm', icon: 'sun', label: 'Warm it up', color: 'orange' },
      { at: '#back', icon: 'battery-full', label: 'It comes back', color: 'green' },
    ]);
  },

  tip(s) {
    s.camera(punch(s, '#harm', { zoom: 1.12 }));
    payoff(s, 'Keep it warm', [
      { text: 'Inside pocket', at: '#pocket' },
      { text: 'No charging while frozen', at: '#charge' },
    ]);
  },
};
