// Each scene of script.md is a span of your recording, and a scene without a
// function here shows just that span. To put something on the speaker's
// words, give the scene a function: draw the recording with s.footage() first,
// then what goes on top, each on its own cue. "npx --yes explainroo docs
// footage" has the layouts that work, also for tall sizes.
//
//   s03(s) {
//     s.footage();
//     s.text('Three times faster', { y: s.safe.top + s.safe.h * 0.12, size: 64, bg: true, at: 'faster' });
//   },
//
// A cutaway shows a drawing over the whole frame while the voice goes on:
//
//   s05(s) {
//     s.footage({ out: 'diagram' });
//     s.icon('database', { size: 300, at: 'diagram' });
//   },

export default {};
