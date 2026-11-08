// One function per scene in script.md, with the same names. Each function draws
// one frame of its scene, and s.t is the time in seconds since the scene
// started. Give elements an `at` time (seconds, a spoken word or "#marker") and
// the look animates them in. Run "npx --yes explainroo docs scene-api" to read
// the full scene API.
//
// Everything is placed from s.safe, the part of the frame that is free for
// content, so the same file works in 16:9 and in a tall frame. s.portrait is
// true in a tall frame, where a layout can stack what a wide one puts side by
// side. Replace each placeholder line with the picture of that scene.

export default {
  intro(s) {
    const { top, h, w } = s.safe;
    const u = Math.min(w, h) / 100;
    s.title('{{title}}', { y: top + h * (s.portrait ? 0.3 : 0.38), size: u * 11, at: 0 });
    s.box('The picture for the intro goes here', { y: top + h * (s.portrait ? 0.6 : 0.7), size: u * 5.5, at: 0.4 });
  },

  main(s) {
    const { top, h, w } = s.safe;
    const u = Math.min(w, h) / 100;
    s.box('The picture for the main idea goes here', { y: top + h * 0.5, size: u * 5.5, at: 0 });
  },

  outro(s) {
    const { top, h, w } = s.safe;
    const u = Math.min(w, h) / 100;
    s.text('The summary goes here', { y: top + h * 0.5, size: u * 6, at: 0 });
  },
};
