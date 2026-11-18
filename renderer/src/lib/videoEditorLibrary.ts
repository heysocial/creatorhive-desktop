/* COPIED from creatorhive-app lib/video-editor/library.ts (the built-in music the editor may pick). Re-copy when it changes. */
/*
  Built-in music and sound effects the editor may pick when a student brings
  none (Sebastian's data/library.json). Empty until Valentin or Sebastian
  sends royalty-free tracks: upload them to R2 under video-editor/library/ and
  list them here ({ id, key, name }).
*/
export const VE_LIBRARY: {
  tracks: { id: string; key: string; name: string }[];
  sfx: { id: string; key: string; name: string }[];
} = {
  tracks: [],
  sfx: [],
};
