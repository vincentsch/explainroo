// One function per scene in script.md, with the same names. Each function draws
// one frame of its scene, and s.t is the time in seconds since the scene
// started. Give elements an `at` time (seconds, a spoken word or "#marker") and
// the look animates them in. Run "npx --yes explainroo docs scene-api" to read
// the full scene API.
//
// Everything is placed from s.safe, the part of the frame that is free for
// content, so the same file works in 16:9 and in a tall frame. s.portrait is
// true in a tall frame, where a layout can stack what a wide one puts side by
// side.
//
// Each note below says what the picture of its scene has to do. Replace it
// with that picture: a diagram, a number, a real screen or an object that
// moves, never a card that repeats the narration. "npx --yes explainroo docs
// pictures" has layouts to start from and shows how a card becomes a picture.

export default {
  intro(s) {
    const { top, h, w } = s.safe;
    const u = Math.min(w, h) / 100;
    // at: -1 puts the title on the first frame, which many apps show as the thumbnail.
    s.title('{{title}}', { y: top + h * (s.portrait ? 0.3 : 0.38), size: u * 11, at: -1 });
    s.note('Show the topic here on the first frame: the object, the number or the problem itself', { y: top + h * (s.portrait ? 0.6 : 0.68), size: u * 4.5, maxWidth: w * 0.8, at: -1 });
  },

  main(s) {
    const { top, h, w } = s.safe;
    const u = Math.min(w, h) / 100;
    s.note('Show the idea happening here: what goes in, what happens to it and what comes out, one part on each cue', { y: top + h * 0.5, size: u * 4.5, maxWidth: w * 0.8, at: 0 });
  },

  outro(s) {
    const { top, h, w } = s.safe;
    const u = Math.min(w, h) / 100;
    s.note('Answer the opening question here in one picture, the one the viewer should remember', { y: top + h * 0.5, size: u * 4.5, maxWidth: w * 0.8, at: 0 });
  },
};
